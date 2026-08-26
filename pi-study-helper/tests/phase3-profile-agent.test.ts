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

  it("rejects an Agent explanation that turns ready or diagnostic skips into support gaps", async () => {
    const base = buildLearnerProfile({
      sessionId: "session-semantic", profileRevision: 3, evidenceVersion: 1,
      evidence: [{ evidenceId: "e-semantic", requestId: "r", sessionId: "session-semantic", knowledgePointId: "basic-python", profileRevision: 3, kind: "diagnostic", source: "fixed_diagnostic", form: "selected_response", impact: "mastery", outcome: "correct", independence: "independent", createdAt: "2026-08-25T00:00:00.000Z" }],
      knowledgeStates: [{ knowledgePointId: "basic-python", profileRevision: 3, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: 0.7, confidence: 0.6, status: "ready", validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: ["e-semantic"], consideredEvidenceIds: ["e-semantic"], asOf: "2026-08-25T00:00:00.000Z", skipEligible: false, lastUpdatedAt: "2026-08-25T00:00:00.000Z" }],
      activityProgress: [], diagnosticSkippedKnowledgePointIds: ["pandas.clean.read-csv"],
    });
    const model: ModelExecutionPort = { async execute() {
      return { status: "ok", modelId: "deepseek-chat", promptVersion: "w6-profile-v2", sourceRefs: ["e-semantic"], traceSummary: "bad profile", payload: { summary: "basic-python 属于仍需支持的薄弱点，并建议继续推进尚未开始的活动。", evidenceRefs: ["e-semantic"] } };
    } };
    const agent = new LearnerProfileAgentService({ modelExecutionPort: model, modelId: "deepseek-chat", promptVersion: "w6-profile-v2" });
    await expect(agent.summarize({ profile: base })).resolves.toMatchObject({ status: "unavailable", errorCode: "semantic_conflict" });
  });

  it("rejects the support and pending wording observed in a live v2 response", async () => {
    const base = buildLearnerProfile({
      sessionId: "session-live-conflict", profileRevision: 3, evidenceVersion: 1,
      evidence: [{ evidenceId: "e-live", requestId: "r", sessionId: "session-live-conflict", knowledgePointId: "basic-python", profileRevision: 3, kind: "diagnostic", source: "fixed_diagnostic", form: "selected_response", impact: "mastery", outcome: "correct", independence: "independent", createdAt: "2026-08-25T00:00:00.000Z" }],
      knowledgeStates: [{ knowledgePointId: "basic-python", profileRevision: 3, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: 1, confidence: 0.6, status: "ready", validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: ["e-live"], consideredEvidenceIds: ["e-live"], asOf: "2026-08-25T00:00:00.000Z", skipEligible: false, lastUpdatedAt: "2026-08-25T00:00:00.000Z" }],
      activityProgress: [], diagnosticSkippedKnowledgePointIds: ["pandas.clean.read-csv"],
    });
    const model: ModelExecutionPort = { async execute() {
      return { status: "ok", modelId: "deepseek-chat", promptVersion: "w6-profile-v2", sourceRefs: ["e-live"], traceSummary: "live conflict", payload: {
        summary: "仍需支持点：basic-python 状态为 ready，仍需进一步强化。\n带缺口活动：相关活动均处于待处理状态，尚未执行，是后续需要继续推进的内容。",
        evidenceRefs: ["e-live"],
      } };
    } };
    const agent = new LearnerProfileAgentService({ modelExecutionPort: model, modelId: "deepseek-chat", promptVersion: "w6-profile-v2" });
    await expect(agent.summarize({ profile: base })).resolves.toMatchObject({ status: "unavailable", errorCode: "semantic_conflict" });
  });

  it("accepts an explanation that reports no support gap and preserves diagnostic skips", async () => {
    const base = buildLearnerProfile({
      sessionId: "session-truthful", profileRevision: 3, evidenceVersion: 1,
      evidence: [{ evidenceId: "e-truthful", requestId: "r", sessionId: "session-truthful", knowledgePointId: "basic-python", profileRevision: 3, kind: "diagnostic", source: "fixed_diagnostic", form: "selected_response", impact: "mastery", outcome: "correct", independence: "independent", createdAt: "2026-08-25T00:00:00.000Z" }],
      knowledgeStates: [], activityProgress: [], diagnosticSkippedKnowledgePointIds: ["pandas.clean.read-csv"],
    });
    const model: ModelExecutionPort = { async execute() {
      return { status: "ok", modelId: "deepseek-chat", promptVersion: "w6-profile-v2", sourceRefs: ["e-truthful"], traceSummary: "truthful profile", payload: {
        summary: "仍需支持点：无。用户依据两类诊断证据主动跳过了对应章节，系统保留该选择事实。带缺口活动：无。",
        evidenceRefs: ["e-truthful"],
      } };
    } };
    const agent = new LearnerProfileAgentService({ modelExecutionPort: model, modelId: "deepseek-chat", promptVersion: "w6-profile-v2" });
    await expect(agent.summarize({ profile: base })).resolves.toMatchObject({ status: "accepted" });
  });
});
