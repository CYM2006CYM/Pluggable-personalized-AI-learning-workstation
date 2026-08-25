import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ActivityResult,
  CapabilityDimension,
  CapabilityDimensionId,
  CapabilityProfileRevision,
  Evidence,
  EvidenceForm,
  EvidenceImpact,
  EvidenceKind,
  EvidenceSource,
  KnowledgeState,
  KnowledgeStatus,
  LearnerDiagnostic,
  LearningRuntimeErrorCode,
  ProfileManifestV2,
} from "../src/domain/v2-types.js";

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

describe("v2 public domain type contracts", () => {
  it("uses the complete immutable Evidence model", () => {
    const kinds = ["diagnostic", "mcq", "code_completion", "coding_practical", "explain", "debug", "legacy", "interaction"] satisfies EvidenceKind[];
    const sources = ["fixed_diagnostic", "deterministic_quiz", "code_submit", "practical_rubric", "legacy_final_answer", "self_report", "context_question", "hint_view", "public_run", "evaluator_error"] satisfies EvidenceSource[];
    const forms = ["selected_response", "code_reasoning", "code_execution", "practical_rubric", "legacy_attempt", "interaction"] satisfies EvidenceForm[];
    const impacts = ["mastery", "soft", "none"] satisfies EvidenceImpact[];
    const candidate = {
      evidenceId: "evidence-1",
      requestId: "request-1",
      sessionId: "session-1",
      knowledgePointId: "kp-1",
      profileRevision: 2,
      kind: "diagnostic",
      source: "fixed_diagnostic",
      form: "selected_response",
      impact: "mastery",
      outcome: "correct",
      score: 1,
      independence: "independent",
      createdAt: "2026-07-30T01:00:00.000Z",
    } satisfies Evidence;
    expect(kinds).toHaveLength(8);
    expect(sources).toHaveLength(10);
    expect(forms).toHaveLength(6);
    expect(impacts).toHaveLength(3);
    expect(candidate).not.toHaveProperty("evidenceVersion");
    expectTypeOf(candidate).toMatchTypeOf<Evidence>();
  });

  it("keeps nullable mastery and the five KnowledgeStatus values", () => {
    const statuses = ["unverified", "support_needed", "learning", "ready", "mastered"] satisfies KnowledgeStatus[];
    const state = {
      knowledgePointId: "kp-1",
      profileRevision: 2,
      evidenceVersion: 1,
      aggregationVersion: "knowledge-state-v1",
      mastery: null,
      confidence: 0,
      status: "unverified",
      validEvidenceCount: 0,
      evidenceFormCount: 0,
      evidenceIds: [],
      consideredEvidenceIds: [],
      asOf: "2026-07-30T01:00:00.000Z",
      skipEligible: false,
      lastUpdatedAt: "2026-07-30T01:00:00.000Z",
    } satisfies KnowledgeState;
    expect(statuses).toHaveLength(5);
    expect(state.mastery).toBeNull();
    expectTypeOf(state).toMatchTypeOf<KnowledgeState>();
  });

  it("defines the immutable LearnerDiagnostic snapshot", () => {
    const diagnostic = {
      diagnosticId: "diagnostic-1",
      sessionId: "session-1",
      profileRevision: 2,
      diagnosticVersion: 1,
      evidenceVersion: 1,
      goalId: "goal-1",
      status: "completed",
      states: [],
      insufficientKnowledgePointIds: ["kp-2"],
      summaryTemplateVersion: "diagnostic-summary-v1",
      createdAt: "2026-07-30T01:00:00.000Z",
    } satisfies LearnerDiagnostic;
    expect(diagnostic.status).toBe("completed");
    expectTypeOf(diagnostic).toMatchTypeOf<LearnerDiagnostic>();
  });

  it("keeps five fixed capability dimensions separate from KnowledgeState", () => {
    const ids = ["syntax_api", "data_abstraction", "cleaning_reasoning", "validation_debugging", "engineering_independence"] satisfies CapabilityDimensionId[];
    const dimensions: CapabilityDimension[] = ids.map((id) => ({ id, state: "unverified", evidenceRefs: [] }));
    const profile = {
      capabilityProfileRevision: 1,
      dimensions,
      evidenceVersion: 1,
      profileRevision: 2,
      modelId: "model-1",
      promptVersion: "capability-v1",
      status: "unverified",
      createdAt: "2026-07-30T01:00:00.000Z",
    } satisfies CapabilityProfileRevision;
    expect(profile.dimensions).toHaveLength(5);
    expectTypeOf(profile).toMatchTypeOf<CapabilityProfileRevision>();
  });

  it("represents evaluator failure without manufacturing learner evidence", () => {
    const result = {
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "evaluator_error",
      safeFeedback: "评测服务暂时不可用，草稿已保留。",
      evaluatorVersion: "evaluator-v1",
      environmentHash: "environment-hash",
      assetBundleHash: "asset-bundle-hash",
    } satisfies ActivityResult;
    expect(result).not.toHaveProperty("score");
    expectTypeOf(result).toMatchTypeOf<ActivityResult>();
  });

  it("keeps the frozen profile manifest shape", () => {
    const manifest = {
      subjectId: "subject-1",
      name: "Subject",
      schemaVersion: 2,
      status: "draft",
      version: "0.2.0-draft",
      revision: 2,
      revisionOf: 1,
      capabilities: { modalities: ["reading"], runtimes: [], diagnostic: false },
      paths: {
        subject: "subject.md",
        chapters: "chapters",
        knowledge: "knowledge/knowledge-points.json",
        goals: "goals/learning-goals.json",
        sources: "sources/source-map.json",
        quality: "quality/quality-report.json",
      },
    } satisfies ProfileManifestV2;
    expect(manifest.revision).toBe(2);
    expectTypeOf(manifest).toMatchTypeOf<ProfileManifestV2>();
  });

  it("keeps the intended optional fields only", () => {
    expectTypeOf<OptionalKeys<Evidence>>().toEqualTypeOf<
      "evidenceVersion" | "score" | "difficulty" | "activityId" | "attemptId" | "evaluatorVersion"
    >();
    expectTypeOf<OptionalKeys<KnowledgeState>>().toEqualTypeOf<"diagnosticSkipEligible">();
    expectTypeOf<OptionalKeys<CapabilityDimension>>().toEqualTypeOf<"score" | "confidence" | "rationale">();
  });

  it("includes the diagnostic conflict error code", () => {
    const codes = ["diagnostic_answer_conflict", "diagnostic_incomplete", "evidence_invalid", "storage_error"] as const satisfies LearningRuntimeErrorCode[];
    expect(codes).toContain("diagnostic_answer_conflict");
    expectTypeOf<(typeof codes)[number]>().toMatchTypeOf<LearningRuntimeErrorCode>();
  });
});
