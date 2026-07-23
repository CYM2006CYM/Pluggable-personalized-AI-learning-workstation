import type { Evidence, KnowledgeState } from "../domain/v2-types.js";
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
  path?: PathSafeSnapshot;
  latestCommit: LatestCommitMarker;
}

export interface CommitLearningSessionInput extends WriteRequestMeta {
  candidate: SessionCommitCandidate;
}

export interface SessionCommitCandidate {
  requestId: string;
  evidenceCandidate?: Evidence;
  knowledgeStates: KnowledgeState[];
  pathCandidate?: PathSafeSnapshot;
  activityAttemptId?: string;
  nextStage?: SessionStage;
}

export interface CommittedSessionSnapshot extends SessionSnapshot {
  committed: true;
  committedEvidenceId?: string;
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
