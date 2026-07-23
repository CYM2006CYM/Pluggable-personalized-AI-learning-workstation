import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ActivityReferenceDefinition,
  ActivityResult,
  CapabilityDimension,
  CapabilityDimensionId,
  CapabilityProfileRevision,
  Evidence,
  EvidenceKind,
  EvidenceResult,
  KnowledgePointDefinition,
  KnowledgePointsAsset,
  LearningActivitiesAsset,
  LearningGoalDefinition,
  LearningGoalsAsset,
  LearningRuntimeErrorCode,
  KnowledgeState,
  KnowledgeStateValue,
  ProfileManifestV2,
  ProfileModality,
  ProfileStatus,
} from "../src/domain/v2-types.js";

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

type ActivityErrorKind = Exclude<ActivityResult["errorKind"], undefined>;

describe("v2 public domain type contracts", () => {
  it("keeps the frozen Evidence kinds, results, and fields", () => {
    const kinds = ["diagnostic", "objective", "code", "explain", "context"] satisfies EvidenceKind[];
    const results = ["pass", "partial", "fail", "skipped", "unverified"] satisfies EvidenceResult[];
    const evidence = {
      evidenceId: "evidence-1",
      kind: "objective",
      knowledgePointId: "missing-values",
      result: "pass",
      score: 1,
      sourceActivityId: "activity-1",
      sourceAttemptId: "attempt-1",
      evidenceVersion: 1,
      profileRevision: 2,
      createdAt: "2026-07-23T01:00:00.000Z",
    } satisfies Evidence;

    expect(kinds).toHaveLength(5);
    expect(results).toHaveLength(5);
    expectTypeOf<(typeof kinds)[number]>().toEqualTypeOf<EvidenceKind>();
    expectTypeOf<(typeof results)[number]>().toEqualTypeOf<EvidenceResult>();
    expect(evidence).toMatchObject({ kind: "objective", result: "pass", evidenceVersion: 1 });
    expectTypeOf(evidence).toMatchTypeOf<Evidence>();
  });

  it("keeps KnowledgeState separate from the five-dimension capability profile", () => {
    const states = ["unverified", "emerging", "developing", "mastered"] satisfies KnowledgeStateValue[];
    const knowledgeState = {
      knowledgePointId: "missing-values",
      mastery: 0.8,
      confidence: 0.7,
      state: "mastered",
      evidenceVersion: 3,
      profileRevision: 2,
      updatedAt: "2026-07-23T01:05:00.000Z",
    } satisfies KnowledgeState;

    expect(states).toEqual(["unverified", "emerging", "developing", "mastered"]);
    expectTypeOf<(typeof states)[number]>().toEqualTypeOf<KnowledgeStateValue>();
    expect(knowledgeState).not.toHaveProperty("capabilityProfileRevision");
    expectTypeOf(knowledgeState).toMatchTypeOf<KnowledgeState>();
  });

  it("keeps the five fixed capability dimension identifiers", () => {
    const ids = [
      "syntax_api",
      "data_abstraction",
      "cleaning_reasoning",
      "validation_debugging",
      "engineering_independence",
    ] satisfies CapabilityDimensionId[];
    const dimensionStates = ["verified", "unverified"] as const satisfies readonly CapabilityDimension["state"][];
    const profileStatuses = ["complete", "partial", "unverified", "not_updated"] as const satisfies readonly CapabilityProfileRevision["status"][];
    const dimensions: CapabilityDimension[] = ids.map((id, index) => ({
      id,
      score: 70 + index,
      confidence: 0.8,
      state: "verified",
      rationale: `dimension-${index}`,
      evidenceRefs: ["evidence-1"],
    }));
    const profile = {
      capabilityProfileRevision: 1,
      dimensions,
      evidenceVersion: 3,
      profileRevision: 2,
      modelId: "model-1",
      promptVersion: "capability-v1",
      status: "complete",
      createdAt: "2026-07-23T01:10:00.000Z",
    } satisfies CapabilityProfileRevision;

    expect(profile.dimensions.map((dimension) => dimension.id)).toEqual(ids);
    expect(profile.dimensions).toHaveLength(5);
    expectTypeOf<(typeof ids)[number]>().toEqualTypeOf<CapabilityDimensionId>();
    expectTypeOf<(typeof dimensionStates)[number]>().toEqualTypeOf<CapabilityDimension["state"]>();
    expectTypeOf<(typeof profileStatuses)[number]>().toEqualTypeOf<CapabilityProfileRevision["status"]>();
    expectTypeOf(profile).toMatchTypeOf<CapabilityProfileRevision>();
  });

  it("represents evaluator failure without manufacturing a learner verdict", () => {
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

    expect(result).toMatchObject({ errorKind: "evaluator", verdict: "not_graded" });
    expect(result).not.toHaveProperty("score");
    expectTypeOf(result).toMatchTypeOf<ActivityResult>();
  });

  it("covers every inline ActivityResult union and the frozen optionality", () => {
    const executionStatuses = ["not_started", "running", "completed", "failed", "cancelled"] as const satisfies readonly ActivityResult["executionStatus"][];
    const verdicts = ["pass", "partial", "fail", "not_graded"] as const satisfies readonly ActivityResult["verdict"][];
    const errorKinds = ["learner", "evaluator"] as const satisfies readonly ActivityErrorKind[];
    const minimalEvidence = {
      evidenceId: "evidence-minimal",
      kind: "context",
      knowledgePointId: "missing-values",
      result: "unverified",
      evidenceVersion: 1,
      profileRevision: 1,
      createdAt: "2026-07-23T01:20:00.000Z",
    } satisfies Evidence;
    const minimalDimension = {
      id: "syntax_api",
      state: "unverified",
      evidenceRefs: [],
    } satisfies CapabilityDimension;

    expect(executionStatuses).toHaveLength(5);
    expect(verdicts).toHaveLength(4);
    expect(errorKinds).toHaveLength(2);
    expectTypeOf<(typeof executionStatuses)[number]>().toEqualTypeOf<ActivityResult["executionStatus"]>();
    expectTypeOf<(typeof verdicts)[number]>().toEqualTypeOf<ActivityResult["verdict"]>();
    expectTypeOf<(typeof errorKinds)[number]>().toEqualTypeOf<ActivityErrorKind>();
    expect(minimalEvidence).not.toHaveProperty("score");
    expect(minimalDimension).not.toHaveProperty("score");
  });

  it("proves required and optional fields without adding runtime validation", () => {
    expectTypeOf<OptionalKeys<Evidence>>().toEqualTypeOf<"score" | "sourceActivityId" | "sourceAttemptId">();
    expectTypeOf<OptionalKeys<KnowledgeState>>().toEqualTypeOf<never>();
    expectTypeOf<OptionalKeys<CapabilityDimension>>().toEqualTypeOf<"score" | "confidence" | "rationale">();
    expectTypeOf<OptionalKeys<CapabilityProfileRevision>>().toEqualTypeOf<never>();
    expectTypeOf<OptionalKeys<ActivityResult>>().toEqualTypeOf<"errorKind" | "errorCode" | "score" | "dimensionResults" | "durationMs">();

    expectTypeOf<RequiredKeys<Evidence>>().toEqualTypeOf<
      "evidenceId" | "kind" | "knowledgePointId" | "result" | "evidenceVersion" | "profileRevision" | "createdAt"
    >();
    expectTypeOf<RequiredKeys<CapabilityDimension>>().toEqualTypeOf<"id" | "state" | "evidenceRefs">();
    expectTypeOf<RequiredKeys<ActivityResult>>().toEqualTypeOf<
      "executionStatus" | "verdict" | "safeFeedback" | "evaluatorVersion" | "environmentHash" | "assetBundleHash"
    >();
  });

  it("rejects values outside the frozen enums at compile time", () => {
    // @ts-expect-error EvidenceKind is a closed union.
    const invalidEvidenceKind: EvidenceKind = "quiz";
    // @ts-expect-error EvidenceResult is a closed union.
    const invalidEvidenceResult: EvidenceResult = "unknown";
    // @ts-expect-error KnowledgeStateValue is a closed union.
    const invalidKnowledgeState: KnowledgeStateValue = "expert";
    // @ts-expect-error CapabilityDimensionId is a fixed five-value union.
    const invalidDimensionId: CapabilityDimensionId = "creativity";
    // @ts-expect-error ActivityResult verdict is a closed union.
    const invalidVerdict: ActivityResult["verdict"] = "graded";
    // @ts-expect-error CapabilityDimension state is a closed union.
    const invalidDimensionState: CapabilityDimension["state"] = "pending";
    // @ts-expect-error CapabilityProfileRevision status is a closed union.
    const invalidProfileStatus: CapabilityProfileRevision["status"] = "ready";

    expect([
      invalidEvidenceKind,
      invalidEvidenceResult,
      invalidKnowledgeState,
      invalidDimensionId,
      invalidVerdict,
      invalidDimensionState,
      invalidProfileStatus,
    ]).toHaveLength(7);
  });

  it("keeps the single W1-C2 runtime error-code union", () => {
    const errorCodes = [
      "invalid_profile",
      "profile_revision_conflict",
      "session_not_found",
      "session_version_conflict",
      "idempotency_conflict",
      "diagnostic_incomplete",
      "diagnostic_answer_invalid",
      "evidence_invalid",
      "path_infeasible",
      "path_version_conflict",
      "prerequisite_violation",
      "activity_not_found",
      "activity_version_conflict",
      "attempt_not_found",
      "draft_version_conflict",
      "storage_error",
      "environment_mismatch",
      "syntax_error",
      "runtime_error",
      "test_failed",
      "timeout",
      "output_limit",
      "disallowed_import",
      "submission_contract_error",
      "evaluator_error",
      "evaluator_start_failed",
      "evaluator_timeout",
      "dependency_missing",
      "test_asset_invalid",
      "result_protocol_invalid",
      "runner_crash",
    ] as const satisfies readonly LearningRuntimeErrorCode[];

    expect(errorCodes).toHaveLength(31);
    expectTypeOf<(typeof errorCodes)[number]>().toEqualTypeOf<LearningRuntimeErrorCode>();

    // @ts-expect-error W1-C2 removed the old session_conflict spelling.
    const legacySessionConflict: LearningRuntimeErrorCode = "session_conflict";
    expect(legacySessionConflict).toBe("session_conflict");
  });

  it("exposes the strict Profile v2 manifest without the v1 slot field", () => {
    const modalities = ["reading", "quiz", "code", "practice"] as const satisfies readonly ProfileModality[];
    const statuses = ["active", "draft", "archived"] as const satisfies readonly ProfileStatus[];
    const goal = {
      goalId: "clean-data",
      title: "Clean data",
      targetKnowledgePointIds: ["missing-values"],
      requiredActivityIds: ["activity-1"],
    } satisfies LearningGoalDefinition;
    const manifest = {
      subjectId: "pandas-cleaning",
      name: "Pandas cleaning",
      schemaVersion: 2,
      status: "draft",
      version: "mvp-1.0.0",
      revision: 1,
      revisionOf: null,
      capabilities: {
        modalities: ["reading"],
        runtimes: [],
        diagnostic: false,
      },
      paths: {
        subject: "subject.md",
        chapters: "chapters",
        knowledge: "knowledge/knowledge-points.json",
        goals: "goals/learning-goals.json",
        sources: "sources",
        quality: "quality",
      },
      "x-owner-note": "fixture-only",
    } satisfies ProfileManifestV2;

    expect(modalities).toHaveLength(4);
    expect(statuses).toHaveLength(3);
    expect(goal.goalId).toBe("clean-data");
    expect(manifest).not.toHaveProperty("slot");
    expectTypeOf<(typeof modalities)[number]>().toEqualTypeOf<ProfileModality>();
    expectTypeOf<(typeof statuses)[number]>().toEqualTypeOf<ProfileStatus>();

    const legacyEvidence: Evidence = {
      evidenceId: "legacy-evidence",
      kind: "objective",
      // @ts-expect-error W1-C2 Evidence uses one primary knowledge point.
      knowledgePointIds: ["missing-values"],
      result: "pass",
      evidenceVersion: 1,
      profileRevision: 1,
      createdAt: "2026-07-23T01:30:00.000Z",
    };
    expect(legacyEvidence).toHaveProperty("knowledgePointIds");
  });

  it("exposes the three frozen W1-C3 asset containers and reference projections", () => {
    const goal = {
      goalId: "goal-core",
      title: "Core goal",
      targetKnowledgePointIds: ["kp-core"],
      requiredActivityIds: ["activity-explain"],
    } satisfies LearningGoalDefinition;
    const point = {
      id: "kp-core",
      title: "Core point",
      chapterId: "chapter-introduction",
      sectionId: "section-core",
      prerequisiteIds: [],
      relatedKnowledgePointIds: [],
      sourceAnchorIds: [],
      activityIds: ["activity-explain"],
      importance: 1,
    } satisfies KnowledgePointDefinition;
    const activity = {
      activityId: "activity-explain",
      primaryKnowledgePointId: "kp-core",
      supportingKnowledgePointIds: [],
      goalIds: ["goal-core"],
    } satisfies ActivityReferenceDefinition;
    const goalsAsset = { goals: [goal], "x-owner": "A" } satisfies LearningGoalsAsset;
    const knowledgeAsset = { knowledgePoints: [point] } satisfies KnowledgePointsAsset;
    const activitiesAsset = { activities: [activity] } satisfies LearningActivitiesAsset;

    expect(goalsAsset.goals[0]?.goalId).toBe("goal-core");
    expect(knowledgeAsset.knowledgePoints[0]?.id).toBe("kp-core");
    expect(activitiesAsset.activities[0]?.primaryKnowledgePointId).toBe("kp-core");
    expectTypeOf(goal).toMatchTypeOf<LearningGoalDefinition>();
    expectTypeOf(point).toMatchTypeOf<KnowledgePointDefinition>();
    expectTypeOf(activity).toMatchTypeOf<ActivityReferenceDefinition>();
  });
});
