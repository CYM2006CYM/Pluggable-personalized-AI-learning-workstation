import { createHash } from "node:crypto";
import type {
  AdaptiveContentPort,
  LessonJourneyContext,
  PersonalizedTipOutput,
  PreparePersonalizedTipInput,
} from "../contracts/index.js";
import type { AgentRunRepository } from "../infrastructure/agent-run-repository.js";
import type {
  InternalPersistedPathSnapshot,
  InternalPathSessionPort,
} from "../repositories/internal-path-session-port.js";
import type {
  BoundLearningCardSnapshot,
  LearningSessionRepository,
  SessionBindingReader,
} from "../repositories/learning-session-repository.js";
import { LearningSessionRepositoryError } from "../repositories/learning-session-repository.js";
import { isSelfContainedGuidingQuestion } from "../domain/personalized-lesson-guide.js";
import { attachPersonalizedTip, lessonVariantForPreference } from "./rich-lesson-selection.js";

type PersonalizedTipSessionPort = LearningSessionRepository & InternalPathSessionPort & SessionBindingReader;

export interface PersonalizedTipServiceOptions {
  sessions: PersonalizedTipSessionPort;
  content: AdaptiveContentPort;
  agentRuns: AgentRunRepository;
  now?: () => Date;
}

function cardSha256(card: object): string {
  return createHash("sha256").update(JSON.stringify(card), "utf8").digest("hex");
}

function hasStructuredLessonGuide(card: BoundLearningCardSnapshot["card"]): boolean {
  const tip = card.personalizedTip;
  return tip?.lessonOverview !== undefined
    && tip.priorConnection !== undefined
    && tip.learningFocus !== undefined
    && tip.nextConnection !== undefined
    && tip.studyAdvice !== undefined
    && isSelfContainedGuidingQuestion(tip.guidingQuestion);
}

function buildLessonJourney(
  path: InternalPersistedPathSnapshot,
  bindings: readonly BoundLearningCardSnapshot[],
  currentNodeId: string,
): LessonJourneyContext {
  const bindingByNodeId = new Map(bindings.map((binding) => [binding.nodeId, binding]));
  const lessons = path.nodes.flatMap((pathNode) => {
    const card = bindingByNodeId.get(pathNode.nodeId)?.card;
    return card?.selectedLesson === undefined ? [] : [{
      knowledgePointId: pathNode.knowledgePointId,
      title: card.title,
      objective: card.objective,
    }];
  });
  const currentKnowledgePointId = path.nodes.find((pathNode) => pathNode.nodeId === currentNodeId)?.knowledgePointId;
  const currentIndex = lessons.findIndex((lesson) => lesson.knowledgePointId === currentKnowledgePointId);
  if (currentIndex < 0) {
    throw new LearningSessionRepositoryError("prerequisite_violation", "Current RichLesson is missing from the lesson journey");
  }
  return {
    currentPosition: currentIndex + 1,
    totalLessons: lessons.length,
    lessons,
  };
}

export class PersonalizedTipService {
  readonly #now: () => Date;

  constructor(private readonly options: PersonalizedTipServiceOptions) {
    this.#now = options.now ?? (() => new Date());
  }

