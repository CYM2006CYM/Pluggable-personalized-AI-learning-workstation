import { createHash } from "node:crypto";
import { basename } from "node:path";
import type {
  ActivityAttemptSafeView,
  ActivityDraftOutput,
  ActivityRecoveryOutput,
  ActivitySubmissionOutput,
  CodeActivitySafeView,
  GetActivityAttemptInput,
  OpenActivityInput,
  PrepareActivityRunInput,
  PreparedActivityOutput,
  RecoverActivityInput,
  SaveActivityDraftInput,
  CodeSubmitActivityInput,
} from "../contracts/facade.js";
import type { ContinueActivityWithGapInput, ContinueActivityWithGapOutput } from "../contracts/index.js";
import { calculateKnowledgeStates } from "../domain/knowledge-state.js";
import type { KnowledgePointDefinition } from "../domain/v2-types.js";
import type { EvaluationActivityProjection, EvaluationEnvironmentProjection } from "../infrastructure/code-evaluation-port.js";
import type {
  ActivityAssignment,
  ActivityDraftRecoveryReader,
  ActivityRepository,
} from "../repositories/activity-repository.js";
import { ActivityRepositoryError, LearningSessionUnitOfWork } from "../repositories/activity-repository.js";
import type {
  LearningSessionRepository,
  SessionBindingReader,
  SessionSnapshot,
} from "../repositories/learning-session-repository.js";
import { LearningSessionRepositoryError } from "../repositories/learning-session-repository.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import { ActivityRuntimeService } from "./activity-runtime-service.js";
import type { ActivityPathSuffixReplanner } from "./activity-path-suffix.js";
import { toPathSafeSnapshot } from "../repositories/internal-path-session-port.js";
import type { RuntimeCommitContext } from "./runtime-commit-context.js";
import { projectPublicExecutionBundle, sha256Text } from "./public-execution-bundle.js";

type CodeActivityKind = "code_completion" | "coding_practical" | "debug";

export interface CodeActivityAssets {
  activity: CodeActivitySafeView & {
    kind: CodeActivityKind;
    templateVersion: string;
    environmentRef: string;
  };
  knowledgePoint: Pick<KnowledgePointDefinition, "id" | "requiresCodeEvidence">;
  knowledgePoints?: Array<Pick<KnowledgePointDefinition, "id" | "requiresCodeEvidence">>;
  assignment: Omit<ActivityAssignment, "assignmentId">;
  evaluationActivity: EvaluationActivityProjection;
  taskVersion: string;
  environment: EvaluationEnvironmentProjection;
  assetBundleHash: string;
  publicDatasetFiles: PreparedActivityOutput["publicDatasetFiles"];
  publicTestSources: string[];
}

export interface CodeActivityAssetResolver {
  load(subjectId: string, profileRevision: number, activityId: string): Promise<CodeActivityAssets>;
}

interface CodeActivityFacadeAdapterOptions {
  sessions: LearningSessionRepository & SessionBindingReader;
  activities: ActivityRepository & ActivityDraftRecoveryReader;
  runtime: ActivityRuntimeService;
  assets: CodeActivityAssetResolver;
  pathSuffix: ActivityPathSuffixReplanner;
  now?: () => Date;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function assertSession(snapshot: SessionSnapshot, input: { sessionVersion: number; profileRevision: number }): void {
  if (snapshot.profileRevision !== input.profileRevision) throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
  if (snapshot.sessionVersion !== input.sessionVersion) throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
}

function terminal(status: string): boolean {
  return status === "completed" || status === "insufficient";
}

function assignmentId(input: { sessionId: string; activityId: string; profileRevision: number }): string {
  return `assignment-${sha256(`${input.sessionId}:${input.activityId}:${input.profileRevision}`).slice(0, 24)}`;
}

function attemptId(input: { sessionId: string; activityId: string; requestId: string }): string {
  return `attempt-${sha256(`${input.sessionId}:${input.activityId}:${input.requestId}`).slice(0, 24)}`;
}

function safeActivity(activity: CodeActivityAssets["activity"]): CodeActivitySafeView {
  return {
    activityId: activity.activityId,
    activityVersion: activity.activityVersion,
    kind: activity.kind,
    title: activity.title,
    prompt: activity.prompt,
    primaryKnowledgePointId: activity.primaryKnowledgePointId,
    supportingKnowledgePointIds: [...activity.supportingKnowledgePointIds],
    ...(activity.starterCode === undefined ? {} : { starterCode: activity.starterCode }),
    ...(activity.entryPoint === undefined ? {} : { entryPoint: activity.entryPoint }),
    ...(activity.outputContract === undefined ? {} : { outputContract: activity.outputContract }),
    ...(activity.editableRegions === undefined ? {} : { editableRegions: activity.editableRegions.map((region) => ({
      regionId: region.regionId,
      startMarker: region.startMarker,
      endMarker: region.endMarker,
      maxCharacters: region.maxCharacters,
    })) }),
    ...(activity.allowedLibraries === undefined ? {} : { allowedLibraries: [...activity.allowedLibraries] }),
    ...(activity.publicTestIds === undefined ? {} : { publicTestIds: [...activity.publicTestIds] }),
    ...(activity.publicAcceptanceCriteria === undefined ? {} : { publicAcceptanceCriteria: [...activity.publicAcceptanceCriteria] }),
    ...(activity.problemStatement === undefined ? {} : { problemStatement: structuredClone(activity.problemStatement) }),
  };
}

/** Bridges the W3 code evaluator/repository into A's six public Activity methods. */
export class CodeActivityFacadeAdapter {
  private readonly now: () => Date;

