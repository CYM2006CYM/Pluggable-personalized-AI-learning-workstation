import type { BrowserCodeRunner } from "../../contracts/facade.js";
import { WorkerBrowserCodeRunner } from "./browser-code-runner.js";

export const PYODIDE_CANDIDATE_STATUS = "PYODIDE_CANDIDATE_UNAVAILABLE" as const;

export function createBrowserCodeRunner(): BrowserCodeRunner {
  return new WorkerBrowserCodeRunner({
    createWorker: () => new Worker(new URL("./pyodide-preview.worker.ts", import.meta.url), { type: "module", name: "pi-study-preview" }),
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
  });
}