  async prepare(input: PreparePersonalizedTipInput): Promise<PersonalizedTipOutput> {
    const snapshot = await this.options.sessions.getSnapshot(input);
    const path = await this.options.sessions.getInternalPathSnapshot(input);
    if (path?.pathVersion !== input.pathVersion || path.status !== "active") {
      throw new LearningSessionRepositoryError("path_version_conflict", "Personalized tip path is not active");
    }
    const node = path.nodes.find((item) => item.nodeId === input.nodeId);
    if (node === undefined) throw new LearningSessionRepositoryError("path_version_conflict", "Personalized tip node is not on the active path");
    const bindings = await this.options.sessions.getBoundLearningCards(input);
    const binding = bindings.find((item) => item.nodeId === input.nodeId);
    if (binding?.card.selectedLesson === undefined) {
      throw new LearningSessionRepositoryError("prerequisite_violation", "Personalized tip requires a bound RichLesson");
    }
    if (hasStructuredLessonGuide(binding.card)) {
      return {
        requestId: input.requestId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        pathVersion: input.pathVersion,
        nodeId: input.nodeId,
        status: "generated",
        card: structuredClone(binding.card),
        ...(binding.card.personalizedTipAgentRunId === undefined ? {} : { agentRunId: binding.card.personalizedTipAgentRunId }),
      };
    }

    const run = await this.options.agentRuns.create({
      requestId: input.requestId,
      sessionId: input.sessionId,
      activityId: input.nodeId,
      profileRevision: input.profileRevision,
      pathVersion: input.pathVersion,
      evidenceVersion: snapshot.latestCommit.evidenceVersion,
    });
    const knowledgeState = snapshot.knowledgeStates.find((item) => item.knowledgePointId === node.knowledgePointId);
    const explanationPreference = snapshot.diagnosticDraft?.background?.explanation_preference ?? "step_by_step";
    const journey = buildLessonJourney(path, bindings, input.nodeId);
    if (run.stages.length === 0) await this.recordPreparationStages(run.runId, binding.card, knowledgeState, journey);
    const dynamic = await this.options.content.prepareCard({
      profileRevision: input.profileRevision,
      knowledgePointId: node.knowledgePointId,
      excludedArtifactIds: [binding.card.cardId],
      lessonVariantId: lessonVariantForPreference(explanationPreference),
      personalizationContext: {
        knowledgeStatus: knowledgeState?.status ?? "unverified",
        mastery: knowledgeState?.mastery ?? null,
        confidence: knowledgeState?.confidence ?? 0,
        validEvidenceCount: knowledgeState?.validEvidenceCount ?? 0,
        evidenceFormCount: knowledgeState?.evidenceFormCount ?? 0,
        explanationPreference,
        journey,
      },
      agentRunId: run.runId,
    });
    await this.ensureGeneratorStage(run.runId);

    const publishStartedAt = this.#now();
    await this.options.agentRuns.append(run.runId, {
      role: "publish",
      label: "发布个性化提醒",
      status: "running",
      startedAt: publishStartedAt.toISOString(),
      attemptNumber: 1,
      publicSummary: dynamic.status === "accepted"
        ? "正在把通过审核的个性化提醒绑定到当前Session。"
        : "本次没有形成通过审核的提醒，正在保留完整正式正文。",
    });

    if (dynamic.status !== "accepted" || dynamic.card === undefined || dynamic.reviewBinding === undefined
        || dynamic.reviewBinding.acceptedCardSha256 !== cardSha256(dynamic.card)) {
      const finishedAt = this.#now();
      await this.options.agentRuns.append(run.runId, {
        role: "publish",
        label: "发布个性化提醒",
        status: "fallback",
        startedAt: publishStartedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - publishStartedAt.getTime()),
        attemptNumber: 1,
        publicSummary: "本次提醒未通过完整审核；正式教学正文保持可用。",
        metrics: [{ metricId: "content-origin", label: "当前内容", value: "正式正文", tone: "warning" }],
      });
      await this.options.agentRuns.complete(run.runId, {
        status: "fallback",
        finishedAt: finishedAt.toISOString(),
        resultOrigin: "profile_fixed",
        questionCount: 0,
        fallbackReasonCode: "TIP_NOT_GENERATED",
      });
      return {
        requestId: input.requestId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion,
        profileRevision: input.profileRevision,
        pathVersion: input.pathVersion,
        nodeId: input.nodeId,
        status: "unavailable",
        card: structuredClone(binding.card),
        agentRunId: run.runId,
      };
    }