  constructor(private readonly options: CodeActivityFacadeAdapterOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async openActivity(input: OpenActivityInput): Promise<ActivityDraftOutput> {
    const bound = await this.options.sessions.getBoundSnapshot(input.sessionId);
    const replayAttemptId = attemptId(input);
    if (bound.sessionVersion !== input.sessionVersion
        && bound.currentAttempt?.kind === "code"
        && bound.currentAttempt.activityId === input.activityId
        && bound.currentAttempt.attemptId === replayAttemptId) {
      const replayNode = bound.path?.nodes.find((item) => item.activityIds.includes(input.activityId));
      const replayProgress = bound.activityProgress.find((item) => item.nodeId === replayNode?.nodeId);
      if (replayProgress?.card !== undefined && input.acknowledgedCardId !== replayProgress.card.cardId) {
        throw new LearningSessionRepositoryError("idempotency_conflict", "Repeated open request changed its card acknowledgement");
      }
      const replayAssets = await this.options.assets.load(bound.view.subjectId, input.profileRevision, input.activityId);
      const existing = await this.options.activities.getDraft({ subjectId: bound.view.subjectId, sessionId: input.sessionId, activityId: input.activityId, attemptId: replayAttemptId });
      if (existing === undefined) throw new ActivityRepositoryError("attempt_not_found", "Current Activity draft is missing");
      return this.draftOutput(input.requestId, bound, existing.attemptId, existing.draftVersion, safeActivity(replayAssets.activity), existing.code);
    }
    const snapshot = bound;
    assertSession(snapshot, input);
    if (snapshot.path?.pathVersion !== input.pathVersion) throw new LearningSessionRepositoryError("path_version_conflict", "Activity is not on the active path");
    const node = snapshot.path.nodes.find((item) => item.activityIds.includes(input.activityId));
    if (node === undefined) throw new LearningSessionRepositoryError("path_version_conflict", "Activity is not on the active path");
    const progress = structuredClone(snapshot.activityProgress);
    const nodeProgress = progress.find((entry) => entry.nodeId === node.nodeId);
    if (nodeProgress === undefined) throw new LearningSessionRepositoryError("prerequisite_violation", "Activity progress is not initialized");
    if (nodeProgress.card?.status === "pending" && input.acknowledgedCardId !== nodeProgress.card.cardId) {
      throw new LearningSessionRepositoryError("activity_lifecycle_conflict", "The current learning card must be acknowledged before opening the Activity");
    }
    if (nodeProgress.card?.status === "acknowledged" && input.acknowledgedCardId !== undefined
        && input.acknowledgedCardId !== nodeProgress.card.cardId) {
      throw new LearningSessionRepositoryError("activity_lifecycle_conflict", "The acknowledged learning card does not belong to the current node");
    }
    const next = node.activityIds.find((id) => !terminal(nodeProgress.activities.find((entry) => entry.activityId === id)?.status ?? "pending"));
    if (next !== input.activityId) throw new LearningSessionRepositoryError("prerequisite_violation", "Activity is not the next unfinished activity");
    const assets = await this.options.assets.load(snapshot.view.subjectId, input.profileRevision, input.activityId);
    if (assets.activity.activityVersion !== input.activityVersion) throw new ActivityRepositoryError("activity_version_conflict", "Activity version is stale");

    if (snapshot.currentAttempt !== undefined) {
      if (snapshot.currentAttempt.activityId !== input.activityId) throw new LearningSessionRepositoryError("prerequisite_violation", "Another Activity Attempt is active");
      const existing = await this.options.activities.getDraft({ subjectId: snapshot.view.subjectId, sessionId: input.sessionId, activityId: input.activityId, attemptId: snapshot.currentAttempt.attemptId });
      if (existing === undefined) throw new ActivityRepositoryError("attempt_not_found", "Current Activity draft is missing");
      return this.draftOutput(input.requestId, snapshot, existing.attemptId, existing.draftVersion, safeActivity(assets.activity), existing.code);
    }

    const opened = await this.options.activities.openActivity({
      subjectId: snapshot.view.subjectId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      assignment: { ...assets.assignment, assignmentId: assignmentId(input) },
      attemptId: attemptId(input),
      now: this.now().toISOString(),
    });
    const draft = opened.code === "" && assets.activity.starterCode !== undefined
      ? await this.options.activities.saveDraft({
          subjectId: snapshot.view.subjectId,
          sessionId: input.sessionId,
          requestId: `${input.requestId}-starter`,
          activityId: input.activityId,
          attemptId: opened.attemptId,
          activityVersion: input.activityVersion,
          profileRevision: input.profileRevision,
          draftVersion: opened.draftVersion,
          code: assets.activity.starterCode,
          now: this.now().toISOString(),
        })
      : opened;
    const entry = nodeProgress.activities.find((item) => item.activityId === input.activityId)!;
    entry.status = "in_progress";
    if (!entry.attemptIds.includes(draft.attemptId)) entry.attemptIds.push(draft.attemptId);
    entry.updatedAt = this.now().toISOString();
    if (nodeProgress.card?.status === "pending") nodeProgress.card = { ...nodeProgress.card, status: "acknowledged", acknowledgedAt: entry.updatedAt };
    const committed = await this.options.sessions.commit({
      ...input,
      candidate: {
        requestId: input.requestId,
        knowledgeStates: snapshot.knowledgeStates,
        activityProgress: progress,
        currentAttempt: { kind: "code", activityId: input.activityId, attemptId: draft.attemptId, status: "draft", draftVersion: draft.draftVersion },
        nextStage: "activity",
      },
    });
    return this.draftOutput(input.requestId, committed, draft.attemptId, draft.draftVersion, safeActivity(assets.activity), draft.code);
  }

  async saveActivityDraft(input: SaveActivityDraftInput): Promise<ActivityDraftOutput> {
    const snapshot = await this.options.sessions.getSnapshot(input);
    assertSession(snapshot, input);
    if (snapshot.currentAttempt?.attemptId !== input.attemptId || snapshot.currentAttempt.activityId !== input.activityId) {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Activity Attempt is not current");
    }
    const assets = await this.options.assets.load(snapshot.view.subjectId, input.profileRevision, input.activityId);
    const draft = await this.options.activities.saveDraft({
      subjectId: snapshot.view.subjectId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      activityId: input.activityId,
      attemptId: input.attemptId,
      activityVersion: input.activityVersion,
      profileRevision: input.profileRevision,
      draftVersion: input.draftVersion,
      code: input.userText,
      now: this.now().toISOString(),
    });
    return this.draftOutput(input.requestId, snapshot, draft.attemptId, draft.draftVersion, safeActivity(assets.activity), draft.code);
  }

  async prepareActivityRun(input: PrepareActivityRunInput): Promise<PreparedActivityOutput> {
    const snapshot = await this.options.sessions.getSnapshot(input);
    assertSession(snapshot, input);
    if (snapshot.currentAttempt?.kind !== "code"
        || snapshot.currentAttempt.activityId !== input.activityId
        || snapshot.currentAttempt.attemptId !== input.attemptId
        || snapshot.currentAttempt.status === "submitted") {
      throw new LearningSessionRepositoryError("activity_lifecycle_conflict", "Public execution requires the current code Activity Attempt");
    }
    const assets = await this.options.assets.load(snapshot.view.subjectId, input.profileRevision, input.activityId);
    if (assets.activity.activityVersion !== input.activityVersion) {
      throw new ActivityRepositoryError("activity_version_conflict", "Activity version is stale");
    }
    if (assets.environment.environmentId !== assets.activity.environmentRef
        || assets.assignment.environmentId !== assets.activity.environmentRef) {
      throw new ActivityRepositoryError("environment_mismatch", "Public execution environment does not match the Activity binding");
    }
    const preparedAt = this.now().toISOString();
    const run = await this.options.activities.prepareRun({
      subjectId: snapshot.view.subjectId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      activityId: input.activityId,
      attemptId: input.attemptId,
      activityVersion: input.activityVersion,
      profileRevision: input.profileRevision,
      draftVersion: input.draftVersion,
      mode: "preview",
      now: preparedAt,
    });
    const bundle = projectPublicExecutionBundle({
      run,
      profileRevision: input.profileRevision,
      environmentId: assets.environment.environmentId,
      starterCode: assets.activity.starterCode ?? "",
      publicDatasetFiles: assets.publicDatasetFiles,
      publicTestSources: assets.publicTestSources,
    });
    return {
      requestId: input.requestId,
      sessionVersion: input.sessionVersion,
      mode: "preview",
      ...bundle,
    };
  }

  async submitActivity(input: CodeSubmitActivityInput): Promise<ActivitySubmissionOutput> {
    return (await this.submitActivityWithContext(input)).output;
  }

  async submitActivityWithContext(input: CodeSubmitActivityInput): Promise<RuntimeCommitContext<ActivitySubmissionOutput>> {
    const allowedInputKeys = new Set(["requestId", "sessionId", "sessionVersion", "profileRevision", "kind", "activityId", "activityVersion", "attemptId", "draftVersion", "userText"]);
    if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
      throw new ActivityRepositoryError("submission_contract_error", "Code submission contains unsupported derived or private fields");
    }
    const allowed = new Set(["requestId", "sessionId", "sessionVersion", "profileRevision", "kind", "activityId", "activityVersion", "attemptId", "draftVersion", "userText"]);
    if (Object.keys(input).some((key) => !allowed.has(key)) || (input.kind !== undefined && input.kind !== "code")) {
      throw new ActivityRepositoryError("submission_contract_error", "Code submission contains unsupported derived fields");
    }
    const bound = await this.options.sessions.getBoundSnapshot(input.sessionId);
    if (bound.profileRevision !== input.profileRevision) throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    const prior = await this.options.activities.getAttempt({ subjectId: bound.view.subjectId, sessionId: input.sessionId, activityId: input.activityId, attemptId: input.attemptId });
    if (prior !== undefined) {
      if (prior.attempt.requestId !== input.requestId || prior.attempt.codeHash !== sha256(input.userText)) throw new ActivityRepositoryError("idempotency_conflict", "Attempt was submitted with different content");
      const evidence = bound.evidence.find((item) => item.attemptId === input.attemptId);
      return { replayed: true, snapshot: bound, output: {
        kind: "code",
        requestId: input.requestId,
        attemptId: input.attemptId,
        committed: prior.attempt.committedAt !== undefined || evidence !== undefined,
        result: prior.result,
        sessionId: input.sessionId,
        sessionVersion: bound.sessionVersion,
        profileRevision: input.profileRevision,
        ...(evidence?.evidenceId === undefined ? {} : { evidenceId: evidence.evidenceId, evidenceVersion: evidence.evidenceVersion }),
      } };
    }
    assertSession(bound, input);
    if (bound.currentAttempt?.attemptId !== input.attemptId || bound.currentAttempt.activityId !== input.activityId) {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Activity Attempt is not current");
    }
    const assets = await this.options.assets.load(bound.view.subjectId, input.profileRevision, input.activityId);
    const prepared = await this.options.runtime.prepareActivityRun({
      subjectId: bound.view.subjectId,
      sessionId: input.sessionId,
      requestId: `${input.requestId}-prepare`,
      activityId: input.activityId,
      attemptId: input.attemptId,
      activityVersion: input.activityVersion,
      profileRevision: input.profileRevision,
      draftVersion: input.draftVersion,
      mode: "submit",
      activity: assets.evaluationActivity,
      taskVersion: assets.taskVersion,
      environment: assets.environment,
      assetBundleHash: normalizedHash(assets.assetBundleHash),
      now: this.now().toISOString(),
    });
    const now = this.now().toISOString();
    return this.options.runtime.submitDerivedFormalActivityWithContext({
      subjectId: bound.view.subjectId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      requestId: input.requestId,
      attemptId: input.attemptId,
      activityId: input.activityId,
      activityVersion: input.activityVersion,
      profileRevision: input.profileRevision,
      assignment: { ...assets.assignment, assignmentId: assignmentId(input) },
      draftVersion: input.draftVersion,
      code: input.userText,
      prepared: prepared.prepared,
      sessionRepository: this.options.sessions,
      now,
      deriveCandidate: async ({ evidence }) => {
        const progress = structuredClone(bound.activityProgress);
        const node = progress.find((entry) => entry.activities.some((activity) => activity.activityId === input.activityId));
        const entry = node?.activities.find((activity) => activity.activityId === input.activityId);
        if (entry === undefined || !entry.attemptIds.includes(input.attemptId)) throw new LearningSessionRepositoryError("prerequisite_violation", "Activity Attempt is not current progress");
        entry.status = evidence.outcome === "correct" ? "completed" : "in_progress";
        entry.result = evidence.outcome === "correct" ? "pass" : evidence.outcome === "partial" ? "partial" : "fail";
        entry.updatedAt = now;
        const evidenceVersion = bound.latestCommit.evidenceVersion + 1;
        const definitions = new Map((assets.knowledgePoints ?? [assets.knowledgePoint]).map((point) => [point.id, point]));
        const pointIds = new Set([...bound.knowledgeStates.map((state) => state.knowledgePointId), ...definitions.keys(), assets.knowledgePoint.id]);
        const knowledgeStates = calculateKnowledgeStates({
          knowledgePoints: [...pointIds].map((id) => ({ id, requiresCodeEvidence: definitions.get(id)?.requiresCodeEvidence })),
          profileRevision: input.profileRevision,
          evidenceVersion,
          evidence: [...bound.evidence, { ...evidence, evidenceVersion }],
          asOf: now,
        });
        const suffix: { path?: import("../repositories/internal-path-session-port.js").InternalPersistedPathSnapshot; changeReasons: string[] } = await this.options.pathSuffix.replan({
          snapshot: { ...bound, activityProgress: progress },
          knowledgeStates,
          evidenceVersion,
          trigger: evidence.outcome === "incorrect" ? "error_remediation" : "knowledge_state_changed",
        });
        return {
          knowledgeStates,
          activityProgress: progress,
          currentAttempt: null,
          nextStage: "learning",
          ...(suffix.path === undefined ? {} : { pathCandidate: toPathSafeSnapshot(suffix.path), internalPathCandidate: suffix.path }),
        };
      },
    }, new AbortController().signal);
  }

