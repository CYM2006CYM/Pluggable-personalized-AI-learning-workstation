import type {
  ActivityAttemptSafeView,
  ActivitySubmissionOutput,
  OpenActivityInput,
  QuizActivityDraftOutput,
} from "../contracts/facade.js";
import type { AdaptiveContentPort, NodeActivityProgress, QuizQuestionPrivate, QuizSubmitActivityInput } from "../contracts/index.js";
import { calculateKnowledgeStates } from "../domain/knowledge-state.js";
import { DeterministicQuizRuntime, QuizRuntimeError, type QuizActivityDefinition, type QuizAttemptSnapshot } from "../domain/quiz-runtime.js";
import type { KnowledgePointDefinition } from "../domain/v2-types.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import {
  LearningSessionRepositoryError,
  type LearningSessionRepository,
  type QuizAttemptSessionPort,
  type SessionBindingReader,
} from "../repositories/learning-session-repository.js";
import { selectDeterministicQuizContent } from "./deterministic-content-policy.js";
import type { ActivityPathSuffixReplanner } from "./activity-path-suffix.js";
import { toPathSafeSnapshot } from "../repositories/internal-path-session-port.js";
import type { RuntimeCommitContext } from "./runtime-commit-context.js";

export interface QuizActivityAssets {
  activity: QuizActivityDefinition;
  knowledgePoint: Pick<KnowledgePointDefinition, "id" | "requiresCodeEvidence" | "sourceAnchorIds">;
  knowledgePoints?: Array<Pick<KnowledgePointDefinition, "id" | "requiresCodeEvidence">>;
  fixedQuestions: QuizQuestionPrivate[];
  supplementalQuestions: QuizQuestionPrivate[];
  legacyQuestion?: QuizQuestionPrivate;
  legacySubtype?: "single_choice" | "judgment";
}

export interface QuizActivityRuntimeOptions {
  sessions: LearningSessionRepository & QuizAttemptSessionPort & SessionBindingReader;
  content: AdaptiveContentPort;
  loadAssets(subjectId: string, profileRevision: number, activityId: string): Promise<QuizActivityAssets>;
  pathSuffix: ActivityPathSuffixReplanner;
  now?: () => Date;
}

function progressFor(snapshot: Awaited<ReturnType<LearningSessionRepository["getSnapshot"]>>, nodeId: string, activityIds: readonly string[], now: string): NodeActivityProgress[] {
  const progress = structuredClone(snapshot.activityProgress);
  let node = progress.find((entry) => entry.nodeId === nodeId);
  if (node === undefined) {
    node = {
      nodeId,
      activities: activityIds.map((activityId) => ({ activityId, status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now })),
    };
    progress.push(node);
  }
  return progress;
}

export class QuizActivityRuntime {
  private readonly now: () => Date;

