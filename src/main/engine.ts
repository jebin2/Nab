/**
 * The training engine: a private Python (python-build-standalone) plus a venv
 * with PyTorch and Ultralytics in ~/.nab. This module checks the GPU, picks
 * the right PyTorch build, says how big the download is, installs it with
 * real progress, and verifies the GPU afterwards.
 *
 * It must not import Electron: the standalone CLI export bundles it too.
 */
import { EventEmitter } from "events";
import { execFile } from "child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "fs/promises";
import { createHash } from "crypto";
import {
	YOLO_DIR, RUNTIME_DIR, VENV_DIR, RUNTIME_PYTHON, VENV_PYTHON, VENV_READY_MARKER, RUNTIME_TARBALL,
	runProcess, runWithPTY, runningProcesses, fileExists, parseLastJsonLine, cleanLine, type Detection,
} from "./util";
import { killTree } from "./managedProcess";

// ── Pins ──────────────────────────────────────────────────────────────────────
// Bump deliberately, test training / inference / export, then release.
// Existing installs move to new pins on their next start (the marker stores a
// hash of them). torch and torchvision must be a matching pair.

const PYTHON_RELEASE = "20261026";
const PYTHON_VERSION = "3.12.16";
const PYTHON_ASSETS: Record<string, { triple: string; sha256: string }> = {
	"linux-x64":    { triple: "x86_64-unknown-linux-gnu",  sha256: "ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20" },
	"linux-arm64":  { triple: "aarch64-unknown-linux-gnu", sha256: "bb4b6392670c5d3f93876996fcaa19858a4a413a0c7720144c18b0d6f1f0db2d" },
	"darwin-x64":   { triple: "x86_64-apple-darwin",       sha256: "37c38fda76fec1fbf310adcbafb7f0d96af13b5511bf8ea954c3aa8eec185734" },
	"darwin-arm64": { triple: "aarch64-apple-darwin",      sha256: "353d5f1b4fd2715e7053f12f068435d5bbad16b91e057006b5d01e0925709a7e" },
	"win32-x64":    { triple: "x86_64-pc-windows-msvc",    sha256: "1f2ab53880fc67ea323398c6388e05af28addc99a8e389209f08a51fdff4b149" },
};

const TORCH_VERSION       = "2.14.1";
const TORCHVISION_VERSION = "0.29.1";
const APP_PACKAGES        = ["ultralytics==8.4.196", "psutil==7.2.2"];

/**
 * Which PyTorch build to install. "pypi" is the default build from PyPI
 * (Apple Silicon, Linux ARM); the others come from download.pytorch.org.
 */
export type EngineVariant = "cpu" | "cu126" | "cu130" | "pypi";

// One-time download sizes in MB (compressed, including Python), measured
// 2026-11-14 for the pins above. Remeasure when bumping them.
const DOWNLOAD_MB: Record<string, number> = {
	"linux-x64:cpu":     410,
	"linux-x64:cu126":  3870,
	"linux-x64:cu130":  3220,
	"win32-x64:cpu":     340,
	"win32-x64:cu126":  2820,
	"win32-x64:cu130":  2210,
	"darwin-arm64:pypi": 345,
};

// CUDA 13 builds need NVIDIA driver 580 or newer; older drivers get CUDA 12.6.
const CUDA13_MIN_DRIVER = 580;

// ── GPU detection and install plan ────────────────────────────────────────────

export type GpuInfo = { kind: "nvidia" | "apple" | "none"; name?: string; driverMajor?: number };

export type EnginePlan = {
	platform: string;
	gpu: GpuInfo;
	variant: EngineVariant | null;
	/** Approximate one-time download, or null when unknown. */
	downloadMB: number | null;
	/** Set when this machine can't run the engine; explains why in plain words. */
	unsupported?: string;
	/** What the GPU means for training, in plain words. */
	gpuSummary: string;
};

