// ============================================================
//  Pi Study Helper — v2 public domain contracts
// ============================================================
//
// This file contains the public domain and Profile v2 types frozen by W1-C3.
// Facade DTOs and repository ports remain in their contract-owned modules.
// Runtime algorithms and product fields are intentionally not inferred here.
// ============================================================

export type EvidenceKind =
  | "diagnostic"
  | "objective"
  | "code"
  | "explain"
  | "context";

export type EvidenceResult =
  | "pass"
  | "partial"
  | "fail"
  | "skipped"
  | "unverified";

/** Immutable evidence committed by the learning-session transaction. */
export interface Evidence {
  /** Server-generated immutable identifier; clients cannot provide it. */
  evidenceId: string;
  /** Evidence source. Context questions can only produce soft evidence. */
  kind: EvidenceKind;
  /** The only scored knowledge point; supporting points never enter Evidence. */
  knowledgePointId: string;
  /** Deterministic outcome; evaluator errors must not be represented as fail. */
  result: EvidenceResult;
  /** Deterministic score in the range 0–1, when the activity provides one. */
  score?: number;
  /** Activity that produced the evidence, when applicable. */
  sourceActivityId?: string;
  /** Formal attempt that produced the evidence, when applicable. */
  sourceAttemptId?: string;
  /** Monotonic formal-evidence transaction version. */
  evidenceVersion: number;
  /** Profile revision used to produce the evidence. */
  profileRevision: number;
  /** Server-generated ISO timestamp. */
  createdAt: string;
}

export type KnowledgeStateValue =
  | "unverified"
  | "emerging"
  | "developing"
  | "mastered";

/** Deterministic per-knowledge-point fact used by prerequisite and path logic. */
export interface KnowledgeState {
  /** Stable knowledge-point identifier from the Profile. */
  knowledgePointId: string;
  /** Deterministic mastery value in the range 0–1. */
  mastery: number;
  /** Evidence sufficiency in the range 0–1; it is not mastery. */
  confidence: number;
  /** Deterministically mapped state. */
  state: KnowledgeStateValue;
  /** Formal-evidence version on which this snapshot is based. */
  evidenceVersion: number;
  /** Profile revision used by this snapshot. */
  profileRevision: number;
  /** Server-generated update time. */
  updatedAt: string;
}

export type CapabilityDimensionId =
  | "syntax_api"
  | "data_abstraction"
  | "cleaning_reasoning"
  | "validation_debugging"
  | "engineering_independence";

/** One of the five fixed Pandas capability-display dimensions. */
export interface CapabilityDimension {
  id: CapabilityDimensionId;
  /** AI-provided score in the range 0–100; omitted without direct evidence. */
  score?: number;
  /** Validated AI confidence in the range 0–1. */
  confidence?: number;
  state: "verified" | "unverified";
  /** Learner-facing rationale that must not expose hidden assets. */
  rationale?: string;
  /** References to already committed formal Evidence. */
  evidenceRefs: string[];
}

/** Independently versioned five-dimension capability-display snapshot. */
export interface CapabilityProfileRevision {
  capabilityProfileRevision: number;
  /** Must contain the five fixed dimensions. */
  dimensions: CapabilityDimension[];
  evidenceVersion: number;
  profileRevision: number;
  /** Model identifier without authentication data. */
  modelId: string;
  promptVersion: string;
  status: "complete" | "partial" | "unverified" | "not_updated";
  /** Server-generated creation time. */
  createdAt: string;
}

/** Deterministic evaluator result consumed by the application layer. */
export interface ActivityResult {
  executionStatus: "not_started" | "running" | "completed" | "failed" | "cancelled";
  verdict: "pass" | "partial" | "fail" | "not_graded";
  errorKind?: "learner" | "evaluator";
  errorCode?: LearningRuntimeErrorCode;
  /** Deterministic score in the range 0–1, when graded. */
  score?: number;
  dimensionResults?: Record<string, number>;
  /** Learner-visible feedback after security trimming. */
  safeFeedback: string;
  /** Server-measured duration. */
  durationMs?: number;
  evaluatorVersion: string;
  /** Environment summary that excludes host paths. */
  environmentHash: string;
  /** Test-asset summary that does not expose private content. */
  assetBundleHash: string;
}

export type LearningRuntimeErrorCode =
  | "invalid_profile"
  | "profile_revision_conflict"
  | "session_not_found"
  | "session_version_conflict"
  | "idempotency_conflict"
  | "diagnostic_incomplete"
  | "diagnostic_answer_invalid"
  | "evidence_invalid"
  | "path_infeasible"
  | "path_version_conflict"
  | "prerequisite_violation"
  | "activity_not_found"
  | "activity_version_conflict"
  | "attempt_not_found"
  | "draft_version_conflict"
  | "storage_error"
  | "environment_mismatch"
  | "syntax_error"
  | "runtime_error"
  | "test_failed"
  | "timeout"
  | "output_limit"
  | "disallowed_import"
  | "submission_contract_error"
  | "evaluator_error"
  | "evaluator_start_failed"
  | "evaluator_timeout"
  | "dependency_missing"
  | "test_asset_invalid"
  | "result_protocol_invalid"
  | "runner_crash";

export type ProfileStatus = "active" | "draft" | "archived";
export type ProfileModality = "reading" | "quiz" | "code" | "practice";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProfileManifestV2 {
  subjectId: string;
  name: string;
  schemaVersion: 2;
  status: ProfileStatus;
  version: string;
  revision: number;
  revisionOf: number | null;
  capabilities: ProfileCapabilitiesV2;
  paths: ProfilePathsV2;
  [extensionName: `x-${string}`]: JsonValue;
}

export interface ProfileCapabilitiesV2 {
  modalities: ProfileModality[];
  runtimes: string[];
  diagnostic: boolean;
  [extensionName: `x-${string}`]: JsonValue;
}

export interface ProfilePathsV2 {
  subject: string;
  chapters: string;
  knowledge: string;
  goals: string;
  sources: string;
  quality: string;
  cards?: string;
  activities?: string;
  diagnostic?: string;
  assessments?: string;
  rubrics?: string;
  datasets?: string;
  referenceSolutions?: string;
  environments?: string;
  taskGeneration?: string;
  [extensionName: `x-${string}`]: JsonValue;
}

export interface LearningGoalDefinition {
  goalId: string;
  title: string;
  targetKnowledgePointIds: string[];
  requiredActivityIds: string[];
  finalActivityId?: string;
}

export interface KnowledgePointDefinition {
  id: string;
  title: string;
  chapterId: string;
  sectionId: string;
  prerequisiteIds: string[];
  relatedKnowledgePointIds: string[];
  sourceAnchorIds: string[];
  activityIds: string[];
  importance: number;
}

/** Minimal projection used only for Profile cross-file closure validation. */
export interface ActivityReferenceDefinition {
  activityId: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
  goalIds: string[];
}

export interface LearningGoalsAsset {
  goals: LearningGoalDefinition[];
  [extensionName: `x-${string}`]: JsonValue;
}

export interface KnowledgePointsAsset {
  knowledgePoints: KnowledgePointDefinition[];
  [extensionName: `x-${string}`]: JsonValue;
}

export interface LearningActivitiesAsset {
  activities: ActivityReferenceDefinition[];
  [extensionName: `x-${string}`]: JsonValue;
}
