import type { ActivityResult } from "../domain/v2-types.js";
import type {
  CodeEvaluationPort,
  EvaluationActivityProjection,
  EvaluationEnvironmentProjection,
  PreparedEvaluation,
} from "../infrastructure/code-evaluation-port.js";
import type {
  ActivityRepository,
  ActivityResultRecord,
  EvaluationFailureRecord,
  FormalActivityCommitInput,
  PrepareActivityRunInput,
  PreparedActivityRun,
  RecordActivityResultInput,
  DerivedFormalActivityCommitInput,
} from "../repositories/activity-repository.js";
import { LearningSessionUnitOfWork } from "../repositories/activity-repository.js";
import type { LearningSessionRepository } from "../repositories/learning-session-repository.js";
import type { ActivitySubmissionOutput } from "./learning-runtime-facade.js";
import type { RuntimeCommitContext } from "./runtime-commit-context.js";
import { EvaluationPreparationError, EvaluationRunError } from "../infrastructure/code-evaluation-port.js";

export interface ActivityRunPreparationInput extends PrepareActivityRunInput {
  activity: EvaluationActivityProjection;
  taskVersion: string;
  environment: EvaluationEnvironmentProjection;
  assetBundleHash: string;
}

export interface PreparedFormalActivityRun extends PreparedActivityRun {
  prepared: PreparedEvaluation;
}

export interface ActivitySubmissionInput extends RecordActivityResultInput {
  prepared: PreparedEvaluation;
}

export interface FormalActivitySubmissionInput extends Omit<ActivitySubmissionInput, "result"> {
  sessionRepository: LearningSessionRepository;
  knowledgeStates: FormalActivityCommitInput["knowledgeStates"];
  pathCandidate?: FormalActivityCommitInput["pathCandidate"];
  nextStage?: FormalActivityCommitInput["nextStage"];
}

/** Application boundary between C's public evaluator port and A's repository. */
export class ActivityRuntimeService {
  constructor(private readonly repository: ActivityRepository, private readonly evaluator: CodeEvaluationPort) {}

  async prepareActivityRun(input: ActivityRunPreparationInput): Promise<PreparedFormalActivityRun> {
    const prepared = await this.evaluator.prepare({
      activity: input.activity,
      profileRevision: input.profileRevision,
      taskVersion: input.taskVersion,
      mode: input.mode,
      environment: input.environment,
      assetBundleHash: input.assetBundleHash,
    });
    const run = await this.repository.prepareRun(input);
    return { ...run, prepared };
  }

  async submitActivity(input: ActivitySubmissionInput, signal: AbortSignal): Promise<Awaited<ReturnType<ActivityRepository["recordResult"]>>> {
    const result = await this.runEvaluation(input, signal);
    return this.repository.recordResult(toActivityResultInput(input, result));
  }

  /** Runs C's public result through A's formal session transaction and returns only the facade DTO. */
  async submitFormalActivity(input: FormalActivitySubmissionInput, signal: AbortSignal): Promise<ActivitySubmissionOutput> {
    const result = await this.runEvaluation(input, signal);
    const activity = toActivityResultInput(input, result);
    const unit = new LearningSessionUnitOfWork(this.repository, input.sessionRepository);
    const committed = await unit.commit({
      repository: this.repository,
      sessionRepository: input.sessionRepository,
      activity,
      knowledgeStates: input.knowledgeStates,
      pathCandidate: input.pathCandidate,
      nextStage: input.nextStage,
    });
    if (isEvaluationFailure(committed)) {
      return {
        kind: "code",
        requestId: input.requestId,
        attemptId: input.attemptId,
        committed: false,
        result,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        errorCode: committed.errorCode,
      };
    }
    if (isActivityResultRecord(committed)) {
      return {
        kind: "code",
        requestId: input.requestId,
        attemptId: input.attemptId,
        committed: false,
        result,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        errorCode: result.errorCode,
      };
    }
    const evidence = committed.evidence.find((item) => item.attemptId === input.attemptId);
    return {
      kind: "code",
      requestId: input.requestId,
      attemptId: input.attemptId,
      committed: true,
      result,
      sessionId: committed.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: committed.profileRevision,
      ...(evidence?.evidenceId === undefined ? {} : { evidenceId: evidence.evidenceId }),
      ...(evidence?.evidenceVersion === undefined ? {} : { evidenceVersion: evidence.evidenceVersion }),
    };
  }