  async continueActivityWithGap(input: ContinueActivityWithGapInput): Promise<ContinueActivityWithGapOutput> {
    const snapshot = await this.options.sessions.getBoundSnapshot(input.sessionId);
    if (snapshot.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    }
    const progress = structuredClone(snapshot.activityProgress);
    const node = progress.find((item) => item.activities.some((activity) => activity.activityId === input.activityId));
    const entry = node?.activities.find((activity) => activity.activityId === input.activityId);
    const result = entry?.result;
    const replay = snapshot.latestCommit.requestId === input.requestId
      && entry?.continuedWithGap === true
      && entry.attemptIds.at(-1) === input.attemptId;
    if (replay && result !== undefined && result !== "pass") {
      return {
        requestId: input.requestId,
        sessionId: snapshot.sessionId,
        sessionVersion: snapshot.sessionVersion,
        profileRevision: snapshot.profileRevision,
        activityId: input.activityId,
        status: "insufficient",
        result,
        attemptCount: entry.attemptIds.length,
      };
    }
    if (snapshot.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    if (entry === undefined || entry.status !== "in_progress" || entry.attemptIds.length < 2
        || entry.attemptIds.at(-1) !== input.attemptId || result === undefined || result === "pass") {
      throw new LearningSessionRepositoryError(
        "prerequisite_violation",
        "Only a twice-attempted unresolved code Activity can continue with a learning gap",
      );
    }
    const recorded = await this.options.activities.getAttempt({
      subjectId: snapshot.view.subjectId,
      sessionId: input.sessionId,
      activityId: input.activityId,
      attemptId: input.attemptId,
    });
    if (recorded === undefined || recorded.result.executionStatus !== "completed"
        || (recorded.result.verdict !== "fail" && recorded.result.verdict !== "partial")) {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Latest code Attempt is not a submitted learner failure");
    }
    entry.status = "insufficient";
    entry.continuedWithGap = true;
    entry.updatedAt = this.now().toISOString();
    const suffix = await this.options.pathSuffix.replan({
      snapshot: { ...snapshot, activityProgress: progress },
      knowledgeStates: snapshot.knowledgeStates,
      evidenceVersion: snapshot.latestCommit.evidenceVersion,
      trigger: "error_remediation",
    });
    const committed = await this.options.sessions.commit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      candidate: {
        requestId: input.requestId,
        knowledgeStates: snapshot.knowledgeStates,
        activityProgress: progress,
        currentAttempt: null,
        nextStage: "learning",
        ...(suffix.path === undefined ? {} : {
          pathCandidate: toPathSafeSnapshot(suffix.path),
          internalPathCandidate: suffix.path,
        }),
      },
    });
    return {
      requestId: input.requestId,
      sessionId: committed.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: committed.profileRevision,
      activityId: input.activityId,
      status: "insufficient",
      result,
      attemptCount: entry.attemptIds.length,
    };
  }

