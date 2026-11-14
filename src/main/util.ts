import { spawn, type ChildProcess } from "child_process";
import { access, appendFile, copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "fs/promises";
import { createHash } from "crypto";
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
export const UTIL_ENTRY        = join(CLI_DIR, "util.ts");
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

type LineHandler = (line: string) => Promise<void>;
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

// ── downloadPythonRuntime ─────────────────────────────────────────────────────

// Pinned python-build-standalone build. Bump deliberately: update the release,
// version and every checksum (from the release's SHA256SUMS file) together.
const PYTHON_RELEASE = "20261026";
const PYTHON_VERSION = "3.12.16";
const PYTHON_ASSETS: Record<string, { triple: string; sha256: string }> = {
	"linux-x64":    { triple: "x86_64-unknown-linux-gnu",  sha256: "ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20" },
	"linux-arm64":  { triple: "aarch64-unknown-linux-gnu", sha256: "bb4b6392670c5d3f93876996fcaa19858a4a413a0c7720144c18b0d6f1f0db2d" },
	"darwin-x64":   { triple: "x86_64-apple-darwin",       sha256: "37c38fda76fec1fbf310adcbafb7f0d96af13b5511bf8ea954c3aa8eec185734" },
	"darwin-arm64": { triple: "aarch64-apple-darwin",      sha256: "353d5f1b4fd2715e7053f12f068435d5bbad16b91e057006b5d01e0925709a7e" },
	"win32-x64":    { triple: "x86_64-pc-windows-msvc",    sha256: "1f2ab53880fc67ea323398c6388e05af28addc99a8e389209f08a51fdff4b149" },
};

export function pythonRuntimeAsset(platformKey = `${process.platform}-${process.arch}`) {
	const asset = PYTHON_ASSETS[platformKey];
	if (!asset) return null;
	const filename = `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${asset.triple}-install_only_stripped.tar.gz`;
	return {
		filename,
		url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${encodeURIComponent(filename)}`,
		sha256: asset.sha256,
	};
}

export async function downloadPythonRuntime(
	destPath: string,
	log: (text: string) => Promise<void>,
): Promise<void> {
	const platformKey = `${process.platform}-${process.arch}`;
	const asset = pythonRuntimeAsset(platformKey);
	if (!asset) throw new Error(`Unsupported platform for Python download: ${platformKey}`);

	await log(`[setup] Downloading Python runtime: ${asset.filename}...`);
	const dlRes = await fetch(asset.url, { headers: { "User-Agent": "Nab" } });
	if (!dlRes.ok || !dlRes.body) throw new Error(`Download failed: ${dlRes.status}`);

	await mkdir(YOLO_DIR, { recursive: true });
	const hash = createHash("sha256");
	const chunks: Uint8Array[] = [];
	const reader = dlRes.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		hash.update(value);
	}
	if (hash.digest("hex") !== asset.sha256)
		throw new Error("Python runtime download is corrupt (checksum mismatch). Check your connection and try again.");
	const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const c of chunks) { buf.set(c, offset); offset += c.length; }
	await writeFile(destPath, buf);
	await log("[setup] Python runtime downloaded.");
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

// ── prepareEnvironment ────────────────────────────────────────────────────────

// Training engine versions installed into ~/.nab/venv. Pinned so a new
// upstream release can't break new installs. These live in code (not a
// requirements file) so the standalone CLI export gets them too. Bump on
// purpose, test training/inference/export, then release; existing installs
// update on their next start. torch and torchvision must be a matching pair.
export const ENGINE_REQUIREMENTS = [
	"ultralytics==8.4.196",
	"torch==2.14.1",
	"torchvision==0.29.1",
	"psutil==7.2.2",
];

const VENV_CHECK =
	"import importlib.util as u, sys; " +
	"sys.exit(0 if all(u.find_spec(m) for m in ('ultralytics', 'torch')) else 1)";

export async function prepareEnvironment(
	logPath: string,
	runId: string,
	stderrHandler?: LineHandler,
): Promise<string> {
	const log = async (text: string) => {
		await appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});
		await stderrHandler?.(text);
	};

	const runOpts = {
		stdoutHandler: log,
		stderrHandler: log,
		collectStdout: false,
		collectStderr: false,
		env: { ...process.env, PYTHONUNBUFFERED: "1" },
		runId,
	};

	async function run(cmd: string[], label: string): Promise<void> {
		const { exitCode } = await runProcess(cmd, runOpts);
		if (exitCode !== 0) {
			await log(`[setup] error: ${label} failed (exit ${exitCode})`);
			throw new Error(`${label} failed with exit code ${exitCode}`);
		}
	}

	async function runPip(packages: string[], label: string): Promise<void> {
		const pipLog = coalescePipProgress(log);
		const cmd = [VENV_PYTHON, "-m", "pip", "install", "--progress-bar", "raw", ...packages];
		const { exitCode } = await runWithPTY(cmd, {
			...runOpts,
			stdoutHandler: pipLog,
			stderrHandler: pipLog,
		});
		if (exitCode !== 0) {
			await log(`[setup] error: ${label} failed (exit ${exitCode})`);
			throw new Error(`${label} failed with exit code ${exitCode}`);
		}
	}

	if (!(await fileExists(RUNTIME_PYTHON))) {
		if (!(await fileExists(RUNTIME_TARBALL)))
			await downloadPythonRuntime(RUNTIME_TARBALL, log);
		await log("[setup] Extracting Python runtime...");
		await mkdir(RUNTIME_DIR, { recursive: true });
		await run(["tar", "xzf", RUNTIME_TARBALL, "-C", RUNTIME_DIR], "tar extract");
		await log("[setup] Python runtime ready.");
	}

	// The marker holds a hash of the pins, so changing them triggers a
	// reinstall on the next start.
	const reqHash = createHash("sha256").update(ENGINE_REQUIREMENTS.join("\n")).digest("hex");

	const venvOk = (await fileExists(VENV_READY_MARKER)) &&
		await new Promise<boolean>(resolve => {
			try {
				// Check the engine packages are installed, not just that Python starts.
				// find_spec doesn't import torch, so this stays fast.
				const p = spawn(VENV_PYTHON, ["-c", VENV_CHECK], { stdio: "ignore" });
				p.on("close", code => resolve(code === 0));
				p.on("error", () => resolve(false));
			} catch { resolve(false); }
		});

	if (!venvOk) {
		if (await fileExists(VENV_READY_MARKER)) {
			await log("[setup] Virtual environment is broken — recreating...");
			await rm(VENV_DIR, { recursive: true, force: true }).catch(() => {});
			await unlink(VENV_READY_MARKER).catch(() => {});
		}
		await log("[setup] Creating virtual environment at ~/.nab/venv...");
		await run([RUNTIME_PYTHON, "-m", "venv", "--clear", VENV_DIR], "venv create");
		await log("[setup] Virtual environment created.");
		await log("[setup] Installing the training engine (first run only - may take a few minutes)...");
		await runPip(ENGINE_REQUIREMENTS, "pip install (training engine)");
		await writeFile(VENV_READY_MARKER, reqHash);
		await log("[setup] Environment ready.");
	} else if ((await readFile(VENV_READY_MARKER, "utf-8").catch(() => "")).trim() !== reqHash) {
		// Installed with different (or unpinned) versions: bring it to the pins.
		await log("[setup] Updating the training engine to the pinned versions...");
		await runPip(ENGINE_REQUIREMENTS, "pip install (training engine)");
		await writeFile(VENV_READY_MARKER, reqHash);
		await log("[setup] Environment ready.");
	}

	return VENV_PYTHON;
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
		await copyFile(CLI_ENTRY,         join(buildDir, "cli.ts"));
		await copyFile(UTIL_ENTRY,        join(buildDir, "util.ts"));
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

// ── runInference ──────────────────────────────────────────────────────────────

export async function runInference(
	imagePath:   string,
	modelPath:   string,
	confidence:  number,
	inferScript: string,
	logPath:     string,
	runId:       string,
	stderrHandler?: LineHandler,
): Promise<{ detections: Detection[]; inferenceMs: number; error: string | null }> {
	try {
		await prepareEnvironment(logPath, runId, stderrHandler);
	} catch (err) {
		return { detections: [], inferenceMs: 0, error: `Environment setup failed: ${(err as Error).message}` };
	}

	const logStderr = async (text: string) => {
		await appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});
		await stderrHandler?.(text);
	};

	const t0 = Date.now();
	const { stdout, stderr } = await runProcess(
		[VENV_PYTHON, inferScript],
		{
			stdinData: JSON.stringify({ imagePath, modelPath, confidence }),
			stderrHandler: logStderr,
		},
	);

	const inferenceMs = Date.now() - t0;
	const data = parseLastJsonLine(stdout);
	if (!data) {
		if (stderr.trim()) console.error("[infer] stderr:\n", stderr.trim());
		if (stdout.trim()) console.error("[infer] stdout:\n", stdout.trim());
		const hint = stderr.trim().split("\n").filter(l => l.trim()).pop() ?? "";
		return { detections: [], inferenceMs, error: `Inference failed.${hint ? ` ${hint}` : ""}` };
	}
	if (data.error) return { detections: [], inferenceMs, error: data.error as string };
	return { detections: (data.detections ?? []) as Detection[], inferenceMs, error: null };
}
