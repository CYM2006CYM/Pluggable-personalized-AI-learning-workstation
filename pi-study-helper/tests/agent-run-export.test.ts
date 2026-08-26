import { describe, expect, it } from "vitest";
import { createSafeAgentRunExport, parseSafeAgentRunExport } from "../src/infrastructure/agent-run-export.js";
import type { SafeAgentRunView } from "../src/contracts/index.js";

const run: SafeAgentRunView = {
  runId: "agent-export", requestId: "request-export", sessionId: "session-export", activityId: "activity-export",
  profileRevision: 3, pathVersion: 2, evidenceVersion: 1, status: "queued", currentStage: "source",
  startedAt: "2026-08-25T12:00:00.000Z", resultOrigin: "unknown", questionCount: 0, stages: [],
};

describe("Agent运行安全导出", () => {
  it("使用同一安全DTO生成可复算SHA-256", () => {
    const exported = createSafeAgentRunExport(run, "2026-08-25T12:01:00.000Z");
    expect(exported.exportSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(parseSafeAgentRunExport(exported)).toEqual(exported);
    expect(() => parseSafeAgentRunExport({ ...exported, run: { ...run, questionCount: 1 } })).toThrow("hash mismatch");
    expect(JSON.stringify(exported)).not.toMatch(/correctAnswer|systemPrompt|apiKey|[A-Za-z]:\\/u);
  });
});
