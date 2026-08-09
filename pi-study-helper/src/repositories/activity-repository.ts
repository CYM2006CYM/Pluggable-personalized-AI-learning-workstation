import type { ActivityResult, Evidence, EvidenceForm, EvidenceIndependence, EvidenceOutcome, EvidenceSource } from "../domain/v2-types.js";
import type { CommittedSessionSnapshot, CommitLearningSessionInput, LearningSessionRepository, RecoverableActivityCommitReader, RecoverySnapshot } from "./learning-session-repository.js";

export type ActivityTaskSource = "fixed" | "ai_generated" | "fallback";
export type AssistanceLevel = "independent" | "hinted" | "worked_example" | "answer_exposed";

export interface ActivityAssignment {
  assignmentId: string;
  activityId: string;
  activityVersion: number;
  profileRevision: number;
  primaryKnowledgePointId: string;
  kind: "code_completion" | "coding_practical" | "debug";
  source: ActivityTaskSource;
  assetBundleHash: string;
  environmentId: string;
}

export interface HintEvent {
  hintId: string;
  level: Exclude<AssistanceLevel, "independent">;
  occurredAt: string;
}

export interface ActivityDraft {
  sessionId: string;
  activityId: string;
  activityVersion: number;
  profileRevision: number;
  attemptId: string;
  draftVersion: number;
  code: string;
  codeHash: string;
  hintEvents: HintEvent[];
  updatedAt: string;
}

export interface OpenActivityInput {
  subjectId: string;
  sessionId: string;
  requestId: string;
  assignment: ActivityAssignment;
  attemptId?: string;
  now?: string;
}

export interface SaveActivityDraftInput {
  subjectId: string;
  sessionId: string;
  requestId: string;
  activityId: string;
  attemptId: string;
  activityVersion: number;
  profileRevision: number;
  draftVersion: number;
  code: string;
  hintEvents?: readonly HintEvent[];
  now?: string;
}

export interface PrepareActivityRunInput {
  subjectId: string;
  sessionId: string;
  requestId: string;
  activityId: string;
  attemptId: string;
  activityVersion: number;
  profileRevision: number;
  draftVersion: number;
  mode: "preview" | "submit";
  now?: string;
}

export interface PreparedActivityRun {
  runId: string;
  sessionId: string;
  activityId: string;
  attemptId: string;
  draftVersion: number;
  mode: "preview" | "submit";
  codeHash: string;
  createdAt: string;
}

export interface RecordActivityResultInput {
  subjectId: string;
  sessionId: string;
  sessionVersion: number;
  requestId: string;
  attemptId: string;
  activityId: string;
  activityVersion: number;
  profileRevision: number;
  assignment: ActivityAssignment;
  draftVersion: number;
  code: string;
  highestAssistance?: AssistanceLevel;
  result: ActivityResult;
  now?: string;
}

export interface ActivityAttemptCandidate {
  attemptId: string;
  requestId: string;
  sessionId: string;
  activityId: string;
  activityVersion: number;
  assignmentId: string;
  primaryKnowledgePointId: string;
  kind: ActivityAssignment["kind"];
  profileRevision: number;
  source: ActivityTaskSource;
  assetBundleHash: string;
  submissionRef: string;
  codeHash: string;
  highestAssistance: AssistanceLevel;
  resultRef: string;
  attemptStatus: "completed";
  createdAt: string;
  committedAt?: string;
}

export interface EvaluationFailureRecord {
  requestId: string;
  attemptId: string;
  sessionId: string;
  activityId: string;
  assignmentId: string;
  errorCode: NonNullable<ActivityResult["errorCode"]>;
  stage: "prepare" | "user_code" | "public_tests" | "hidden_tests" | "rubric" | "commit";
  environmentHash: string;
  createdAt: string;
}

export interface ActivityResultRecord {
  attempt: ActivityAttemptCandidate;
  result: ActivityResult;
}

export interface ActivityRepository {
  openActivity(input: OpenActivityInput): Promise<ActivityDraft>;
  saveDraft(input: SaveActivityDraftInput): Promise<ActivityDraft>;
  prepareRun(input: PrepareActivityRunInput): Promise<PreparedActivityRun>;
  recordResult(input: RecordActivityResultInput): Promise<ActivityResultRecord | EvaluationFailureRecord>;
  getAttempt(input: { subjectId: string; sessionId: string; activityId: string; attemptId: string }): Promise<ActivityResultRecord | undefined>;
  markCommitted(input: { subjectId: string; sessionId: string; activityId: string; attemptId: string; committedAt?: string }): Promise<ActivityAttemptCandidate>;
  discardAttempt(input: { subjectId: string; sessionId: string; activityId: string; attemptId: string }): Promise<void>;
  recover(input: { subjectId: string; sessionId: string }): Promise<ActivityRecoveryReport>;
}

export interface ActivityRecoveryReport {
  publishedCandidates: string[];
  quarantinedCandidates: string[];
  removedOrphanResults: string[];
}

export class ActivityRepositoryError extends Error {
  constructor(readonly errorCode: "activity_not_found" | "activity_version_conflict" | "attempt_not_found" | "draft_version_conflict" | "idempotency_conflict" | "submission_contract_error" | "environment_mismatch" | "storage_error", message: string) {
    super(message);
    this.name = "ActivityRepositoryError";
  }
}

export interface FormalActivityCommitInput {
  repository: ActivityRepository;
  sessionRepository: LearningSessionRepository;
  activity: RecordActivityResultInput;
  knowledgeStates: CommitLearningSessionInput["candidate"]["knowledgeStates"];
  pathCandidate?: CommitLearningSessionInput["candidate"]["pathCandidate"];
  nextStage?: CommitLearningSessionInput["candidate"]["nextStage"];
}

