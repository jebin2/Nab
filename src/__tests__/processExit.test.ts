import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const IS_WIN = process.platform === "win32";
const work = mkdtempSync(join(tmpdir(), "nab-proc-test-"));

// Fake "training script": run by /bin/sh instead of Python. Its behaviour is
// chosen by the run id in the JSON config it reads from stdin.
const FAKE_TRAIN = join(work, "train.sh");

vi.mock("../main/util", async importOriginal => {
	const actual = await importOriginal<typeof import("../main/util")>();
	return { ...actual, TRAIN_SCRIPT: FAKE_TRAIN, MODELS_DIR: join(work, "models") };
});

vi.mock("../main/engine", async importOriginal => {
	const actual = await importOriginal<typeof import("../main/engine")>();
	return {
		...actual,
		// "slowsetup" runs simulate a long, shared engine install.
		prepareEnvironment: async (_log: string, runId: string) => {
			if (runId.includes("slowsetup")) await new Promise(r => setTimeout(r, 30_000));
			return "/bin/sh";
		},
	};
});

const { runProcess, waitForExit } = await import("../main/util");
const { startManaged } = await import("../main/managedProcess");
const { trainingHandlers, trainingEvents } = await import("../main/handlers/training");
type StatusEvent = import("../main/handlers/training").TrainingStatusEvent;
const { spawn } = await import("child_process");

beforeAll(() => {
	writeFileSync(FAKE_TRAIN, `#!/bin/sh
config=$(cat)
echo '{"type": "progress", "epoch": 1, "epochs": 3}'
case "$config" in
  *crash*)    kill -9 $$ ;;
  *exit3*)    exit 3 ;;
  *graceful*) trap 'sleep 1; exit 0' TERM; sleep 30 & wait ;;
  *workers*)  sleep 300 & echo $! > "${work}/worker.pid"; sleep 30 & wait ;;
  *slow*)     sleep 30 & wait ;;
  *)          echo '{"type": "done", "mAP50": 0.9}' ;;
esac
`);
	chmodSync(FAKE_TRAIN, 0o755);
});

const statusLog: StatusEvent[] = [];
trainingEvents.on("status", (ev: StatusEvent) => statusLog.push(ev));
const statusesOf = (runId: string) => statusLog.filter(e => e.runId === runId).map(e => e.status);

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, what: string): Promise<T> {
	for (let i = 0; i < 200; i++) {
		const v = await fn();
		if (v) return v;
		await new Promise(r => setTimeout(r, 25));
	}
	throw new Error(`timed out waiting for ${what}`);
}

const lastStatus = (runId: string, status: string) =>
	until(() => statusLog.find(e => e.runId === runId && e.status === status), `${runId} → ${status}`);

const logLines = async (runId: string) =>
	(await readFile(join(work, runId, "train.log"), "utf-8").catch(() => "")).split("\n").filter(Boolean);
const types = (lines: string[]) => lines.map(l => { try { return JSON.parse(l).type; } catch { return "?"; } });

