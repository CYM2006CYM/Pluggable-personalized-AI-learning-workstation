import { describe, expect, it } from "vitest";
import { buildLearnerProfile } from "../src/domain/learner-profile.js";
import type { Evidence, KnowledgeState } from "../src/contracts/index.js";

function state(knowledgePointId: string, status: KnowledgeState["status"], evidenceIds: string[]): KnowledgeState {
  return {
    knowledgePointId, profileRevision: 3, evidenceVersion: 2, aggregationVersion: "knowledge-state-v1",
    mastery: status === "support_needed" ? 0 : 1, confidence: 0.8, status,
    validEvidenceCount: evidenceIds.length, evidenceFormCount: evidenceIds.length,
    evidenceIds, consideredEvidenceIds: evidenceIds, asOf: "2026-08-25T00:00:00.000Z", skipEligible: false,
    lastUpdatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function evidence(evidenceId: string, knowledgePointId: string, outcome: Evidence["outcome"]): Evidence {
  return {
    evidenceId, requestId: `request-${evidenceId}`, sessionId: "session-phase3", knowledgePointId,
    profileRevision: 3, kind: "mcq", source: "deterministic_quiz", form: "selected_response", impact: "mastery",
    outcome, score: outcome === "correct" ? 1 : 0, independence: "independent", createdAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("Phase 3 learner profile fact projection", () => {
  it("compares initial diagnosis with current facts and preserves gap semantics", () => {
    const profile = buildLearnerProfile({
      sessionId: "session-phase3", profileRevision: 3, evidenceVersion: 2,
      evidence: [evidence("e1", "kp-read", "correct"), evidence("e2", "kp-clean", "incorrect")],
      latestDiagnostic: {
        diagnosticId: "diagnostic", sessionId: "session-phase3", profileRevision: 3, diagnosticVersion: 1,
        evidenceVersion: 1, goalId: "goal", status: "completed", states: [state("kp-read", "support_needed", []), state("kp-clean", "support_needed", [])],
        insufficientKnowledgePointIds: [], summaryTemplateVersion: "diagnostic-summary-v1", createdAt: "2026-08-25T00:00:00.000Z",
      },
      knowledgeStates: [state("kp-read", "ready", ["e1"]), state("kp-clean", "support_needed", ["e2"])],
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz-clean", status: "insufficient", attemptIds: ["a1"], result: "fail", quizRetryCount: 1, continuedWithGap: true, updatedAt: "2026-08-25T00:00:00.000Z" }] }],
    });

    expect(profile.agentStatus).toBe("deterministic_fallback");
    expect(profile.strengths).toEqual(["kp-read"]);
    expect(profile.supportNeeded).toEqual(["kp-clean"]);
    expect(profile.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ knowledgePointId: "kp-read", beforeStatus: "support_needed", afterStatus: "ready", improved: true }),
      expect.objectContaining({ knowledgePointId: "kp-clean", beforeStatus: "support_needed", afterStatus: "support_needed", improved: false }),
    ]));
    expect(profile.skippedActivityIds).toEqual(["quiz-clean"]);
    expect(profile.deterministicSummary).toContain("未将其记为掌握");
  });
});