  constructor(private readonly options: QuizActivityRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async openActivity(input: OpenActivityInput): Promise<QuizActivityDraftOutput> {
    const snapshot = await this.options.sessions.getBoundSnapshot(input.sessionId);
    if (snapshot.sessionVersion !== input.sessionVersion && snapshot.currentAttempt?.kind === "quiz"
        && snapshot.currentAttempt.activityId === input.activityId) {
      const existing = await this.options.sessions.getQuizAttempt({ ...input, sessionVersion: snapshot.sessionVersion, attemptId: snapshot.currentAttempt.attemptId });
      if (existing?.openedRequestId === input.requestId) {
        const replayNode = snapshot.path?.nodes.find((item) => item.activityIds.includes(input.activityId));
        const replayProgress = snapshot.activityProgress.find((item) => item.nodeId === replayNode?.nodeId);
        if (replayProgress?.card !== undefined && input.acknowledgedCardId !== replayProgress.card.cardId) {
          throw new LearningSessionRepositoryError("idempotency_conflict", "Repeated open request changed its card acknowledgement");
        }
        return this.openOutput(input.requestId, snapshot, existing);
      }
    }
    if (snapshot.sessionVersion !== input.sessionVersion) throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    const node = snapshot.path?.nodes.find((item) => item.activityIds.includes(input.activityId));
    if (node === undefined || snapshot.path?.pathVersion !== input.pathVersion) throw new LearningSessionRepositoryError("path_version_conflict", "Activity is not on the active path");
    const now = this.now().toISOString();
    const progress = progressFor(snapshot, node.nodeId, node.activityIds, now);
    const nodeProgress = progress.find((entry) => entry.nodeId === node.nodeId)!;
    if (nodeProgress.card?.status === "pending" && input.acknowledgedCardId !== nodeProgress.card.cardId) {
      throw new LearningSessionRepositoryError("activity_lifecycle_conflict", "The current learning card must be acknowledged before opening the Activity");
    }
    if (nodeProgress.card?.status === "acknowledged" && input.acknowledgedCardId !== undefined
        && input.acknowledgedCardId !== nodeProgress.card.cardId) {
      throw new LearningSessionRepositoryError("activity_lifecycle_conflict", "The acknowledged learning card does not belong to the current node");
    }
    const terminal = new Set(["completed", "insufficient"]);
    const next = node.activityIds.find((id) => !terminal.has(nodeProgress.activities.find((entry) => entry.activityId === id)?.status ?? "pending"));
    if (next !== input.activityId) throw new LearningSessionRepositoryError("prerequisite_violation", "Activity is not the next unfinished activity");
    const entry = nodeProgress.activities.find((item) => item.activityId === input.activityId)!;
    if (snapshot.currentAttempt !== undefined) {
      if (snapshot.currentAttempt.activityId !== input.activityId) throw new LearningSessionRepositoryError("prerequisite_violation", "Another Activity Attempt is active");
      const existing = await this.options.sessions.getQuizAttempt({ ...input, attemptId: snapshot.currentAttempt.attemptId });
      if (existing === undefined) throw new LearningSessionRepositoryError("storage_error", "Current Quiz Attempt is missing");
      return this.openOutput(input.requestId, snapshot, existing);
    }
    const assets = await this.options.loadAssets(snapshot.view.subjectId, input.profileRevision, input.activityId);
    if (assets.activity.activityVersion !== input.activityVersion) throw new LearningSessionRepositoryError("activity_version_conflict", "Activity version is stale");
    const previousAttempts = (await Promise.all(entry.attemptIds.map((attemptId) => this.options.sessions.getQuizAttempt({ ...input, attemptId }))))
      .filter((attempt): attempt is QuizAttemptSnapshot => attempt !== undefined);
    const excludedQuestionIds = previousAttempts.flatMap((attempt) => attempt.questions.map((question) => question.questionId));
    const retryNumber = entry.quizRetryCount;
    const selected = assets.legacyQuestion === undefined
      ? await (async () => {
        const dynamic = await this.options.content.prepareQuiz({
          profileRevision: input.profileRevision,
          activityId: input.activityId,
          retryNumber,
          excludedQuestionIds,
        });
        return selectDeterministicQuizContent({
          dynamic: dynamic.status === "accepted" ? dynamic.questions ?? [] : [],
          supplemental: assets.supplementalQuestions,
          fixed: assets.fixedQuestions,
          excludedQuestionIds,
          allowedSourceAnchorIds: assets.knowledgePoint.sourceAnchorIds,
        });
      })()
      : { source: "fixed" as const, questions: [structuredClone(assets.legacyQuestion)] };
    const core = new DeterministicQuizRuntime();
    const opened = core.open({
      requestId: input.requestId,
      sessionId: input.sessionId,
      profileRevision: input.profileRevision,
      activity: assets.activity,
      questions: selected.questions,
      retryNumber,
      ...(assets.legacySubtype === undefined ? {} : { legacySubtype: assets.legacySubtype }),
    });
    const attempt = core.getAttempt(opened.attemptId);
    entry.status = "in_progress";
    entry.attemptIds.push(attempt.attemptId);
    entry.updatedAt = now;
    if (nodeProgress.card?.status === "pending") nodeProgress.card = { ...nodeProgress.card, status: "acknowledged", acknowledgedAt: now };
    const committed = await this.options.sessions.commit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      candidate: {
        requestId: input.requestId,
        knowledgeStates: snapshot.knowledgeStates,
        activityProgress: progress,
        currentAttempt: { kind: "quiz", activityId: input.activityId, attemptId: attempt.attemptId, status: "draft", retryNumber },
        quizAttemptCandidate: attempt,
        nextStage: "activity",
      },
    });
    return this.openOutput(input.requestId, committed, attempt);
  }

  async submitActivity(input: QuizSubmitActivityInput): Promise<ActivitySubmissionOutput> {
    return (await this.submitActivityWithContext(input)).output;
  }

  async submitActivityWithContext(input: QuizSubmitActivityInput): Promise<RuntimeCommitContext<ActivitySubmissionOutput>> {
    const allowedInputKeys = new Set(["requestId", "sessionId", "sessionVersion", "profileRevision", "kind", "activityId", "activityVersion", "attemptId", "answers"]);
    if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
      throw new QuizRuntimeError("submission_contract_error", "Quiz submission contains unsupported derived or private fields");
    }
    const snapshot = await this.options.sessions.getBoundSnapshot(input.sessionId);
    if (snapshot.profileRevision !== input.profileRevision) throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    const attempt = await this.options.sessions.getQuizAttempt({ ...input, sessionVersion: snapshot.sessionVersion, activityId: input.activityId, attemptId: input.attemptId });
    if (attempt === undefined) throw new QuizRuntimeError("attempt_not_found", "Quiz Attempt does not exist");
    const assets = await this.options.loadAssets(snapshot.view.subjectId, input.profileRevision, input.activityId);
    const core = new DeterministicQuizRuntime();
    core.restore(attempt);
    const now = attempt.submittedAt ?? this.now().toISOString();
    const evaluated = core.submit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      profileRevision: input.profileRevision,
      activity: assets.activity,
      attemptId: input.attemptId,
      answers: input.answers,
      knowledgePointId: assets.knowledgePoint.id,
      now,
    });
    if (attempt.status === "submitted") {
      const evidence = snapshot.evidence.find((item) => item.attemptId === input.attemptId);
      return { replayed: true, snapshot, output: {
        kind: "quiz",
        requestId: input.requestId,
        attemptId: input.attemptId,
        committed: true,
        result: evaluated.result,
        sessionId: snapshot.sessionId,
        sessionVersion: snapshot.sessionVersion,
        profileRevision: snapshot.profileRevision,
        ...(evidence?.evidenceId === undefined ? {} : { evidenceId: evidence.evidenceId, evidenceVersion: evidence.evidenceVersion }),
      } };
    }
    if (snapshot.sessionVersion !== input.sessionVersion) throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    const progress = structuredClone(snapshot.activityProgress);
    const node = progress.find((entry) => entry.activities.some((activity) => activity.activityId === input.activityId));
    const entry = node?.activities.find((activity) => activity.activityId === input.activityId);
    if (node === undefined || entry === undefined || !entry.attemptIds.includes(input.attemptId)) {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Quiz Attempt is not current activity progress");
    }
    const retryPending = evaluated.result.verdict !== "pass" && attempt.retryNumber === 0;
    entry.status = retryPending ? "in_progress" : evaluated.result.verdict === "insufficient" ? "insufficient" : "completed";
    entry.result = evaluated.result.verdict;
    entry.quizRetryCount = retryPending ? 1 : attempt.retryNumber;
    entry.updatedAt = now;
    const evidence = evaluated.evidence;
    const nextEvidenceVersion = snapshot.latestCommit.evidenceVersion + (evidence === undefined ? 0 : 1);
    const definitions = new Map((assets.knowledgePoints ?? [assets.knowledgePoint]).map((point) => [point.id, point]));
    const pointIds = new Set([...snapshot.knowledgeStates.map((state) => state.knowledgePointId), ...definitions.keys(), assets.knowledgePoint.id]);
    const knowledgeStates = calculateKnowledgeStates({
      knowledgePoints: [...pointIds].map((id) => ({ id, requiresCodeEvidence: definitions.get(id)?.requiresCodeEvidence })),
      profileRevision: input.profileRevision,
      evidenceVersion: nextEvidenceVersion,
      evidence: evidence === undefined ? snapshot.evidence : [...snapshot.evidence, evidence],
      asOf: now,
    });
    const suffix: { path?: import("../repositories/internal-path-session-port.js").InternalPersistedPathSnapshot; changeReasons: string[] } = await this.options.pathSuffix.replan({
      snapshot: { ...snapshot, activityProgress: progress },
      knowledgeStates,
      evidenceVersion: nextEvidenceVersion,
      trigger: evidence?.outcome === "incorrect" ? "error_remediation" : "knowledge_state_changed",
    });
    const committed = await this.options.sessions.commit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      candidate: {
        requestId: input.requestId,
        ...(evidence === undefined ? {} : { evidenceCandidate: evidence }),
        knowledgeStates,
        activityProgress: progress,
        currentAttempt: null,
        quizAttemptCandidate: evaluated.attempt,
        ...(suffix.path === undefined ? {} : { pathCandidate: toPathSafeSnapshot(suffix.path), internalPathCandidate: suffix.path }),
        nextStage: "learning",
      },
    });
    return { replayed: committed.replayed, snapshot: committed, output: {
      kind: "quiz",
      requestId: input.requestId,
      attemptId: input.attemptId,
      committed: true,
      result: evaluated.result,
      sessionId: committed.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: committed.profileRevision,
      ...(committed.committedEvidenceId === undefined ? {} : { evidenceId: committed.committedEvidenceId, evidenceVersion: committed.latestCommit.evidenceVersion }),
    } };
  }

  async getAttempt(input: { sessionId: string; sessionVersion: number; profileRevision: number; activityId: string; attemptId: string }): Promise<ActivityAttemptSafeView> {
    const [attempt, snapshot] = await Promise.all([
      this.options.sessions.getQuizAttempt(input),
      this.options.sessions.getBoundSnapshot(input.sessionId),
    ]);
    if (attempt === undefined) throw new QuizRuntimeError("attempt_not_found", "Quiz Attempt does not exist");
    if (snapshot.profileRevision !== input.profileRevision) {
      throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision is stale");
    }
    if (snapshot.sessionVersion !== input.sessionVersion) {
      throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    }
    const evidence = snapshot.evidence.find((item) => item.attemptId === input.attemptId && item.activityId === input.activityId);
    return {
      kind: "quiz",
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      activityId: input.activityId,
      attemptId: input.attemptId,
      status: attempt.status,
      retryNumber: attempt.retryNumber,
      ...(attempt.result === undefined ? {} : { result: attempt.result }),
      ...(evidence === undefined ? {} : { evidenceId: evidence.evidenceId, evidenceVersion: evidence.evidenceVersion }),
    };
  }

  private openOutput(requestId: string, snapshot: { sessionId: string; sessionVersion: number; profileRevision: number }, attempt: QuizAttemptSnapshot): QuizActivityDraftOutput {
    const activity = this.safeActivity(attempt);
    return { kind: "quiz", requestId, sessionId: snapshot.sessionId, sessionVersion: snapshot.sessionVersion, profileRevision: snapshot.profileRevision, attemptId: attempt.attemptId, activity };
  }

  private safeActivity(attempt: QuizAttemptSnapshot) {
    if (attempt.legacySubtype !== undefined) {
      const question = attempt.questions[0];
      if (question === undefined) throw new QuizRuntimeError("submission_contract_error", "Legacy Quiz Attempt has no question");
      return {
        activityId: attempt.activityId,
        activityVersion: attempt.activityVersion,
        kind: "mcq" as const,
        title: attempt.title,
        prompt: attempt.prompt,
        primaryKnowledgePointId: attempt.primaryKnowledgePointId,
        supportingKnowledgePointIds: [...attempt.supportingKnowledgePointIds],
        questions: [{ questionId: question.questionId, kind: question.kind, prompt: question.prompt, options: [...question.options] }],
        retryNumber: attempt.retryNumber,
      };
    }
    return {
      activityId: attempt.activityId,
      activityVersion: attempt.activityVersion,
      kind: "mcq" as const,
      title: attempt.title,
      prompt: attempt.prompt,
      primaryKnowledgePointId: attempt.primaryKnowledgePointId,
      supportingKnowledgePointIds: [...attempt.supportingKnowledgePointIds],
      questions: attempt.questions.map(({ questionId, kind, prompt, options }) => ({ questionId, kind, prompt, options: [...options] })),
      retryNumber: attempt.retryNumber,
    };
  }
}

