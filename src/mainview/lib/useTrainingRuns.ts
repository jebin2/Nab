import { useState, useRef, useEffect, useMemo } from "react";
import { type TrainingRun, type Asset, type RunStatus } from "./types";
import { getRPC, onEvent } from "./rpc";
import { applyLogLine, parseLog, EMPTY_SUMMARY, type LogProgress, type LogSummary } from "./trainLog";
import { nowStamp } from "./formatTime";

const ACTIVE: RunStatus[] = ["installing", "training", "stopping"];
const isActive = (status: RunStatus) => ACTIVE.includes(status);

/**
 * Run status and live progress. The main process owns the status of running
 * runs and pushes every change ("training:status") plus new log lines
 * ("training:log"); this hook applies them to the saved runs list.
 */
export function useTrainingRuns(
  runs: TrainingRun[],
  onRunsChange: (runs: TrainingRun[]) => void,
  assets: Asset[],
) {
  const [summaries, setSummaries] = useState<Record<string, LogSummary>>({});

  // Refs so event handlers always see the latest values. runsRef is updated
  // eagerly in updateRun so back-to-back events don't overwrite each other.
  const runsRef         = useRef(runs);
  const onRunsChangeRef = useRef(onRunsChange);
  runsRef.current         = runs;
  onRunsChangeRef.current = onRunsChange;

  function updateRun(runId: string, patch: Partial<TrainingRun>) {
    const next = runsRef.current.map(run => run.id === runId ? { ...run, ...patch } : run);
    runsRef.current = next;
    onRunsChangeRef.current(next);
  }

  function setSummary(runId: string, summary: LogSummary | undefined) {
    setSummaries(prev => {
      const next = { ...prev };
      if (summary) next[runId] = summary; else delete next[runId];
      return next;
    });
  }

  // Pushed status and log events.
  useEffect(() => {
    const offStatus = onEvent("training:status", ev => {
      const patch: Partial<TrainingRun> = { status: ev.status, updatedAt: new Date(ev.at).toISOString() };
      if (ev.status === "installing") patch.mAP = undefined;
      if (ev.status === "done" && ev.mAP != null) patch.mAP = ev.mAP;
      updateRun(ev.runId, patch);
      if (ev.status === "idle") setSummary(ev.runId, undefined);
    });
    const offLog = onEvent("training:log", ev => {
      setSummaries(prev => {
        const base = ev.reset ? EMPTY_SUMMARY : (prev[ev.runId] ?? EMPTY_SUMMARY);
        const next = ev.lines.reduce(applyLogLine, base);
        return next === prev[ev.runId] ? prev : { ...prev, [ev.runId]: next };
      });
    });
    return () => { offStatus(); offLog(); };
  }, []);

  // Once runs have loaded (also after a window reload mid-run): take the live
  // status from the main process and load each active run's log once.
  const runsLoaded = runs.length > 0;
  const reconciled = useRef(false);
  useEffect(() => {
    if (!runsLoaded || reconciled.current) return;
    reconciled.current = true;
    // Not cancelled on cleanup: this runs once, and App outlives it.
    void (async () => {
      let statuses: Record<string, RunStatus> = {};
      try { statuses = (await getRPC().request.getTrainingStatus({})).statuses; } catch {}
      for (const run of runsRef.current) {
        const live = statuses[run.id];
        if (!live && !isActive(run.status)) continue;
        let summary: LogSummary = EMPTY_SUMMARY;
        try {
          summary = parseLog((await getRPC().request.readTrainingLog({ outputPath: run.outputPath })).lines);
        } catch {}
        setSummary(run.id, summary);
        if (live) {
          if (live !== run.status) updateRun(run.id, { status: live });
        } else {
          // Saved as active but nothing is running: it ended while we weren't listening.
          updateRun(run.id, summary.done
            ? { status: "done", mAP: summary.done.mAP50 }
            : { status: summary.error ? "failed" : "paused" });
        }
      }
    })();
  }, [runsLoaded]);

  const runProgress = useMemo(() => {
    const out: Record<string, LogProgress> = {};
    for (const [id, s] of Object.entries(summaries)) if (s.progress) out[id] = s.progress;
    return out;
  }, [summaries]);

  async function startRun(run: TrainingRun, fresh: boolean) {
    if (isActive(run.status)) return;
    const runAssets = assets.filter(a => run.assetIds.includes(a.id));
    try {
      // Returns at once; "installing" → "training" → ... arrive as events.
      await getRPC().request.startTraining({
        id: run.id, name: run.name, assetPaths: runAssets.map(a => a.storagePath),
        classMap: run.classMap, baseModel: run.baseModel, epochs: run.epochs,
        batchSize: run.batchSize, imgsz: run.imgsz, device: run.device,
        outputPath: run.outputPath, fresh,
      });
    } catch (err) {
      console.error("Failed to start training:", err);
      updateRun(run.id, { status: "failed", updatedAt: nowStamp() });
    }
  }

  async function pauseRun(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id });
      // If the main process had nothing running, no event comes; settle locally.
      const latest = runsRef.current.find(r => r.id === run.id);
      if (latest && isActive(latest.status)) updateRun(run.id, { status: "paused", updatedAt: nowStamp() });
    } catch (err) { console.error("Failed to pause training:", err); }
  }

  async function stopRun(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id, clearCheckpoint: true, outputPath: run.outputPath });
    } catch (err) { console.error("Failed to stop training:", err); }
  }

  return { runProgress, startRun, pauseRun, stopRun };
}

export type TrainingRunsApi = ReturnType<typeof useTrainingRuns>;