/** Pure: decides what to install for a platform and GPU. */
export function planFor(platform: string, gpu: GpuInfo): EnginePlan {
	const base = { platform, gpu };
	if (platform === "darwin-x64") {
		return { ...base, variant: null, downloadMB: null, gpuSummary: "",
			unsupported: "Training needs a Mac with Apple Silicon (M1 or newer). PyTorch no longer supports Intel Macs." };
	}
	if (!PYTHON_ASSETS[platform]) {
		return { ...base, variant: null, downloadMB: null, gpuSummary: "",
			unsupported: `Nab can't train on this platform (${platform}) yet.` };
	}

	let variant: EngineVariant;
	if (platform === "darwin-arm64" || platform === "linux-arm64") variant = "pypi";
	else if (gpu.kind === "nvidia") variant = (gpu.driverMajor ?? 0) >= CUDA13_MIN_DRIVER ? "cu130" : "cu126";
	else variant = "cpu";

	const gpuSummary =
		gpu.kind === "nvidia" ? `${gpu.name ?? "NVIDIA GPU"} found: training will be fast.`
		: gpu.kind === "apple" ? "Apple Silicon GPU found: training will be reasonably fast."
		: "No supported GPU found: training will work, but more slowly.";

	return { ...base, variant, downloadMB: DOWNLOAD_MB[`${platform}:${variant}`] ?? null, gpuSummary };
}

async function detectGpu(): Promise<GpuInfo> {
	if (process.platform === "darwin") return process.arch === "arm64" ? { kind: "apple", name: "Apple Silicon GPU" } : { kind: "none" };
	return new Promise(resolve => {
		execFile("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"], { timeout: 5000 }, (err, stdout) => {
			if (err) { resolve({ kind: "none" }); return; }
			const [name, driver] = stdout.split("\n")[0].split(",").map(s => s.trim());
			const driverMajor = parseInt(driver ?? "", 10);
			resolve(name ? { kind: "nvidia", name, driverMajor: Number.isFinite(driverMajor) ? driverMajor : undefined } : { kind: "none" });
		});
	});
}

let planPromise: Promise<EnginePlan> | null = null;
export function getPlan(): Promise<EnginePlan> {
	planPromise ??= detectGpu().then(gpu => planFor(`${process.platform}-${process.arch}`, gpu));
	return planPromise;
}

function pinsHash(variant: EngineVariant): string {
	return createHash("sha256")
		.update(JSON.stringify([PYTHON_VERSION, TORCH_VERSION, TORCHVISION_VERSION, APP_PACKAGES, variant]))
		.digest("hex");
}

// ── Status ────────────────────────────────────────────────────────────────────

export type EngineState = "missing" | "outdated" | "installing" | "ready" | "failed" | "unsupported";

export type EngineProgress = {
	phase: string;
	/** 0–100, or null while the step has no measurable progress. */
	pct: number | null;
	doneMB: number;
	totalMB: number | null;
	etaSec: number | null;
};

export type EngineStatus = {
	state: EngineState;
	plan: EnginePlan;
	progress?: EngineProgress;
	error?: string;
	/** After install: what training will run on. */
	device?: { gpuUsable: boolean; message: string };
};

type Marker = { pinsHash: string; variant: EngineVariant; gpuUsable: boolean; message: string };

/** Emits "status" (EngineStatus) on every change. */
export const engineEvents = new EventEmitter();

let current: { state: EngineState; progress?: EngineProgress; error?: string } = { state: "missing" };

async function readMarker(): Promise<Marker | null> {
	try { return JSON.parse(await readFile(VENV_READY_MARKER, "utf-8")) as Marker; } catch { return null; }
}

const VENV_CHECK =
	"import importlib.util as u, sys; " +
	"sys.exit(0 if all(u.find_spec(m) for m in ('ultralytics', 'torch', 'psutil')) else 1)";

function venvPackagesPresent(): Promise<boolean> {
	return new Promise(resolve => {
		execFile(VENV_PYTHON, ["-c", VENV_CHECK], { timeout: 30_000 }, err => resolve(!err));
	});
}

async function installedState(plan: EnginePlan): Promise<{ state: EngineState; marker: Marker | null }> {
	if (plan.unsupported) return { state: "unsupported", marker: null };
	const marker = await readMarker();
	if (!(await fileExists(VENV_PYTHON)) || !(await venvPackagesPresent())) return { state: "missing", marker };
	if (!marker || marker.pinsHash !== pinsHash(plan.variant!)) return { state: "outdated", marker };
	return { state: "ready", marker };
}

export async function getEngineStatus(): Promise<EngineStatus> {
	const plan = await getPlan();
	if (installing) return { ...current, plan };
	const { state, marker } = await installedState(plan);
	if (state !== "ready" && current.state === "failed") return { state: "failed", plan, error: current.error };
	return {
		state, plan,
		device: marker && state === "ready" ? { gpuUsable: marker.gpuUsable, message: marker.message } : undefined,
	};
}