  async getActivityAttempt(input: GetActivityAttemptInput): Promise<ActivityAttemptSafeView> {
    const snapshot = await this.options.sessions.getBoundSnapshot(input.sessionId);
    assertSession(snapshot, input);
    const key = { subjectId: snapshot.view.subjectId, sessionId: input.sessionId, activityId: input.activityId, attemptId: input.attemptId };
    const submitted = await this.options.activities.getAttempt(key);
    if (submitted !== undefined) {
      const evidence = snapshot.evidence.find((item) => item.attemptId === input.attemptId && item.activityId === input.activityId);
      return {
        kind: "code",
        sessionId: input.sessionId, sessionVersion: input.sessionVersion, profileRevision: input.profileRevision,
        activityId: input.activityId, attemptId: input.attemptId, status: "submitted", result: submitted.result,
        draftVersion: (await this.options.activities.getDraft(key))?.draftVersion ?? 1,
        codeHash: submitted.attempt.codeHash, ...(submitted.attempt.committedAt === undefined ? {} : { committedAt: submitted.attempt.committedAt }),
        ...(evidence === undefined ? {} : { evidenceId: evidence.evidenceId, evidenceVersion: evidence.evidenceVersion }),
      };
    }
    const [draft, failure] = await Promise.all([this.options.activities.getDraft(key), this.options.activities.getEvaluationFailure(key)]);
    if (draft === undefined) throw new ActivityRepositoryError("attempt_not_found", "Activity Attempt does not exist");
    return {
      kind: "code",
      sessionId: input.sessionId, sessionVersion: input.sessionVersion, profileRevision: input.profileRevision,
      activityId: input.activityId, attemptId: input.attemptId, status: failure === undefined ? "draft" : "evaluator_error", draftVersion: draft.draftVersion, codeHash: draft.codeHash,
    };
  }

