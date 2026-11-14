import { spawn, type ChildProcess } from "child_process";
import { access, copyFile, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { killTree } from "./managedProcess";

// ── Resource paths ────────────────────────────────────────────────────────────
// Resolved lazily so the module can be imported in non-Electron environments
// (e.g. vitest) without crashing.

interface ResourceDirs { pythonDir: string; cliDir: string; bunDir: string }

function resolveResourceDirs(): ResourceDirs {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { app } = require("electron") as typeof import("electron");
		if (app.isPackaged) {
			const base = process.resourcesPath;
			return { pythonDir: join(base, "python"), cliDir: join(base, "cli"), bunDir: join(base, "bun") };
		}
		return devDirs(app.getAppPath());
	} catch {
		return devDirs(process.cwd());
	}
}

function devDirs(root: string): ResourceDirs {
	const src = join(root, "src");
	// vendor/bun is filled by `node scripts/fetch-bun.mjs`.
	return { pythonDir: join(src, "python"), cliDir: join(src, "main"), bunDir: join(root, "vendor", "bun") };
}

const { pythonDir: PYTHON_DIR, cliDir: CLI_DIR, bunDir: BUN_DIR } = resolveResourceDirs();

// ── Constants ─────────────────────────────────────────────────────────────────

export const IS_WIN            = process.platform === "win32";
export const YOLO_DIR          = join(homedir(), ".nab");
export const RUNTIME_DIR       = join(YOLO_DIR, "python-runtime");
export const VENV_DIR          = join(YOLO_DIR, "venv");
export const RUNTIME_PYTHON    = join(RUNTIME_DIR, "python", IS_WIN ? "python.exe" : "bin/python3");
export const VENV_PYTHON       = join(VENV_DIR, IS_WIN ? "Scripts/python.exe" : "bin/python");
export const VENV_READY_MARKER = join(VENV_DIR, ".ready");
export const CLI_ENTRY         = join(CLI_DIR, "cli.ts");
// TypeScript sources the standalone CLI is compiled from (cli.ts and the
// modules it imports). Keep in sync with extraResources in electron-builder.config.ts.
export const CLI_SOURCES       = ["cli.ts", "util.ts", "managedProcess.ts", "engine.ts"];
export const BUNDLED_BUN       = join(BUN_DIR, IS_WIN ? "bun.exe" : "bun");
export const TRAIN_SCRIPT      = join(PYTHON_DIR, "train.py");
export const INFER_SCRIPT      = join(PYTHON_DIR, "infer.py");
export const LOGGER_SCRIPT     = join(PYTHON_DIR, "logger.py");
export const EXPORT_SCRIPT     = join(PYTHON_DIR, "export.py");
export const YOLO_UTILS_SCRIPT = join(PYTHON_DIR, "yolo_utils.py");
export const PUSH_SCRIPT       = join(PYTHON_DIR, "push_to_hub.py");
export const HUB_LOGS_DIR      = join(YOLO_DIR, "hub-logs");
export const MODELS_DIR        = join(YOLO_DIR, "models");
export const RUNTIME_TARBALL   = join(YOLO_DIR, "python-runtime.tar.gz");

// ── Types ─────────────────────────────────────────────────────────────────────

export type Detection = {
	classIndex: number; label: string; confidence: number;
	cx: number; cy: number; w: number; h: number;
};

export type LineHandler = (line: string) => Promise<void>;
type RunProcessOptions = {
	stdinData?: string;
	stdoutHandler?: LineHandler;
	stderrHandler?: LineHandler;
	collectStdout?: boolean;
	collectStderr?: boolean;
	env?: Record<string, string | undefined>;
	runId?: string;
};

// ── Process registry ──────────────────────────────────────────────────────────

export const runningProcesses = new Map<string, ChildProcess>();

// ── Helpers ───────────────────────────────────────────────────────────────────

export function safeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function parseLastJsonLine(stdout: string): Record<string, unknown> | null {
	const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
	try { return JSON.parse(line); } catch { return null; }
}

// Strip ANSI/CSI escape sequences and collapse \r-overwritten lines.
export function cleanLine(raw: string): string {
	const segments = raw.split("\r");
	return segments[segments.length - 1].replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

export async function fileExists(p: string): Promise<boolean> {
	try { await access(p); return true; } catch { return false; }
}

export function coalescePipProgress(log: LineHandler): LineHandler {
	let lastTotal = 0;
	let lastBucket = -1;

	return async (line: string) => {
		const match = line.match(/^Progress\s+(\d+)\s+of\s+(\d+)/i);
		if (!match) { await log(line); return; }

		const done  = Number(match[1]);
		const total = Number(match[2]);
		if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return;

		if (total !== lastTotal) { lastTotal = total; lastBucket = -1; }

		const pct    = Math.min(100, Math.floor((done / total) * 100));
		const bucket = pct === 100 ? 100 : Math.floor(pct / 5) * 5;
		if (bucket <= lastBucket && pct !== 100) return;
		lastBucket = bucket;

		const doneMB  = (done  / (1024 * 1024)).toFixed(1);
		const totalMB = (total / (1024 * 1024)).toFixed(1);
		await log(`Download progress ${pct}% (${doneMB}/${totalMB} MB)`);
	};
}

// ── Stream helpers (Node.js Readable streams) ─────────────────────────────────

function streamPipe(
	readable: NodeJS.ReadableStream | null | undefined,
	onLine?: LineHandler,
	collect = false,
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!readable) { resolve(""); return; }
		let text = "";
		let buf  = "";

		readable.on("data", (chunk: Buffer | string) => {
			const decoded = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
			if (collect) text += decoded;
			if (!onLine) return;
			buf += decoded;
			const lines = buf.split(/\r\n|\n|\r/);
			buf = lines.pop() ?? "";
			for (const line of lines) {
				const clean = cleanLine(line);
				if (clean) onLine(clean).catch(() => {});
			}
		});

		readable.on("end", () => {
			if (onLine && buf) {
				const clean = cleanLine(buf);
				if (clean) {
					onLine(clean).catch(() => {}).finally(() => resolve(text));
					return;
				}
			}
			resolve(text);
		});

		readable.on("error", reject);
	});
}

