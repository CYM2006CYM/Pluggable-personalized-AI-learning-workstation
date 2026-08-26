import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRunClient } from "../../src/web/api/agent-run-client.js";
import type { SafeAgentRunView } from "../../src/contracts/index.js";

function run(status: SafeAgentRunView["status"] = "running"): SafeAgentRunView {
  return {
    runId: "agent-123", requestId: "request-123", sessionId: "session-123", activityId: "activity-123",
    profileRevision: 3, pathVersion: 2, evidenceVersion: 1, status, currentStage: "source",
    startedAt: "2026-08-25T10:00:00.000Z", resultOrigin: status === "succeeded" ? "ai_live" : "unknown",
    questionCount: status === "succeeded" ? 4 : 0,
    ...(status === "succeeded" ? { finishedAt: "2026-08-25T10:00:01.000Z", durationMs: 1_000, artifactSha256: "a".repeat(64) } : {}),
    stages: [],
  };
}

class FakeEventSource {
  static latest?: FakeEventSource;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) { FakeEventSource.latest = this; }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }
  close() { this.closed = true; }
  emit(value: unknown) { this.listeners.get("run")?.(new MessageEvent("run", { data: JSON.stringify(value) })); }
}

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.latest = undefined; });

describe("AgentRunClient", () => {
  it("携带after sequence订阅、解析安全run并在终态主动关闭", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const received = vi.fn();
    const disconnected = vi.fn();
    const close = new AgentRunClient().subscribe("agent-123", 7, received, disconnected);
    expect(FakeEventSource.latest?.url).toBe("/api/agent-runs/agent-123/events?after=7");
    FakeEventSource.latest?.emit(run("succeeded"));
    expect(received).toHaveBeenCalledWith(run("succeeded"));
    expect(FakeEventSource.latest?.closed).toBe(true);
    expect(disconnected).not.toHaveBeenCalled();
    close?.();
  });

  it("拒绝未知或私有字段并转入断线降级", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const received = vi.fn();
    const disconnected = vi.fn();
    new AgentRunClient().subscribe("agent-123", 0, received, disconnected);
    FakeEventSource.latest?.emit({ ...run(), systemPrompt: "private" });
    expect(received).not.toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(FakeEventSource.latest?.closed).toBe(true);
  });

  it("环境没有EventSource时明确返回undefined供轮询降级", () => {
    vi.stubGlobal("EventSource", undefined);
    expect(new AgentRunClient().subscribe("agent-123", 0, vi.fn(), vi.fn())).toBeUndefined();
  });
});
