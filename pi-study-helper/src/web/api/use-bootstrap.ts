import { useCallback, useEffect, useState } from "react";
import type { AppBootstrapSafeView } from "../../contracts/index.js";
import { api, type ApiError } from "./client.js";

export interface BootstrapResource {
  data?: AppBootstrapSafeView;
  error?: ApiError | Error;
  loading: boolean;
  reload(): Promise<AppBootstrapSafeView | undefined>;
}

export function useBootstrap(recoverSessionId?: string): BootstrapResource {
  const [data, setData] = useState<AppBootstrapSafeView>();
  const [error, setError] = useState<ApiError | Error>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.getBootstrap(recoverSessionId);
      setData(next);
      return next;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error("bootstrap_failed");
      setError(nextError);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [recoverSessionId]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
