import type { Evidence, KnowledgeState, LearnerDiagnostic, LearningRuntimeErrorCode } from "../domain/v2-types.js";
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
}

export interface CommittedSessionSnapshot extends SessionSnapshot {
  committed: true;
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