export async function runProcess(
	cmd: string[],
	{
		stdinData,
		stdoutHandler,
		stderrHandler,
		collectStdout = true,
		collectStderr = true,
		env,
		runId,
	}: RunProcessOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const [executable, ...args] = cmd;
	const proc = spawn(executable, args, {
		stdio: ["pipe", "pipe", "pipe"],
		env:   env ? { ...process.env, ...env } : process.env as Record<string, string>,
		// Own process group, so killTree() also stops children (pip under `script`).
		detached: !IS_WIN,
	});

	if (runId) {
		const existing = runningProcesses.get(runId);
		if (existing) {
			console.log(`[util] Killing existing process for runId: ${runId}`);
			killTree(existing);
			runningProcesses.delete(runId);
		}
		runningProcesses.set(runId, proc);
	}

	proc.stdin?.write(stdinData ?? "", "utf-8");
	proc.stdin?.end();

	try {
		let spawnError: Error | null = null;
		const exitCodePromise = waitForExit(proc, err => { spawnError = err; });
		const stdoutPromise = streamPipe(proc.stdout, stdoutHandler, collectStdout);
		const stderrPromise = streamPipe(proc.stderr, stderrHandler, collectStderr);
		const exitCode = await exitCodePromise;
		// A process that never started has pipes that never end; don't wait on them.
		if (spawnError) return { stdout: "", stderr: (spawnError as Error).message, exitCode };
		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
		return { stdout, stderr, exitCode };
	} finally {
		if (runId && runningProcesses.get(runId) === proc) runningProcesses.delete(runId);
	}
}

/**
 * Resolves with the process exit code. A process killed by a signal (Node
 * reports code null) or one that failed to start counts as a failure (1),
 * never as success.
 */
export function waitForExit(proc: ChildProcess, onSpawnError?: (err: Error) => void): Promise<number> {
	return new Promise(resolve => {
		proc.once("error", err => { onSpawnError?.(err); resolve(1); });
		proc.once("close", code => resolve(code ?? 1));
	});
}

export async function streamProcessOutput(
	proc: ChildProcess,
	handlers: { stdoutHandler?: LineHandler; stderrHandler?: LineHandler },
): Promise<void> {
	await Promise.all([
		streamPipe(proc.stdout, handlers.stdoutHandler, false),
		streamPipe(proc.stderr, handlers.stderrHandler, false),
	]);
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function checkpointPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "last.pt");
}

export function modelPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "best.pt");
}

// ── PTY wrapper ───────────────────────────────────────────────────────────────

export async function runWithPTY(
	cmd: string[],
	options: RunProcessOptions = {},
): Promise<{ exitCode: number }> {
	if (process.platform !== "linux" && process.platform !== "darwin") {
		const { exitCode } = await runProcess(cmd, options);
		return { exitCode };
	}

	let ptyCmd: string[];
	if (process.platform === "linux") {
		const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
		ptyCmd = ["script", "-q", "-e", "-c", cmd.map(shellQuote).join(" "), "/dev/null"];
	} else {
		ptyCmd = ["script", "-q", "/dev/null", ...cmd];
	}

	const { exitCode } = await runProcess(ptyCmd, options);
	return { exitCode };
}

// ── buildCLIArtifact ──────────────────────────────────────────────────────────

/** Bun used to compile CLI exports: NAB_BUN override, then the bundled copy. */
async function resolveBun(): Promise<string | null> {
	const override = process.env.NAB_BUN;
	if (override) return override;
	return (await fileExists(BUNDLED_BUN)) ? BUNDLED_BUN : null;
}

export async function buildCLIArtifact(modelPath: string, outBinary: string, runId: string): Promise<string | null> {
	const buildDir = await mkdtemp(join(tmpdir(), "nab-cli-"));
	let stderr = "";

	try {
		for (const file of CLI_SOURCES) await copyFile(join(CLI_DIR, file), join(buildDir, file));
		await copyFile(modelPath,         join(buildDir, "model.pt"));
		await copyFile(INFER_SCRIPT,      join(buildDir, "infer.py"));
		await copyFile(LOGGER_SCRIPT,     join(buildDir, "logger.py"));
		await copyFile(YOLO_UTILS_SCRIPT, join(buildDir, "yolo_utils.py"));

		const bun = await resolveBun();
		if (!bun) return "The bundled Bun compiler is missing. Reinstall Nab, or run `node scripts/fetch-bun.mjs` in a dev checkout.";

		const buildArgs = ["build", "--compile", "--minify", join(buildDir, "cli.ts"), "--outfile", outBinary];
		const proc = spawn(bun, buildArgs, { stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN });
		runningProcesses.set(runId, proc);
		try {
			// If Bun fails to start, its pipes never emit "end", so don't wait on
			// the output in that case.
			let spawnFailed = false;
			const exited = waitForExit(proc, err => { spawnFailed = true; stderr += `${err.message}\n`; });
			const streamed = streamProcessOutput(proc, {
				stderrHandler: async line => { stderr += line + "\n"; },
			});
			const exitCode = await exited;
			if (!spawnFailed) await streamed;
			if (exitCode !== 0) return stderr.trim() || "Unknown build failure";
			return null;
		} finally {
			runningProcesses.delete(runId);
		}
	} finally {
		await rm(buildDir, { recursive: true, force: true }).catch(() => {});
	}
}
