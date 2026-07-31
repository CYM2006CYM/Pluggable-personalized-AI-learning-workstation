// Pi Study Helper — v2 public domain contracts.
//
// These are the single v2 definitions used by the deterministic learning
// runtime.  Legacy v1 types remain in domain/types.ts and are intentionally
// not mixed with this module.

export type EvidenceKind =
  | "diagnostic"
  | "mcq"
  | "code_completion"
  | "coding_practical"
  | "explain"
  | "debug"
  | "legacy"
  | "interaction";

export type EvidenceSource =
  | "fixed_diagnostic"
  | "deterministic_quiz"
  | "code_submit"
  | "practical_rubric"
  | "legacy_final_answer"
  | "self_report"
  | "context_question"
  | "hint_view"
  | "public_run"
  | "evaluator_error";

export type EvidenceImpact = "mastery" | "soft" | "none";

export type EvidenceForm =
  | "selected_response"
  | "code_reasoning"
  | "code_execution"
  | "practical_rubric"
  | "legacy_attempt"
  | "interaction";

export type EvidenceOutcome = "correct" | "partial" | "incorrect" | "unverifiable";
export type EvidenceIndependence = "independent" | "hinted" | "worked_example" | "answer_exposed";
export type Difficulty = "S-R" | "S-U" | "M-U" | "M-A" | "C-A";

/** Immutable observation. Candidates omit evidenceVersion until commit. */
export interface Evidence {
  evidenceId: string;
  requestId: string;
  sessionId: string;
  knowledgePointId: string;
  profileRevision: number;
  evidenceVersion?: number;
  kind: EvidenceKind;
  source: EvidenceSource;
  form: EvidenceForm;
  impact: EvidenceImpact;
  outcome: EvidenceOutcome;
  score?: number;
  difficulty?: Difficulty;
  independence: EvidenceIndependence;
  activityId?: string;
  attemptId?: string;
  evaluatorVersion?: string;
  createdAt: string;
}

export type KnowledgeStatus =
  | "unverified"
  | "support_needed"
  | "learning"
  | "ready"
  | "mastered";

export interface KnowledgeState {
  knowledgePointId: string;
  profileRevision: number;
  evidenceVersion: number;
  aggregationVersion: "knowledge-state-v1";
  mastery: number | null;
  confidence: number;
  status: KnowledgeStatus;
  validEvidenceCount: number;
  evidenceFormCount: number;
  evidenceIds: string[];
  consideredEvidenceIds: string[];
  asOf: string;
  skipEligible: boolean;
  lastUpdatedAt: string;
}

export interface LearnerDiagnostic {
  diagnosticId: string;
  sessionId: string;
  profileRevision: number;
  diagnosticVersion: number;
  evidenceVersion: number;
  goalId: string;
  status: "completed";
  states: KnowledgeState[];
  insufficientKnowledgePointIds: string[];
  summaryTemplateVersion: string;
  agentExplanation?: string;
  createdAt: string;
}

export type CapabilityDimensionId =
  | "syntax_api"
  | "data_abstraction"
  | "cleaning_reasoning"
  | "validation_debugging"
  | "engineering_independence";

export interface CapabilityDimension {
  id: CapabilityDimensionId;
  score?: number;
  confidence?: number;
  state: "verified" | "unverified";
  rationale?: string;
  evidenceRefs: string[];
}

export interface CapabilityProfileRevision {
  capabilityProfileRevision: number;
  dimensions: CapabilityDimension[];
  evidenceVersion: number;
  profileRevision: number;
  modelId: string;
  promptVersion: string;
  status: "complete" | "partial" | "unverified" | "not_updated";
  createdAt: string;
}

export interface ActivityResult {
  executionStatus: "not_started" | "running" | "completed" | "failed" | "cancelled";
  verdict: "pass" | "partial" | "fail" | "not_graded";
  errorKind?: "learner" | "evaluator";
  errorCode?: LearningRuntimeErrorCode;
  score?: number;
  dimensionResults?: Record<string, number>;
  safeFeedback: string;
  durationMs?: number;
  evaluatorVersion: string;
  environmentHash: string;
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
  | "diagnostic_answer_conflict"
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
  requiresCodeEvidence?: boolean;
}

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