  async recoverActivity(input: RecoverActivityInput): Promise<ActivityRecoveryOutput> {
    const before = await this.options.sessions.getBoundSnapshot(input.sessionId);
    assertSession(before, input);
    await this.options.activities.recover({ subjectId: before.view.subjectId, sessionId: input.sessionId });
    const recorded = await this.options.activities.getAttempt({ subjectId: before.view.subjectId, sessionId: input.sessionId, activityId: input.activityId, attemptId: input.attemptId });
    let snapshot = before;
    if (recorded !== undefined && recorded.attempt.committedAt === undefined) {
      snapshot = await new LearningSessionUnitOfWork(this.options.activities, this.options.sessions).recover({
        subjectId: before.view.subjectId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        requestId: `recover-${input.attemptId}`,
        activityId: input.activityId,
        attemptId: input.attemptId,
      });
    }
    const attempt = await this.getActivityAttempt({ ...input, sessionVersion: snapshot.sessionVersion });
    if (attempt.status === "submitted") return {
      sessionId: input.sessionId,
      sessionVersion: snapshot.sessionVersion,
      profileRevision: input.profileRevision,
      attempt,
      recoveryAction: "show_submitted",
    };
    const draft = await this.options.activities.getDraft({ subjectId: snapshot.view.subjectId, sessionId: input.sessionId, activityId: input.activityId, attemptId: input.attemptId });
    if (draft === undefined) throw new ActivityRepositoryError("attempt_not_found", "Activity draft does not exist");
    return {
      sessionId: input.sessionId, sessionVersion: input.sessionVersion, profileRevision: input.profileRevision,
      attempt, draftVersion: draft.draftVersion, userText: draft.code,
      recoveryAction: attempt.status === "evaluator_error" ? "retry_after_evaluator_error" : "resume_draft",
    };
  }

