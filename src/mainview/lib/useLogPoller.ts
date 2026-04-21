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

    async function poll() {
      if (!active) return;
      try {
        const lines = await fetcherRef.current();
        if (active) onLinesRef.current(lines);
      } catch {}
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(id); };
  }, [enabled]);
}
