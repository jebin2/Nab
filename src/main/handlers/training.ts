import { EventEmitter } from "events";
import { appendFile, copyFile, mkdir, readFile, rm, stat, readdir, unlink, writeFile } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import {
	TRAIN_SCRIPT, MODELS_DIR, runningProcesses,
	prepareEnvironment, checkpointPath, modelPath as getModelPath,
	fileExists, cleanLine,
} from "../util";
import { startManaged, killTree, type ManagedProcess } from "../managedProcess";
import { exp, IMAGE_EXTS, checkFileHasPolygon, detectHasPolygons, listAnnotatedImages, readLogFile, type AnnotatedImageEntry } from "../common";

// ── run-meta.json schema ──────────────────────────────────────────────────────

type RunMeta = {
	classMap: string[];
	assetPaths: string[];
	hasPolygons: boolean;
	imageCount: number;
	datasetCopiedAt: number;
};

// ── Run status, owned here and pushed to the UI ───────────────────────────────

export type TrainingStatus = "idle" | "installing" | "training" | "stopping" | "paused" | "done" | "failed";

/** Sent on every status change. `at` is a Unix timestamp in ms. */
export type TrainingStatusEvent = {
	runId: string; status: TrainingStatus; at: number;
	mAP?: number; message?: string;
};
/** New train.log lines for a run. `reset` means the log was cleared first. */
export type TrainingLogEvent = { runId: string; lines: string[]; reset?: boolean };

/** Emits "status" (TrainingStatusEvent) and "log" (TrainingLogEvent). */
export const trainingEvents = new EventEmitter();

// Pause waits this long for train.py to finish writing a checkpoint before it
// is force-killed.
const STOP_GRACE_MS = 60_000;
const LOG_PUSH_INTERVAL_MS = 100;

type ActiveRun = {
	status: TrainingStatus;
	cancel: null | "pause" | "stop";
	managed?: ManagedProcess;
	flow: Promise<void>;
};

/** Runs that are installing, training or stopping. */
const active = new Map<string, ActiveRun>();

function setStatus(runId: string, status: TrainingStatus, extra: Partial<TrainingStatusEvent> = {}) {
	const run = active.get(runId);
	if (run) run.status = status;
	trainingEvents.emit("status", { runId, status, at: Date.now(), ...extra } satisfies TrainingStatusEvent);
}

/**
 * Appends lines to train.log in order and pushes them to the UI in small
 * batches. `push` sends a line to the UI without writing it (for lines another
 * writer already put in the file).
 */
class RunLog {
	private pending = "";
	private writing: Promise<void> = Promise.resolve();
	private batch: string[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private path: string, private runId: string) {}

	write(line: string) {
		this.pending += line + "\n";
		this.writing = this.writing.then(() => this.flushFile());
		this.push(line);
	}

	push(line: string) {
		this.batch.push(line);
		this.timer ??= setTimeout(() => this.flushPush(), LOG_PUSH_INTERVAL_MS);
	}

	/** Waits until everything written so far is on disk and pushed. */
	async idle() {
		await this.writing;
		this.flushPush();
	}

	private async flushFile() {
		if (!this.pending) return;
		const data = this.pending;
		this.pending = "";
		await appendFile(this.path, data).catch(console.error);
	}

	private flushPush() {
		if (this.timer) { clearTimeout(this.timer); this.timer = null; }
		if (this.batch.length === 0) return;
		const lines = this.batch;
		this.batch = [];
		trainingEvents.emit("log", { runId: this.runId, lines } satisfies TrainingLogEvent);
	}
}

function terminalEvent(line: string): { type: "done"; mAP50?: number } | { type: "error"; message?: string } | null {
	try {
		const ev = JSON.parse(line);
		if (ev?.type === "done" || ev?.type === "error") return ev;
	} catch {}
	return null;
}

class Cancelled extends Error {}

// ── Dataset copy ──────────────────────────────────────────────────────────────

const DATASET_SUBDIR     = join("dataset", "images", "train");
const DATASET_LBL_SUBDIR = join("dataset", "labels", "train");

