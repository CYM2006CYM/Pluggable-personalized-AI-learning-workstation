import type {
  ActivityResult,
  Difficulty,
  KnowledgeState,
  LearningRuntimeErrorCode,
  ScaffoldLevel,
} from "./domain.js";

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
  continueActivityWithGap(input: import("./index.js").ContinueActivityWithGapInput): Promise<import("./index.js").ContinueActivityWithGapOutput>;
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

export interface SessionRecoverySafeView extends FacadeResponseMeta {
  view: SessionSafeView;
  diagnosticDraftVersion: number;
  diagnosticDraft?: import("./index.js").DiagnosticDraftSafeView;
  activityProgress: import("./index.js").NodeActivityProgress[];
  currentAttempt?: import("./index.js").CurrentAttemptSafeReference;
  evidenceVersion?: number;
  knowledgeStates?: KnowledgeState[];
  learningCards?: Array<{ nodeId: string; card: import("./index.js").LearningCardSafeView }>;
  path?: {
    pathId: string;
    pathVersion: number;
    status: "candidate" | "confirmed" | "active" | "superseded" | "completed";
    nodes: PathNodeSafeView[];
  };
}

export type CompleteSessionInput = WriteRequestMeta;

export interface CompleteSessionOutput extends FacadeResponseMeta {
  requestId: string;
  completedAt?: IsoDateTime;
  summary: string;
  nextRecommendation?: string;
}

export interface SaveDiagnosticDraftInput extends WriteRequestMeta {
  diagnosticId: string;
  diagnosticVersion: number;
  currentQuestionId?: string;
  background: import("./index.js").BackgroundQuestionnaire;
  diagnosticDraftVersion: number;
}

export interface DiagnosticDraftOutput extends FacadeResponseMeta {
  requestId: string;
  diagnosticId: string;
  diagnosticVersion: number;
  currentQuestionId?: string;
  savedAt: IsoDateTime;
  diagnosticDraftVersion: number;
}

interface SubmitDiagnosticAnswerBase extends WriteRequestMeta {
  diagnosticId: string;
  diagnosticVersion: number;
  questionId: string;
  diagnosticDraftVersion: number;
}

export type SubmitDiagnosticAnswerInput =
  | (SubmitDiagnosticAnswerBase & {
      action: "answer";
      answer: string | boolean;
    })
  | (SubmitDiagnosticAnswerBase & {
      action: "skip";
      answer?: never;
    });

export interface DiagnosticAnswerOutput extends FacadeResponseMeta {
  requestId: string;
  diagnosticId: string;
  questionId: string;
  result: "pass" | "fail" | "skipped";
  evidenceId?: string;
  diagnosticDraftVersion: number;
}

export type CompleteDiagnosticInput =
  | (WriteRequestMeta & {
      mode: "fixed";
      diagnosticId: string;
      diagnosticVersion: number;
      diagnosticDraftVersion: number;
    })
  | (WriteRequestMeta & {
      mode: "background_only";
      background: import("./index.js").BackgroundQuestionnaire;
      diagnosticDraftVersion: number;
    });

export interface DiagnosticCompleteOutput extends FacadeResponseMeta {
  requestId: string;
  diagnosticId?: string;
  mode?: "fixed" | "background_only";
  evidenceVersion: number;
  knowledgeStates: KnowledgeState[];
  capabilityProfileRevision?: number;
  insufficientKnowledgePointIds: string[];
  diagnosticDraftVersion: number;
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
  difficulty: Difficulty;
  scaffold: ScaffoldLevel;
  required: boolean;
  positionLocked: boolean;
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
  card?: import("./index.js").LearningCardSafeView;
  sourceAnchorIds?: string[];
  contentReadiness?: "ready" | "fallback" | "preparing";
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
  changeReasons: string[];
}

export interface ActivitySafeViewBase {
  activityId: string;
  activityVersion: number;
  kind: ActivityKind;
  title: string;
  prompt: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
}

export interface CodeProblemStatementSafeView {
  background: string;
  inputDescription: string;
  outputDescription: string;
  rules: string[];
  prohibitedActions: string[];
  sample: {
    inputFileName: string;
    inputCsv: string;
    outputFileName: string;
    outputCsv: string;
    explanation: string;
  };
}

