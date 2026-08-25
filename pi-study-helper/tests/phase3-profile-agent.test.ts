import { describe, expect, it } from "vitest";
import { LearnerProfileAgentService } from "../src/application/learner-profile-agent-service.js";
import { attachLearnerProfileAgentResult, buildLearnerProfile } from "../src/domain/learner-profile.js";
import type { ModelExecutionPort } from "../src/infrastructure/model-execution-port.js";

function profile() {
  return buildLearnerProfile({
    sessionId: "session-agent", profileRevision: 3, evidenceVersion: 1,
    evidence: [{ evidenceId: "e-agent", requestId: "r", sessionId: "session-agent", knowledgePointId: "kp", profileRevision: 3, kind: "diagnostic", source: "fixed_diagnostic", form: "selected_response", impact: "mastery", outcome: "correct", independence: "independent", createdAt: "2026-08-25T00:00:00.000Z" }],
    knowledgeStates: [], activityProgress: [],
  });
}

describe("Phase 3 learner profile Agent contract", () => {
  it("accepts only Chinese explanation bound to formal Evidence", async () => {
    const calls: unknown[] = [];
    const model: ModelExecutionPort = { async execute(input) {
      calls.push(input);
      return { status: "ok", modelId: "deepseek-chat", promptVersion: "w6-profile-v1", sourceRefs: ["e-agent"], traceSummary: "recorded profile", payload: { summary: "画像显示本次诊断证据已形成。", evidenceRefs: ["e-agent"] } };
    } };
    const agent = new LearnerProfileAgentService({ modelExecutionPort: model, modelId: "deepseek-chat", promptVersion: "w6-profile-v1" });
    const base = profile();
    const result = await agent.summarize({ profile: base });
    expect(result).toMatchObject({ status: "accepted", evidenceRefs: ["e-agent"] });
    expect(calls[0]).toMatchObject({ graphId: "learner-profile", safeContext: { sessionId: "session-agent", evidenceIds: ["e-agent"] } });
    const enriched = attachLearnerProfileAgentResult(base, { explanation: result.explanation!, evidenceRefs: result.evidenceRefs!, runId: result.runId });
    expect(enriched).toMatchObject({ agentStatus: "agent_complete", agentExplanation: "画像显示本次诊断证据已形成。", agentEvidenceRefs: ["e-agent"] });
  });

  it("keeps deterministic facts when the model is unavailable", async () => {
    const model: ModelExecutionPort = { async execute() { return { status: "provider_error", modelId: "deepseek-chat", promptVersion: "w6-profile-v1", sourceRefs: [], traceSummary: "provider unavailable", errorCode: "provider_error" }; } };
    const agent = new LearnerProfileAgentService({ modelExecutionPort: model, modelId: "deepseek-chat", promptVersion: "w6-profile-v1" });
    await expect(agent.summarize({ profile: profile() })).resolves.toMatchObject({ status: "unavailable", errorCode: "provider_error" });
  });
});
