import type {
  ActivityAttemptSafeView,
  ActivityDraftOutput,
  ActivityRecoveryOutput,
  ActivitySubmissionOutput,
  CompleteSessionInput,
  CompleteSessionOutput,
  ContextAnswerOutput,
  ContextQuestionInput,
  GetActivityAttemptInput,
  LearningRuntimeFacade,
  OpenActivityInput,
  PrepareActivityRunInput,
  PreparedActivityOutput,
  RecoverActivityInput,
  SaveActivityDraftInput,
  SubmitActivityInput,
} from "../contracts/facade.js";
import type { CapabilityTaskPort, ContinueActivityWithGapInput, ContinueActivityWithGapOutput } from "../contracts/index.js";
import { LearningSessionRepositoryError, type LearningSessionRepository } from "../repositories/learning-session-repository.js";
import type { PathEngineProfile } from "../domain/path-engine.js";
import type { RuntimeCommitContext, RuntimeCommitSnapshot } from "./runtime-commit-context.js";
import { attachLearnerProfileAgentResult, buildLearnerProfile, diagnosticSkippedKnowledgePointIdsFromPath } from "../domain/learner-profile.js";
import type { LearnerProfileAgentPort } from "./learner-profile-agent-service.js";
import type { LearnerProfileHistoryCapturePort } from "./learner-profile-history-service.js";
import type { SessionCompletionArchiveRepository } from "../infrastructure/session-completion-archive-repository.js";
import type { AgentRunRepository } from "../infrastructure/agent-run-repository.js";

type SessionMethods = Pick<LearningRuntimeFacade, "startSession">;
type DiagnosticMethods = Pick<LearningRuntimeFacade, "saveDiagnosticDraft" | "submitDiagnosticAnswer" | "completeDiagnostic"> & {
  completeDiagnosticWithContext?(input: Parameters<LearningRuntimeFacade["completeDiagnostic"]>[0]): Promise<RuntimeCommitContext<Awaited<ReturnType<LearningRuntimeFacade["completeDiagnostic"]>>>>;
};
type PathMethods = Pick<LearningRuntimeFacade, "recoverSession" | "buildPath" | "confirmPath" | "getNextStep" | "replanPath">;
type ActivityMethods = Pick<LearningRuntimeFacade, "openActivity" | "saveActivityDraft" | "prepareActivityRun" | "submitActivity" | "continueActivityWithGap" | "getActivityAttempt" | "recoverActivity"> & {
  submitActivityWithContext?(input: SubmitActivityInput): Promise<RuntimeCommitContext<ActivitySubmissionOutput>>;
};
type QuizActivityMethods = Pick<ActivityMethods, "openActivity" | "submitActivity" | "continueActivityWithGap" | "getActivityAttempt" | "submitActivityWithContext">;

export interface ComposedLearningRuntimeFacadeOptions {
  session: SessionMethods;
  diagnostic: DiagnosticMethods;
  path: PathMethods;
  codeActivity: ActivityMethods;
  quizActivity: QuizActivityMethods;
  sessions: LearningSessionRepository;
  profile: { load(subjectId: string, profileRevision: number): Promise<PathEngineProfile> };
  capabilityTasks?: CapabilityTaskPort;
  profileAgent?: LearnerProfileAgentPort;
  profileHistory?: LearnerProfileHistoryCapturePort;
  completionArchive?: SessionCompletionArchiveRepository;
  agentRuns?: Pick<AgentRunRepository, "create" | "append" | "complete" | "listBySession">;
  resolveActivityKind(input: { sessionId: string; profileRevision: number; activityId: string }): Promise<"code" | "quiz">;
  now?: () => Date;
}

/** Importable A composition root. HTTP and web adapters only call this contract. */
export class ComposedLearningRuntimeFacade implements LearningRuntimeFacade {
  private readonly now: () => Date;

  constructor(private readonly options: ComposedLearningRuntimeFacadeOptions) {
    this.now = options.now ?? (() => new Date());
  }

