import type {
  AppBootstrapFacade,
  AppBootstrapSafeView,
  CurrentAttemptSafeReference,
  DiagnosticDraftSafeView,
  DiagnosticSafeEnvelope,
  NodeActivityProgress,
  PathNodeSafeView,
  SessionSafeView,
  SessionRecoverySafeView,
} from "../contracts/index.js";
import { DiagnosticValidationError, parseDiagnosticBlueprint } from "../domain/diagnostic.js";
import type { LearningSessionCatalogPort, SessionBindingReader } from "../repositories/learning-session-repository.js";
import type { InternalPathSessionPort } from "../repositories/internal-path-session-port.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import { projectPathNodes } from "./path-progress-projection.js";
import { buildLearnerProfile } from "../domain/learner-profile.js";

export interface FileAppBootstrapFacadeOptions {
  profiles: Pick<ProfileFamilyRepository, "listActiveProfileV2Manifests" | "readActiveProfileV2File">;
  sessions: LearningSessionCatalogPort & SessionBindingReader & InternalPathSessionPort;
}

function sessionView(view: SessionSafeView): SessionSafeView {
  return {
    sessionId: view.sessionId,
    sessionVersion: view.sessionVersion,
    profileRevision: view.profileRevision,
    subjectId: view.subjectId,
    mode: view.mode,
    goalId: view.goalId,
    ...(view.chapterId === undefined ? {} : { chapterId: view.chapterId }),
    availableMinutes: view.availableMinutes,
    status: view.status,
    stage: view.stage,
    diagnosticRequired: view.diagnosticRequired,
    ...(view.pathVersion === undefined ? {} : { pathVersion: view.pathVersion }),
    ...(view.errorCode === undefined ? {} : { errorCode: view.errorCode }),
  };
}

function diagnosticDraft(draft: DiagnosticDraftSafeView): DiagnosticDraftSafeView {
  return {
    diagnosticDraftVersion: draft.diagnosticDraftVersion,
    ...(draft.background === undefined ? {} : { background: {
      python_experience: draft.background.python_experience,
      pandas_experience: draft.background.pandas_experience,
      explanation_preference: draft.background.explanation_preference,
    } }),
    ...(draft.currentQuestionId === undefined ? {} : { currentQuestionId: draft.currentQuestionId }),
    processedQuestionIds: [...draft.processedQuestionIds],
    answers: (draft.answers ?? []).map((answer) => ({
      questionId: answer.questionId,
      status: answer.status,
      ...(answer.submittedAnswer === undefined ? {} : { submittedAnswer: answer.submittedAnswer }),
    })),
  };
}

function progress(entries: readonly NodeActivityProgress[]): NodeActivityProgress[] {
  return entries.map((node) => ({
    nodeId: node.nodeId,
    ...(node.card === undefined ? {} : { card: {
      cardId: node.card.cardId,
      status: node.card.status,
      ...(node.card.acknowledgedAt === undefined ? {} : { acknowledgedAt: node.card.acknowledgedAt }),
    } }),
    activities: node.activities.map((activity) => ({
      activityId: activity.activityId,
      status: activity.status,
      attemptIds: [...activity.attemptIds],
      ...(activity.result === undefined ? {} : { result: activity.result }),
      quizRetryCount: activity.quizRetryCount,
      ...(activity.bestResult === undefined ? {} : { bestResult: activity.bestResult }),
      ...(activity.continuedWithGap === undefined ? {} : { continuedWithGap: activity.continuedWithGap }),
      updatedAt: activity.updatedAt,
    })),
  }));
}

function currentAttempt(attempt: CurrentAttemptSafeReference): CurrentAttemptSafeReference {
  switch (attempt.kind) {
    case "code":
      return { kind: "code", activityId: attempt.activityId, attemptId: attempt.attemptId, status: attempt.status, draftVersion: attempt.draftVersion };
    case "quiz":
      return { kind: "quiz", activityId: attempt.activityId, attemptId: attempt.attemptId, status: attempt.status, retryNumber: attempt.retryNumber };
  }
}

function pathNode(node: PathNodeSafeView): PathNodeSafeView {
  return {
    nodeId: node.nodeId,
    knowledgePointId: node.knowledgePointId,
    activityIds: [...node.activityIds],
    status: node.status,
    estimatedMinutes: node.estimatedMinutes,
    reasonCodes: [...node.reasonCodes],
    difficulty: node.difficulty,
    scaffold: node.scaffold,
    required: node.required,
    positionLocked: node.positionLocked,
  };
}

function diagnosticEnvelope(raw: string): DiagnosticSafeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DiagnosticValidationError("invalid_profile", "Diagnostic asset is not valid JSON");
  }
  const blueprint = parseDiagnosticBlueprint(parsed);
  return {
    diagnosticId: blueprint.blueprintId,
    diagnosticVersion: 1,
    estimatedMinutes: blueprint.estimatedMinutes,
    questions: blueprint.questions.map((question) => ({
      questionId: question.questionId,
      knowledgePointId: question.knowledgePointId,
      kind: question.kind,
      difficulty: question.difficulty,
      prompt: question.prompt,
      ...(question.options === undefined ? {} : { options: [...question.options] }),
      required: question.required,
      ...(question.evidenceForm === undefined ? {} : { evidenceForm: question.evidenceForm }),
    })),
  };
}

