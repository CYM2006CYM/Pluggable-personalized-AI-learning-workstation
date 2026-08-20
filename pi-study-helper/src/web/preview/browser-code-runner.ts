import type { ActivityResult } from "../../contracts/domain.js";
import type { BrowserCodeRunner, PublicExecutionBundle } from "../../contracts/facade.js";

export type { BrowserCodeRunner, PublicExecutionBundle } from "../../contracts/facade.js";

export type BrowserWorkerMessage =
  | { type: "result"; runId: string; result: ActivityResult }
  | { type: "error"; runId: string; code: string; message?: string }
  | { type: "stdout" | "stderr"; runId: string; chunk: string };

export interface BrowserWorkerLike {
  postMessage(message: { type: "run"; runId: string; bundle: PublicExecutionBundle; code: string }): void;
  addEventListener(type: "message", listener: (event: MessageEvent<BrowserWorkerMessage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<BrowserWorkerMessage>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export type PreviewFailureCode =
  | "preview_cancelled"
  | "preview_timeout"
  | "preview_output_limit"
  | "preview_protocol_error"
  | "preview_unavailable";

export class BrowserCodeRunnerError extends Error {
  constructor(readonly code: PreviewFailureCode, message: string = code) {
    super(message);
    this.name = "BrowserCodeRunnerError";
  }
}

export interface WorkerBrowserCodeRunnerOptions {
  createWorker: () => BrowserWorkerLike;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8_192;

/**
 * The worker implementation is replaceable, but its lifecycle and public
 * execution contract remain fixed across the enabled and fallback candidates.
 */
export class WorkerBrowserCodeRunner implements BrowserCodeRunner {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: WorkerBrowserCodeRunnerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
    if (!Number.isInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) throw new Error("maxOutputBytes must be a positive integer");
  }

  run(bundle: PublicExecutionBundle, code: string, signal: AbortSignal): Promise<ActivityResult> {
    if (signal.aborted) return Promise.reject(new BrowserCodeRunnerError("preview_cancelled"));

    let worker: BrowserWorkerLike;
    try {
      worker = this.options.createWorker();
    } catch {
      return Promise.reject(new BrowserCodeRunnerError("preview_unavailable"));
    }
    const runId = bundle.runId;
    const encoder = new TextEncoder();

    return new Promise<ActivityResult>((resolve, reject) => {
      let settled = false;
      let outputBytes = 0;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const terminate = () => {
        try {
          worker.terminate();
        } catch {
          // Termination is best effort after a failed preview.
        }
      };

      const cleanup = () => {
        if (timeout !== undefined) clearTimeout(timeout);
        try { signal.removeEventListener("abort", onAbort); } catch { /* best-effort cleanup */ }
        try { worker.removeEventListener("message", onMessage); } catch { /* best-effort cleanup */ }
        try { worker.removeEventListener("error", onError); } catch { /* best-effort cleanup */ }
        terminate();
      };

      const fail = (error: BrowserCodeRunnerError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const complete = (result: ActivityResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const onAbort = () => fail(new BrowserCodeRunnerError("preview_cancelled"));
      const onError = () => fail(new BrowserCodeRunnerError("preview_unavailable"));
      const onMessage = (event: MessageEvent<BrowserWorkerMessage>) => {
        const message = event.data;
        if (typeof message !== "object" || message === null || typeof message.runId !== "string" || typeof message.type !== "string") {
          fail(new BrowserCodeRunnerError("preview_protocol_error"));
          return;
        }
        if (message.runId !== runId) return;

        if (message.type === "stdout" || message.type === "stderr") {
          outputBytes += encoder.encode(message.chunk).byteLength;
          if (outputBytes > this.maxOutputBytes) fail(new BrowserCodeRunnerError("preview_output_limit"));
          return;
        }

        if (message.type === "error") {
          fail(new BrowserCodeRunnerError("preview_unavailable", message.message ?? message.code));
          return;
        }

        if (message.type !== "result" || !isActivityResult(message.result)) {
          fail(new BrowserCodeRunnerError("preview_protocol_error"));
          return;
        }
        complete(message.result);
      };

      try {
        signal.addEventListener("abort", onAbort, { once: true });
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        timeout = setTimeout(() => fail(new BrowserCodeRunnerError("preview_timeout")), this.timeoutMs);
        worker.postMessage({ type: "run", runId, bundle, code });
      } catch {
        fail(new BrowserCodeRunnerError("preview_unavailable"));
      }
    });
  }
}

function isActivityResult(value: unknown): value is ActivityResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<ActivityResult>;
  return ["not_started", "running", "completed", "failed", "cancelled"].includes(result.executionStatus ?? "")
    && ["pass", "partial", "fail", "not_graded"].includes(result.verdict ?? "")
    && typeof result.safeFeedback === "string"
    && typeof result.evaluatorVersion === "string"
    && typeof result.environmentHash === "string"
    && typeof result.assetBundleHash === "string"
    && (result.score === undefined || (Number.isFinite(result.score) && result.score >= 0 && result.score <= 1));
}
