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

export function parseLog(lines: string[]): {
  progress?: LogProgress; done?: LogDone; error?: LogError;
  datasetSize?: number; earlyStopTriggered?: boolean;
} {
  let progress: LogProgress | undefined;
  let done: LogDone | undefined;
  let error: LogError | undefined;
  let datasetSize: number | undefined;
  let earlyStopTriggered = false;

  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "progress") {
        if (ev.earlyStop) earlyStopTriggered = true;
        progress = {
          epoch: ev.epoch, epochs: ev.epochs,
          loss:      ev.loss      ?? null,
          lossBox:   ev.lossBox   ?? null,
          lossCls:   ev.lossCls   ?? null,
          lossDfl:   ev.lossDfl   ?? null,
          mAP:       ev.mAP       ?? null,
          precision: ev.precision ?? null,
          recall:    ev.recall    ?? null,
          ramMB:     ev.ramMB     ?? null,
          gpuMB:     ev.gpuMB     ?? null,
          earlyStop: !!ev.earlyStop,
        };
      }
      if (ev.type === "dataset") datasetSize = ev.imageCount;
      if (ev.type === "done")    done    = { mAP50: ev.mAP50, mAP50_95: ev.mAP50_95, weightsPath: ev.weightsPath };
      if (ev.type === "error")   error   = { message: ev.message };
    } catch {}
  }

  return { progress, done, error, datasetSize, earlyStopTriggered };
}