    const card = attachPersonalizedTip(binding.card, dynamic.card, run.runId);
    const nextBindings = bindings.map((item) => item.nodeId === input.nodeId
      ? { ...item, source: "fixed" as const, card }
      : item);
    const committed = await this.options.sessions.commit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      candidate: {
        requestId: input.requestId,
        knowledgeStates: snapshot.knowledgeStates,
        boundLearningCards: nextBindings,
      },
    });
    const finishedAt = this.#now();
    await this.options.agentRuns.append(run.runId, {
      role: "publish",
      label: "发布个性化提醒",
      status: "succeeded",
      startedAt: publishStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - publishStartedAt.getTime()),
      attemptNumber: 1,
      publicSummary: "已把通过多Agent审核的个性化提醒绑定到当前Session。",
      metrics: [{ metricId: "content-origin", label: "提醒来源", value: dynamic.origin === "live_model" ? "ai_live" : "ai_recorded", tone: "success" }],
      sourceClaimIds: [...card.personalizedTip!.sourceAnchorIds],
    });
    await this.options.agentRuns.complete(run.runId, {
      status: "succeeded",
      finishedAt: finishedAt.toISOString(),
      resultOrigin: dynamic.origin === "live_model" ? "ai_live" : "ai_recorded",
      questionCount: 0,
      artifactSha256: dynamic.reviewBinding.acceptedCardSha256,
    });
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: input.profileRevision,
      pathVersion: input.pathVersion,
      nodeId: input.nodeId,
      status: "generated",
      card,
      agentRunId: run.runId,
    };
  }

  private async recordPreparationStages(
    runId: string,
    card: { selectedLesson?: { variantId: string }; sourceAnchorIds: string[] },
    knowledgeState: { status: string; mastery: number | null; confidence: number; validEvidenceCount: number } | undefined,
    journey: LessonJourneyContext,
  ): Promise<void> {
    const startedAt = this.#now();
    await this.options.agentRuns.append(runId, {
      role: "source",
      label: "教学依据准备",
      status: "running",
      startedAt: startedAt.toISOString(),
      attemptNumber: 1,
      publicSummary: "正在绑定当前章节正式中文正文、讲解版本和公开来源。",
    });
    const finishedAt = this.#now();
    await this.options.agentRuns.append(runId, {
      role: "source",
      label: "教学依据准备",
      status: "succeeded",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      attemptNumber: 1,
      publicSummary: "已绑定正式正文；提醒只能提供阅读辅助，不能替换教材事实。",
      metrics: [
        { metricId: "lesson-variant", label: "正文版本", value: card.selectedLesson?.variantId ?? "legacy", tone: "success" },
        { metricId: "lesson-position", label: "章节位置", value: `${journey.currentPosition}/${journey.totalLessons}`, tone: "neutral" },
        { metricId: "source-count", label: "公开来源", value: `${card.sourceAnchorIds.length}项`, tone: "neutral" },
      ],
      sourceClaimIds: [...card.sourceAnchorIds],
    });
    const profileStartedAt = this.#now();
    await this.options.agentRuns.append(runId, {
      role: "profile",
      label: "学情画像分析",
      status: "running",
      startedAt: profileStartedAt.toISOString(),
      attemptNumber: 1,
      publicSummary: "正在读取当前章节的确定性学情状态和讲解偏好。",
    });
    const profileFinishedAt = this.#now();
    await this.options.agentRuns.append(runId, {
      role: "profile",
      label: "学情画像分析",
      status: "succeeded",
      startedAt: profileStartedAt.toISOString(),
      finishedAt: profileFinishedAt.toISOString(),
      durationMs: Math.max(0, profileFinishedAt.getTime() - profileStartedAt.getTime()),
      attemptNumber: 1,
      publicSummary: knowledgeState === undefined
        ? "本节尚无充分学情证据，提醒将侧重讲解偏好和正文阅读顺序。"
        : "已读取本节当前掌握状态；提醒将据此选择需要优先关注的正文内容。",
      metrics: [
        { metricId: "knowledge-status", label: "当前状态", value: knowledgeState?.status ?? "evidence_insufficient", tone: knowledgeState === undefined ? "warning" : "neutral" },
        { metricId: "mastery", label: "掌握度", value: knowledgeState?.mastery === null || knowledgeState?.mastery === undefined ? "暂无" : knowledgeState.mastery.toFixed(2), tone: "neutral" },
        { metricId: "evidence-count", label: "画像证据", value: `${knowledgeState?.validEvidenceCount ?? 0}项`, tone: "neutral" },
      ],
    });
  }

  private async ensureGeneratorStage(runId: string): Promise<void> {
    const current = await this.options.agentRuns.getByRunId(runId);
    if (current?.currentStage !== "profile") return;
    const timestamp = this.#now();
    await this.options.agentRuns.append(runId, {
      role: "generator",
      label: "Generator生成候选内容",
      status: "skipped",
      startedAt: timestamp.toISOString(),
      finishedAt: timestamp.toISOString(),
      durationMs: 0,
      attemptNumber: 1,
      publicSummary: "模型服务未形成可审核候选，本次没有进入后续审核工位。",
    });
  }
}
