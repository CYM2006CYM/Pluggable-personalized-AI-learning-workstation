import { useEffect, useRef, useState } from "react";
import type { SafeAgentRunView } from "../../contracts/index.js";
import { AgentRunClient, isTerminalAgentRun } from "../api/agent-run-client.js";
import { isApiError } from "../api/client.js";

export type AgentRunTransport = "idle" | "discovering" | "sse" | "polling" | "complete";

export function useAgentRun(input: { requestId?: string; runId?: string; active?: boolean }) {
  const [run, setRun] = useState<SafeAgentRunView>();
  const [transport, setTransport] = useState<AgentRunTransport>(input.requestId || input.runId ? "discovering" : "idle");
  const runRef = useRef<SafeAgentRunView>();

  useEffect(() => {
    const targetKey = `${input.requestId ?? ""}:${input.runId ?? ""}`;
    if (targetKey === ":") {
      runRef.current = undefined;
      setRun(undefined);
      setTransport("idle");
      return;
    }
    const client = new AgentRunClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeSse: (() => void) | undefined;
    runRef.current = undefined;
    setRun(undefined);
    setTransport("discovering");

    const accept = (next: SafeAgentRunView) => {
      if (cancelled) return;
      const current = runRef.current;
      const currentSequence = current?.stages.at(-1)?.sequence ?? 0;
      const nextSequence = next.stages.at(-1)?.sequence ?? 0;
      if (current?.runId === next.runId && nextSequence < currentSequence) return;
      runRef.current = next;
      setRun(next);
      if (isTerminalAgentRun(next)) setTransport("complete");
    };
    const schedulePoll = (runId: string, delay = 1_000) => {
      if (cancelled || (runRef.current !== undefined && isTerminalAgentRun(runRef.current))) return;
      setTransport("polling");
      timer = setTimeout(async () => {
        try {
          const next = await client.getByRunId(runId);
          accept(next);
          if (!isTerminalAgentRun(next)) schedulePoll(runId);
        } catch { schedulePoll(runId); }
      }, delay);
    };
    const subscribe = (snapshot: SafeAgentRunView) => {
      if (isTerminalAgentRun(snapshot)) return;
      const after = snapshot.stages.at(-1)?.sequence ?? 0;
      closeSse = client.subscribe(snapshot.runId, after, accept, () => schedulePoll(snapshot.runId, 0));
      if (closeSse === undefined) schedulePoll(snapshot.runId, 0);
      else setTransport("sse");
    };
    const discover = async () => {
      if (cancelled) return;
      try {
        const snapshot = input.runId !== undefined
          ? await client.getByRunId(input.runId)
          : await client.getByRequestId(input.requestId!);
        accept(snapshot);
        subscribe(snapshot);
      } catch (error) {
        if (input.active === false || (isApiError(error) && error.status !== 404)) {
          setTransport("idle");
          return;
        }
        timer = setTimeout(discover, 250);
      }
    };
    void discover();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      closeSse?.();
    };
  }, [input.active, input.requestId, input.runId]);

  return { run, transport };
}