async function emitStatus() {
	engineEvents.emit("status", await getEngineStatus());
}

// ── Progress ──────────────────────────────────────────────────────────────────

/**
 * Turns byte counts from several downloads (the Python runtime, then each
 * file pip fetches) into one overall percentage and an ETA.
 */
export class ProgressTracker {
	private completed = 0;
	private fileDone = 0;
	private fileTotal = 0;
	private speed = 0; // bytes/s, smoothed
	private lastT = 0;
	private lastBytes = 0;

	constructor(private totalBytes: number | null, private now: () => number = Date.now) {
		this.lastT = now();
	}

	/** Progress within the current file; a new file starts when the total changes or the count goes back. */
	fileProgress(done: number, total: number) {
		if (total !== this.fileTotal || done < this.fileDone) {
			this.completed += this.fileTotal;
			this.fileTotal = total;
		}
		this.fileDone = done;
		this.sample();
	}

	get doneBytes() { return this.completed + this.fileDone; }

	private sample() {
		const t = this.now();
		const dt = (t - this.lastT) / 1000;
		if (dt < 0.5) return;
		const inst = (this.doneBytes - this.lastBytes) / dt;
		this.speed = this.speed ? this.speed * 0.7 + inst * 0.3 : inst;
		this.lastT = t;
		this.lastBytes = this.doneBytes;
	}

	snapshot(phase: string): EngineProgress {
		const total = this.totalBytes ? Math.max(this.totalBytes, this.doneBytes * 1.02) : null;
		const pct = total ? Math.min(99, Math.floor((this.doneBytes / total) * 100)) : null;
		const etaSec = total && this.speed > 1000 ? Math.round((total - this.doneBytes) / this.speed) : null;
		return {
			phase, pct, etaSec,
			doneMB: Math.round(this.doneBytes / 1e6),
			totalMB: total ? Math.round(total / 1e6) : null,
		};
	}
}

// ── Install ───────────────────────────────────────────────────────────────────

class EngineCancelled extends Error { constructor() { super("Setup was cancelled."); } }

const SETUP_ID = "engine-setup";
let installing: Promise<string> | null = null;
let cancelRequested = false;
let abortDownload: AbortController | null = null;
const lineListeners = new Set<(text: string) => void>();

function logLine(text: string) {
	for (const l of lineListeners) { try { l(text); } catch {} }
}

/**
 * Resolves with the venv's Python once the engine is installed and current,
 * installing it first if needed. Concurrent callers share one install.
 * `onLine` receives human-readable setup log lines while this caller waits.
 */
export async function ensureEngine(onLine?: (text: string) => void): Promise<string> {
	if (onLine) lineListeners.add(onLine);
	try {
		installing ??= (async () => {
			const plan = await getPlan();
			if ((await installedState(plan)).state === "ready") return VENV_PYTHON;
			return install(plan);
		})().finally(() => { installing = null; void emitStatus(); });
		return await installing;
	} finally {
		if (onLine) lineListeners.delete(onLine);
	}
}

/** Starts setup from the UI without waiting for it. */
export function startEngineSetup(): void {
	void ensureEngine().catch(() => {});
}

/** Stops a running setup. The next ensureEngine() starts over (pip reuses what it downloaded). */
export async function cancelEngineSetup(): Promise<void> {
	if (!installing) return;
	cancelRequested = true;
	abortDownload?.abort();
	const proc = runningProcesses.get(SETUP_ID);
	if (proc) killTree(proc);
	await installing.catch(() => {});
}

