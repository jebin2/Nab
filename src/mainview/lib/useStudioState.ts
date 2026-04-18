import { useEffect, useRef, useState } from "react";
import { getRPC } from "./rpc";
import { type Asset, type TrainingRun } from "./types";

const SAVE_DEBOUNCE_MS = 250;

export function useStudioState() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingPayloadRef = useRef<{ assets: Asset[]; runs: TrainingRun[] } | null>(null);

  async function flushSaveQueue() {
    if (savingRef.current) return;

    const nextPayload = pendingPayloadRef.current;
    if (!nextPayload) return;

    savingRef.current = true;
    pendingPayloadRef.current = null;

    try {
      await getRPC().request.saveStudio(nextPayload);
    } catch (err) {
      console.error("Failed to save studio data:", err);
    } finally {
      savingRef.current = false;
      if (pendingPayloadRef.current) void flushSaveQueue();
    }
  }

  useEffect(() => {
    getRPC().request.loadStudio({}).then(data => {
      setAssets(data.assets);
      setRuns(data.runs);
      loadedRef.current = true;
    }).catch(err => {
      console.error("Failed to load studio data:", err);
      loadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;

    const payload = { assets, runs };
    pendingPayloadRef.current = payload;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      void flushSaveQueue();
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [assets, runs]);

  return { assets, setAssets, runs, setRuns };
}
