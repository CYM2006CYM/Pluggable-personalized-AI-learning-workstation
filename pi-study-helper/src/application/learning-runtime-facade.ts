import type {
  ActivityResult,
  KnowledgeState,
  LearningRuntimeErrorCode,
} from "../domain/v2-types.js";

export interface LearningRuntimeFacade {
  startSession(input: StartSessionInput): Promise<StartSessionOutput>;
  recoverSession(input: RecoverSessionInput): Promise<RecoverSessionOutput>;
  completeSession(input: CompleteSessionInput): Promise<CompleteSessionOutput>;
  saveDiagnosticDraft(input: SaveDiagnosticDraftInput): Promise<DiagnosticDraftOutput>;
  submitDiagnosticAnswer(input: SubmitDiagnosticAnswerInput): Promise<DiagnosticAnswerOutput>;
  completeDiagnostic(input: CompleteDiagnosticInput): Promise<DiagnosticCompleteOutput>;
  buildPath(input: BuildPathInput): Promise<PathCandidateOutput>;
  confirmPath(input: ConfirmPathInput): Promise<ConfirmedPathOutput>;
  getNextStep(input: GetNextStepInput): Promise<NextStepOutput>;
  replanPath(input: ReplanPathInput): Promise<ReplanPathOutput>;
  openActivity(input: OpenActivityInput): Promise<ActivityDraftOutput>;
  saveActivityDraft(input: SaveActivityDraftInput): Promise<ActivityDraftOutput>;
  prepareActivityRun(input: PrepareActivityRunInput): Promise<PreparedActivityOutput>;
  submitActivity(input: SubmitActivityInput): Promise<ActivitySubmissionOutput>;
  getActivityAttempt(input: GetActivityAttemptInput): Promise<ActivityAttemptSafeView>;
  recoverActivity(input: RecoverActivityInput): Promise<ActivityRecoveryOutput>;
  askContextQuestion(input: ContextQuestionInput): Promise<ContextAnswerOutput>;
}

export type LearningEntryMode = "chapter" | "recommended";
export type IsoDateTime = string;
export type SessionStatus = "active" | "paused" | "completed" | "recoverable";
export type SessionStage = "diagnostic" | "path" | "learning" | "activity" | "completed";
export type ActivityKind = "mcq" | "code_completion" | "coding_practical" | "explain" | "debug";

export interface CreateRequestMeta {
  requestId: string;
}

export interface WriteRequestMeta {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
}

export interface ReadRequestMeta {
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
}

export interface FacadeResponseMeta {
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  errorCode?: LearningRuntimeErrorCode;
}

export interface SessionSafeView extends FacadeResponseMeta {
  subjectId: string;
  mode: LearningEntryMode;
  goalId: string;
  chapterId?: string;
  availableMinutes: number;
  status: SessionStatus;
  stage: SessionStage;
  diagnosticRequired: boolean;
  pathVersion?: number;
}

export interface StartSessionInput extends CreateRequestMeta {
  subjectId: string;
  mode: LearningEntryMode;
  goalId: string;
  availableMinutes: number;
  chapterId?: string;
}

export interface StartSessionOutput extends SessionSafeView {
  requestId: string;
}

export type RecoverSessionInput = WriteRequestMeta;

export interface RecoverSessionOutput extends FacadeResponseMeta {
  requestId: string;
  view: SessionSafeView;
  recoveryAction: "none" | "completed_candidate_commit" | "isolated_incomplete_candidate" | "rebuilt_derived_state";
}

export type CompleteSessionInput = WriteRequestMeta;

export interface CompleteSessionOutput extends FacadeResponseMeta {
  requestId: string;
  completedAt?: IsoDateTime;
  summary: string;
  nextRecommendation?: string;
}

export interface DiagnosticDraftField {
  fieldId: string;
  value: string | number | boolean | string[];
}

export interface SaveDiagnosticDraftInput extends WriteRequestMeta {
  diagnosticId: string;
  diagnosticVersion: number;
  currentQuestionId?: string;
  background: DiagnosticDraftField[];
}

export interface DiagnosticDraftOutput extends FacadeResponseMeta {
  requestId: string;
  diagnosticId: string;
  diagnosticVersion: number;
  currentQuestionId?: string;
  savedAt: IsoDateTime;
}

export interface SubmitDiagnosticAnswerInput extends WriteRequestMeta {
  diagnosticId: string;
  diagnosticVersion: number;
  questionId: string;
  answer: string | boolean;
}

export interface DiagnosticAnswerOutput extends FacadeResponseMeta {
  requestId: string;
  diagnosticId: string;
  questionId: string;
  result: "pass" | "fail" | "skipped";
  evidenceId?: string;
}

export interface CompleteDiagnosticInput extends WriteRequestMeta {
  diagnosticId: string;
  diagnosticVersion: number;
}

export interface DiagnosticCompleteOutput extends FacadeResponseMeta {
  requestId: string;
  diagnosticId: string;
  evidenceVersion: number;
  knowledgeStates: KnowledgeState[];
  capabilityProfileRevision?: number;
  insufficientKnowledgePointIds: string[];
}

