import Electrobun, { BrowserWindow, defineElectrobunRPC } from "electrobun/bun";
import { readdir, mkdir, copyFile, appendFile, unlink } from "fs/promises";
import { join, extname, basename } from "path";
import { randomBytes } from "crypto";
import { homedir } from "os";

const IMAGE_EXTS      = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"]);
const TRAIN_SCRIPT    = join(import.meta.dir, "../python/train.py");
const INFER_SCRIPT    = join(import.meta.dir, "../python/infer.py");
const EXPORT_SCRIPT   = join(import.meta.dir, "../python/export.py");
const CLI_SCRIPT      = join(import.meta.dir, "../python/cli.py");
const RUNTIME_TARBALL = join(import.meta.dir, "../python/python-runtime.tar.gz");

const YOLO_DIR        = join(homedir(), ".yolostudio");
const RUNTIME_DIR     = join(YOLO_DIR, "python-runtime");
const VENV_DIR        = join(YOLO_DIR, "venv");

const IS_WIN          = process.platform === "win32";
const RUNTIME_PYTHON  = join(RUNTIME_DIR, "python", IS_WIN ? "python.exe" : "bin/python3");
const VENV_PYTHON     = join(VENV_DIR, IS_WIN ? "Scripts/python.exe" : "bin/python");
// Written only after a successful pip install — used to detect partial/failed venv.
const VENV_READY_MARKER = join(VENV_DIR, ".ready");

/**
 * Ensures the Python environment is ready, then returns [venvPython, trainScript].
 *
 * On first call:
 *   1. Extracts the bundled Python runtime tarball → ~/.yolostudio/python-runtime/
 *   2. Creates a venv using that Python           → ~/.yolostudio/venv/
 *   3. pip-installs ultralytics into the venv
 *
 * Subsequent calls are instant (everything already exists).
 * Each subprocess is registered under runId so stopTraining can kill it mid-setup.
 */
async function prepareEnvironment(logPath: string, runId: string): Promise<string[]> {
	const log = (text: string) =>
		appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {});

	async function run(cmd: string[], label: string): Promise<void> {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PYTHONUNBUFFERED: "1" },
		});

		runningProcesses.set(runId, proc);
		try {
			await Promise.all([
				pipeLines(proc.stdout, log).catch(() => {}),
				pipeLines(proc.stderr, log).catch(() => {}),
			]);
			const code = await proc.exited;
			if (code !== 0) {
				await log(`[setup] ✗ ${label} failed (exit ${code})`);
				throw new Error(`${label} failed with exit code ${code}`);
			}
		} finally {
			runningProcesses.delete(runId);
		}
	}

	if (!(await Bun.file(RUNTIME_PYTHON).exists())) {
		await log("[setup] Extracting bundled Python runtime…");
		await mkdir(RUNTIME_DIR, { recursive: true });
		await run(["tar", "xzf", RUNTIME_TARBALL, "-C", RUNTIME_DIR], "tar extract");
		await log("[setup] Python runtime ready.");
	}

	// Guard on .ready marker so a failed pip install retries rather than skipping.
	if (!(await Bun.file(VENV_READY_MARKER).exists())) {
		await log("[setup] Creating virtual environment at ~/.yolostudio/venv…");
		await run([RUNTIME_PYTHON, "-m", "venv", "--clear", VENV_DIR], "venv create");
		await log("[setup] Virtual environment created.");

		await log("[setup] Installing ultralytics (first run only — may take a few minutes)…");
		await run([VENV_PYTHON, "-m", "pip", "install", "ultralytics"], "pip install");

		await Bun.write(VENV_READY_MARKER, "ready");
		await log("[setup] Environment ready. Starting training…");
	}

	return [VENV_PYTHON, TRAIN_SCRIPT];
}

// ── standalone helpers ─────────────────────────────────────────────────────────

// Strip all ANSI/CSI escape sequences (\x1b[K erase-line, \x1b[1m bold, etc.)
// and collapse \r-overwritten progress lines to their final state.
function cleanLine(raw: string): string {
	const segments = raw.split("\r");
	return segments[segments.length - 1].replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

// Buffer a byte pipe, split on \n, clean each line, and call onLine per entry.
// Single implementation used by both setup (pip) and training (ultralytics) output.
async function pipeLines(
	pipe: AsyncIterable<Uint8Array>,
	onLine: (line: string) => Promise<void>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buf = "";
	for await (const chunk of pipe) {
		buf += decoder.decode(chunk, { stream: true });
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const clean = cleanLine(line);
			if (clean) await onLine(clean);
		}
	}
	const clean = cleanLine(buf);
	if (clean) await onLine(clean);
}