function start(runId: string, fresh = true) {
	return trainingHandlers.startTraining({
		id: runId, name: runId, assetPaths: [], classMap: ["a"], baseModel: "yolo11n",
		epochs: 3, batchSize: 1, imgsz: 64, device: "cpu", outputPath: join(work, runId), fresh,
	});
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe.skipIf(IS_WIN)("process helpers", () => {
	it("waitForExit treats a killed process as a failure", async () => {
		const proc = spawn("sleep", ["30"]);
		const code = waitForExit(proc);
		proc.kill("SIGKILL");
		expect(await code).not.toBe(0);
	});

	it("runProcess reports a missing program instead of hanging", async () => {
		const res = await runProcess(["/nonexistent/program"]);
		expect(res.exitCode).not.toBe(0);
		expect(res.stderr).toMatch(/ENOENT/);
	});

	it("startManaged delivers every output line in order", async () => {
		const lines: string[] = [];
		const m = startManaged(["sh", "-c", "for i in 1 2 3 4 5; do echo $i; done; printf tail"], { onStdout: l => lines.push(l) });
		const info = await m.exited;
		expect(info.ok).toBe(true);
		expect(lines).toEqual(["1", "2", "3", "4", "5", "tail"]);
	});

	it("stop() force-kills a process that ignores SIGTERM", async () => {
		const m = startManaged(["sh", "-c", "trap '' TERM; sleep 30 & wait; sleep 30"]);
		await new Promise(r => setTimeout(r, 100));
		const t0 = Date.now();
		const info = await m.stop(300);
		expect(info.ok).toBe(false);
		expect(Date.now() - t0).toBeLessThan(5000);
	});
});

describe.skipIf(IS_WIN)("training runs", () => {
	it("reports installing → training → done, with mAP, and no error", async () => {
		expect((await start("ok")).started).toBe(true);
		const done = await lastStatus("ok", "done");
		expect(done.mAP).toBe(0.9);
		expect(statusesOf("ok")).toEqual(["installing", "training", "done"]);
		const lines = await logLines("ok");
		expect(types(lines)).not.toContain("error");
		expect(types(lines).indexOf("progress")).toBeLessThan(types(lines).indexOf("done"));
	});

	it("pushes log lines to the UI", async () => {
		const pushed: string[] = [];
		const onLog = (ev: { runId: string; lines: string[] }) => { if (ev.runId === "pushed") pushed.push(...ev.lines); };
		trainingEvents.on("log", onLog);
		await start("pushed");
		await lastStatus("pushed", "done");
		trainingEvents.off("log", onLog);
		expect(types(pushed)).toEqual(expect.arrayContaining(["start", "progress", "done"]));
	});

	it("fails with a clear message when training is killed without reporting", async () => {
		await start("crash");
		const failed = await lastStatus("crash", "failed");
		expect(failed.message).toMatch(/killed by SIGKILL/);
		expect((await logLines("crash")).join("\n")).toMatch(/killed by SIGKILL/);
	});

	it("fails with the exit code when training exits silently", async () => {
		await start("exit3");
		expect((await lastStatus("exit3", "failed")).message).toMatch(/exit code 3/);
	});

	it("refuses a second start while a run is active", async () => {
		expect((await start("slow-double")).started).toBe(true);
		expect((await start("slow-double")).started).toBe(false);
		await trainingHandlers.stopTraining({ runId: "slow-double" });
	});

	it("pauses a training run: stopping → paused, no error logged", async () => {
		await start("slow-pause");
		await lastStatus("slow-pause", "training");
		await until(async () => types(await logLines("slow-pause")).includes("progress"), "progress");
		await trainingHandlers.stopTraining({ runId: "slow-pause" });
		expect(statusesOf("slow-pause").slice(-2)).toEqual(["stopping", "paused"]);
		expect(types(await logLines("slow-pause"))).not.toContain("error");
	});

	it("lets the trainer finish its SIGTERM handling before it exits", async () => {
		await start("graceful");
		await lastStatus("graceful", "training");
		await new Promise(r => setTimeout(r, 100));
		const t0 = Date.now();
		await trainingHandlers.stopTraining({ runId: "graceful" });
		expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // waited for the trap's `sleep 1`
		expect(statusesOf("graceful").at(-1)).toBe("paused");
	});

	it("kills worker processes the trainer started", async () => {
		await start("workers");
		const pidFile = join(work, "worker.pid");
		await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf-8").trim(), "worker pid");
		const pid = Number(readFileSync(pidFile, "utf-8").trim());
		expect(alive(pid)).toBe(true);
		await trainingHandlers.stopTraining({ runId: "workers" });
		await until(() => !alive(pid), "worker to die");
	});

	it("pause during setup stops waiting at once and never starts training", async () => {
		await start("slowsetup");
		await new Promise(r => setTimeout(r, 200));
		await trainingHandlers.stopTraining({ runId: "slowsetup" });
		expect(statusesOf("slowsetup")).toEqual(["installing", "stopping", "paused"]);
		expect(types(await logLines("slowsetup"))).not.toContain("progress");
	});

	it("stop clears the checkpoint and log and returns to idle", async () => {
		await start("slow-stop");
		await lastStatus("slow-stop", "training");
		await trainingHandlers.stopTraining({ runId: "slow-stop", clearCheckpoint: true, outputPath: join(work, "slow-stop") });
		expect(statusesOf("slow-stop").at(-1)).toBe("idle");
		expect(existsSync(join(work, "slow-stop", "train.log"))).toBe(false);
	});

	it("reports active runs to a reloaded UI", async () => {
		await start("slow-status");
		await lastStatus("slow-status", "training");
		expect((await trainingHandlers.getTrainingStatus()).statuses["slow-status"]).toBe("training");
		await trainingHandlers.stopTraining({ runId: "slow-status" });
		expect((await trainingHandlers.getTrainingStatus()).statuses["slow-status"]).toBeUndefined();
	});
});
