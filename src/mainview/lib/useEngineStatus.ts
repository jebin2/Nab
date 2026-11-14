import { useEffect, useState } from "react";
import { getRPC, onEvent, type EngineStatus } from "./rpc";

/** Live status of the training engine (Python + PyTorch setup). */
export function useEngineStatus() {
  const [status, setStatus] = useState<EngineStatus | null>(null);

  useEffect(() => {
    const off = onEvent("engine:status", setStatus);
    getRPC().request.getEngineStatus({}).then(s => setStatus(prev => prev ?? s)).catch(() => {});
    return off;
  }, []);

  return {
    status,
    start:  () => getRPC().request.startEngineSetup({}),
    cancel: () => getRPC().request.cancelEngineSetup({}),
  };
}

/** "340 MB" / "3.2 GB". */
export function formatSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Rough download time range for an unknown connection (20 MB/s to 5 MB/s). */
export function downloadTimeRange(mb: number): string {
  const lo = Math.max(1, Math.round(mb / 20 / 60));
  const hi = Math.max(1, Math.round(mb / 5 / 60));
  return lo === hi ? `about ${lo} min` : `about ${lo}–${hi} min`;
}

export function formatEta(sec: number): string {
  if (sec < 60) return "less than a minute left";
  const min = Math.round(sec / 60);
  return min === 1 ? "about 1 min left" : `about ${min} min left`;
}
