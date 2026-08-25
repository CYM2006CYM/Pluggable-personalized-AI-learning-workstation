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
import { attachLearnerProfileAgentResult, buildLearnerProfile } from "../domain/learner-profile.js";
import type { LearnerProfileAgentPort } from "./learner-profile-agent-service.js";

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
    }
    return context.output;
  }

  async continueActivityWithGap(input: ContinueActivityWithGapInput): Promise<ContinueActivityWithGapOutput> {
    const kind = await this.options.resolveActivityKind(input);
    switch (kind) {
      case "code": return this.options.codeActivity.continueActivityWithGap(input);
      case "quiz": return this.options.quizActivity.continueActivityWithGap(input);
    }
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

  async completeSession(input: CompleteSessionInput): Promise<CompleteSessionOutput> {
    const snapshot = await this.options.sessions.getSnapshot(input);
    if (snapshot.sessionVersion !== input.sessionVersion) throw new LearningSessionRepositoryError("session_version_conflict", "Session version is stale");
    const profile = await this.options.profile.load(snapshot.view.subjectId, snapshot.profileRevision);
    const finalActivityId = profile.goals.find((goal) => goal.goalId === snapshot.view.goalId)?.finalActivityId;
    if (finalActivityId === undefined) throw new LearningSessionRepositoryError("prerequisite_violation", "Goal has no final practical binding");
    const practical = snapshot.evidence.filter((item) => item.kind === "coding_practical" && item.impact === "mastery" && item.activityId === finalActivityId);
    if (practical.length === 0) throw new LearningSessionRepositoryError("prerequisite_violation", "Final practical has no formal learner verdict");
    const issues = new Set<string>();
    for (const item of snapshot.activityProgress.flatMap((node) => node.activities)) {
      if (item.result === "fail" || item.result === "partial" || item.result === "insufficient") issues.add(`${item.activityId}:${item.result}`);
    }
    for (const state of snapshot.knowledgeStates) if (state.status === "unverified" || state.status === "support_needed") issues.add(`${state.knowledgePointId}:${state.status}`);
    const learningProfile = buildLearnerProfile({
      sessionId: snapshot.sessionId,
      profileRevision: snapshot.profileRevision,
      evidenceVersion: snapshot.latestCommit?.evidenceVersion ?? snapshot.knowledgeStates[0]?.evidenceVersion ?? snapshot.evidence.length,
      evidence: snapshot.evidence,
      knowledgeStates: snapshot.knowledgeStates,
      latestDiagnostic: snapshot.latestDiagnostic,
      activityProgress: snapshot.activityProgress,
    });
    const agentResult = this.options.profileAgent === undefined ? undefined : await this.options.profileAgent.summarize({ profile: learningProfile }).catch(() => undefined);
    const enrichedProfile = agentResult?.status === "accepted" && agentResult.explanation !== undefined && agentResult.evidenceRefs !== undefined
      ? attachLearnerProfileAgentResult(learningProfile, { explanation: agentResult.explanation, evidenceRefs: agentResult.evidenceRefs, runId: agentResult.runId })
      : learningProfile;
    const unresolvedSummary = issues.size === 0
      ? "Session completed. No unresolved deterministic result was recorded."
      : `Session completed with unresolved items: ${[...issues].sort((left, right) => left.localeCompare(right, "en")).join(", ")}.`;
    const summary = `${enrichedProfile.deterministicSummary}${enrichedProfile.agentExplanation === undefined ? "" : `\n\n画像 Agent：${enrichedProfile.agentExplanation}`}\n\n${unresolvedSummary}`;
    const committed = await this.options.sessions.commit({
      ...input,
      candidate: { requestId: input.requestId, knowledgeStates: snapshot.knowledgeStates, nextStage: "completed" },
    });
    return {
      requestId: input.requestId,
      sessionId: committed.sessionId,
      sessionVersion: committed.sessionVersion,
      profileRevision: committed.profileRevision,
      completedAt: this.now().toISOString(),
      summary,
      learningProfile: enrichedProfile,
      ...(issues.size === 0 ? {} : { nextRecommendation: "Review the unresolved items before starting a new goal." }),
    };
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