export async function commitFormalActivity(input: FormalActivityCommitInput): Promise<CommittedSessionSnapshot | EvaluationFailureRecord | ActivityResultRecord> {
  return new LearningSessionUnitOfWork(input.repository, input.sessionRepository).commit(input);
}

export interface RecoverFormalActivityInput {
  subjectId: string;
  sessionId: string;
  sessionVersion: number;
  profileRevision: number;
  requestId: string;
  activityId: string;
  attemptId: string;
}

/** Coordinates A's candidate with the single formal session fact source. */
export class LearningSessionUnitOfWork {
  constructor(private readonly activityRepository: ActivityRepository, private readonly sessionRepository: LearningSessionRepository) {}

  async commit(input: FormalActivityCommitInput): Promise<CommittedSessionSnapshot | EvaluationFailureRecord | ActivityResultRecord> {
    const recorded = await this.activityRepository.recordResult(input.activity);
    if ("errorCode" in recorded && !("attempt" in recorded)) return recorded;
    const resultRecord = recorded as ActivityResultRecord;
    const evidence = activityResultToEvidence(resultRecord.attempt, resultRecord.result);
    if (!evidence || evidence.impact === "none") return resultRecord;
    let committed: CommittedSessionSnapshot;
    try {
      committed = await this.sessionRepository.commit({
        requestId: input.activity.requestId,
        sessionId: input.activity.sessionId,
        sessionVersion: input.activity.sessionVersion,
        profileRevision: input.activity.profileRevision,
        candidate: {
          requestId: input.activity.requestId,
          evidenceCandidate: evidence,
          knowledgeStates: input.knowledgeStates,
          pathCandidate: input.pathCandidate,
          activityAttemptId: input.activity.attemptId,
          nextStage: input.nextStage,
        },
      });
    } catch (error) {
      const recoverable = await this.hasRecoverableCandidate(input.activity.sessionId, input.activity.requestId);
      if (!recoverable) await this.activityRepository.discardAttempt({
          subjectId: input.activity.subjectId,
          sessionId: input.activity.sessionId,
          activityId: input.activity.activityId,
          attemptId: input.activity.attemptId,
        }).catch(() => undefined);
      throw error;
    }
    await this.activityRepository.markCommitted({
      subjectId: input.activity.subjectId,
      sessionId: input.activity.sessionId,
      activityId: input.activity.activityId,
      attemptId: input.activity.attemptId,
    });
    return committed;
  }

  async recover(input: RecoverFormalActivityInput): Promise<RecoverySnapshot> {
    let recovered: RecoverySnapshot | undefined;
    try {
      recovered = await this.sessionRepository.recover({
        requestId: input.requestId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
      });
      const committedAttempt = recovered.evidence.some((item) => item.attemptId === input.attemptId);
      if (committedAttempt) {
        await this.activityRepository.markCommitted({
          subjectId: input.subjectId,
          sessionId: input.sessionId,
          activityId: input.activityId,
          attemptId: input.attemptId,
        });
      }
      return recovered;
    } catch (error) {
      // recover() may already have published the session facts before the
      // cross-repository markCommitted callback fails. In that state the
      // Attempt is the durable retry handle and must not be deleted.
      const sessionFactPublished = recovered?.evidence.some((item) => item.attemptId === input.attemptId) ?? false;
      const recoverable = await this.hasRecoverableCandidate(input.sessionId, input.requestId);
      if (!sessionFactPublished && !recoverable) await this.activityRepository.discardAttempt({
          subjectId: input.subjectId,
          sessionId: input.sessionId,
          activityId: input.activityId,
          attemptId: input.attemptId,
        }).catch(() => undefined);
      throw error;
    }
  }

  private async hasRecoverableCandidate(sessionId: string, requestId: string): Promise<boolean> {
    const reader = this.sessionRepository as LearningSessionRepository & Partial<RecoverableActivityCommitReader>;
    if (typeof reader.hasRecoverableActivityCommit !== "function") return false;
    return reader.hasRecoverableActivityCommit({ sessionId, requestId }).catch(() => false);
  }
}

export function activityResultToEvidence(attempt: ActivityAttemptCandidate, result: ActivityResult): Evidence | undefined {
  if (result.errorKind === "evaluator" || result.verdict === "not_graded" || result.executionStatus !== "completed") return undefined;
  if (result.score === undefined || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
    throw new ActivityRepositoryError("submission_contract_error", "A graded ActivityResult must carry a score in 0..1");
  }
  const outcome: EvidenceOutcome = result.verdict === "pass" ? "correct" : result.verdict === "partial" ? "partial" : "incorrect";
  const source: EvidenceSource = attempt.kind === "coding_practical" ? "practical_rubric" : "code_submit";
  const form: EvidenceForm = attempt.kind === "coding_practical" ? "practical_rubric" : "code_execution";
  const independence: EvidenceIndependence = attempt.highestAssistance;
  return {
    evidenceId: `evidence-${attempt.attemptId}`,
    requestId: attempt.requestId,
    sessionId: attempt.sessionId,
    knowledgePointId: attempt.primaryKnowledgePointId,
    profileRevision: attempt.profileRevision,
    kind: attempt.kind,
    source,
    form,
    impact: independence === "answer_exposed" ? "none" : "mastery",
    outcome,
    score: result.score,
    independence,
    activityId: attempt.activityId,
    attemptId: attempt.attemptId,
    evaluatorVersion: result.evaluatorVersion,
    createdAt: attempt.createdAt,
  };
}
