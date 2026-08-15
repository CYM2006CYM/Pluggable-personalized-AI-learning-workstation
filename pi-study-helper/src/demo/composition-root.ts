import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { AdaptiveContentService } from "../application/adaptive-content-service.js";
import { CapabilityTaskService } from "../application/capability-task-service.js";
import { ActivityRuntimeService } from "../application/activity-runtime-service.js";
import { createActivityPathSuffixReplanner } from "../application/activity-path-suffix.js";
import { CodeActivityFacadeAdapter, ProfileFamilyCodeActivityAssetResolver } from "../application/code-activity-facade-adapter.js";
import { ComposedLearningRuntimeFacade } from "../application/composed-learning-runtime-facade.js";
import { DiagnosticRuntime, type DiagnosticRuntimeAssets } from "../application/diagnostic-runtime.js";
import { FileAppBootstrapFacade } from "../application/app-bootstrap-facade.js";
import { ProfileBoundSessionRuntime } from "../application/profile-bound-session-runtime.js";
import { ProfileFamilyPathResolver, createPathRuntimeMethods } from "../application/path-learning-facade.js";
import { ProfileFamilyQuizActivityAssetResolver, QuizActivityRuntime } from "../application/quiz-activity-runtime.js";
import { parseDiagnosticAnswerKey, parseDiagnosticBlueprint } from "../domain/diagnostic.js";
import { createW4DModelGraphs } from "../graphs/w4-d-graph-factory.js";
import { loadRecordedModelResponseFixtures, RecordedModelExecutionAdapter } from "../infrastructure/model-execution-port.js";
import { createLiveModelExecutionPort } from "../infrastructure/live-model-execution-port.js";
import { ProfileAdaptiveContentSourceProvider } from "../infrastructure/profile-adaptive-source-provider.js";
import { FileProfileUserRuntimeStore } from "../infrastructure/w4-private-runtime-store.js";
import { SessionCapabilityEvidenceProvider } from "../infrastructure/session-capability-evidence-provider.js";
import { PythonProcessCodeEvaluationAdapter } from "../infrastructure/python-process-evaluation-adapter.js";
import { FileActivityRepository } from "../repositories/file-activity-repository.js";
import { ActivityRepositoryError } from "../repositories/activity-repository.js";
import { FileLearningSessionRepository } from "../repositories/file-learning-session-repository.js";
import { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import type { LearningRuntimeFacade } from "../contracts/facade.js";

export interface DemoRuntime {
  facade: LearningRuntimeFacade;
  bootstrap: FileAppBootstrapFacade;
  close(): Promise<void>;
}

export interface DemoRuntimeOptions {
  dataRoot: string;
  fixturesRoot: string;
  pythonExecutable?: string;
  liveConfig?: { model?: string; baseUrl?: string; apiKey?: string };
  now?: () => Date;
}

async function loadDiagnosticAssets(profiles: ProfileFamilyRepository, subjectId: string, revision: number): Promise<DiagnosticRuntimeAssets> {
  const manifest = await profiles.loadProfileV2Revision(subjectId, revision);
  if (manifest.paths.diagnostic === undefined || manifest.paths.assessments === undefined) throw new Error("diagnostic assets unavailable");
  const blueprint = parseDiagnosticBlueprint(JSON.parse(await profiles.readProfileV2RevisionFile(subjectId, revision, manifest.paths.diagnostic)));
  const answerRefs = new Set(blueprint.questions.map((question) => question.evaluatorRef.split("#", 1)[0]));
  if (answerRefs.size !== 1) throw new Error("diagnostic answer binding is invalid");
  const answerKeyPath = posix.join(posix.dirname(manifest.paths.diagnostic), [...answerRefs][0]!);
  const answerKey = parseDiagnosticAnswerKey(JSON.parse(await profiles.readProfileV2RevisionFile(subjectId, revision, answerKeyPath)), blueprint);
  const knowledge = JSON.parse(await profiles.readProfileV2RevisionFile(subjectId, revision, manifest.paths.knowledge)) as { knowledgePoints: Array<{ id: string; requiresCodeEvidence?: boolean }> };
  return { blueprint, answerKey, knowledgePoints: knowledge.knowledgePoints };
}

export async function createDemoRuntime(options: DemoRuntimeOptions): Promise<DemoRuntime> {
  const profiles = new ProfileFamilyRepository({ dataRoot: options.dataRoot, fixturesRoot: options.fixturesRoot, now: options.now });
  await profiles.activateRevision3Draft("pandas-cleaning");
  const sessions = new FileLearningSessionRepository({ dataRoot: options.dataRoot, now: options.now });
  const activities = new FileActivityRepository({ dataRoot: options.dataRoot, now: options.now });
  const pathProfile = new ProfileFamilyPathResolver(profiles);
  const pathSuffix = createActivityPathSuffixReplanner({ sessions, profile: pathProfile, now: options.now });
  const privateStore = new FileProfileUserRuntimeStore(profiles.familyDirectory("pandas-cleaning"));
  const recorded = new RecordedModelExecutionAdapter({
    fixtures: loadRecordedModelResponseFixtures(await readFile(resolve(options.fixturesRoot, "../model-responses/w4/recorded-responses.json"), "utf8")),
    defaultModelId: "deepseek-chat",
  });
  const graphs = createW4DModelGraphs();
  if (graphs.length !== 5) throw new Error("D graph registry binding is incomplete");
  const modelExecutionPort = options.liveConfig === undefined
    ? recorded
    : createLiveModelExecutionPort({
        cwd: resolve(options.fixturesRoot, "../.."),
        modelId: options.liveConfig.model,
        baseUrl: options.liveConfig.baseUrl,
        apiKey: options.liveConfig.apiKey,
        graphs,
      });
  const sourceProvider = new ProfileAdaptiveContentSourceProvider({
    resolveProfileRoot: (revision) => profiles.profileV2RevisionDirectory("pandas-cleaning", revision),
  });
  const adaptive = new AdaptiveContentService({
    modelExecutionPort,
    sourceProvider,
    privateStore,
    modelId: "deepseek-chat",
    promptVersion: "w4-d2-v1",
  });
  const capability = new CapabilityTaskService({
    modelExecutionPort,
    evidenceProvider: new SessionCapabilityEvidenceProvider({ sessions }),
    privateStore,
    modelId: "deepseek-chat",
    promptVersion: "w4-d2-v1",
    now: options.now,
  });
  const profileBound = new ProfileBoundSessionRuntime({ profiles, sessions });
  const diagnostic = new DiagnosticRuntime({
    repository: sessions,
    dataRoot: options.dataRoot,
    loadAssets: (subjectId, revision) => loadDiagnosticAssets(profiles, subjectId, revision),
    now: options.now,
  });
  const path = createPathRuntimeMethods({ sessions, profile: pathProfile, content: adaptive, now: options.now });
  const quizAssets = new ProfileFamilyQuizActivityAssetResolver(profiles);
  const quiz = new QuizActivityRuntime({
    sessions,
    content: adaptive,
    loadAssets: (subjectId, revision, activityId) => quizAssets.loadAssets(subjectId, revision, activityId),
    pathSuffix,
    now: options.now,
  });
  const codeAssets = new ProfileFamilyCodeActivityAssetResolver(profiles);
  const evaluator = new PythonProcessCodeEvaluationAdapter({
    profileRoot: await profiles.profileV2RevisionDirectory("pandas-cleaning", 3),
    // Keep the HTTP/Bootstrap path independent from local Python. A missing
    // executable is reported by the existing evaluator as an environment fault
    // only when a code activity is actually run.
    pythonExecutable: options.pythonExecutable ?? resolve(options.dataRoot, ".python-unavailable"),
    now: options.now,
  });
  const code = new CodeActivityFacadeAdapter({
    sessions,
    activities,
    assets: codeAssets,
    runtime: new ActivityRuntimeService(activities, evaluator),
    pathSuffix,
    now: options.now,
  });
  const facade = new ComposedLearningRuntimeFacade({
    session: profileBound,
    diagnostic,
    path,
    codeActivity: code,
    quizActivity: {
      openActivity: quiz.openActivity.bind(quiz),
      submitActivity: quiz.submitActivity.bind(quiz),
      submitActivityWithContext: quiz.submitActivityWithContext.bind(quiz),
      getActivityAttempt: quiz.getAttempt.bind(quiz),
    },
    sessions,
    profile: pathProfile,
    capabilityTasks: capability,
    resolveActivityKind: async (input) => {
      const profile = await pathProfile.load(input.sessionId ? (await sessions.getBoundSnapshot(input.sessionId)).view.subjectId : "pandas-cleaning", input.profileRevision);
      const activity = profile.activities.find((item) => item.activityId === input.activityId);
      if (activity === undefined) throw new ActivityRepositoryError("activity_not_found", "Activity is unavailable");
      return activity.kind === "mcq" ? "quiz" : "code";
    },
    now: options.now,
  });
  const bootstrap = new FileAppBootstrapFacade({ profiles, sessions });
  return { facade, bootstrap, close: async () => { await capability.waitForIdle(); } };
}
