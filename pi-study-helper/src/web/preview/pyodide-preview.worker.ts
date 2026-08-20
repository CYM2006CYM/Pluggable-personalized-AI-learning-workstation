import type { PublicExecutionBundle } from "../../contracts/facade.js";
import type { BrowserWorkerMessage } from "./browser-code-runner.js";

interface RunMessage {
  type: "run";
  runId: string;
  bundle: PublicExecutionBundle;
  code: string;
}

interface PreviewWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<RunMessage>) => void): void;
  postMessage(message: BrowserWorkerMessage): void;
}

const workerScope = self as unknown as PreviewWorkerScope;

workerScope.addEventListener("message", (event: MessageEvent<RunMessage>) => {
  const message = event.data;
  if (message?.type !== "run" || typeof message.runId !== "string") return;

  // C D1 measured no local Pyodide runtime. D2 keeps the worker boundary real
  // and offline while reporting the candidate honestly for the D3 decision.
  const response: BrowserWorkerMessage = {
    type: "error",
    runId: message.runId,
    code: "pyodide_candidate_unavailable",
    message: "本地 Pyodide 运行资产尚未通过负责人裁决。",
  };
  workerScope.postMessage(response);
});

export {};
