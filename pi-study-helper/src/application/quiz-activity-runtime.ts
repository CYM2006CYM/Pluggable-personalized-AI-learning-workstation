import type {
  ActivityAttemptSafeView,
  ActivitySubmissionOutput,
  OpenActivityInput,
  QuizActivityDraftOutput,
} from "../contracts/facade.js";
import { PUBLIC_RECOMMENDATION_MAX_LENGTH, type AdaptiveContentPort, type ContinueActivityWithGapInput, type ContinueActivityWithGapOutput, type LessonVariantId, type NodeActivityProgress, type QuizQuestionPrivate, type QuizRemediationContext, type QuizRemediationSafeView, type QuizSubmitActivityInput } from "../contracts/index.js";
import { calculateKnowledgeStates } from "../domain/knowledge-state.js";
import {
  DeterministicQuizRuntime,
  QuizRuntimeError,
  quizQuestionSetSha256,
  type QuizActivityDefinition,
  type QuizAttemptSnapshot,
  type QuizGradingBinding,
} from "../domain/quiz-runtime.js";
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
import { lessonVariantForPreference } from "./rich-lesson-selection.js";
import { buildLearnerProfile, diagnosticSkippedKnowledgePointIdsFromPath } from "../domain/learner-profile.js";
import type { LearnerProfileAgentPort } from "./learner-profile-agent-service.js";
import type { AgentRunRepository } from "../infrastructure/agent-run-repository.js";

export interface QuizActivityAssets {
  activity: QuizActivityDefinition;
  knowledgePoint: Pick<KnowledgePointDefinition, "id" | "requiresCodeEvidence" | "sourceAnchorIds">;
  allowedSourceAnchorIds?: string[];
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
  profileAgent?: LearnerProfileAgentPort;
  agentRuns?: AgentRunRepository;
  /** Upper bound for opening an AI-backed quiz, including unexpected adapter/storage hangs. */
  dynamicGenerationTimeoutMs?: number;
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

const RESULT_RANK = { insufficient: 0, fail: 1, partial: 2, pass: 3 } as const;

function resolveWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, timeoutMs);
    operation.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

function bestResult(current: NodeActivityProgress["activities"][number]["bestResult"], latest: NonNullable<NodeActivityProgress["activities"][number]["result"]>) {
  return current === undefined || RESULT_RANK[latest] > RESULT_RANK[current] ? latest : current;
}

export class QuizActivityRuntime {
  private readonly now: () => Date;
  private readonly dynamicGenerationTimeoutMs: number;