export interface BuildPathInput extends WriteRequestMeta {
  goalId: string;
  mode: LearningEntryMode;
  chapterId?: string;
  availableMinutes: number;
  evidenceVersion: number;
  selectedKnowledgePointIds: string[];
  lockedNodeIds: string[];
}

export interface PathNodeSafeView {
  nodeId: string;
  knowledgePointId: string;
  activityIds: string[];
  status: "locked" | "available" | "in_progress" | "completed" | "skipped";
  estimatedMinutes: number;
  reasonCodes: string[];
}

export interface PathCandidateOutput extends FacadeResponseMeta {
  requestId: string;
  status: "candidate" | "infeasible";
  pathId?: string;
  pathVersion?: number;
  nodes: PathNodeSafeView[];
  missingPrerequisiteIds: string[];
  minimumRequiredMinutes?: number;
}

export interface ConfirmPathInput extends WriteRequestMeta {
  pathId: string;
  pathVersion: number;
}

export interface ConfirmedPathOutput extends FacadeResponseMeta {
  requestId: string;
  pathId: string;
  pathVersion: number;
  status: "active";
}

export interface GetNextStepInput extends ReadRequestMeta {
  pathVersion: number;
}

export interface NextStepOutput extends FacadeResponseMeta {
  pathVersion: number;
  completed: boolean;
  node?: PathNodeSafeView;
  activity?: ActivitySafeView;
}

export type ReplanTrigger =
  | "knowledge_state_changed"
  | "skip_eligibility_changed"
  | "error_remediation"
  | "user_constraint_changed";

export interface ReplanPathInput extends WriteRequestMeta {
  pathVersion: number;
  evidenceVersion: number;
  trigger: ReplanTrigger;
  availableMinutes: number;
  selectedKnowledgePointIds: string[];
  lockedNodeIds: string[];
}

export interface ReplanPathOutput extends FacadeResponseMeta {
  requestId: string;
  changed: boolean;
  pathId: string;
  pathVersion: number;
  nodes: PathNodeSafeView[];
  fallbackToPrevious: boolean;
}

export interface ActivitySafeView {
  activityId: string;
  activityVersion: number;
  kind: ActivityKind;
  title: string;
  prompt: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
  starterCode?: string;
}

export interface OpenActivityInput extends WriteRequestMeta {
  activityId: string;
  activityVersion: number;
  pathVersion: number;
}

export interface ActivityDraftOutput extends FacadeResponseMeta {
  requestId: string;
  attemptId: string;
  draftVersion: number;
  activity: ActivitySafeView;
  userText: string;
}

export interface SaveActivityDraftInput extends WriteRequestMeta {
  activityId: string;
  activityVersion: number;
  attemptId: string;
  draftVersion: number;
  userText: string;
}

export interface PrepareActivityRunInput extends WriteRequestMeta {
  activityId: string;
  activityVersion: number;
  attemptId: string;
  draftVersion: number;
  mode: "preview";
}

export interface PublicExecutionFile {
  name: string;
  content: string;
  hash: string;
}

export interface PreparedActivityOutput extends FacadeResponseMeta {
  requestId: string;
  runId: string;
  mode: "preview";
  environmentId: string;
  starterCodeHash: string;
  publicDatasetFiles: PublicExecutionFile[];
  publicTestSources: string[];
  expiresAt: IsoDateTime;
  bundleHash: string;
}

export interface SubmitActivityInput extends WriteRequestMeta {
  activityId: string;
  activityVersion: number;
  attemptId: string;
  draftVersion: number;
  userText: string;
}

export interface ActivitySubmissionOutput extends FacadeResponseMeta {
  requestId: string;
  attemptId: string;
  committed: boolean;
  result: ActivityResult;
  evidenceId?: string;
  evidenceVersion?: number;
}

export interface GetActivityAttemptInput extends ReadRequestMeta {
  activityId: string;
  attemptId: string;
}

export interface ActivityAttemptSafeView extends FacadeResponseMeta {
  activityId: string;
  attemptId: string;
  status: "draft" | "submitted" | "evaluator_error";
  result?: ActivityResult;
  codeHash?: string;
  committedAt?: IsoDateTime;
}

export interface RecoverActivityInput extends ReadRequestMeta {
  activityId: string;
  attemptId: string;
}

export interface ActivityRecoveryOutput extends FacadeResponseMeta {
  attempt: ActivityAttemptSafeView;
  draftVersion?: number;
  userText?: string;
  recoveryAction: "resume_draft" | "show_submitted" | "retry_after_evaluator_error";
}

export interface ContextQuestionInput extends WriteRequestMeta {
  pathVersion: number;
  nodeId: string;
  activityId?: string;
  question: string;
}

export interface ContextAnswerOutput extends FacadeResponseMeta {
  requestId: string;
  answer: string;
  sourceAnchorIds: string[];
  softEvidenceId?: string;
}
