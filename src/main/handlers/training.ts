import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { appendFile, copyFile, mkdir, readFile, rm, stat, readdir, unlink, writeFile } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import {
	TRAIN_SCRIPT, MODELS_DIR, runningProcesses,
	prepareEnvironment, streamProcessOutput, waitForExit, checkpointPath, modelPath as getModelPath,
	fileExists,
} from "../util";
import { exp, IMAGE_EXTS, checkFileHasPolygon, detectHasPolygons, listAnnotatedImages, readLogFile, type AnnotatedImageEntry } from "../common";

// ── run-meta.json schema ──────────────────────────────────────────────────────

type RunMeta = {
	classMap: string[];
	assetPaths: string[];
	hasPolygons: boolean;
	imageCount: number;
	datasetCopiedAt: number;
};

// ── Dataset copy ──────────────────────────────────────────────────────────────

const DATASET_SUBDIR     = join("dataset", "images", "train");
const DATASET_LBL_SUBDIR = join("dataset", "labels", "train");

async function copyDatasetFiles(
	assetPaths: string[],
	outputPath: string,
	logPath: string,
): Promise<{ imageCount: number; hasPolygons: boolean }> {
	const imgDir = join(exp(outputPath), DATASET_SUBDIR);
	const lblDir = join(exp(outputPath), DATASET_LBL_SUBDIR);

	try { await rm(join(exp(outputPath), "dataset"), { recursive: true, force: true }); } catch {}
	await mkdir(imgDir, { recursive: true });
	await mkdir(lblDir, { recursive: true });

	const allEntries = (await Promise.all(assetPaths.map(p => listAnnotatedImages(p)))).flat();
	const total = allEntries.length;

	await appendFile(logPath, JSON.stringify({ type: "dataset_copy_start", total }) + "\n");

	const seen        = new Set<string>();
	let   hasPolygons = false;
	const REPORT_EVERY = 10;

	for (let i = 0; i < allEntries.length; i++) {
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
			await appendFile(logPath, JSON.stringify({ type: "dataset_copy_progress", done: i + 1, total }) + "\n");
		}
	}

	return { imageCount: total, hasPolygons };
}

// Runs the user paused or stopped. Their process exit is expected, so no
// "stopped unexpectedly" error is logged for them.
const userStopped = new Set<string>();