  constructor(private readonly options: QuizActivityRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    this.dynamicGenerationTimeoutMs = options.dynamicGenerationTimeoutMs ?? 120_000;
    if (!Number.isInteger(this.dynamicGenerationTimeoutMs) || this.dynamicGenerationTimeoutMs <= 0) {
      throw new RangeError("dynamicGenerationTimeoutMs must be a positive integer");
    }
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
    const entry = nodeProgress.activities.find((item) => item.activityId === input.activityId)!;
    const requiresExplicitRelearn = node.status === "skipped" || entry.continuedWithGap === true;
    const relearnAllowed = input.relearn === true && requiresExplicitRelearn;
    if ((requiresExplicitRelearn && input.relearn !== true) || (input.relearn === true && !relearnAllowed)) {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Only a skipped or gap-continued Activity can be relearned");
    }
    const next = node.activityIds.find((id) => !terminal.has(nodeProgress.activities.find((entry) => entry.activityId === id)?.status ?? "pending"));
    if (next !== input.activityId && !relearnAllowed) throw new LearningSessionRepositoryError("prerequisite_violation", "Activity is not the next unfinished activity");
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
    const previousAttempt = previousAttempts.at(-1);
    const excludedQuestionIds = [...new Set(previousAttempts.flatMap((attempt) => attempt.questions.map((question) => question.questionId)))];
    const excludedQuestionPrompts = [...new Set(previousAttempts.flatMap((attempt) => attempt.questions.map((question) => question.prompt)))];
    const fallbackExcludedQuestionIds = previousAttempt?.questions.map((question) => question.questionId) ?? [];
    const retryNumber = entry.quizRetryCount;
    const targetKnowledgePointIds = [assets.activity.primaryKnowledgePointId];
    const remediationContext = retryNumber > 0 && previousAttempt?.result?.answerReview !== undefined
      ? await this.buildRemediationContext(snapshot, previousAttempt, excludedQuestionIds, excludedQuestionPrompts)
      : undefined;
    const lessonVariantId = lessonVariantForPreference(snapshot.diagnosticDraft?.background?.explanation_preference);
    const remediation = remediationContext === undefined ? undefined : this.toRemediationSafeView(
      remediationContext,
      lessonVariantId,
      targetKnowledgePointIds,
      snapshot.latestCommit.evidenceVersion,
    );
    const agentRun = assets.legacyQuestion === undefined && this.options.agentRuns !== undefined
      ? await this.options.agentRuns.create({
          requestId: input.requestId,
          sessionId: input.sessionId,
          activityId: input.activityId,
          profileRevision: input.profileRevision,
          pathVersion: input.pathVersion,
          evidenceVersion: snapshot.latestCommit.evidenceVersion,
          ...(remediation === undefined ? {} : { remediation }),
        })
      : undefined;
    if (agentRun !== undefined && !this.preparationStagesComplete(agentRun)) {
      await this.recordPreparationStages(agentRun.runId, lessonVariantId, assets, remediationContext);
    }
    const dynamic = assets.legacyQuestion === undefined
      ? await resolveWithin(this.options.content.prepareQuiz({
          profileRevision: input.profileRevision,
          activityId: input.activityId,
          retryNumber,
          excludedQuestionIds,
          lessonVariantId,
          targetKnowledgePointIds,
          ...(agentRun === undefined ? {} : { agentRunId: agentRun.runId }),
          ...(remediationContext === undefined ? {} : { remediationContext }),
        }), this.dynamicGenerationTimeoutMs)
      : undefined;
    const dynamicTimedOut = assets.legacyQuestion === undefined && dynamic === undefined;
    const selected = assets.legacyQuestion === undefined
      ? selectDeterministicQuizContent({
          dynamic: dynamic?.status === "accepted" ? dynamic.questions ?? [] : [],
          supplemental: assets.supplementalQuestions,
          fixed: assets.fixedQuestions,
          excludedQuestionIds: fallbackExcludedQuestionIds,
          allowedSourceAnchorIds: assets.allowedSourceAnchorIds ?? assets.knowledgePoint.sourceAnchorIds,
        })
      : { source: "fixed" as const, questions: [structuredClone(assets.legacyQuestion)] };
    const questionSource = selected.source === "dynamic"
      ? dynamic?.origin === "live_model" ? "ai_live" as const : "ai_recorded" as const
      : selected.source === "supplemental" ? "ai_supplemented" as const
        : selected.source === "fixed" ? "profile_fixed" as const : "insufficient" as const;
    const fixedFallbackReasonCode = dynamic?.reasonCode === "review_rejected"
      ? "AI_REVIEW_REJECTED_FIXED"
      : dynamic?.reasonCode === "repair_exhausted"
        ? "AI_REPAIR_EXHAUSTED_FIXED"
        : dynamic?.reasonCode === "generation_timeout" || dynamicTimedOut
          ? "AI_GENERATION_TIMEOUT_FIXED"
          : "AI_UNAVAILABLE_FIXED";
    const fixedFallbackSummary = fixedFallbackReasonCode === "AI_REVIEW_REJECTED_FIXED"
      ? "AI候选已完成生成，但未通过Judge最终审核，正在选择固定保障内容。"
      : fixedFallbackReasonCode === "AI_REPAIR_EXHAUSTED_FIXED"
        ? "AI候选按Judge要求返修后仍未通过审核，正在选择固定保障内容。"
        : fixedFallbackReasonCode === "AI_GENERATION_TIMEOUT_FIXED"
          ? `AI题组生成超过${Math.ceil(this.dynamicGenerationTimeoutMs / 1_000)}秒未完成，正在选择固定保障内容。`
          : "模型服务未形成可审核题组，正在选择固定保障内容。";
    if (agentRun !== undefined && this.options.agentRuns !== undefined) {
      if (dynamicTimedOut) {
        const timeoutFinishedAt = this.now();
        const latestGenerator = [...agentRun.stages].reverse().find((stage) => stage.role === "generator");
        const timeoutStartedAt = latestGenerator?.status === "running" ? Date.parse(latestGenerator.startedAt) : timeoutFinishedAt.getTime();
        await this.options.agentRuns.append(agentRun.runId, {
          role: "generator", label: "Generator生成题组", status: "failed",
          startedAt: new Date(timeoutStartedAt).toISOString(), finishedAt: timeoutFinishedAt.toISOString(),
          durationMs: Math.max(0, timeoutFinishedAt.getTime() - timeoutStartedAt),
          attemptNumber: latestGenerator?.attemptNumber ?? 1,
          publicSummary: `Generator超过${Math.ceil(this.dynamicGenerationTimeoutMs / 1_000)}秒未返回，已停止等待并转入固定保障。`,
          metrics: [{ metricId: "failure-category", label: "失败类别", value: "generation_timeout", tone: "danger" }],
          issueCategories: ["生成超时"],
        });
      }
      const publishStartedAt = this.now();
      await this.options.agentRuns.append(agentRun.runId, {
        role: "publish", label: "发布题组或固定保障", status: "running", startedAt: publishStartedAt.toISOString(), attemptNumber: 1,
        publicSummary: selected.source === "dynamic" ? "正在发布已通过多Agent审核的AI题组。"
          : fixedFallbackSummary,
      });
      const publishFinishedAt = this.now();
      const isDynamic = selected.source === "dynamic";
      await this.options.agentRuns.append(agentRun.runId, {
        role: "publish", label: "发布题组或固定保障", status: isDynamic ? "succeeded" : selected.source === "insufficient" ? "failed" : "fallback",
        startedAt: publishStartedAt.toISOString(), finishedAt: publishFinishedAt.toISOString(),
        durationMs: Math.max(0, publishFinishedAt.getTime() - publishStartedAt.getTime()), attemptNumber: 1,
        publicSummary: isDynamic ? `已发布${selected.questions.length}道审核通过的AI客观题。`
          : selected.source === "insufficient" ? "AI题组和固定保障内容均不可用，本轮活动已阻塞。"
            : fixedFallbackReasonCode === "AI_REVIEW_REJECTED_FIXED"
              ? `AI候选未通过Judge最终审核，已切换为${selected.questions.length}道固定保障题。`
              : fixedFallbackReasonCode === "AI_REPAIR_EXHAUSTED_FIXED"
                ? `AI候选返修预算耗尽，已切换为${selected.questions.length}道固定保障题。`
                : fixedFallbackReasonCode === "AI_GENERATION_TIMEOUT_FIXED"
                  ? `AI题组生成超过${Math.ceil(this.dynamicGenerationTimeoutMs / 1_000)}秒仍未返回，已切换为${selected.questions.length}道固定保障题。`
                  : `模型服务未形成可审核题组，已切换为${selected.questions.length}道固定保障题。`,
        metrics: [
          { metricId: "question-count", label: "发布题量", value: `${selected.questions.length}道`, tone: selected.questions.length > 0 ? "success" : "danger" },
          { metricId: "content-origin", label: "内容来源", value: questionSource, tone: isDynamic ? "success" : "warning" },
        ],
      });
      await this.options.agentRuns.complete(agentRun.runId, {
        status: isDynamic ? "succeeded" : selected.source === "insufficient" ? "failed" : "fallback",
        finishedAt: publishFinishedAt.toISOString(),
        resultOrigin: isDynamic ? dynamic?.origin === "live_model" ? "ai_live" : "ai_recorded" : selected.source === "insufficient" ? "unknown" : "profile_fixed",
        questionCount: selected.questions.length,
        artifactSha256: quizQuestionSetSha256(selected.questions),
        ...(isDynamic || selected.source === "insufficient" ? {} : { fallbackReasonCode: selected.source === "supplemental" ? "AI_UNAVAILABLE_SUPPLEMENTAL" : fixedFallbackReasonCode }),
      });
    }
    let gradingBinding: QuizGradingBinding;
    if (selected.source === "dynamic") {
      if (dynamic?.status !== "accepted" || dynamic.reviewBinding === undefined
          || dynamic.reviewBinding.acceptedQuestionSetSha256 !== quizQuestionSetSha256(selected.questions)) {
        throw new QuizRuntimeError("submission_contract_error", "AI quiz is missing its accepted review binding");
      }
      gradingBinding = {
        source: "ai_reviewed",
        generationRunId: dynamic.reviewBinding.generationRunId,
        questionSetSha256: dynamic.reviewBinding.acceptedQuestionSetSha256,
      };
    } else {
      gradingBinding = {
        source: selected.source === "supplemental" ? "profile_supplemental"
          : selected.source === "fixed" ? "profile_fixed" : "none",
        questionSetSha256: quizQuestionSetSha256(selected.questions),
      };
    }
    const core = new DeterministicQuizRuntime();
    const opened = core.open({
      requestId: input.requestId,
      sessionId: input.sessionId,
      profileRevision: input.profileRevision,
      activity: assets.activity,
      questions: selected.questions,
      retryNumber,
      ...(agentRun === undefined ? {} : { agentRunId: agentRun.runId }),
      targetKnowledgePointIds,
      questionSource,
      gradingBinding,
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

  private toRemediationSafeView(
    context: QuizRemediationContext,
    lessonVariantId: LessonVariantId,
    targetKnowledgePointIds: string[],
    evidenceVersion: number,
  ): QuizRemediationSafeView {
    return {
      lessonVariantId,
      previousAttemptId: context.previousAttemptId,
      missedQuestionCount: context.missedQuestions.length,
      weakKnowledgePointIds: [...new Set(targetKnowledgePointIds)],
      learnerProfileSource: context.learnerProfileSource,
      // 画像 Agent 的安全摘要上限与公共 DTO 合同一致，保留完整可展示内容。
      publicRecommendation: context.learnerProfileSummary.slice(0, PUBLIC_RECOMMENDATION_MAX_LENGTH),
      evidenceVersion,
      evidenceRefCount: context.learnerProfileEvidenceRefs.length,
    };
  }

  private async recordPreparationStages(
    runId: string,
    lessonVariantId: LessonVariantId,
    assets: QuizActivityAssets,
    remediationContext: QuizRemediationContext | undefined,
  ): Promise<void> {
    if (this.options.agentRuns === undefined) return;
    const existing = await this.options.agentRuns.getByRunId(runId);
    const sourceComplete = existing?.stages.some((stage) => stage.role === "source" && stage.status === "succeeded") ?? false;
    const sourceClaimIds = (assets.allowedSourceAnchorIds ?? assets.knowledgePoint.sourceAnchorIds).slice(0, 32);
    if (!sourceComplete) {
      const sourceStartedAt = existing?.stages.find((stage) => stage.role === "source" && stage.status === "running")?.startedAt
        ?? this.now().toISOString();
      const sourceStartedMs = Date.parse(sourceStartedAt);
      const sourceFinishedAt = this.now();
      await this.options.agentRuns.append(runId, {
        role: "source", label: "教学依据准备", status: "succeeded",
        startedAt: Number.isFinite(sourceStartedMs) ? new Date(sourceStartedMs).toISOString() : sourceFinishedAt.toISOString(),
        finishedAt: sourceFinishedAt.toISOString(),
        durationMs: Number.isFinite(sourceStartedMs) ? Math.max(0, sourceFinishedAt.getTime() - sourceStartedMs) : 0,
        attemptNumber: 1,
        publicSummary: "已绑定当前章节正式中文正文；Agent只能据此生成题目，不能替换教材事实。",
        metrics: [
          { metricId: "lesson-variant", label: "正文版本", value: lessonVariantId, tone: "success" },
          { metricId: "source-count", label: "公开来源", value: `${sourceClaimIds.length}项`, tone: "neutral" },
        ],
        sourceClaimIds,
      });
    }
    const profileComplete = existing?.stages.some((stage) => stage.role === "profile" && stage.status === "succeeded") ?? false;
    if (profileComplete) return;
    const profileStartedAt = existing?.stages.find((stage) => stage.role === "profile" && stage.status === "running")?.startedAt
      ?? this.now().toISOString();
    const profileStartedMs = Date.parse(profileStartedAt);
    const profileRunning = existing?.stages.some((stage) => stage.role === "profile" && stage.status === "running") ?? false;
    if (!profileRunning) {
      await this.options.agentRuns.append(runId, {
        role: "profile", label: "学情画像分析", status: "running",
        startedAt: Number.isFinite(profileStartedMs) ? new Date(profileStartedMs).toISOString() : this.now().toISOString(), attemptNumber: 1,
        publicSummary: remediationContext === undefined ? "正在读取当前会话的确定性学情事实。" : "正在结合上一轮错题和学情画像形成补救重点。",
      });
    }
    const profileFinishedAt = this.now();
    const missedCount = remediationContext?.missedQuestions.length ?? 0;
    const evidenceCount = remediationContext?.learnerProfileEvidenceRefs.length ?? 0;
    await this.options.agentRuns.append(runId, {
      role: "profile", label: "学情画像分析", status: "succeeded",
      startedAt: Number.isFinite(profileStartedMs) ? new Date(profileStartedMs).toISOString() : profileFinishedAt.toISOString(),
      finishedAt: profileFinishedAt.toISOString(),
      durationMs: Number.isFinite(profileStartedMs) ? Math.max(0, profileFinishedAt.getTime() - profileStartedMs) : 0, attemptNumber: 1,
      publicSummary: remediationContext === undefined
        ? "已建立本轮生成所需的会话画像基线。"
        : `已识别上一轮${missedCount}道错题，生成时将重复考察对应薄弱知识。`,
      metrics: [
        { metricId: "missed-count", label: "上一轮错题", value: `${missedCount}道`, tone: missedCount > 0 ? "warning" : "success" },
        { metricId: "evidence-count", label: "画像证据", value: `${evidenceCount}项`, tone: "neutral" },
        { metricId: "profile-source", label: "画像来源", value: remediationContext?.learnerProfileSource ?? "deterministic", tone: remediationContext?.learnerProfileSource === "agent" ? "success" : "neutral" },
      ],
    });
  }

  private preparationStagesComplete(run: { stages: readonly { role: string; status: string }[] }): boolean {
    return ["source", "profile"].every((role) => run.stages.some((stage) => stage.role === role && stage.status === "succeeded"));
  }

  private async buildRemediationContext(
    snapshot: Awaited<ReturnType<LearningSessionRepository["getSnapshot"]>>,
    previousAttempt: QuizAttemptSnapshot,
    excludedQuestionIds: string[],
    excludedQuestionPrompts: string[],
  ): Promise<QuizRemediationContext> {
    const missedQuestions = (previousAttempt.result?.answerReview ?? [])
      .filter((item) => !item.correct)
      .map((item) => ({
        questionId: item.questionId,
        prompt: item.prompt,
        explanation: item.explanation,
        sourceAnchorIds: [...item.sourceAnchorIds],
      }));
    const profile = buildLearnerProfile({
      sessionId: snapshot.sessionId,
      profileRevision: snapshot.profileRevision,
      evidenceVersion: snapshot.latestCommit.evidenceVersion,
      evidence: snapshot.evidence,
      knowledgeStates: snapshot.knowledgeStates,
      latestDiagnostic: snapshot.latestDiagnostic,
      activityProgress: snapshot.activityProgress,
      diagnosticSkippedKnowledgePointIds: diagnosticSkippedKnowledgePointIdsFromPath(snapshot.path?.nodes),
    });
    const agentResult = this.options.profileAgent === undefined
      ? undefined
      : await this.options.profileAgent.summarize({ profile }).catch(() => undefined);
    const agentAccepted = agentResult?.status === "accepted"
      && agentResult.explanation !== undefined
      && agentResult.evidenceRefs !== undefined;
    return {
      previousAttemptId: previousAttempt.attemptId,
      excludedQuestionIds: [...excludedQuestionIds],
      excludedQuestionPrompts: [...excludedQuestionPrompts],
      missedQuestions,
      learnerProfileSummary: agentAccepted ? agentResult.explanation! : profile.deterministicSummary,
      learnerProfileEvidenceRefs: agentAccepted ? [...agentResult.evidenceRefs!] : [...profile.evidenceIds],
      learnerProfileSource: agentAccepted ? "agent" : "deterministic",
    };
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
    if (attempt.retryNumber > 0) {
      const previousAttemptId = entry.attemptIds.at(-2);
      const previousAttempt = previousAttemptId === undefined ? undefined : await this.options.sessions.getQuizAttempt({
        ...input,
        sessionVersion: snapshot.sessionVersion,
        attemptId: previousAttemptId,
      });
      const previousMissedQuestionCount = previousAttempt?.result?.answerReview?.filter((item) => !item.correct).length;
      const currentMissedQuestionCount = evaluated.result.answerReview?.filter((item) => !item.correct).length ?? 0;
      if (previousMissedQuestionCount !== undefined) {
        const targetKnowledgePointIds = attempt.targetKnowledgePointIds ?? [assets.knowledgePoint.id];
        const status = currentMissedQuestionCount < previousMissedQuestionCount ? "improved" as const
          : currentMissedQuestionCount > previousMissedQuestionCount ? "regressed" as const : "unchanged" as const;
        const remediationOutcome = {
          status,
          previousMissedQuestionCount,
          currentMissedQuestionCount,
          targetKnowledgePointIds: [...targetKnowledgePointIds],
          improvedKnowledgePointIds: status === "improved" ? [...targetKnowledgePointIds] : [],
          stillWeakKnowledgePointIds: currentMissedQuestionCount > 0 ? [...targetKnowledgePointIds] : [],
        };
        evaluated.result.remediationOutcome = remediationOutcome;
        if (evaluated.attempt.result !== undefined) evaluated.attempt.result.remediationOutcome = structuredClone(remediationOutcome);
      }
    }
    const retryPending = evaluated.result.verdict !== "pass";
    entry.status = retryPending ? "in_progress" : evaluated.result.verdict === "insufficient" ? "insufficient" : "completed";
    entry.result = evaluated.result.verdict;
    entry.bestResult = bestResult(entry.bestResult, evaluated.result.verdict);
    entry.quizRetryCount = retryPending ? attempt.retryNumber + 1 : attempt.retryNumber;
    delete entry.continuedWithGap;
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

  async continueActivityWithGap(input: ContinueActivityWithGapInput): Promise<ContinueActivityWithGapOutput> {
    const snapshot = await this.options.sessions.getBoundSnapshot(input.sessionId);
    if (snapshot.profileRevision !== input.profileRevision) throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match session");
    const progress = structuredClone(snapshot.activityProgress);
    const node = progress.find((item) => item.activities.some((activity) => activity.activityId === input.activityId));
    const entry = node?.activities.find((activity) => activity.activityId === input.activityId);
    const result = entry?.result;
    const replay = snapshot.latestCommit.requestId === input.requestId && entry?.continuedWithGap === true && entry.attemptIds.at(-1) === input.attemptId;
    if (replay && result !== undefined && result !== "pass") {
      return { requestId: input.requestId, sessionId: snapshot.sessionId, sessionVersion: snapshot.sessionVersion, profileRevision: snapshot.profileRevision, activityId: input.activityId, status: "insufficient", result, attemptCount: entry.attemptIds.length };
    }
    if (snapshot.sessionVersion !== input.sessionVersion) throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    if (entry === undefined || entry.status !== "in_progress" || entry.attemptIds.length < 2 || entry.attemptIds.at(-1) !== input.attemptId || result === undefined || result === "pass") {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Only a twice-attempted unresolved quiz can continue with a learning gap");
    }
    const attempt = await this.options.sessions.getQuizAttempt({ ...input, sessionVersion: snapshot.sessionVersion });
    if (attempt?.status !== "submitted") throw new LearningSessionRepositoryError("prerequisite_violation", "Latest quiz Attempt is not submitted");
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
        ...(suffix.path === undefined ? {} : { pathCandidate: toPathSafeSnapshot(suffix.path), internalPathCandidate: suffix.path }),
        nextStage: "learning",
      },
    });
    return { requestId: input.requestId, sessionId: committed.sessionId, sessionVersion: committed.sessionVersion, profileRevision: committed.profileRevision, activityId: input.activityId, status: "insufficient", result, attemptCount: entry.attemptIds.length };
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
        ...(attempt.agentRunId === undefined ? {} : { agentRunId: attempt.agentRunId }),
        ...(attempt.targetKnowledgePointIds === undefined ? {} : { targetKnowledgePointIds: [...attempt.targetKnowledgePointIds] }),
        questionSource: attempt.questionSource ?? "profile_fixed",
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
      ...(attempt.agentRunId === undefined ? {} : { agentRunId: attempt.agentRunId }),
      ...(attempt.targetKnowledgePointIds === undefined ? {} : { targetKnowledgePointIds: [...attempt.targetKnowledgePointIds] }),
      questionSource: attempt.questionSource ?? "profile_fixed",
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
        allowedSourceAnchorIds: [...new Set([...stored.sourceAnchorIds, ...point.sourceAnchorIds])],
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
      allowedSourceAnchorIds: [...new Set([...stored.sourceAnchorIds, ...point.sourceAnchorIds])],
      knowledgePoints: knowledgePoints.map((item) => ({ id: item.id, ...(item.requiresCodeEvidence === undefined ? {} : { requiresCodeEvidence: item.requiresCodeEvidence }) })),
      fixedQuestions: merge(stored.fixedQuestionGroupId, "fixed"),
      supplementalQuestions: stored.supplementalQuestionGroupId === undefined ? [] : merge(stored.supplementalQuestionGroupId, "supplemental"),
    };
  }
}