/** Read-only bootstrap projection. Every nested DTO is built from a field allowlist. */
export class FileAppBootstrapFacade implements AppBootstrapFacade {
  constructor(private readonly options: FileAppBootstrapFacadeOptions) {}

  async getBootstrap(input: { recoverSessionId?: string }): Promise<AppBootstrapSafeView> {
    const manifests = await this.options.profiles.listActiveProfileV2Manifests();
    const diagnosticManifests = manifests.filter((manifest) => manifest.capabilities.diagnostic && manifest.paths.diagnostic !== undefined);
    if (diagnosticManifests.length !== 1) {
      throw new DiagnosticValidationError("invalid_profile", "Bootstrap requires exactly one active diagnostic asset");
    }
    const diagnosticManifest = diagnosticManifests[0]!;
    const diagnostic = diagnosticEnvelope(await this.options.profiles.readActiveProfileV2File(
      diagnosticManifest.subjectId,
      diagnosticManifest.paths.diagnostic!,
    ));

    const goals: AppBootstrapSafeView["goals"] = [];
    const chapters: AppBootstrapSafeView["chapters"] = [];
    for (const manifest of manifests) {
      const [goalsRaw, knowledgeRaw] = await Promise.all([
        this.options.profiles.readActiveProfileV2File(manifest.subjectId, manifest.paths.goals),
        this.options.profiles.readActiveProfileV2File(manifest.subjectId, manifest.paths.knowledge),
      ]);
      const goalAsset = JSON.parse(goalsRaw) as { goals: Array<{ goalId: string; title: string }> };
      const knowledgeAsset = JSON.parse(knowledgeRaw) as { knowledgePoints: Array<{ chapterId: string }> };
      goals.push(...goalAsset.goals.map(({ goalId, title }) => ({ goalId, title })));
      for (const chapterId of [...new Set(knowledgeAsset.knowledgePoints.map((point) => point.chapterId))].sort((left, right) => left.localeCompare(right, "en"))) {
        if (!chapters.some((chapter) => chapter.chapterId === chapterId)) chapters.push({ chapterId, title: chapterId });
      }
    }

    const snapshots = await this.options.sessions.listBoundSnapshots();
    const recoverableSessions = snapshots
      .filter((snapshot) => snapshot.view.status !== "completed")
      .map((snapshot) => sessionView(snapshot.view));
    const recovered = input.recoverSessionId === undefined
      ? undefined
      : await this.options.sessions.getBoundSnapshot(input.recoverSessionId);
    const internalPath = recovered === undefined
      ? undefined
      : await this.options.sessions.getInternalPathSnapshot({
          sessionId: recovered.sessionId,
          sessionVersion: recovered.sessionVersion,
          profileRevision: recovered.profileRevision,
        });
    const boundLearningCards = recovered === undefined || typeof this.options.sessions.getBoundLearningCards !== "function"
      ? []
      : await this.options.sessions.getBoundLearningCards({
          sessionId: recovered.sessionId,
          sessionVersion: recovered.sessionVersion,
          profileRevision: recovered.profileRevision,
        });
    const session: SessionRecoverySafeView | undefined = recovered === undefined ? undefined : {
      sessionId: recovered.sessionId,
      sessionVersion: recovered.sessionVersion,
      profileRevision: recovered.profileRevision,
      view: sessionView(recovered.view),
      diagnosticDraftVersion: recovered.diagnosticDraftVersion,
      ...(recovered.diagnosticDraft === undefined ? {} : { diagnosticDraft: diagnosticDraft(recovered.diagnosticDraft) }),
      activityProgress: progress(recovered.activityProgress),
      evidenceVersion: recovered.latestCommit?.evidenceVersion ?? 0,
      knowledgeStates: structuredClone(recovered.knowledgeStates ?? []),
      learningProfile: buildLearnerProfile({
        sessionId: recovered.sessionId,
        profileRevision: recovered.profileRevision,
        evidenceVersion: recovered.latestCommit?.evidenceVersion ?? 0,
        evidence: recovered.evidence,
        knowledgeStates: recovered.knowledgeStates ?? [],
        latestDiagnostic: recovered.latestDiagnostic,
        activityProgress: recovered.activityProgress,
      }),
      learningCards: boundLearningCards.map((binding) => ({
        nodeId: binding.nodeId,
        card: structuredClone(binding.card),
      })),
      ...(recovered.currentAttempt === undefined ? {} : { currentAttempt: currentAttempt(recovered.currentAttempt) }),
      ...(recovered.path === undefined ? {} : { path: {
        pathId: recovered.path.pathId,
        pathVersion: recovered.path.pathVersion,
        status: recovered.path.status,
        nodes: projectPathNodes(internalPath?.nodes ?? recovered.path.nodes, recovered.activityProgress).map(pathNode),
      } }),
    };
    return {
      profiles: manifests.map((manifest) => ({
        subjectId: manifest.subjectId,
        name: manifest.name,
        revision: manifest.revision,
        modalities: [...manifest.capabilities.modalities],
      })),
      goals,
      chapters,
      diagnostic,
      recoverableSessions,
      ...(session === undefined ? {} : { session }),
    };
  }
}