  /** Same formal transaction, with all session facts derived after C returns its result. */
  async submitDerivedFormalActivity(
    input: Omit<ActivitySubmissionInput, "result"> & {
      sessionRepository: LearningSessionRepository;
      deriveCandidate: DerivedFormalActivityCommitInput["deriveCandidate"];
    },
    signal: AbortSignal,
  ): Promise<ActivitySubmissionOutput> {
    return (await this.submitDerivedFormalActivityWithContext(input, signal)).output;
  }

  async submitDerivedFormalActivityWithContext(
    input: Omit<ActivitySubmissionInput, "result"> & {
      sessionRepository: LearningSessionRepository;
      deriveCandidate: DerivedFormalActivityCommitInput["deriveCandidate"];
    },
    signal: AbortSignal,
  ): Promise<RuntimeCommitContext<ActivitySubmissionOutput>> {
    const result = await this.runEvaluation(input, signal);
    const activity = toActivityResultInput(input, result);
    const unit = new LearningSessionUnitOfWork(this.repository, input.sessionRepository);
    const committed = await unit.commitDerived({
      repository: this.repository,
      sessionRepository: input.sessionRepository,
      activity,
      deriveCandidate: input.deriveCandidate,
    });
    if (isEvaluationFailure(committed) || isActivityResultRecord(committed)) {
      return { replayed: false, output: {
        kind: "code",
        requestId: input.requestId,
        attemptId: input.attemptId,
        committed: false,
        result,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        ...(isEvaluationFailure(committed) ? { errorCode: committed.errorCode } : result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
      } };
    }
    const evidence = committed.evidence.find((item) => item.attemptId === input.attemptId);
    return { replayed: committed.replayed, snapshot: committed, output: {
      kind: "code",
      requestId: input.requestId,
      attemptId: input.attemptId,
      committed: true,
      result,
      sessionId: committed.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: committed.profileRevision,
      ...(evidence?.evidenceId === undefined ? {} : { evidenceId: evidence.evidenceId }),
      ...(evidence?.evidenceVersion === undefined ? {} : { evidenceVersion: evidence.evidenceVersion }),
    } };
  }

  private async runEvaluation(input: Pick<ActivitySubmissionInput, "requestId" | "attemptId" | "prepared" | "code">, signal: AbortSignal): Promise<ActivityResult> {
    try {
      return await this.evaluator.run({
        requestId: input.requestId,
        attemptId: input.attemptId,
        prepared: input.prepared,
        code: input.code,
      }, signal);
    } catch (error) {
      if (error instanceof EvaluationRunError) {
        return {
          executionStatus: "failed",
          verdict: "not_graded",
          errorKind: "evaluator",
          errorCode: error.errorCode,
          safeFeedback: "The evaluator rejected this idempotency binding; no learning fact was created.",
          evaluatorVersion: "unknown",
          environmentHash: input.prepared.environmentHash,
          assetBundleHash: input.prepared.assetBundleHash,
        };
      }
      throw error;
    }
  }

  /** Converts preparation failures into non-graded failure records. */
  async recordPreparationFailure(input: RecordActivityResultInput, error: unknown): Promise<Awaited<ReturnType<ActivityRepository["recordResult"]>>> {
    if (!(error instanceof EvaluationPreparationError)) throw error;
    const result: ActivityResult = {
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: error.errorCode,
      safeFeedback: "The formal evaluator could not be prepared; the draft remains available.",
      evaluatorVersion: "unknown",
      environmentHash: input.result.environmentHash,
      assetBundleHash: input.assignment.assetBundleHash,
    };
    return this.repository.recordResult({ ...input, result });
  }
}

function isEvaluationFailure(value: unknown): value is EvaluationFailureRecord {
  return typeof value === "object" && value !== null && "errorCode" in value && !("attempt" in value);
}

function isActivityResultRecord(value: unknown): value is ActivityResultRecord {
  return typeof value === "object" && value !== null && "attempt" in value && "result" in value;
}

function toActivityResultInput(
  input: Omit<ActivitySubmissionInput, "result"> | ActivitySubmissionInput,
  result: ActivityResult,
): RecordActivityResultInput {
  return {
    subjectId: input.subjectId,
    sessionId: input.sessionId,
    sessionVersion: input.sessionVersion,
    requestId: input.requestId,
    attemptId: input.attemptId,
    activityId: input.activityId,
    activityVersion: input.activityVersion,
    profileRevision: input.profileRevision,
    assignment: input.assignment,
    draftVersion: input.draftVersion,
    code: input.code,
    ...(input.highestAssistance === undefined ? {} : { highestAssistance: input.highestAssistance }),
    result,
    ...(input.now === undefined ? {} : { now: input.now }),
  };
}
