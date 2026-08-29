import { useCallback, useEffect, useState } from "react";
import type { AppBootstrapSafeView } from "../../contracts/index.js";
import { api, type ApiError } from "./client.js";

export interface BootstrapResource {
  data?: AppBootstrapSafeView;
  error?: ApiError | Error;
  loading: boolean;
  reload(): Promise<AppBootstrapSafeView | undefined>;
}

/*
 * 骨架(AppShell)与当前页面各自调用 useBootstrap,但同一会话只需要一次请求:
 * 进行中的请求按 sessionId 合并,先到者发起、后到者共享同一个 promise,
 * 完成即清除,下一次 reload 仍是全新请求。
 */
const inflightBootstrap = new Map<string, Promise<AppBootstrapSafeView>>();
const NO_SESSION_KEY = "\u0000";

function fetchBootstrapOnce(recoverSessionId: string | undefined): Promise<AppBootstrapSafeView> {
  const key = recoverSessionId ?? NO_SESSION_KEY;
  let pending = inflightBootstrap.get(key);
  if (pending === undefined) {
    pending = api.getBootstrap(recoverSessionId).finally(() => {
      inflightBootstrap.delete(key);
    });
    inflightBootstrap.set(key, pending);
  }
  return pending;
}

export function useBootstrap(recoverSessionId?: string, enabled = true): BootstrapResource {
  const [data, setData] = useState<AppBootstrapSafeView>();
  const [error, setError] = useState<ApiError | Error>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await fetchBootstrapOnce(recoverSessionId);
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

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void reload();
  }, [enabled, reload]);
  return { data, error, loading, reload };
}
