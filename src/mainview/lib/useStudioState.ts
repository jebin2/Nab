import { useEffect, useRef, useState } from "react";
import { getRPC } from "./rpc";
import { type Asset, type TrainingRun } from "./types";

const SAVE_DEBOUNCE_MS = 250;

export function useLoadStudio() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getRPC().request.loadStudio({}).then(data => {
      setAssets(data.assets);
      setRuns(data.runs);
      setLoaded(true);
    }).catch(err => {
      console.error("Failed to load studio data:", err);
      setLoaded(true);
    });
  }, []);

  return { assets, runs, loaded };
}

export function useStudioState() {
  const { assets: loadedAssets, runs: loadedRuns, loaded } = useLoadStudio();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);

  useEffect(() => {
    if (loaded) {
      setAssets(loadedAssets);
      setRuns(loadedRuns);
    }
  }, [loaded, loadedAssets, loadedRuns]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef<{ assets: Asset[]; runs: TrainingRun[] } | null>(null);

  async function flushSaveQueue() {
    if (savingRef.current || !pendingRef.current) return;

    savingRef.current = true;
    const payload = pendingRef.current;
    pendingRef.current = null;

    try {
      await getRPC().request.saveStudio(payload);
    } catch (err) {
      console.error("Failed to save studio data:", err);
    } finally {
      savingRef.current = false;
      if (pendingRef.current) void flushSaveQueue();
    }
  }

  useEffect(() => {
    if (!loaded) return;

    pendingRef.current = { assets, runs };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushSaveQueue(), SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [loaded, assets, runs]);

  return { assets, setAssets, runs, setRuns };
}
