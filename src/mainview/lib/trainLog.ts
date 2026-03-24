export type LogProgress = {
  epoch: number; epochs: number;
  loss: number | null; mAP: number | null;
  ramMB: number | null; gpuMB: number | null;
};
export type LogDone  = { mAP50: number; mAP50_95: number; weightsPath: string };
export type LogError = { message: string };

export function parseLog(lines: string[]): { progress?: LogProgress; done?: LogDone; error?: LogError } {
  let progress: LogProgress | undefined;
  let done: LogDone | undefined;
  let error: LogError | undefined;

  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "progress") progress = { epoch: ev.epoch, epochs: ev.epochs, loss: ev.loss ?? null, mAP: ev.mAP ?? null, ramMB: ev.ramMB ?? null, gpuMB: ev.gpuMB ?? null };
      if (ev.type === "done")    done    = { mAP50: ev.mAP50, mAP50_95: ev.mAP50_95, weightsPath: ev.weightsPath };
      if (ev.type === "error")   error   = { message: ev.message };
    } catch {}
  }

  return { progress, done, error };
}