  private draftOutput(requestId: string, snapshot: Pick<SessionSnapshot, "sessionId" | "sessionVersion" | "profileRevision">, id: string, draftVersion: number, activity: CodeActivitySafeView, userText: string): ActivityDraftOutput {
    return { kind: "code", requestId, sessionId: snapshot.sessionId, sessionVersion: snapshot.sessionVersion, profileRevision: snapshot.profileRevision, attemptId: id, draftVersion, activity, userText };
  }
}

interface StoredActivity extends CodeActivitySafeView {
  profileRevision: number;
  templateVersion: string;
  environmentRef: string;
  datasetRefs?: string[];
  publicTestRefs?: string[];
  businessAcceptanceCriteria?: string[];
}

interface StoredPublicTest {
  testId: string;
  visibility: "public";
  fileRef: string;
  fixtureRefs: string[];
  assetHash: string;
}

interface StoredTaskBundle {
  bundleId: string;
  source: "profile_fixed" | "ai_generated";
  activity: StoredActivity;
  publicTests: StoredPublicTest[];
  environmentRef: string;
  assetBundleHash: string;
}

interface StoredFixture {
  fixtureId: string;
  visibility: "public" | "private";
  fileRef: string;
  assetHash: string;
}

function assertPublicAssetPath(fileRef: string, root: string): void {
  if (fileRef.includes("\\") || fileRef.startsWith("/") || /^[A-Za-z]:/u.test(fileRef)
      || fileRef.split("/").some((part) => part === "" || part === "." || part === "..")
      || !fileRef.startsWith(`${root}/`)) {
    throw new ActivityRepositoryError("test_asset_invalid", "Public execution asset path is outside its public root");
  }
}

