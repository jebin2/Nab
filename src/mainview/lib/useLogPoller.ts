import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 1000;

export function useLogPoller(
  enabled: boolean,
  fetcher: () => Promise<string[]>,
  onLines: (lines: string[]) => void,
) {
  const fetcherRef = useRef(fetcher);
  const onLinesRef = useRef(onLines);
  useEffect(() => { fetcherRef.current = fetcher; });
  useEffect(() => { onLinesRef.current = onLines; });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Each poll starts only after the previous one finished, so slow reads
    // can't pile up.
    async function poll() {
      if (!active) return;
      try {
        const lines = await fetcherRef.current();
        if (active) onLinesRef.current(lines);
      } catch {}
      if (active) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [enabled]);
}