async function install(plan: EnginePlan): Promise<string> {
	if (plan.unsupported) throw new Error(plan.unsupported);
	const variant = plan.variant!;
	cancelRequested = false;
	const tracker = new ProgressTracker(plan.downloadMB ? plan.downloadMB * 1e6 : null);
	let phase = "Starting";

	let lastEmit = 0;
	const update = (force = false) => {
		const t = Date.now();
		if (!force && t - lastEmit < 250) return;
		lastEmit = t;
		current = { state: "installing", progress: tracker.snapshot(phase) };
		engineEvents.emit("status", { ...current, plan } satisfies EngineStatus);
	};
	const setPhase = (p: string) => { phase = p; logLine(`[setup] ${p}...`); update(true); };
	const checkCancel = () => { if (cancelRequested) throw new EngineCancelled(); };

	// Every 10% of overall progress also goes to the caller's log.
	let lastLoggedDecile = -1;
	const logProgress = () => {
		const s = tracker.snapshot(phase);
		if (s.pct == null) return;
		const decile = Math.floor(s.pct / 10);
		if (decile <= lastLoggedDecile) return;
		lastLoggedDecile = decile;
		logLine(`[setup] Downloading: ${s.pct}% (${s.doneMB}${s.totalMB ? ` of ${s.totalMB}` : ""} MB)`);
	};

	const pip = async (args: string[], label: string) => {
		const onLine = async (raw: string) => {
			const m = raw.match(/^Progress\s+(\d+)\s+of\s+(\d+)/i);
			if (m) { tracker.fileProgress(Number(m[1]), Number(m[2])); update(); logProgress(); return; }
			const line = cleanLine(raw);
			if (line) logLine(line);
		};
		const { exitCode } = await runWithPTY(
			[VENV_PYTHON, "-m", "pip", "install", "--progress-bar", "raw", "--disable-pip-version-check", ...args],
			{ stdoutHandler: onLine, stderrHandler: onLine, collectStdout: false, collectStderr: false, runId: SETUP_ID },
		);
		checkCancel();
		if (exitCode !== 0) throw new Error(`${label} failed (exit code ${exitCode}). Check your internet connection and try again.`);
	};

	try {
		current = { state: "installing", progress: tracker.snapshot(phase) };
		update(true);

		// 1. Python runtime.
		if (!(await fileExists(RUNTIME_PYTHON))) {
			setPhase("Downloading Python");
			if (!(await fileExists(RUNTIME_TARBALL))) await downloadPythonRuntime(RUNTIME_TARBALL, tracker, update);
			checkCancel();
			setPhase("Unpacking Python");
			await mkdir(RUNTIME_DIR, { recursive: true });
			const { exitCode } = await runProcess(["tar", "xzf", RUNTIME_TARBALL, "-C", RUNTIME_DIR], { runId: SETUP_ID });
			checkCancel();
			if (exitCode !== 0) {
				await rm(RUNTIME_TARBALL, { force: true }).catch(() => {});
				throw new Error("Couldn't unpack Python. Try again.");
			}
		}

		// 2. Virtual environment (reused when it works; pip brings it to the pins).
		const venvWorks = (await fileExists(VENV_PYTHON)) &&
			(await runProcess([VENV_PYTHON, "-c", "import sys"])).exitCode === 0;
		if (!venvWorks) {
			setPhase("Preparing");
			await rm(VENV_DIR, { recursive: true, force: true }).catch(() => {});
			const { exitCode } = await runProcess([RUNTIME_PYTHON, "-m", "venv", "--clear", VENV_DIR], { runId: SETUP_ID });
			checkCancel();
			if (exitCode !== 0) throw new Error("Couldn't create the Python environment.");
		}
		await rm(VENV_READY_MARKER, { force: true }).catch(() => {});

		// 3. PyTorch, the right build for this machine, then the rest.
		if (variant === "pypi") {
			setPhase("Downloading the training engine");
			await pip([`torch==${TORCH_VERSION}`, `torchvision==${TORCHVISION_VERSION}`, ...APP_PACKAGES], "Installing the training engine");
		} else {
			setPhase(variant === "cpu" ? "Downloading PyTorch" : "Downloading PyTorch with GPU support");
			await pip([
				`torch==${TORCH_VERSION}+${variant}`, `torchvision==${TORCHVISION_VERSION}+${variant}`,
				"--index-url", `https://download.pytorch.org/whl/${variant}`,
			], "Installing PyTorch");
			setPhase("Downloading the training engine");
			await pip(APP_PACKAGES, "Installing the training engine");
		}

		// 4. Can training actually use the GPU?
		setPhase("Checking the GPU");
		const device = await checkDevice(plan);
		const marker: Marker = { pinsHash: pinsHash(variant), variant, ...device };
		await writeFile(VENV_READY_MARKER, JSON.stringify(marker, null, 2));
		await rm(RUNTIME_TARBALL, { force: true }).catch(() => {});
		logLine(`[setup] Training engine ready. ${device.message}`);
		current = { state: "ready" };
		return VENV_PYTHON;
	} catch (err) {
		if (err instanceof EngineCancelled) {
			logLine("[setup] Setup cancelled.");
			current = { state: "missing" };
		} else {
			const message = (err as Error).message || "Setup failed.";
			logLine(`[setup] error: ${message}`);
			current = { state: "failed", error: message };
		}
		throw err;
	} finally {
		cancelRequested = false;
		abortDownload = null;
	}
}

