import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const IS_WIN = process.platform === "win32";
const work = mkdtempSync(join(tmpdir(), "nab-proc-test-"));

// Fake "training script": run by /bin/sh instead of Python. Its behaviour is
// chosen by the run name in the JSON config it reads from stdin.
const FAKE_TRAIN = join(work, "train.sh");

vi.mock("../main/util", async importOriginal => {
	const actual = await importOriginal<typeof import("../main/util")>();
	return {
		...actual,
		TRAIN_SCRIPT: FAKE_TRAIN,
		MODELS_DIR: join(work, "models"),
		prepareEnvironment: async () => "/bin/sh",
	};
});

const { runProcess, waitForExit } = await import("../main/util");
const { trainingHandlers } = await import("../main/handlers/training");
const { spawn } = await import("child_process");

beforeAll(() => {
	writeFileSync(FAKE_TRAIN, `#!/bin/sh
config=$(cat)
echo '{"type": "progress", "epoch": 1, "epochs": 3}'
case "$config" in
  *crash*) kill -9 $$ ;;
  *exit3*) exit 3 ;;
  *slow*)  sleep 30 ;;
  *)       echo '{"type": "done", "mAP50": 0.9}' ;;
esac
`);
	chmodSync(FAKE_TRAIN, 0o755);
});

async function waitForLog(path: string, predicate: (lines: string[]) => boolean): Promise<string[]> {
	for (let i = 0; i < 100; i++) {
		const lines = (await readFile(path, "utf-8").catch(() => "")).split("\n").filter(Boolean);
		if (predicate(lines)) return lines;
		await new Promise(r => setTimeout(r, 50));
	}
	throw new Error(`timed out waiting for ${path}`);
}

const types = (lines: string[]) => lines.map(l => { try { return JSON.parse(l).type; } catch { return "?"; } });

function startRun(name: string) {
	const outputPath = join(work, name);
	return {
		logPath: join(outputPath, "train.log"),
		result: trainingHandlers.startTraining({
			id: name, name, assetPaths: [], classMap: ["a"], baseModel: "yolo11n.pt",
			epochs: 3, batchSize: 1, imgsz: 64, device: "cpu", outputPath, fresh: true,
		}),
	};
}

describe.skipIf(IS_WIN)("process exit handling", () => {
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

	it("runProcess reports a killed process as failed", async () => {
		const pending = runProcess(["sleep", "30"], { runId: "kill-me" });
		const { runningProcesses } = await import("../main/util");
		await new Promise(r => setTimeout(r, 50));
		runningProcesses.get("kill-me")?.kill("SIGKILL");
		expect((await pending).exitCode).not.toBe(0);
	});

	it("logs a done run without an extra error", async () => {
		const { logPath, result } = startRun("ok");
		expect((await result).started).toBe(true);
		const lines = await waitForLog(logPath, l => types(l).includes("done"));
		await new Promise(r => setTimeout(r, 200));
		const after = await waitForLog(logPath, () => true);
		expect(types(after)).not.toContain("error");
		expect(types(lines).indexOf("progress")).toBeLessThan(types(lines).indexOf("done"));
	});

	it("logs an error when training is killed without reporting", async () => {
		const { logPath, result } = startRun("crash");
		expect((await result).started).toBe(true);
		const lines = await waitForLog(logPath, l => types(l).includes("error"));
		const err = JSON.parse(lines.find(l => l.includes('"error"'))!);
		expect(err.message).toMatch(/killed by SIGKILL/);
	});

	it("logs an error with the exit code when training exits silently", async () => {
		const { logPath, result } = startRun("exit3");
		expect((await result).started).toBe(true);
		const lines = await waitForLog(logPath, l => types(l).includes("error"));
		expect(lines.join("\n")).toMatch(/exit code 3/);
	});

	it("does not log an error when the user pauses", async () => {
		const { logPath, result } = startRun("slow");
		expect((await result).started).toBe(true);
		await waitForLog(logPath, l => types(l).includes("progress"));
		await trainingHandlers.stopTraining({ runId: "slow" });
		await new Promise(r => setTimeout(r, 300));
		const lines = await waitForLog(logPath, () => true);
		expect(types(lines)).not.toContain("error");
	});
});