  startSession: LearningRuntimeFacade["startSession"] = (input) => this.options.session.startSession(input);
  recoverSession: LearningRuntimeFacade["recoverSession"] = (input) => this.options.path.recoverSession(input);
  saveDiagnosticDraft: LearningRuntimeFacade["saveDiagnosticDraft"] = (input) => this.options.diagnostic.saveDiagnosticDraft(input);
  submitDiagnosticAnswer: LearningRuntimeFacade["submitDiagnosticAnswer"] = (input) => this.options.diagnostic.submitDiagnosticAnswer(input);
  completeDiagnostic: LearningRuntimeFacade["completeDiagnostic"] = async (input) => {
    if (this.options.diagnostic.completeDiagnosticWithContext === undefined) {
      if (this.options.capabilityTasks !== undefined) throw new Error("Diagnostic runtime does not expose commit context for capability tasks");
      return this.options.diagnostic.completeDiagnostic(input);
    }
    const context = await this.options.diagnostic.completeDiagnosticWithContext(input);
    if (!context.replayed) {
      void this.options.capabilityTasks?.enqueue({
        trigger: "diagnostic_completed",
        sessionId: context.output.sessionId,
        profileRevision: context.output.profileRevision,
        evidenceVersion: context.output.evidenceVersion,
        evidenceIds: context.output.knowledgeStates.flatMap((state) => state.evidenceIds),
      }).catch(() => undefined);
      this.options.profileHistory?.enqueue({ sessionId: context.output.sessionId, trigger: "diagnostic_completed" });
    }
    return context.output;
  };
  buildPath: LearningRuntimeFacade["buildPath"] = (input) => this.options.path.buildPath(input);
  confirmPath: LearningRuntimeFacade["confirmPath"] = (input) => this.options.path.confirmPath(input);
  getNextStep: LearningRuntimeFacade["getNextStep"] = (input) => this.options.path.getNextStep(input);
  replanPath: LearningRuntimeFacade["replanPath"] = (input) => this.options.path.replanPath(input);

  async openActivity(input: OpenActivityInput): Promise<ActivityDraftOutput> {
    const kind = await this.options.resolveActivityKind(input);
    switch (kind) {
      case "code": return this.options.codeActivity.openActivity(input);
      case "quiz": return this.options.quizActivity.openActivity(input);
    }
  }

  saveActivityDraft(input: SaveActivityDraftInput): Promise<ActivityDraftOutput> {
    return this.options.codeActivity.saveActivityDraft(input);
  }

  prepareActivityRun(input: PrepareActivityRunInput): Promise<PreparedActivityOutput> {
    return this.options.codeActivity.prepareActivityRun(input);
  }

  async submitActivity(input: SubmitActivityInput): Promise<ActivitySubmissionOutput> {
    let context: RuntimeCommitContext<ActivitySubmissionOutput>;
    switch (input.kind) {
      case "code":
        if (this.options.codeActivity.submitActivityWithContext === undefined) {
          if (this.options.capabilityTasks !== undefined) throw new Error("Code runtime does not expose commit context for capability tasks");
          return this.options.codeActivity.submitActivity(input);
        }
        context = await this.options.codeActivity.submitActivityWithContext(input);
        break;
      case "quiz":
        if (this.options.quizActivity.submitActivityWithContext === undefined) {
          if (this.options.capabilityTasks !== undefined) throw new Error("Quiz runtime does not expose commit context for capability tasks");
          return this.options.quizActivity.submitActivity(input);
        }
        context = await this.options.quizActivity.submitActivityWithContext(input);
        break;
    }
    if (context.output.committed && !context.replayed && context.snapshot !== undefined) {
      void this.enqueueCompletedNode(input.activityId, context.output, context.snapshot).catch(() => undefined);
      this.options.profileHistory?.enqueue({
        sessionId: context.output.sessionId,
        trigger: input.kind === "quiz" ? "quiz_submitted" : "code_submitted",
      });
    }
    return context.output;
  }

  async continueActivityWithGap(input: ContinueActivityWithGapInput): Promise<ContinueActivityWithGapOutput> {
    const kind = await this.options.resolveActivityKind(input);
    let output: ContinueActivityWithGapOutput;
    switch (kind) {
      case "code": output = await this.options.codeActivity.continueActivityWithGap(input); break;
      case "quiz": output = await this.options.quizActivity.continueActivityWithGap(input); break;
    }
    this.options.profileHistory?.enqueue({ sessionId: output.sessionId, trigger: "continued_with_gap" });
    return output;
  }