const DEVICE_CHECK = `
import json, torch
cuda = torch.cuda.is_available()
mps = getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available()
print(json.dumps({"cuda": cuda, "mps": mps, "name": torch.cuda.get_device_name(0) if cuda else None}))
`;

async function checkDevice(plan: EnginePlan): Promise<{ gpuUsable: boolean; message: string }> {
	const { stdout } = await runProcess([VENV_PYTHON, "-c", DEVICE_CHECK]);
	const r = parseLastJsonLine(stdout) as { cuda?: boolean; mps?: boolean; name?: string } | null;
	if (r?.cuda) return { gpuUsable: true, message: `Training will use your ${r.name ?? "NVIDIA GPU"}.` };
	if (r?.mps) return { gpuUsable: true, message: "Training will use the Apple Silicon GPU." };
	if (plan.gpu.kind === "nvidia") {
		return { gpuUsable: false, message:
			"Found an NVIDIA GPU but couldn't use it (the driver may be too old). Training will use the CPU: it works, but more slowly." };
	}
	return { gpuUsable: false, message: "No supported GPU: training will use the CPU. It works, but more slowly." };
}

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

async function downloadPythonRuntime(destPath: string, tracker: ProgressTracker, update: () => void): Promise<void> {
	const asset = pythonRuntimeAsset();
	if (!asset) throw new Error(`Unsupported platform for Python download: ${process.platform}-${process.arch}`);

	abortDownload = new AbortController();
	const res = await fetch(asset.url, { headers: { "User-Agent": "Nab" }, signal: abortDownload.signal })
		.catch(err => { throw cancelRequested ? new EngineCancelled() : new Error(`Couldn't download Python: ${(err as Error).message}`); });
	if (!res.ok || !res.body) throw new Error(`Couldn't download Python (HTTP ${res.status}).`);
	const total = Number(res.headers.get("content-length")) || 0;

	await mkdir(YOLO_DIR, { recursive: true });
	const hash = createHash("sha256");
	const chunks: Uint8Array[] = [];
	let received = 0;
	const reader = res.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			hash.update(value);
			received += value.length;
			tracker.fileProgress(received, total || received);
			update();
		}
	} catch (err) {
		throw cancelRequested ? new EngineCancelled() : err;
	}
	if (hash.digest("hex") !== asset.sha256)
		throw new Error("The Python download was corrupted. Check your connection and try again.");
	const buf = new Uint8Array(received);
	let offset = 0;
	for (const c of chunks) { buf.set(c, offset); offset += c.length; }
	await writeFile(destPath, buf);
}

// ── Callers that need the engine ──────────────────────────────────────────────

/**
 * Ensures the engine is installed, writing setup lines to `logPath` (as
 * {"type":"stderr"} JSON lines) and to `stderrHandler`.
 */
export async function prepareEnvironment(
	logPath: string,
	_runId: string,
	stderrHandler?: (text: string) => Promise<void>,
): Promise<string> {
	let chain = Promise.resolve();
	const onLine = (text: string) => {
		chain = chain.then(() => appendFile(logPath, JSON.stringify({ type: "stderr", text }) + "\n").catch(() => {}));
		void stderrHandler?.(text);
	};
	try {
		return await ensureEngine(onLine);
	} finally {
		await chain;
	}
}

export async function runInference(
	imagePath:   string,
	modelPath:   string,
	confidence:  number,
	inferScript: string,
	logPath:     string,
	runId:       string,
	stderrHandler?: (line: string) => Promise<void>,
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

// ── IPC handlers ──────────────────────────────────────────────────────────────

export const engineHandlers = {
	getEngineStatus: () => getEngineStatus(),
	startEngineSetup: async () => { startEngineSetup(); return {}; },
	cancelEngineSetup: async () => { await cancelEngineSetup(); return {}; },
};