function isTerminalEvent(line: string): boolean {
	try {
		const type = JSON.parse(line)?.type;
		return type === "done" || type === "error";
	} catch { return false; }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const trainingHandlers = {
	startTraining: async (config: {
		id: string; name: string; assetPaths: string[]; classMap: string[];
		baseModel: string; epochs: number; batchSize: number; imgsz: number;
		device: string; outputPath: string; fresh: boolean;
	}) => {
		const existing = runningProcesses.get(config.id);
		if (existing) {
			if (existing.exitCode !== null) {
				runningProcesses.delete(config.id);
			} else {
				return { started: false };
			}
		}
		await mkdir(exp(config.outputPath), { recursive: true });
		if (config.fresh) {
			await unlink(checkpointPath(exp(config.outputPath))).catch(() => {});
			await unlink(join(exp(config.outputPath), "train.log")).catch(() => {});
		}
		const logPath     = join(exp(config.outputPath), "train.log");
		const metaPath    = join(exp(config.outputPath), "run-meta.json");
		const datasetPath = join(exp(config.outputPath), "dataset");

		await appendFile(logPath, JSON.stringify({ type: "start", timestamp: new Date().toISOString(), config }) + "\n");

		let imageCount: number;
		let hasPolygons: boolean;

		if (config.fresh) {
			const result = await copyDatasetFiles(config.assetPaths, config.outputPath, logPath);
			imageCount  = result.imageCount;
			hasPolygons = result.hasPolygons;
			const meta: RunMeta = { classMap: config.classMap, assetPaths: config.assetPaths, hasPolygons, imageCount, datasetCopiedAt: Date.now() };
			await writeFile(metaPath, JSON.stringify(meta, null, 2));
		} else {
			try {
				const meta: RunMeta = JSON.parse(await readFile(metaPath, "utf-8"));
				imageCount  = meta.imageCount  ?? 0;
				hasPolygons = meta.hasPolygons ?? false;
			} catch {
				imageCount = 0; hasPolygons = false;
			}

			const imgDir = join(datasetPath, "images", "train");
			let datasetExists = false;
			try { datasetExists = (await stat(imgDir)).isDirectory(); } catch {}

			if (!datasetExists) {
				await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[dataset] Dataset missing — copying from assets..." }) + "\n");
				const result = await copyDatasetFiles(config.assetPaths, config.outputPath, logPath);
				imageCount  = result.imageCount;
				hasPolygons = result.hasPolygons;
				const meta: RunMeta = { classMap: config.classMap, assetPaths: config.assetPaths, hasPolygons, imageCount, datasetCopiedAt: Date.now() };
				await writeFile(metaPath, JSON.stringify(meta, null, 2));
			}
		}

		const venvPython = await prepareEnvironment(logPath, config.id);
		await appendFile(logPath, JSON.stringify({ type: "stderr", text: "[setup] Starting training..." }) + "\n");

		await mkdir(MODELS_DIR, { recursive: true });
		userStopped.delete(config.id);

		let proc: ReturnType<typeof spawn>;
		try {
			proc = spawn(venvPython, [TRAIN_SCRIPT], {
				stdio: ["pipe", "pipe", "pipe"],
				env:   { ...process.env, PYTHONUNBUFFERED: "1" },
			});
		} catch (spawnErr) {
			await appendFile(logPath, JSON.stringify({
				type: "error",
				message: `Failed to start Python process: ${(spawnErr as Error).message}`,
			}) + "\n");
			return { started: false };
		}
		runningProcesses.set(config.id, proc);

		// One append stream per run keeps log lines in the order they arrive.
		const log = createWriteStream(logPath, { flags: "a" });
		log.on("error", console.error);
		const writeLine = (line: string) => { log.write(line + "\n"); };

		let sawTerminal = false;
		let spawnError: Error | null = null;
		const exited = waitForExit(proc, err => { spawnError = err; });

		proc.stdin?.on("error", () => {}); // process may die before reading its config
		proc.stdin?.write(JSON.stringify({ ...config, datasetPath, modelsDir: MODELS_DIR }), "utf-8");
		proc.stdin?.end();

		const streamed = streamProcessOutput(proc, {
			stdoutHandler: async line => {
				if (isTerminalEvent(line)) sawTerminal = true;
				writeLine(line);
			},
			stderrHandler: async text => { writeLine(JSON.stringify({ type: "stderr", text })); },
		}).catch(console.error);

		void (async () => {
			const exitCode = await exited;
			if (!spawnError) await streamed;
			if (runningProcesses.get(config.id) === proc) runningProcesses.delete(config.id);
			// Python normally ends with a done/error line. If it died without one
			// (out of memory, CUDA crash, killed by the OS) say so, or the UI would
			// show "training" forever.
			if (!sawTerminal && !userStopped.has(config.id)) {
				const reason = spawnError
					? `Failed to start Python process: ${(spawnError as Error).message}`
					: proc.signalCode
						? `Training stopped unexpectedly (killed by ${proc.signalCode}). The machine may have run out of memory.`
						: `Training stopped unexpectedly (exit code ${exitCode}).`;
				writeLine(JSON.stringify({ type: "error", message: reason }));
			}
			log.end();
		})();

		return { started: true };
	},

	stopTraining: async ({ runId, clearCheckpoint, outputPath }: {
		runId: string; clearCheckpoint?: boolean; outputPath?: string;
	}) => {
		const proc = runningProcesses.get(runId);
		if (proc) { userStopped.add(runId); proc.kill(9); runningProcesses.delete(runId); }
		if (clearCheckpoint && outputPath) {
			await unlink(checkpointPath(exp(outputPath))).catch(() => {});
			await unlink(join(exp(outputPath), "train.log")).catch(() => {});
		}
		return {};
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

		const { imageCount, hasPolygons } = await copyDatasetFiles(meta.assetPaths, outputPath, updateLogPath);

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
