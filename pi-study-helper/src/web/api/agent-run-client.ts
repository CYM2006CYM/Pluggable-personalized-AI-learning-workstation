import { parseSafeAgentRunView, type SafeAgentRunExport, type SafeAgentRunView } from "../../contracts/index.js";
import { api } from "./client.js";

const TERMINAL = new Set<SafeAgentRunView["status"]>(["succeeded", "failed", "fallback"]);

export class AgentRunClient {
  getByRequestId(requestId: string): Promise<SafeAgentRunView> {
    return api.getAgentRunByRequest(requestId).then(parseSafeAgentRunView);
  }

  getByRunId(runId: string): Promise<SafeAgentRunView> {
    return api.getAgentRun(runId).then(parseSafeAgentRunView);
  }

  subscribe(
    runId: string,
    afterSequence: number,
    onRun: (run: SafeAgentRunView) => void,
    onDisconnect: () => void,
  ): (() => void) | undefined {
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource(`/api/agent-runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`);
    let intentionallyClosed = false;
    const close = () => {
      intentionallyClosed = true;
      source.close();
    };
    source.addEventListener("run", (event) => {
      try {
        const run = parseSafeAgentRunView(JSON.parse((event as MessageEvent<string>).data));
        onRun(run);
        if (TERMINAL.has(run.status)) close();
      } catch {
        close();
        onDisconnect();
      }
    });
    source.onerror = () => {
      if (intentionallyClosed) return;
      source.close();
      onDisconnect();
    };
    return close;
  }
}

export function isTerminalAgentRun(run: SafeAgentRunView): boolean {
  return TERMINAL.has(run.status);
}

export async function downloadAgentRunExport(runId: string): Promise<SafeAgentRunExport> {
  const exported = await api.getAgentRunExport(runId);
  const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${runId}-safe-export.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return exported;
}
