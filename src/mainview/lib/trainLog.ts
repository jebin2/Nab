import { parseLogLine } from "./logParser";

export type LogProgress = {
  epoch: number; epochs: number;
  loss: number | null;
  lossBox: number | null; lossCls: number | null; lossDfl: number | null;
  mAP: number | null; precision: number | null; recall: number | null;
  ramMB: number | null; gpuMB: number | null;
  earlyStop: boolean;
};
export type LogDone  = { mAP50: number; mAP50_95: number; weightsPath: string };
export type LogError = { message: string };

export type CopyProgress = { done: number; total: number };

export type LogSummary = {
  progress?: LogProgress; done?: LogDone; error?: LogError;
  datasetSize?: number; earlyStopTriggered?: boolean;
  copyProgress?: CopyProgress;
};

export const EMPTY_SUMMARY: LogSummary = { earlyStopTriggered: false };

/**
 * Folds one train.log line into a summary. Pure: returns the same object when
 * the line changes nothing, so it can be applied to pushed lines one at a time.
 */
export function applyLogLine(state: LogSummary, line: string): LogSummary {
  const ev = parseLogLine(line);
  if (!ev) return state;
  switch (ev.type) {
    case "start":
      // New session — discard terminal states from any previous session in this log.
      return { ...state, done: undefined, error: undefined };
    case "dataset_copy_start":
      return { ...state, copyProgress: { done: 0, total: ev.total } };
    case "dataset_copy_progress":
      return { ...state, copyProgress: { done: ev.done, total: ev.total } };
    case "progress":
      return {
        ...state,
        earlyStopTriggered: state.earlyStopTriggered || !!ev.earlyStop,
        progress: {
          epoch: ev.epoch as number, epochs: ev.epochs as number,
          loss:      (ev.loss      as number)  ?? null,
          lossBox:   (ev.lossBox   as number)  ?? null,
          lossCls:   (ev.lossCls   as number)  ?? null,
          lossDfl:   (ev.lossDfl   as number)  ?? null,
          mAP:       (ev.mAP       as number)  ?? null,
          precision: (ev.precision as number)  ?? null,
          recall:    (ev.recall    as number)  ?? null,
          ramMB:     (ev.ramMB     as number)  ?? null,
          gpuMB:     (ev.gpuMB     as number)  ?? null,
          earlyStop: !!ev.earlyStop,
        },
      };
    case "dataset":
      return { ...state, datasetSize: ev.imageCount };
    case "done":
      return { ...state, done: { mAP50: ev.mAP50 ?? 0, mAP50_95: ev.mAP50_95 ?? 0, weightsPath: ev.weightsPath ?? "" } };
    case "error":
      return { ...state, error: { message: ev.message } };
    default:
      return state;
  }
}

export function parseLog(lines: string[]): LogSummary {
  return lines.reduce(applyLogLine, EMPTY_SUMMARY);
}