function assertContentHash(content: string, expectedHash: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedHash) || sha256Text(content) !== expectedHash) {
    throw new ActivityRepositoryError("test_asset_invalid", "Public execution asset content hash is invalid");
  }
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Strict revision-bound resolver. It reads private bindings but emits only public assets. */
export class ProfileFamilyCodeActivityAssetResolver implements CodeActivityAssetResolver {
  constructor(private readonly profiles: ProfileFamilyRepository) {}

  async load(subjectId: string, profileRevision: number, activityId: string): Promise<CodeActivityAssets> {
    const manifest = await this.profiles.loadProfileV2Revision(subjectId, profileRevision);
    if (manifest.paths.activities === undefined || manifest.paths.assessments === undefined || manifest.paths.datasets === undefined || manifest.paths.environments === undefined) {
      throw new ActivityRepositoryError("activity_not_found", "Code Activity assets are unavailable");
    }
    const [activitiesRaw, bundlesRaw, fixturesRaw, environmentRaw] = await Promise.all([
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.activities),
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, `${manifest.paths.assessments}/private/task-bundles.json`),
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, `${manifest.paths.datasets}/fixtures.json`),
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.environments),
    ]);
    const activities = (JSON.parse(activitiesRaw) as { activities: StoredActivity[] }).activities;
    const bundles = (JSON.parse(bundlesRaw) as { bundles: StoredTaskBundle[] }).bundles;
    const fixtures = (JSON.parse(fixturesRaw) as { fixtures: StoredFixture[] }).fixtures;
    const environment = JSON.parse(environmentRaw) as EvaluationEnvironmentProjection;
    const activity = activities.find((item) => item.activityId === activityId);
    const bundle = bundles.find((item) => item.activity.activityId === activityId);
    const codeKind = activity?.kind;
    if (activity === undefined || bundle === undefined
        || (codeKind !== "code_completion" && codeKind !== "coding_practical" && codeKind !== "debug")) {
      throw new ActivityRepositoryError("activity_not_found", "Code Activity is unavailable");
    }
    if (activity.profileRevision !== profileRevision || bundle.activity.profileRevision !== profileRevision || bundle.activity.templateVersion !== activity.templateVersion
        || bundle.environmentRef !== activity.environmentRef || bundle.activity.environmentRef !== activity.environmentRef
        || bundle.activity.kind !== activity.kind || bundle.activity.primaryKnowledgePointId !== activity.primaryKnowledgePointId
        || bundle.activity.starterCode !== activity.starterCode
        || !sameStrings(bundle.activity.datasetRefs, activity.datasetRefs)
        || !sameStrings(bundle.activity.publicTestRefs, activity.publicTestRefs)) {
      throw new ActivityRepositoryError("activity_version_conflict", "Code Activity asset bindings differ");
    }
    if (environment.environmentId !== activity.environmentRef) {
      throw new ActivityRepositoryError("environment_mismatch", "Code Activity environment binding differs");
    }
    const pointAsset = JSON.parse(await this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.knowledge)) as { knowledgePoints: KnowledgePointDefinition[] };
    const point = pointAsset.knowledgePoints.find((item) => item.id === activity.primaryKnowledgePointId);
    if (point === undefined) throw new ActivityRepositoryError("activity_not_found", "Code Activity knowledge point is unavailable");
    const fixtureIds = fixtures.map((fixture) => fixture.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) throw new ActivityRepositoryError("test_asset_invalid", "Dataset fixture identifiers are not unique");
    const fixturesById = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture]));
    const datasetRefs = bundle.activity.datasetRefs ?? [];
    if (new Set(datasetRefs).size !== datasetRefs.length) throw new ActivityRepositoryError("test_asset_invalid", "Activity dataset references are not unique");
    const referencedFixtures = datasetRefs.map((fixtureId) => {
      const fixture = fixturesById.get(fixtureId);
      if (fixture === undefined) throw new ActivityRepositoryError("test_asset_invalid", "Activity dataset reference is missing");
      return fixture;
    });
    const publicFixtures = referencedFixtures.filter((fixture) => fixture.visibility === "public");
    for (const fixture of publicFixtures) assertPublicAssetPath(fixture.fileRef, `${manifest.paths.datasets}/public`);

    const expectedPublicTestIds = bundle.activity.publicTestRefs ?? [];
    const actualPublicTestIds = bundle.publicTests.map((test) => test.testId);
    if (expectedPublicTestIds.length !== actualPublicTestIds.length
        || expectedPublicTestIds.some((testId, index) => testId !== actualPublicTestIds[index])
        || new Set(actualPublicTestIds).size !== actualPublicTestIds.length
        || new Set(bundle.publicTests.map((test) => test.fileRef)).size !== bundle.publicTests.length) {
      throw new ActivityRepositoryError("test_asset_invalid", "Public test references do not match the Activity declaration");
    }
    for (const test of bundle.publicTests) {
      if (test.visibility !== "public") throw new ActivityRepositoryError("test_asset_invalid", "Private tests cannot be projected for public execution");
      assertPublicAssetPath(test.fileRef, `${manifest.paths.assessments}/public`);
      if (!Array.isArray(test.fixtureRefs) || test.fixtureRefs.some((fixtureId) => fixturesById.get(fixtureId)?.visibility !== "public")) {
        throw new ActivityRepositoryError("test_asset_invalid", "Public tests may reference only public datasets");
      }
    }

    const datasetContents = await Promise.all(publicFixtures.map(async (fixture) => {
      const content = await this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, fixture.fileRef);
      const hash = normalizedHash(fixture.assetHash);
      assertContentHash(content, hash);
      return { name: basename(fixture.fileRef), content, hash };
    }));
    if (new Set(datasetContents.map((file) => file.name)).size !== datasetContents.length) {
      throw new ActivityRepositoryError("test_asset_invalid", "Public dataset names are not unique");
    }
    const publicTestSources = await Promise.all(bundle.publicTests.map(async (test) => {
      const content = await this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, test.fileRef);
      assertContentHash(content, normalizedHash(test.assetHash));
      return content;
    }));
    // Profile assets store the revision binding as `profileRevision`; the public
    // Activity DTO exposes the same immutable binding as `activityVersion`.
    const code: CodeActivityAssets["activity"] = {
      ...activity,
      kind: codeKind,
      activityVersion: activity.profileRevision,
      ...(activity.publicTestRefs === undefined ? {} : { publicTestIds: [...activity.publicTestRefs] }),
      ...(activity.publicAcceptanceCriteria !== undefined
        ? { publicAcceptanceCriteria: [...activity.publicAcceptanceCriteria] }
        : activity.businessAcceptanceCriteria === undefined
          ? activity.outputContract === undefined ? {} : { publicAcceptanceCriteria: [activity.outputContract] }
          : { publicAcceptanceCriteria: [...activity.businessAcceptanceCriteria] }),
    };
    return {
      activity: code,
      knowledgePoint: { id: point.id, ...(point.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: point.requiresCodeEvidence }) },
      knowledgePoints: pointAsset.knowledgePoints.map((item) => ({ id: item.id, ...(item.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: item.requiresCodeEvidence }) })),
      assignment: {
        activityId,
        activityVersion: activity.profileRevision,
        profileRevision,
        primaryKnowledgePointId: activity.primaryKnowledgePointId,
        kind: activity.kind as CodeActivityKind,
        source: bundle.source === "profile_fixed" ? "fixed" : "ai_generated",
        assetBundleHash: normalizedHash(bundle.assetBundleHash),
        environmentId: activity.environmentRef,
      },
      evaluationActivity: { activityId, kind: activity.kind as CodeActivityKind, profileRevision, templateVersion: activity.templateVersion, environmentRef: activity.environmentRef },
      taskVersion: activity.templateVersion,
      environment,
      assetBundleHash: normalizedHash(bundle.assetBundleHash),
      publicDatasetFiles: datasetContents,
      publicTestSources,
    };
  }
}