  async getActivityAttempt(input: GetActivityAttemptInput): Promise<ActivityAttemptSafeView> {
    const kind = await this.options.resolveActivityKind(input);
    switch (kind) {
      case "code": return this.options.codeActivity.getActivityAttempt(input);
      case "quiz": return this.options.quizActivity.getActivityAttempt(input);
    }
  }

  recoverActivity(input: RecoverActivityInput): Promise<ActivityRecoveryOutput> {
    return this.options.codeActivity.recoverActivity(input);
  }

  private async beginSummaryStage(
    runId: string | undefined,
    role: "source" | "profile" | "generator" | "safety" | "publish",
    label: string,
    publicSummary: string,
  ): Promise<number> {
    const startedAt = this.now().getTime();
    if (runId !== undefined) {
      await this.options.agentRuns?.append(runId, {
        role,
        label,
        status: "running",
        startedAt: new Date(startedAt).toISOString(),
        attemptNumber: 1,
        publicSummary,
      });
    }
    return startedAt;
  }

  private async finishSummaryStage(
    runId: string | undefined,
    role: "source" | "profile" | "generator" | "safety" | "publish",
    label: string,
    startedAt: number,
    status: "succeeded" | "fallback" | "failed",
    publicSummary: string,
    metrics: Array<{ metricId: string; label: string; value: string; tone: "neutral" | "success" | "warning" | "danger" }> = [],
    issueCategories: string[] = [],
  ): Promise<void> {
    if (runId === undefined) return;
    const finishedAt = this.now().getTime();
    await this.options.agentRuns?.append(runId, {
      role,
      label,
      status,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - startedAt),
      attemptNumber: 1,
      publicSummary,
      metrics,
      issueCategories,
    });
  }

  async completeSession(input: CompleteSessionInput): Promise<CompleteSessionOutput> {
    const archived = await this.options.completionArchive?.get(input.sessionId);
    if (archived !== undefined) {
      if (archived.profileRevision !== input.profileRevision) throw new LearningSessionRepositoryError("profile_revision_conflict", "Profile revision does not match completed archive");
      return { ...structuredClone(archived.output), requestId: input.requestId };
    }
    const snapshot = await this.options.sessions.getSnapshot(input);
    if (snapshot.sessionVersion !== input.sessionVersion && snapshot.view.status !== "completed") throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    const profile = await this.options.profile.load(snapshot.view.subjectId, snapshot.profileRevision);
    const finalActivityId = profile.goals.find((goal) => goal.goalId === snapshot.view.goalId)?.finalActivityId;
    if (finalActivityId === undefined) throw new LearningSessionRepositoryError("prerequisite_violation", "Goal has no final practical binding");
    const practical = snapshot.evidence.filter((item) => item.kind === "coding_practical" && item.impact === "mastery" && item.activityId === finalActivityId);
    if (practical.length === 0) throw new LearningSessionRepositoryError("prerequisite_violation", "Final practical has no formal learner verdict");
    let summaryRunId: string | undefined;
    if (this.options.agentRuns !== undefined) {
      const run = await this.options.agentRuns.create({
        requestId: input.requestId,
        sessionId: snapshot.sessionId,
        activityId: "session-summary",
        profileRevision: snapshot.profileRevision,
        pathVersion: snapshot.path?.pathVersion ?? 1,
        evidenceVersion: snapshot.latestCommit?.evidenceVersion ?? snapshot.evidence.length,
      });
      summaryRunId = run.runId;
    }
    const sourceStartedAt = await this.beginSummaryStage(summaryRunId, "source", "正式学习证据汇总", "正在读取本次会话的诊断、作答、实操和带缺口记录。");
    const issues = new Set<string>();
    for (const item of snapshot.activityProgress.flatMap((node) => node.activities)) {
      if (item.result === "fail" || item.result === "partial" || item.result === "insufficient") issues.add(`${item.activityId}:${item.result}`);
    }
    for (const state of snapshot.knowledgeStates) if (state.status === "unverified" || state.status === "support_needed") issues.add(`${state.knowledgePointId}:${state.status}`);
    await this.finishSummaryStage(summaryRunId, "source", "正式学习证据汇总", sourceStartedAt, "succeeded", "已完成正式证据和未解决项目汇总。", [
      { metricId: "evidence-count", label: "正式证据", value: `${snapshot.evidence.length}条`, tone: "success" },
      { metricId: "unresolved-count", label: "未解决项", value: `${issues.size}项`, tone: issues.size === 0 ? "success" : "warning" },
    ]);
    const profileStartedAt = await this.beginSummaryStage(summaryRunId, "profile", "确定性学情画像", "正在计算学习前后状态、掌握情况和仍需支持的知识点。");
    const learningProfile = buildLearnerProfile({
      sessionId: snapshot.sessionId,
      profileRevision: snapshot.profileRevision,
      evidenceVersion: snapshot.latestCommit?.evidenceVersion ?? snapshot.knowledgeStates[0]?.evidenceVersion ?? snapshot.evidence.length,
      evidence: snapshot.evidence,
      knowledgeStates: snapshot.knowledgeStates,
      latestDiagnostic: snapshot.latestDiagnostic,
      activityProgress: snapshot.activityProgress,
      diagnosticSkippedKnowledgePointIds: diagnosticSkippedKnowledgePointIdsFromPath(snapshot.path?.nodes),
    });
    await this.finishSummaryStage(summaryRunId, "profile", "确定性学情画像", profileStartedAt, "succeeded", "已建立不可由Agent改写的学情事实基线。", [
      { metricId: "knowledge-count", label: "知识状态", value: `${learningProfile.currentKnowledgeStates.length}个`, tone: "neutral" },
      { metricId: "support-count", label: "仍需支持", value: `${learningProfile.supportNeeded.length}个`, tone: learningProfile.supportNeeded.length === 0 ? "success" : "warning" },
    ]);
    const generatorStartedAt = await this.beginSummaryStage(summaryRunId, "generator", "学情画像Agent总结", "学情画像Agent正在根据正式证据组织学习成果、进步和后续建议。");
    const agentResult = this.options.profileAgent === undefined ? undefined : await this.options.profileAgent.summarize({ profile: learningProfile }).catch(() => undefined);
    const agentAccepted = agentResult?.status === "accepted" && agentResult.explanation !== undefined && agentResult.evidenceRefs !== undefined;
    await this.finishSummaryStage(
      summaryRunId,
      "generator",
      "学情画像Agent总结",
      generatorStartedAt,
      agentAccepted ? "succeeded" : "fallback",
      agentAccepted ? "学情画像Agent已形成基于正式证据的总结草稿。" : "学情画像Agent未形成可采用结果，已切换到确定性事实总结。",
      [{ metricId: "agent-evidence", label: "引用证据", value: `${agentResult?.evidenceRefs?.length ?? 0}条`, tone: agentAccepted ? "success" : "warning" }],
      agentAccepted ? [] : ["Agent总结不可用"],
    );
    const enrichedProfile = agentResult?.status === "accepted" && agentResult.explanation !== undefined && agentResult.evidenceRefs !== undefined
      ? attachLearnerProfileAgentResult(learningProfile, { explanation: agentResult.explanation, evidenceRefs: agentResult.evidenceRefs, runId: agentResult.runId })
      : learningProfile;
    const safetyStartedAt = await this.beginSummaryStage(summaryRunId, "safety", "事实与引用核验", "正在核对Agent表述与确定性学情事实是否一致。");
    await this.finishSummaryStage(summaryRunId, "safety", "事实与引用核验", safetyStartedAt, "succeeded", agentAccepted
      ? "Agent总结已通过证据绑定和事实一致性检查。"
      : "确定性事实摘要已通过安全边界检查，可作为可靠回退。", [
      { metricId: "summary-source", label: "总结来源", value: agentAccepted ? "画像Agent + 确定性事实" : "确定性事实", tone: agentAccepted ? "success" : "warning" },
    ]);
    const unresolvedSummary = issues.size === 0
      ? "本次学习已完成，没有记录到尚未解决的确定性结果。"
      : `本次学习已完成，但仍有 ${issues.size} 个项目需要继续复习。`;
    const summary = `${enrichedProfile.deterministicSummary}${enrichedProfile.agentExplanation === undefined ? "" : `\n\n画像 Agent：${enrichedProfile.agentExplanation}`}\n\n${unresolvedSummary}`;
    const committed = snapshot.view.status === "completed" ? snapshot : await this.options.sessions.commit({
      ...input,
      candidate: { requestId: input.requestId, knowledgeStates: snapshot.knowledgeStates, nextStage: "completed" },
    });
    const completedAt = this.now().toISOString();
    const publishStartedAt = await this.beginSummaryStage(summaryRunId, "publish", "总结归档", "正在冻结本次总结，确保刷新和恢复后结果不变。");
    const output: CompleteSessionOutput = {
      requestId: input.requestId,
      sessionId: committed.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: committed.profileRevision,
      completedAt,
      summary,
      learningProfile: enrichedProfile,
      ...(issues.size === 0 ? {} : { nextRecommendation: "建议先复习下方尚未解决的项目，再开始新的学习目标。" }),
    };
    if (this.options.completionArchive !== undefined) {
      const agentRunIds = this.options.agentRuns === undefined ? [] : (await this.options.agentRuns.listBySession(committed.sessionId)).map((run) => run.runId);
      await this.options.completionArchive.create({
        sessionId: committed.sessionId,
        sessionVersion: committed.sessionVersion,
        profileRevision: committed.profileRevision,
        evidenceVersion: committed.latestCommit.evidenceVersion,
        createdAt: completedAt,
        output,
        unresolvedFacts: [...issues].sort((left, right) => left.localeCompare(right, "en")),
        agentRunIds,
      });
    }
    await this.finishSummaryStage(summaryRunId, "publish", "总结归档", publishStartedAt, "succeeded", "总结已冻结保存，可以稳定展示和恢复。", [
      { metricId: "session-version", label: "会话版本", value: `v${committed.sessionVersion}`, tone: "success" },
    ]);
    if (summaryRunId !== undefined) {
      await this.options.agentRuns?.complete(summaryRunId, {
        status: agentAccepted ? "succeeded" : "fallback",
        finishedAt: this.now().toISOString(),
        resultOrigin: agentAccepted ? "unknown" : "profile_fixed",
        questionCount: 0,
        ...(agentAccepted ? {} : { fallbackReasonCode: "PROFILE_AGENT_UNAVAILABLE" }),
      });
    }
    this.options.profileHistory?.enqueue({ sessionId: committed.sessionId, trigger: "session_completed" });
    return output;
  }

  async askContextQuestion(input: ContextQuestionInput): Promise<ContextAnswerOutput> {
    const snapshot = await this.options.sessions.getSnapshot(input);
    if (snapshot.sessionVersion !== input.sessionVersion) throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    if (snapshot.path?.pathVersion !== input.pathVersion || !snapshot.path.nodes.some((node) => node.nodeId === input.nodeId)) {
      throw new LearningSessionRepositoryError("path_version_conflict", "Question context is not on the current path");
    }
    return {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      profileRevision: input.profileRevision,
      answer: "Use the current card and activity feedback as the authoritative context. No additional private material is available.",
      sourceAnchorIds: [],
    };
  }

  private async enqueueCompletedNode(activityId: string, submitted: ActivitySubmissionOutput, snapshot: RuntimeCommitSnapshot): Promise<void> {
    if (this.options.capabilityTasks === undefined) return;
    const node = snapshot.activityProgress.find((entry) => entry.activities.some((activity) => activity.activityId === activityId));
    if (node === undefined || !node.activities.every((activity) => activity.status === "completed" || activity.status === "insufficient")) return;
    const knowledgePointId = snapshot.path?.nodes.find((item) => item.nodeId === node.nodeId)?.knowledgePointId;
    await this.options.capabilityTasks.enqueue({
      trigger: "node_completed",
      sessionId: submitted.sessionId,
      profileRevision: submitted.profileRevision,
      evidenceVersion: snapshot.latestCommit.evidenceVersion,
      ...(knowledgePointId === undefined ? {} : { knowledgePointId }),
      evidenceIds: snapshot.evidence.filter((item) => item.knowledgePointId === knowledgePointId).map((item) => item.evidenceId),
    });
  }
}
