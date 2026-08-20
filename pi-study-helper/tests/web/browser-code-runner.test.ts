import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityResult } from "../../src/contracts/domain.js";
import type { PublicExecutionBundle } from "../../src/contracts/facade.js";
import type { BrowserWorkerMessage, BrowserWorkerLike } from "../../src/web/preview/browser-code-runner.js";
import { BrowserCodeRunnerError, WorkerBrowserCodeRunner } from "../../src/web/preview/browser-code-runner.js";

class FakeWorker implements BrowserWorkerLike {
  readonly messages: Array<{ type: "run"; runId: string; bundle: PublicExecutionBundle; code: string }> = [];
  terminated = false;
  private readonly messageListeners = new Set<(event: MessageEvent<BrowserWorkerMessage>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  postMessage(message: { type: "run"; runId: string; bundle: PublicExecutionBundle; code: string }): void {
    this.messages.push(message);
  }

  addEventListener(type: "message", listener: (event: MessageEvent<BrowserWorkerMessage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<BrowserWorkerMessage>) => void) | ((event: ErrorEvent) => void)): void {
    if (type === "message") this.messageListeners.add(listener as (event: MessageEvent<BrowserWorkerMessage>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: "message", listener: (event: MessageEvent<BrowserWorkerMessage>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message" | "error", listener: ((event: MessageEvent<BrowserWorkerMessage>) => void) | ((event: ErrorEvent) => void)): void {
    if (type === "message") this.messageListeners.delete(listener as (event: MessageEvent<BrowserWorkerMessage>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: BrowserWorkerMessage): void {
    for (const listener of this.messageListeners) listener(new MessageEvent("message", { data: message }));
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener({} as ErrorEvent);
  }
}

const bundle = (runId = "run-1"): PublicExecutionBundle => ({
  runId,
  sessionId: "session-1",
  activityId: "activity-1",
  profileRevision: 3,
  environmentId: "env-node-candidate",
  starterCodeHash: "sha256:starter",
  publicDatasetFiles: [{ name: "orders.csv", content: "id,value\n1,2\n", hash: "sha256:data" }],
  publicTestSources: ["assert result is not None"],
  expiresAt: "2026-08-18T12:00:00.000Z",
  bundleHash: "sha256:bundle",
});

const result: ActivityResult = {
  executionStatus: "completed",
  verdict: "pass",
  safeFeedback: "公开检查通过",
  evaluatorVersion: "browser-preview-skeleton",
  environmentHash: "sha256:environment",
  assetBundleHash: "sha256:assets",
};

afterEach(() => vi.useRealTimers());

describe("W5 D2 Worker browser runner", () => {
  it("creates a fresh worker per run and resolves only a matching result", async () => {
    const workers: FakeWorker[] = [];
    const runner = new WorkerBrowserCodeRunner({ createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });

    const first = runner.run(bundle("run-1"), "print(1)", new AbortController().signal);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages[0]).toMatchObject({ type: "run", runId: "run-1", code: "print(1)" });
    workers[0]?.emit({ type: "result", runId: "stale-run", result });
    workers[0]?.emit({ type: "result", runId: "run-1", result });
    await expect(first).resolves.toEqual(result);
    expect(workers[0]?.terminated).toBe(true);

    const second = runner.run(bundle("run-2"), "print(2)", new AbortController().signal);
    expect(workers).toHaveLength(2);
    workers[1]?.emit({ type: "result", runId: "run-2", result });
    await expect(second).resolves.toEqual(result);
  });

  it("counts UTF-8 bytes and terminates on output overflow", async () => {
    const worker = new FakeWorker();
    const runner = new WorkerBrowserCodeRunner({ createWorker: () => worker, maxOutputBytes: 2 });
    const pending = runner.run(bundle(), "print('x')", new AbortController().signal);
    worker.emit({ type: "stdout", runId: "run-1", chunk: "好" });

    await expect(pending).rejects.toMatchObject({ code: "preview_output_limit" });
    expect(worker.terminated).toBe(true);
  });

  it("preserves cancellation and timeout as explicit preview failures", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const runner = new WorkerBrowserCodeRunner({ createWorker: () => worker, timeoutMs: 20 });
    const controller = new AbortController();
    const cancelled = runner.run(bundle(), "", controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "preview_cancelled" });
    expect(worker.terminated).toBe(true);

    const timeoutWorker = new FakeWorker();
    const timeoutRunner = new WorkerBrowserCodeRunner({ createWorker: () => timeoutWorker, timeoutMs: 20 });
    const timedOut = timeoutRunner.run(bundle("run-timeout"), "", new AbortController().signal);
    vi.advanceTimersByTime(20);
    await expect(timedOut).rejects.toMatchObject({ code: "preview_timeout" });
    expect(timeoutWorker.terminated).toBe(true);
  });

  it("rejects malformed results and worker errors without exposing a formal submission", async () => {
    const worker = new FakeWorker();
    const runner = new WorkerBrowserCodeRunner({ createWorker: () => worker });
    const malformed = runner.run(bundle(), "", new AbortController().signal);
    worker.emit({ type: "result", runId: "run-1", result: { verdict: "pass" } as ActivityResult });
    await expect(malformed).rejects.toMatchObject({ code: "preview_protocol_error" });

    const failedWorker = new FakeWorker();
    const failedRunner = new WorkerBrowserCodeRunner({ createWorker: () => failedWorker });
    const unavailable = failedRunner.run(bundle(), "", new AbortController().signal);
    failedWorker.emitError();
    await expect(unavailable).rejects.toMatchObject({ code: "preview_unavailable" });
  });

  it("maps worker construction and initial message failures to preview_unavailable", async () => {
    const constructionFailure = new WorkerBrowserCodeRunner({ createWorker: () => { throw new Error("worker blocked"); } });
    await expect(constructionFailure.run(bundle(), "", new AbortController().signal)).rejects.toMatchObject({ code: "preview_unavailable" });

    const worker = new FakeWorker();
    worker.postMessage = () => { throw new Error("clone failed"); };
    const messageFailure = new WorkerBrowserCodeRunner({ createWorker: () => worker });
    await expect(messageFailure.run(bundle(), "", new AbortController().signal)).rejects.toMatchObject({ code: "preview_unavailable" });
    expect(worker.terminated).toBe(true);

    const listenerWorker = new FakeWorker();
    listenerWorker.addEventListener = () => { throw new Error("listener blocked"); };
    const listenerFailure = new WorkerBrowserCodeRunner({ createWorker: () => listenerWorker });
    await expect(listenerFailure.run(bundle(), "", new AbortController().signal)).rejects.toMatchObject({ code: "preview_unavailable" });
    expect(listenerWorker.terminated).toBe(true);
  });
});
