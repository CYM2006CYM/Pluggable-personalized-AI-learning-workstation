import { useCallback, useEffect, useRef, useState } from "react";

export function useAsyncActionProgress() {
  const [label, setLabel] = useState<string>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (label === undefined) return undefined;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1_000)));
    updateElapsed();
    const timer = globalThis.setInterval(updateElapsed, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [label]);

  const start = useCallback((nextLabel: string) => {
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    setLabel(nextLabel);
  }, []);
  const update = useCallback((nextLabel: string) => setLabel(nextLabel), []);
  const stop = useCallback(() => {
    setLabel(undefined);
    setElapsedSeconds(0);
  }, []);

  return {
    active: label !== undefined,
    text: label === undefined ? undefined : `${label}（已处理 ${elapsedSeconds} 秒）`,
    start,
    update,
    stop,
  };
}