// Canonical path to the YOLO training checkpoint for a given output directory.
function checkpointPath(outputPath: string): string {
	return join(outputPath, "weights", "weights", "last.pt");
}

// Tracks active training subprocesses keyed by run ID.
const runningProcesses = new Map<string, ReturnType<typeof Bun.spawn>>();

// ── binary bridge ─────────────────────────────────────────────────────────────
// Serves image files to the renderer by path. Avoids base64 encoding entirely.

const securityToken = randomBytes(32).toString("hex");

const server = Bun.serve({
	port: 0, // random available port
	async fetch(req) {
		const headers = new Headers({ "Access-Control-Allow-Origin": "*" });
		const url = new URL(req.url);

		if (url.searchParams.get("token") !== securityToken)
			return new Response("Unauthorized", { status: 401, headers });

		const filePath = url.searchParams.get("path");
		if (!filePath) return new Response("Missing path", { status: 400, headers });

		const file = Bun.file(filePath);
		if (!(await file.exists())) return new Response("Not found", { status: 404, headers });

		return new Response(file, { headers });
	},
});

// ── recursive image collector ─────────────────────────────────────────────────

async function collectImagePaths(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const results = await Promise.all(entries.map(async entry => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) return collectImagePaths(fullPath);
		if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) return [fullPath];
		return [];
	}));
	return results.flat();
}

// ── RPC ───────────────────────────────────────────────────────────────────────