async function copyDatasetFiles(
	assetPaths: string[],
	outputPath: string,
	log: (line: string) => Promise<void> | void,
	shouldCancel: () => boolean = () => false,
): Promise<{ imageCount: number; hasPolygons: boolean }> {
	const imgDir = join(exp(outputPath), DATASET_SUBDIR);
	const lblDir = join(exp(outputPath), DATASET_LBL_SUBDIR);

	try { await rm(join(exp(outputPath), "dataset"), { recursive: true, force: true }); } catch {}
	await mkdir(imgDir, { recursive: true });
	await mkdir(lblDir, { recursive: true });

	const allEntries = (await Promise.all(assetPaths.map(p => listAnnotatedImages(p)))).flat();
	const total = allEntries.length;

	await log(JSON.stringify({ type: "dataset_copy_start", total }));

	const seen        = new Set<string>();
	let   hasPolygons = false;
	const REPORT_EVERY = 10;

	for (let i = 0; i < allEntries.length; i++) {
		if (shouldCancel()) throw new Cancelled();
		const entry = allEntries[i];

		const srcName  = basename(entry.imgPath);
		let   destName = srcName;
		if (seen.has(destName)) {
			const assetBase = basename(dirname(dirname(entry.imgPath)));
			destName = `${assetBase}__${srcName}`;
		}
		seen.add(destName);

		const destStem = destName.slice(0, destName.lastIndexOf("."));
		await copyFile(entry.imgPath,   join(imgDir, destName));
		await copyFile(entry.labelPath, join(lblDir, `${destStem}.txt`));

		if (!hasPolygons) hasPolygons = await checkFileHasPolygon(entry.labelPath);

		if ((i + 1) % REPORT_EVERY === 0 || i === allEntries.length - 1) {
			await log(JSON.stringify({ type: "dataset_copy_progress", done: i + 1, total }));
		}
	}

	return { imageCount: total, hasPolygons };
}

// ── Training flow ─────────────────────────────────────────────────────────────

type TrainingConfig = {
	id: string; name: string; assetPaths: string[]; classMap: string[];
	baseModel: string; epochs: number; batchSize: number; imgsz: number;
	device: string; outputPath: string; fresh: boolean;
};

async function clearRunFiles(outputPath: string) {
	await unlink(checkpointPath(exp(outputPath))).catch(() => {});
	await unlink(join(exp(outputPath), "train.log")).catch(() => {});
}