interface StoredQuizActivityBase extends QuizActivityDefinition {
  kind: "mcq";
  evaluatorRef: string;
  sourceAnchorIds: string[];
}

interface StoredLegacyQuizActivity extends StoredQuizActivityBase {
  subtype: "single_choice" | "judgment";
  options: string[];
  fixedQuestionGroupId?: never;
  supplementalQuestionGroupId?: never;
}

interface StoredQuestionGroupQuizActivity extends StoredQuizActivityBase {
  fixedQuestionGroupId: string;
  supplementalQuestionGroupId?: string;
  subtype?: never;
  options?: never;
}

type StoredQuizActivity = StoredLegacyQuizActivity | StoredQuestionGroupQuizActivity;

interface PublicQuizGroup {
  groupId: string;
  role: "fixed" | "supplemental";
  activityId: string;
  knowledgePointId: string;
  questions: Array<Omit<QuizQuestionPrivate, "correctAnswer" | "explanation" | "sourceAnchorIds">>;
}

/** Reads B's sealed question groups by the immutable session revision. */
export class ProfileFamilyQuizActivityAssetResolver {
  constructor(private readonly profiles: ProfileFamilyRepository) {}

  async loadAssets(subjectId: string, profileRevision: number, activityId: string): Promise<QuizActivityAssets> {
    const manifest = await this.profiles.loadProfileV2Revision(subjectId, profileRevision);
    if (manifest.paths.activities === undefined || manifest.paths.assessments === undefined) {
      throw new QuizRuntimeError("submission_contract_error", "Quiz Activity assets are unavailable");
    }
    const [activitiesRaw, knowledgeRaw, publicGroupAsset] = await Promise.all([
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.activities),
      this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, manifest.paths.knowledge),
      this.profiles.loadProfileV2RevisionQuizGroups(subjectId, profileRevision),
    ]);
    const stored = (JSON.parse(activitiesRaw) as { activities: StoredQuizActivity[] }).activities.find((activity) => activity.activityId === activityId);
    if (stored === undefined || stored.kind !== "mcq" || stored.profileRevision !== profileRevision || !stored.evaluatorRef) {
      throw new QuizRuntimeError("activity_version_conflict", "Quiz Activity binding is invalid");
    }
    const [answerRelativePath] = stored.evaluatorRef.split("#", 2);
    if (!answerRelativePath) throw new QuizRuntimeError("submission_contract_error", "Quiz answer key binding is invalid");
    const answersRaw = await this.profiles.readProfileV2RevisionFile(subjectId, profileRevision, `${manifest.paths.assessments}/${answerRelativePath}`);
    const point = (JSON.parse(knowledgeRaw) as { knowledgePoints: KnowledgePointDefinition[] }).knowledgePoints
      .find((item) => item.id === stored.primaryKnowledgePointId);
    if (point === undefined) throw new QuizRuntimeError("submission_contract_error", "Quiz knowledge point binding is invalid");
    const legacySubtype = stored.subtype;
    if (legacySubtype !== undefined) {
      if (!Array.isArray(stored.options) || stored.options.length < 2 || new Set(stored.options).size !== stored.options.length) {
        throw new QuizRuntimeError("submission_contract_error", "Legacy Quiz options are invalid");
      }
      const answerDocument = JSON.parse(answersRaw) as { answers?: Array<{ questionId?: string; correctOptionIndex?: number }> };
      const answer = answerDocument.answers?.find((item) => item.questionId === stored.evaluatorRef.split("#")[1]);
      const correctOptionIndex = answer?.correctOptionIndex;
      if (answer === undefined || typeof correctOptionIndex !== "number" || !Number.isInteger(correctOptionIndex)
          || correctOptionIndex < 0 || correctOptionIndex >= stored.options.length) {
        throw new QuizRuntimeError("submission_contract_error", "Legacy Quiz answer binding is invalid");
      }
      const questionId = stored.evaluatorRef.split("#")[1];
      if (!questionId) throw new QuizRuntimeError("submission_contract_error", "Legacy Quiz question binding is invalid");
      const question: QuizQuestionPrivate = {
        questionId,
        kind: legacySubtype,
        prompt: stored.prompt,
        options: [...stored.options],
        correctAnswer: legacySubtype === "judgment" ? correctOptionIndex === 0 : stored.options[correctOptionIndex],
        explanation: "",
        sourceAnchorIds: [...stored.sourceAnchorIds],
      };
      return {
        activity: {
          activityId: stored.activityId,
          activityVersion: profileRevision,
          profileRevision,
          title: stored.title,
          prompt: stored.prompt,
          primaryKnowledgePointId: stored.primaryKnowledgePointId,
          supportingKnowledgePointIds: [...stored.supportingKnowledgePointIds],
        },
        knowledgePoint: { id: point.id, sourceAnchorIds: [...point.sourceAnchorIds], ...(point.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: point.requiresCodeEvidence }) },
        knowledgePoints: [point].map((item) => ({ id: item.id, ...(item.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: item.requiresCodeEvidence }) })),
        fixedQuestions: [],
        supplementalQuestions: [],
        legacyQuestion: question,
        legacySubtype,
      };
    }
    const publicGroups = publicGroupAsset.groups as PublicQuizGroup[];
    const privateGroups = (JSON.parse(answersRaw) as { groups: Array<{ groupId: string; answers: QuizQuestionPrivate[] }> }).groups;
    const merge = (groupId: string, role: PublicQuizGroup["role"]): QuizQuestionPrivate[] => {
      const publicGroup = publicGroups.find((group) => group.groupId === groupId);
      const privateGroup = privateGroups.find((group) => group.groupId === groupId);
      if (publicGroup === undefined || privateGroup === undefined || publicGroup.role !== role
          || publicGroup.activityId !== activityId || publicGroup.knowledgePointId !== stored.primaryKnowledgePointId
          || publicGroup.questions.length !== privateGroup.answers.length) {
        throw new QuizRuntimeError("submission_contract_error", "Quiz question group binding is invalid");
      }
      return publicGroup.questions.map((question, index) => {
        const answer = privateGroup.answers[index];
        if (answer === undefined || answer.questionId !== question.questionId || answer.kind !== question.kind
            || answer.prompt !== question.prompt || JSON.stringify(answer.options) !== JSON.stringify(question.options)) {
          throw new QuizRuntimeError("submission_contract_error", "Quiz public and private questions differ");
        }
        return structuredClone(answer);
      });
    };
    const knowledgePoints = (JSON.parse(knowledgeRaw) as { knowledgePoints: KnowledgePointDefinition[] }).knowledgePoints;
    if (!stored.fixedQuestionGroupId) throw new QuizRuntimeError("submission_contract_error", "Quiz fixed group binding is invalid");
    return {
      activity: {
        activityId: stored.activityId,
        activityVersion: profileRevision,
        profileRevision,
        title: stored.title,
        prompt: stored.prompt,
        primaryKnowledgePointId: stored.primaryKnowledgePointId,
        supportingKnowledgePointIds: [...stored.supportingKnowledgePointIds],
      },
      knowledgePoint: { id: point.id, sourceAnchorIds: [...point.sourceAnchorIds], ...(point.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: point.requiresCodeEvidence }) },
      knowledgePoints: knowledgePoints.map((item) => ({ id: item.id, ...(item.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: item.requiresCodeEvidence }) })),
      fixedQuestions: merge(stored.fixedQuestionGroupId, "fixed"),
      supplementalQuestions: stored.supplementalQuestionGroupId === undefined ? [] : merge(stored.supplementalQuestionGroupId, "supplemental"),
    };
  }
}