const rpc = defineElectrobunRPC("bun", {
	maxRequestTime: Infinity,
	handlers: {
		requests: {
			getBridgeConfig: async () => ({
				port:  server.port,
				token: securityToken,
			}),

			openImagesDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder:        homedir(),
					allowedFileTypes:      "*.jpg,*.jpeg,*.png,*.webp,*.bmp,*.gif,*.tiff,*.tif",
					canChooseFiles:        true,
					canChooseDirectory:    false,
					allowsMultipleSelection: true,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				return { canceled, paths: canceled ? [] : filePaths };
			},

			loadStudio: async () => {
				const studioFile = join(homedir(), ".yolostudio", "studio.json");
				try {
					const file = Bun.file(studioFile);
					if (await file.exists()) {
						const data = JSON.parse(await file.text());
						// Processes don't survive app restarts — reset any active run to
						// "paused" so the user sees a Resume button instead of a stuck
						// "Training" badge with no live process behind it.
						if (Array.isArray(data.runs)) {
							data.runs = data.runs.map((r: { status: string }) =>
								r.status === "training" || r.status === "installing"
									? { ...r, status: "paused" }
									: r
							);
						}
						return data;
					}
				} catch (err) {
					console.error("Failed to parse studio.json:", err);
				}
				return { assets: [], runs: [] };
			},

			saveStudio: async ({ assets, runs }: { assets: unknown[]; runs: unknown[] }) => {
				const studioDir = join(homedir(), ".yolostudio");
				await mkdir(studioDir, { recursive: true });
				await Bun.write(join(studioDir, "studio.json"), JSON.stringify({ assets, runs }, null, 2));
				return {};
			},

			openFolderDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder:        homedir(),
					canChooseFiles:        false,
					canChooseDirectory:    true,
					allowsMultipleSelection: false,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				if (canceled) return { canceled: true, paths: [] };

				const paths = await collectImagePaths(filePaths[0]);
				paths.sort((a, b) =>
					a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
				);
				return { canceled: false, paths };
			},

			loadAssetData: async ({ storagePath }: { storagePath: string }) => {
				const imagesDir = join(storagePath, "images");
				const labelsDir = join(storagePath, "labels");
				await mkdir(imagesDir, { recursive: true });
				await mkdir(labelsDir, { recursive: true });

				const imageFiles = (await readdir(imagesDir))
					.filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));

				const labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>> = {};
				for (const filename of imageFiles) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					try {
						const text = await Bun.file(labelPath).text();
						labels[filename] = text.trim().split("\n").filter(Boolean).map(line => {
							const [ci, cx, cy, w, h] = line.split(" ").map(Number);
							return { classIndex: ci, cx, cy, w, h };
						});
					} catch {
						labels[filename] = [];
					}
				}

				let classes: string[] = [];
				try {
					const text = await Bun.file(join(storagePath, "classes.txt")).text();
					classes = text.trim().split("\n").filter(Boolean);
				} catch {}

				return {
					images:  imageFiles.map(f => ({ filename: f, filePath: join(imagesDir, f) })),
					labels,
					classes,
				};
			},

			saveAnnotations: async ({ storagePath, labels, classes }: {
				storagePath: string;
				labels:  Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>>;
				classes: string[];
			}) => {
				const labelsDir = join(storagePath, "labels");
				await mkdir(labelsDir, { recursive: true });
				for (const [filename, anns] of Object.entries(labels)) {
					const labelPath = join(labelsDir, filename.replace(/\.[^.]+$/, ".txt"));
					const content   = anns.map(a =>
						`${a.classIndex} ${a.cx.toFixed(6)} ${a.cy.toFixed(6)} ${a.w.toFixed(6)} ${a.h.toFixed(6)}`
					).join("\n");
					await Bun.write(labelPath, content);
				}
				await Bun.write(join(storagePath, "classes.txt"), classes.join("\n"));
				return {};
			},

			importImages: async ({ storagePath, files }: {
				storagePath: string;
				files: Array<{ filename: string; sourcePath?: string; dataUrl?: string }>;
			}) => {
				const imagesDir = join(storagePath, "images");
				await mkdir(imagesDir, { recursive: true });
				const results: Array<{ filename: string; filePath: string }> = [];
				for (const file of files) {
					const dest = join(imagesDir, basename(file.filename));
					if (file.sourcePath && file.sourcePath !== dest) {
						await copyFile(file.sourcePath, dest);
					} else if (file.dataUrl) {
						const [, b64] = file.dataUrl.split(",");
						await Bun.write(dest, Buffer.from(b64, "base64"));
					}
					results.push({ filename: basename(file.filename), filePath: dest });
				}
				return { images: results };
			},

			openFolderPathDialog: async () => {
				const filePaths = await Electrobun.Utils.openFileDialog({
					startingFolder:        homedir(),
					canChooseFiles:        false,
					canChooseDirectory:    true,
					allowsMultipleSelection: false,
				});
				const canceled = !filePaths || filePaths.length === 0 || filePaths[0] === "";
				return canceled
					? { canceled: true, path: "" }
					: { canceled: false, path: filePaths[0] };
			},

			startTraining: async (config: {
				id: string; name: string; assetPaths: string[]; classMap: string[];
				baseModel: string; epochs: number; batchSize: number; imgsz: number;
				device: string; outputPath: string; fresh: boolean;
			}) => {
				await mkdir(config.outputPath, { recursive: true });

				if (config.fresh) {
					await unlink(checkpointPath(config.outputPath)).catch(() => {});
					await unlink(join(config.outputPath, "train.log")).catch(() => {});
				}

				const logPath = join(config.outputPath, "train.log");
				await appendFile(logPath, JSON.stringify({
					type: "start", timestamp: new Date().toISOString(), config,
				}) + "\n");

				const trainCmd = await prepareEnvironment(logPath, config.id);
				const proc = Bun.spawn(trainCmd, {
					stdin:  "pipe",
					stdout: "pipe",
					stderr: "pipe",
				});

				runningProcesses.set(config.id, proc);

				// Write JSON config to Python stdin then close it.
				proc.stdin.write(JSON.stringify(config));
				proc.stdin.end();

				// stdout: newline-delimited JSON from train.py (progress/done/error).
				pipeLines(proc.stdout, line =>
					appendFile(logPath, line + "\n").catch(console.error)
				).then(() => runningProcesses.delete(config.id)).catch(console.error);

				// stderr: ultralytics status + progress bars — wrap as typed log entries.
				pipeLines(proc.stderr, text =>
					appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(console.error)
				).catch(console.error);

				return { started: true };
			},

			readTrainingLog: async ({ outputPath }: { outputPath: string }) => {
				const logPath = join(outputPath, "train.log");
				try {
					const content = await Bun.file(logPath).text();
					const lines   = content.split("\n").filter(l => l.trim());
					return { lines };
				} catch {
					return { lines: [] };
				}
			},

			runInference: async ({ imagePath, outputPath, confidence }: {
				imagePath: string; outputPath: string; confidence: number;
			}) => {
				if (!(await Bun.file(VENV_READY_MARKER).exists())) {
					return { detections: [], inferenceMs: 0, error: "Python environment not ready. Train a model first to install dependencies." };
				}
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists())) {
					return { detections: [], inferenceMs: 0, error: "Model weights not found — the output directory may have been moved or deleted." };
				}

				const t0  = Date.now();
				const proc = Bun.spawn([VENV_PYTHON, INFER_SCRIPT], {
					stdin:  "pipe",
					stdout: "pipe",
					stderr: "pipe",
				});

				proc.stdin.write(JSON.stringify({ imagePath, modelPath, confidence }));
				proc.stdin.end();

				const decoder = new TextDecoder();
				let stdout = "";
				let stderr = "";
				await Promise.all([
					(async () => { for await (const chunk of proc.stdout) stdout += decoder.decode(chunk); })(),
					(async () => { for await (const chunk of proc.stderr) stderr += decoder.decode(chunk); })(),
				]);
				await proc.exited;

				const inferenceMs = Date.now() - t0;
				const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
				try {
					const data = JSON.parse(line);
					if (data.error) return { detections: [], inferenceMs, error: data.error };
					return { detections: data.detections ?? [], inferenceMs, error: null };
				} catch {
					if (stderr.trim()) console.error("[infer] stderr:\n", stderr.trim());
					if (stdout.trim()) console.error("[infer] stdout:\n", stdout.trim());
					const hint = stderr.trim().split("\n").filter(l => l.trim()).pop() ?? "";
					return { detections: [], inferenceMs, error: `Inference failed.${hint ? ` ${hint}` : ""}` };
				}
			},

			exportModel: async ({ outputPath, format }: { outputPath: string; format: string }) => {
				if (!(await Bun.file(VENV_READY_MARKER).exists()))
					return { exportedPath: "", fileSize: 0, error: "Python environment not ready." };

				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists()))
					return { exportedPath: "", fileSize: 0, error: "Model weights not found." };

				// PyTorch: best.pt already exists — nothing to convert.
				if (format === "pt") {
					const size = (await Bun.file(modelPath).size) ?? 0;
					return { exportedPath: modelPath, fileSize: size, error: null };
				}

				const proc = Bun.spawn([VENV_PYTHON, EXPORT_SCRIPT], {
					stdin: "pipe", stdout: "pipe", stderr: "pipe",
				});
				proc.stdin.write(JSON.stringify({ modelPath, format }));
				proc.stdin.end();

				const dec = new TextDecoder();
				let stdout = ""; let stderr = "";
				await Promise.all([
					(async () => { for await (const c of proc.stdout) stdout += dec.decode(c); })(),
					(async () => { for await (const c of proc.stderr) stderr += dec.decode(c); })(),
				]);
				await proc.exited;

				const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
				try {
					const data = JSON.parse(line);
					if (data.error) return { exportedPath: "", fileSize: 0, error: data.error };
					const fileSize = (await Bun.file(data.exportedPath).size) ?? 0;
					return { exportedPath: data.exportedPath, fileSize, error: null };
				} catch {
					const hint = stderr.trim().split("\n").filter(Boolean).pop() ?? "";
					return { exportedPath: "", fileSize: 0, error: `Export failed.${hint ? ` ${hint}` : ""}` };
				}
			},

			exportCLI: async ({ outputPath, runName, destDir }: {
				outputPath: string; runName: string; destDir: string;
			}) => {
				const modelPath = join(outputPath, "weights", "weights", "best.pt");
				if (!(await Bun.file(modelPath).exists()))
					return { bundlePath: "", error: "Model weights not found." };

				const safeName  = runName.replace(/[^a-zA-Z0-9_-]/g, "_");
				const bundleDir = join(destDir, `${safeName}-cli`);
				await mkdir(bundleDir, { recursive: true });

				// Copy assets into bundle.
				await copyFile(modelPath,     join(bundleDir, "model.pt"));
				await copyFile(CLI_SCRIPT,    join(bundleDir, "cli.py"));
				await copyFile(RUNTIME_TARBALL, join(bundleDir, "python-runtime.tar.gz"));

				// Write run.sh (Linux / macOS).
				const runSh = `#!/usr/bin/env bash
# YOLOStudio CLI — ${runName}
# No external dependencies required — Python runtime is bundled.
#
# Usage:
#   ./run.sh <image_path> [--conf 0.5] [--output output/]
#
# Example:
#   ./run.sh photo.jpg
#   ./run.sh photo.jpg --conf 0.7 --output results/

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="\\$SCRIPT_DIR/.runtime"
VENV_DIR="\\$SCRIPT_DIR/.venv"
RUNTIME_PYTHON="\\$RUNTIME_DIR/python/bin/python3"
VENV_PYTHON="\\$VENV_DIR/bin/python"

if [ ! -f "\\$RUNTIME_PYTHON" ]; then
  echo "[setup] Extracting Python runtime (first run only)..."
  mkdir -p "\\$RUNTIME_DIR"
  tar xzf "\\$SCRIPT_DIR/python-runtime.tar.gz" -C "\\$RUNTIME_DIR"
fi

if [ ! -f "\\$VENV_DIR/.ready" ]; then
  echo "[setup] Creating virtual environment..."
  "\\$RUNTIME_PYTHON" -m venv --clear "\\$VENV_DIR"
  echo "[setup] Installing ultralytics (may take a few minutes on first run)..."
  "\\$VENV_PYTHON" -m pip install ultralytics --quiet
  touch "\\$VENV_DIR/.ready"
fi

exec "\\$VENV_PYTHON" "\\$SCRIPT_DIR/cli.py" "\\$@"
`;
				await Bun.write(join(bundleDir, "run.sh"), runSh);
				const chmodProc = Bun.spawn(["chmod", "+x", join(bundleDir, "run.sh")]);
				await chmodProc.exited;

				// Write README.
				await Bun.write(join(bundleDir, "README.md"), `# ${runName} — YOLOStudio CLI Bundle

Self-contained YOLO inference tool. No pre-installed dependencies required.

## Quick Start

\`\`\`bash
./run.sh photo.jpg
./run.sh photo.jpg --conf 0.7
./run.sh photo.jpg --conf 0.5 --output results/
\`\`\`

## What's Included

| File | Description |
|------|-------------|
| \`run.sh\` | Runner script — extracts runtime and runs inference |
| \`cli.py\` | Python inference script |
| \`model.pt\` | Trained YOLO model weights |
| \`python-runtime.tar.gz\` | Bundled Python runtime (no system Python needed) |

## First Run

On first run \`run.sh\` will:
1. Extract the bundled Python runtime into \`.runtime/\`
2. Create a virtual environment in \`.venv/\`
3. Install \`ultralytics\` (requires internet — ~200MB)

Subsequent runs start immediately.

## Output

Detected objects are printed as JSON. Annotated images are saved to \`./output/detect/\`.
`);

				return { bundlePath: bundleDir, error: null };
			},

			revealInFilesystem: async ({ path }: { path: string }) => {
				const dir = path.includes(".") && !path.endsWith("/")
					? path.split("/").slice(0, -1).join("/")
					: path;
				const cmd = process.platform === "darwin"
					? ["open", "-R", path]
					: process.platform === "win32"
						? ["explorer", `/select,${path}`]
						: ["xdg-open", dir];
				Bun.spawn(cmd);
				return {};
			},

			stopTraining: async ({ runId, clearCheckpoint, outputPath }: {
				runId: string; clearCheckpoint?: boolean; outputPath?: string;
			}) => {
				const proc = runningProcesses.get(runId);
				if (proc) {
					proc.kill(9); // SIGKILL — guaranteed termination regardless of pip/torch state
					runningProcesses.delete(runId);
				}
				if (clearCheckpoint && outputPath) {
					await unlink(checkpointPath(outputPath)).catch(() => {});
					await unlink(join(outputPath, "train.log")).catch(() => {});
				}
				return {};
			},
		},
	},
});

// ── window ────────────────────────────────────────────────────────────────────

const mainWindow = new BrowserWindow({
	title: "YOLOStudio",
	url:   "views://mainview/index.html",
	frame: { width: 1280, height: 800, x: 100, y: 80 },
	rpc,
});

console.log(`YOLOStudio started — bridge on port ${server.port}`);
