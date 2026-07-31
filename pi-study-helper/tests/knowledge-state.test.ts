import { describe, expect, it } from "vitest";
import {
  calculateKnowledgeState,
  KnowledgeStateCalculationError,
} from "../src/domain/knowledge-state.js";
import type { Evidence } from "../src/domain/v2-types.js";

const AS_OF = "2026-07-30T12:00:00.000Z";

function evidence(overrides: Partial<Evidence> & Pick<Evidence, "evidenceId" | "score">): Evidence {
  return {
    requestId: `request-${overrides.evidenceId}`,
    sessionId: "session-1",
    knowledgePointId: "kp-1",
    profileRevision: 2,
    evidenceVersion: 1,
    kind: "diagnostic",
    source: "fixed_diagnostic",
    form: "selected_response",
    impact: "mastery",
    outcome: overrides.score === 1 ? "correct" : overrides.score === 0 ? "incorrect" : "partial",
    independence: "independent",
    createdAt: "2026-07-30T10:00:00.000Z",
    ...overrides,
  };
}

function calculate(items: Evidence[]) {
  return calculateKnowledgeState({
    knowledgePointId: "kp-1",
    profileRevision: 2,
    evidenceVersion: 1,
    evidence: items,
    asOf: AS_OF,
  });
}

describe("knowledge-state-v1", () => {
  it("example 1: no valid evidence remains unverified with nullable mastery", () => {
    const state = calculate([evidence({
      evidenceId: "self-report",
      score: 1,
      source: "self_report",
      impact: "soft",
      form: "interaction",
      kind: "interaction",
    })]);
    expect(state).toMatchObject({ mastery: null, confidence: 0, status: "unverified", skipEligible: false });
    expect(state.consideredEvidenceIds).toEqual([]);
  });

  it("example 2: one correct fixed diagnostic is ready with low confidence", () => {
    const state = calculate([evidence({ evidenceId: "diagnostic", score: 1 })]);
    expect(state.mastery).toBe(1);
    expect(state.confidence).toBeCloseTo(0.25, 12);
    expect(state).toMatchObject({ status: "ready", validEvidenceCount: 1, evidenceFormCount: 1, skipEligible: false });
  });

  it("example 3: consistent selected response and code evidence become mastered", () => {
    const state = calculate([
      evidence({ evidenceId: "diagnostic", score: 0.8, createdAt: "2026-07-30T09:00:00.000Z" }),
      evidence({
        evidenceId: "code",
        score: 0.9,
        kind: "coding_practical",
        source: "code_submit",
        form: "code_execution",
        createdAt: "2026-07-30T10:00:00.000Z",
      }),
    ]);
    expect(state.mastery).toBeCloseTo(0.854545454545, 10);
    expect(state.confidence).toBeCloseTo(0.49624062518, 10);
    expect(state).toMatchObject({ status: "mastered", validEvidenceCount: 2, evidenceFormCount: 2, skipEligible: true });
  });

  it("example 4: conflicting direct evidence applies the conflict penalty", () => {
    const state = calculate([
      evidence({ evidenceId: "diagnostic", score: 1, createdAt: "2026-07-30T09:00:00.000Z" }),
      evidence({
        evidenceId: "code",
        score: 0.2,
        kind: "coding_practical",
        source: "code_submit",
        form: "code_execution",
        createdAt: "2026-07-30T10:00:00.000Z",
      }),
    ]);
    expect(state.mastery).toBeCloseTo(0.563636363636, 10);
    expect(state.confidence).toBeCloseTo(0.19624062518, 10);
    expect(state).toMatchObject({ status: "learning", skipEligible: false });
  });

  it("example 5: evaluator failure does not change the existing state", () => {
    const baseline = evidence({ evidenceId: "diagnostic", score: 0.6 });
    const evaluatorFailure: Evidence = {
      ...evidence({ evidenceId: "evaluator", score: 0 }),
      kind: "coding_practical",
      source: "evaluator_error",
      form: "code_execution",
      impact: "none",
      outcome: "unverifiable",
    };
    const state = calculate([baseline, evaluatorFailure]);
    expect(state.mastery).toBeCloseTo(0.6, 12);
    expect(state.confidence).toBeCloseTo(0.25, 12);
    expect(state).toMatchObject({ status: "learning", validEvidenceCount: 1 });
  });

  it("uses at most seven recent unique attempts and allows mastery to decrease", () => {
    const history = Array.from({ length: 8 }, (_, index) => evidence({
      evidenceId: `e-${index}`,
      attemptId: `attempt-${index}`,
      score: index === 7 ? 0 : 1,
      createdAt: `2026-07-${String(20 + index).padStart(2, "0")}T10:00:00.000Z`,
    }));
    const state = calculate(history);
    expect(state.validEvidenceCount).toBe(7);
    expect(state.consideredEvidenceIds).not.toContain("e-0");
    expect(state.mastery).toBeLessThan(1);
  });

  it("rejects out-of-range and future direct evidence", () => {
    expect(() => calculate([evidence({ evidenceId: "bad-score", score: 1.1 })])).toThrow(KnowledgeStateCalculationError);
    expect(() => calculate([evidence({ evidenceId: "future", score: 1, createdAt: "2026-08-01T00:00:00.000Z" })]))
      .toThrow(KnowledgeStateCalculationError);
  });

  it("requires code evidence when the knowledge point declares it", () => {
    const items = [
      evidence({ evidenceId: "a", score: 0.9, form: "selected_response" }),
      evidence({ evidenceId: "b", score: 0.9, form: "code_reasoning", createdAt: "2026-07-30T11:00:00.000Z" }),
    ];
    const state = calculateKnowledgeState({
      knowledgePointId: "kp-1",
      profileRevision: 2,
      evidenceVersion: 1,
      evidence: items,
      asOf: AS_OF,
      requiresCodeEvidence: true,
    });
    expect(state.status).toBe("mastered");
    expect(state.skipEligible).toBe(false);
  });
});