async function runTraining(config: TrainingConfig, run: ActiveRun): Promise<void> {
	const outDir      = exp(config.outputPath);
	const logPath     = join(outDir, "train.log");
	const metaPath    = join(outDir, "run-meta.json");
	const datasetPath = join(outDir, "dataset");
	const cancelled   = () => run.cancel !== null;

	await mkdir(outDir, { recursive: true });
	if (config.fresh) {
		await clearRunFiles(config.outputPath);
		trainingEvents.emit("log", { runId: config.id, lines: [], reset: true } satisfies TrainingLogEvent);
	}

	const log = new RunLog(logPath, config.id);
	log.write(JSON.stringify({ type: "start", timestamp: new Date().toISOString(), config }));

	// 1. Dataset snapshot.
	const copyDataset = async () => {
		const result = await copyDatasetFiles(config.assetPaths, config.outputPath, line => log.write(line), cancelled);
		const meta: RunMeta = { classMap: config.classMap, assetPaths: config.assetPaths, hasPolygons: result.hasPolygons, imageCount: result.imageCount, datasetCopiedAt: Date.now() };
		await writeFile(metaPath, JSON.stringify(meta, null, 2));
	};
	if (config.fresh) {
		await copyDataset();
	} else {
		let datasetExists = false;
		try { datasetExists = (await stat(join(datasetPath, "images", "train"))).isDirectory(); } catch {}
		if (!datasetExists) {
			log.write(JSON.stringify({ type: "stderr", text: "[dataset] Dataset missing — copying from assets..." }));
			await copyDataset();
		}
	}
	if (cancelled()) throw new Cancelled();

	// 2. Python environment. prepareEnvironment appends to train.log itself, so
	//    flush ours first and only push its lines to the UI.
	await log.idle();
	const venvPython = await prepareEnvironment(logPath, config.id, async text => {
		log.push(JSON.stringify({ type: "stderr", text }));
	}).catch(err => { throw cancelled() ? new Cancelled() : err; });
	if (cancelled()) throw new Cancelled();

	// 3. Train.
	log.write(JSON.stringify({ type: "stderr", text: "[setup] Starting training..." }));
	await mkdir(MODELS_DIR, { recursive: true });

	let terminal: ReturnType<typeof terminalEvent> = null;
	const managed = startManaged([venvPython, TRAIN_SCRIPT], {
		env:   { ...process.env, PYTHONUNBUFFERED: "1" },
		stdin: JSON.stringify({ ...config, datasetPath, modelsDir: MODELS_DIR }),
		onStdout: raw => {
			const line = cleanLine(raw);
			if (!line) return;
			terminal = terminalEvent(line) ?? terminal;
			log.write(line);
		},
		onStderr: raw => {
			const text = cleanLine(raw);
			if (text) log.write(JSON.stringify({ type: "stderr", text }));
		},
	});
	run.managed = managed;
	runningProcesses.set(config.id, managed.proc); // so quitting the app kills it
	setStatus(config.id, "training");

	const info = await managed.exited;
	if (runningProcesses.get(config.id) === managed.proc) runningProcesses.delete(config.id);
	killTree(managed.proc); // stray data-loader workers

	const result = terminal as ReturnType<typeof terminalEvent>;
	if (result?.type === "done") {
		await log.idle();
		setStatus(config.id, "done", { mAP: result.mAP50 });
		return;
	}
	if (cancelled()) throw new Cancelled();

	// Python normally ends with a done/error line. If it died without one
	// (out of memory, CUDA crash, killed by the OS) say so, or the UI would
	// show "training" forever.
	let message = result?.type === "error" ? result.message ?? "Training failed." : "";
	if (!result) {
		message = info.spawnError
			? `Failed to start Python process: ${info.spawnError.message}`
			: info.signal
				? `Training stopped unexpectedly (killed by ${info.signal}). The machine may have run out of memory.`
				: `Training stopped unexpectedly (exit code ${info.code}).`;
		log.write(JSON.stringify({ type: "error", message }));
	}
	await log.idle();
	setStatus(config.id, "failed", { message });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const trainingHandlers = {
	/**
	 * Starts a run in the background and returns at once. Progress arrives as
	 * "status" and "log" events. Refuses if the run is already active.
	 */
	startTraining: async (config: TrainingConfig) => {
		if (active.has(config.id)) return { started: false };

		const run: ActiveRun = { status: "installing", cancel: null, flow: Promise.resolve() };
		active.set(config.id, run);
		setStatus(config.id, "installing");

		run.flow = runTraining(config, run)
			.catch(async err => {
				if (err instanceof Cancelled || run.cancel) {
					if (run.cancel === "stop") await clearRunFiles(config.outputPath);
					setStatus(config.id, run.cancel === "stop" ? "idle" : "paused");
					return;
				}
				const message = (err as Error).message || "Training failed.";
				await appendFile(join(exp(config.outputPath), "train.log"),
					JSON.stringify({ type: "error", message }) + "\n").catch(() => {});
				trainingEvents.emit("log", { runId: config.id, lines: [JSON.stringify({ type: "error", message })] });
				setStatus(config.id, "failed", { message });
			})
			.finally(() => active.delete(config.id));

		return { started: true };
	},

	/**
	 * Pause (keeps the checkpoint) or stop (`clearCheckpoint`, deletes it and the
	 * log). Works in any phase, including dataset copy and Python setup.
	 * Resolves once the run has actually stopped.
	 */
	stopTraining: async ({ runId, clearCheckpoint, outputPath }: {
		runId: string; clearCheckpoint?: boolean; outputPath?: string;
	}) => {
		const run = active.get(runId);
		if (!run) {
			if (clearCheckpoint && outputPath) {
				await clearRunFiles(outputPath);
				setStatus(runId, "idle");
			}
			return {};
		}

		run.cancel = clearCheckpoint ? "stop" : "pause";
		setStatus(runId, "stopping");
		if (run.managed) {
			void run.managed.stop(STOP_GRACE_MS);
		} else {
			// Setup phase: kill pip / the runtime download if one is running.
			const setupProc = runningProcesses.get(runId);
			if (setupProc) killTree(setupProc);
		}
		await run.flow;
		return {};
	},

	/** Statuses of runs that are active right now (for a UI that reloads). */
	getTrainingStatus: async () => {
		const statuses: Record<string, TrainingStatus> = {};
		for (const [id, run] of active) statuses[id] = run.status;
		return { statuses };
	},

	readTrainingLog: async ({ outputPath }: { outputPath: string }) => {
		return { lines: await readLogFile(join(exp(outputPath), "train.log")) };
	},

	readRunMeta: async ({ outputPath }: { outputPath: string }) => {
		const EMPTY = {
			found: false, classMap: [] as string[], imageCount: 0,
			hasPolygons: false, currentHasPolygons: false, hasPolygonsChanged: false,
			newCount: 0, deletedCount: 0, modifiedCount: 0, hasDrift: false,
		};
		try {
			const meta: RunMeta = JSON.parse(await readFile(join(exp(outputPath), "run-meta.json"), "utf-8"));

			const datasetImgDir = join(exp(outputPath), DATASET_SUBDIR);
			let datasetImageCount = 0;
			try {
				const files = await readdir(datasetImgDir);
				datasetImageCount = files.filter(f => IMAGE_EXTS.has(extname(f).toLowerCase())).length;
			} catch {}

			const assetPaths: string[] = meta.assetPaths ?? [];
			const currentEntries: AnnotatedImageEntry[] = (
				await Promise.all(assetPaths.map(p => listAnnotatedImages(p)))
			).flat();
			const currentCount = currentEntries.length;

			const newCount     = Math.max(0, currentCount - datasetImageCount);
			const deletedCount = Math.max(0, datasetImageCount - currentCount);

			const copiedAt      = meta.datasetCopiedAt ?? 0;
			const modifiedCount = currentEntries.filter(e => e.mtime * 1000 > copiedAt).length;

			const polyResults        = await Promise.all(assetPaths.map(p => detectHasPolygons(exp(p))));
			const currentHasPolygons = polyResults.some(Boolean);
			const hasPolygonsChanged = currentHasPolygons !== (meta.hasPolygons ?? false);

			const hasDrift = newCount > 0 || deletedCount > 0 || modifiedCount > 0 || hasPolygonsChanged;

			return {
				found: true, classMap: meta.classMap ?? [], imageCount: meta.imageCount ?? datasetImageCount,
				hasPolygons: meta.hasPolygons ?? false, currentHasPolygons, hasPolygonsChanged,
				newCount, deletedCount, modifiedCount, hasDrift,
			};
		} catch { return EMPTY; }
	},

	updateDataset: async ({ outputPath }: { outputPath: string }) => {
		const metaPath = join(exp(outputPath), "run-meta.json");
		const meta: RunMeta = JSON.parse(await readFile(metaPath, "utf-8"));

		const updateLogPath = join(exp(outputPath), "dataset-update.log");
		await writeFile(updateLogPath, "");

		const { imageCount, hasPolygons } = await copyDatasetFiles(
			meta.assetPaths, outputPath, line => appendFile(updateLogPath, line + "\n"),
		);

		const updated: RunMeta = { ...meta, hasPolygons, imageCount, datasetCopiedAt: Date.now() };
		await writeFile(metaPath, JSON.stringify(updated, null, 2));
		await unlink(updateLogPath).catch(() => {});

		return { imageCount, hasPolygons, previousHasPolygons: meta.hasPolygons };
	},

	checkWeights: async ({ outputPaths }: { outputPaths: string[] }) => {
		const results: Record<string, boolean> = {};
		await Promise.all(outputPaths.map(async p => {
			results[p] = await fileExists(getModelPath(exp(p)));
		}));
		return { results };
	},
};