export interface CodeActivitySafeView extends ActivitySafeViewBase {
  kind: "code_completion" | "coding_practical" | "explain" | "debug";
  starterCode?: string;
  entryPoint?: string;
  outputContract?: string;
  editableRegions?: Array<{
    regionId: string;
    startMarker: string;
    endMarker: string;
    maxCharacters: number;
  }>;
  allowedLibraries?: string[];
  publicTestIds?: string[];
  publicAcceptanceCriteria?: string[];
  problemStatement?: CodeProblemStatementSafeView;
}

/** Revision 2 keeps its single-question projection unchanged. */
export interface LegacySingleQuestionActivitySafeView extends ActivitySafeViewBase {
  kind: "mcq";
  subtype?: "single_choice" | "judgment";
  options?: string[];
}

export type ActivitySafeView = CodeActivitySafeView | LegacySingleQuestionActivitySafeView | import("./index.js").QuizActivitySafeView;

export interface OpenActivityInput extends WriteRequestMeta {
  activityId: string;
  activityVersion: number;
  pathVersion: number;
  acknowledgedCardId?: string;
}

export interface CodeActivityDraftOutput extends FacadeResponseMeta {
  kind: "code";
  requestId: string;
  attemptId: string;
  draftVersion: number;
  activity: CodeActivitySafeView;
  userText: string;
}

export interface QuizActivityDraftOutput extends FacadeResponseMeta {
  kind: "quiz";
  requestId: string;
  attemptId: string;
  activity: import("./index.js").QuizActivitySafeView;
}

export type ActivityDraftOutput = CodeActivityDraftOutput | QuizActivityDraftOutput;

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

export interface PublicExecutionBundle {
  runId: string;
  sessionId: string;
  activityId: string;
  profileRevision: number;
  environmentId: string;
  starterCodeHash: string;
  publicDatasetFiles: PublicExecutionFile[];
  publicTestSources: string[];
  expiresAt: IsoDateTime;
  bundleHash: string;
}

export interface BrowserCodeRunner {
  run(bundle: PublicExecutionBundle, code: string, signal: AbortSignal): Promise<ActivityResult>;
}

export interface PreparedActivityOutput extends FacadeResponseMeta, PublicExecutionBundle {
  requestId: string;
  mode: "preview";
}

export interface CodeSubmitActivityInput extends WriteRequestMeta {
  kind: "code";
  activityId: string;
  activityVersion: number;
  attemptId: string;
  draftVersion: number;
  userText: string;
}


export type SubmitActivityInput = CodeSubmitActivityInput | import("./index.js").QuizSubmitActivityInput;

interface ActivitySubmissionOutputBase extends FacadeResponseMeta {
  requestId: string;
  attemptId: string;
  committed: boolean;
  evidenceId?: string;
  evidenceVersion?: number;
}

export interface CodeActivitySubmissionOutput extends ActivitySubmissionOutputBase {
  kind: "code";
  result: ActivityResult;
}

export interface QuizActivitySubmissionOutput extends ActivitySubmissionOutputBase {
  kind: "quiz";
  result: import("./index.js").QuizActivityResult;
}

export type ActivitySubmissionOutput = CodeActivitySubmissionOutput | QuizActivitySubmissionOutput;

export interface GetActivityAttemptInput extends ReadRequestMeta {
  activityId: string;
  attemptId: string;
}

interface ActivityAttemptSafeViewBase extends FacadeResponseMeta {
  activityId: string;
  attemptId: string;
  status: "draft" | "submitted" | "evaluator_error";
  evidenceId?: string;
  evidenceVersion?: number;
}

export interface CodeActivityAttemptSafeView extends ActivityAttemptSafeViewBase {
  kind: "code";
  draftVersion: number;
  result?: ActivityResult;
  codeHash?: string;
  committedAt?: IsoDateTime;
}

export interface QuizActivityAttemptSafeView extends ActivityAttemptSafeViewBase {
  kind: "quiz";
  retryNumber: number;
  result?: import("./index.js").QuizActivityResult;
}

export type ActivityAttemptSafeView = CodeActivityAttemptSafeView | QuizActivityAttemptSafeView;

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
