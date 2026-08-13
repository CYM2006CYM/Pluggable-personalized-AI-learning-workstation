import type { Evidence, KnowledgeState, LearnerDiagnostic, LearningRuntimeErrorCode } from "../domain/v2-types.js";
import type { LearningCardSafeView } from "../contracts/index.js";
import type { NodeActivityProgress } from "../contracts/index.js";
import type { BackgroundQuestionnaire } from "../contracts/index.js";
import type { CurrentAttemptSafeReference } from "../contracts/index.js";
import type { DiagnosticAnswerOutput } from "../contracts/facade.js";
import type { InternalPersistedPathSnapshot } from "./internal-path-session-port.js";
import type { QuizAttemptSnapshot } from "../domain/quiz-runtime.js";
import type {
  FacadeResponseMeta,
  LearningEntryMode,
  PathNodeSafeView,
  ReadRequestMeta,
  SessionSafeView,
  SessionStage,
  WriteRequestMeta,
} from "../application/learning-runtime-facade.js";

/** W1-C2 session archive port. It intentionally has no file implementation. */
export interface LearningSessionRepository {
  create(input: CreateLearningSessionRecord): Promise<SessionSafeView>;
  getSnapshot(input: GetSessionSnapshotInput): Promise<SessionSnapshot>;
  commit(input: CommitLearningSessionInput): Promise<CommittedSessionSnapshot>;
  recover(input: RecoverLearningSessionInput): Promise<RecoverySnapshot>;
}

/** Internal binding reader used by the runtime; it never accepts a client revision. */
export interface SessionBindingReader {
  getBoundSnapshot(sessionId: string): Promise<SessionSnapshot>;
}

/** Internal recovery probe that keeps a durable Activity Attempt paired with its session candidate. */
export interface RecoverableActivityCommitReader {
  hasRecoverableActivityCommit(input: { sessionId: string; requestId: string }): Promise<boolean>;
}

/** Internal diagnostic draft CAS. It never publishes a formal session checkpoint. */
export interface DiagnosticDraftSessionPort {
  saveDiagnosticDraftState(input: {
    requestId: string;
    sessionId: string;
    sessionVersion: number;
    profileRevision: number;
    diagnosticDraftVersion: number;
    draft: Record<string, unknown>;
    background?: unknown;
  }): Promise<{ diagnosticDraftVersion: number }>;
  saveDiagnosticAnswerState(input: {
    requestId: string;
    sessionId: string;
    sessionVersion: number;
    profileRevision: number;
    diagnosticDraftVersion: number;
    answer: StoredDiagnosticAnswerState;
  }): Promise<{ diagnosticDraftVersion: number; output: DiagnosticAnswerOutput }>;
}

export interface StoredDiagnosticAnswerState {
  questionId: string;
  requestId: string;
  status: "answered" | "skipped";
  submittedAnswer?: string | boolean;
  normalizedScore?: number;
  evidenceId?: string;
  evaluatorVersion?: string;
  createdAt: string;
  diagnosticId: string;
  diagnosticVersion: number;
  submissionHash: string;
  output: DiagnosticAnswerOutput;
  evidenceCandidate?: Evidence;
  draftVersionBefore: number;
}

/** Internal versioned quiz Attempt storage coupled to the session checkpoint. */
export interface QuizAttemptSessionPort {
  getQuizAttempt(input: ReadRequestMeta & { activityId: string; attemptId: string }): Promise<QuizAttemptSnapshot | undefined>;
}

export interface LearningSessionCatalogPort {
  listBoundSnapshots(): Promise<SessionSnapshot[]>;
}

export class LearningSessionRepositoryError extends Error {
  constructor(readonly errorCode: LearningRuntimeErrorCode, message: string) {
    super(message);
    this.name = "LearningSessionRepositoryError";
  }
}

export interface CreateLearningSessionRecord {
  requestId: string;
  subjectId: string;
  mode: LearningEntryMode;
  goalId: string;
  chapterId?: string;
  availableMinutes: number;
  profileRevision: number;
  diagnosticRequired: boolean;
}

export type GetSessionSnapshotInput = ReadRequestMeta;

export interface SessionSnapshot extends FacadeResponseMeta {
  view: SessionSafeView;
  evidence: Evidence[];
  knowledgeStates: KnowledgeState[];
  latestDiagnostic?: LearnerDiagnostic;
  path?: PathSafeSnapshot;
  latestCommit: LatestCommitMarker;
  activityProgress: NodeActivityProgress[];
  diagnosticDraftVersion: number;
  diagnosticDraft?: { diagnosticDraftVersion: number; background?: BackgroundQuestionnaire; currentQuestionId?: string; processedQuestionIds: string[] };
  currentAttempt?: CurrentAttemptSafeReference;
}

export interface BoundLearningCardSnapshot {
  nodeId: string;
  source: "dynamic" | "fixed";
  card: LearningCardSafeView;
}

export interface CommitLearningSessionInput extends WriteRequestMeta {
  candidate: SessionCommitCandidate;
}

export interface SessionCommitCandidate {
  requestId: string;
  evidenceCandidate?: Evidence;
  evidenceCandidates?: Evidence[];
  knowledgeStates: KnowledgeState[];
  diagnosticCandidate?: LearnerDiagnostic;
  pathCandidate?: PathSafeSnapshot;
  activityAttemptId?: string;
  nextStage?: SessionStage;
  activityProgress?: NodeActivityProgress[];
  boundLearningCards?: BoundLearningCardSnapshot[];
  diagnosticDraftVersion?: number;
  currentAttempt?: CurrentAttemptSafeReference | null;
  quizAttemptCandidate?: QuizAttemptSnapshot;
  /** Internal A-derived path suffix; never part of a public request DTO. */
  internalPathCandidate?: InternalPersistedPathSnapshot;
}

export interface CommittedSessionSnapshot extends SessionSnapshot {
  committed: true;
  /** Internal transaction fact; never projected into a public DTO. */
  replayed: boolean;
  committedEvidenceId?: string;
  committedEvidenceIds?: string[];
  committedDiagnosticId?: string;
}

export type RecoverLearningSessionInput = WriteRequestMeta;

export interface RecoverySnapshot extends SessionSnapshot {
  recoveryAction: "none" | "completed_candidate_commit" | "isolated_incomplete_candidate" | "rebuilt_derived_state";
}

export interface PathSafeSnapshot {
  pathId: string;
  pathVersion: number;
  status: "candidate" | "confirmed" | "active" | "superseded" | "completed";
  goalId: string;
  mode: LearningEntryMode;
  nodes: PathNodeSafeView[];
}

export interface LatestCommitMarker {
  evidenceVersion: number;
  sessionVersion: number;
  pathVersion?: number;
  requestId?: string;
}
