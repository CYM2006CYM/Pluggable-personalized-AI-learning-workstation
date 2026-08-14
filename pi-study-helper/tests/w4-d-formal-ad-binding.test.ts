import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivityPathSuffixReplanner } from "../src/application/activity-path-suffix.js";
import { CapabilityTaskService, capabilityTaskRunId } from "../src/application/capability-task-service.js";
import { ComposedLearningRuntimeFacade } from "../src/application/composed-learning-runtime-facade.js";
import { QuizActivityRuntime, type QuizActivityAssets } from "../src/application/quiz-activity-runtime.js";
import type { LearningRuntimeFacade } from "../src/contracts/index.js";
import { createDeterministicContentPort, type Evidence, type KnowledgeState, type QuizQuestionPrivate } from "../src/contracts/index.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { loadRecordedModelResponseFixtures, RecordedModelExecutionAdapter } from "../src/infrastructure/model-execution-port.js";
import { SessionCapabilityEvidenceProvider } from "../src/infrastructure/session-capability-evidence-provider.js";
import { InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { toPathSafeSnapshot, type InternalPersistedPathSnapshot } from "../src/repositories/internal-path-session-port.js";

const roots: string[] = [];
const now = () => new Date("2026-08-14T00:00:00.000Z");
const recordingsPath = resolve("fixtures/model-responses/w4/recorded-responses.json");

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function method<T>(value: T) {
  return vi.fn(async () => value);
}

function state(evidenceId: string, evidenceVersion: number, knowledgePointId = "pandas.clean.read-csv"): KnowledgeState {
  return {
    knowledgePointId,
    profileRevision: 3,
    evidenceVersion,
    aggregationVersion: "knowledge-state-v1",
    mastery: 1,
    confidence: 1,
    status: "ready",
    validEvidenceCount: 1,
    evidenceFormCount: 1,
    evidenceIds: [evidenceId],
    consideredEvidenceIds: [evidenceId],
    asOf: now().toISOString(),
    skipEligible: false,
    lastUpdatedAt: now().toISOString(),
  };
}

function formalEvidence(sessionId: string, evidenceId: string): Evidence {
  return {
    evidenceId,
    requestId: `request-${evidenceId}`,
    sessionId,
    knowledgePointId: "pandas.clean.read-csv",
    profileRevision: 3,
    kind: "diagnostic",
    source: "fixed_diagnostic",
    form: "selected_response",
    impact: "mastery",
    outcome: "correct",
    score: 1,
    difficulty: "S-U",
    independence: "independent",
    attemptId: "diagnostic.fixed.q1",
    activityId: "act-read-csv",
    evaluatorVersion: "diagnostic-v1",
    createdAt: now().toISOString(),
  };
}

async function createCapability(sessions: FileLearningSessionRepository) {
  const fixtures = loadRecordedModelResponseFixtures(await readFile(recordingsPath, "utf8"));
  const adapter = new RecordedModelExecutionAdapter({ fixtures, defaultModelId: "deepseek-chat" });
  const store = new InMemoryW4PrivateRuntimeStore();
  const service = new CapabilityTaskService({
    modelExecutionPort: adapter,
    evidenceProvider: new SessionCapabilityEvidenceProvider({ sessions }),
    privateStore: store,
    modelId: "deepseek-chat",
    promptVersion: "w4-d2-v1",
    now,
  });
  return { adapter, store, service };
}

async function tempSessions() {
  const root = await mkdtemp(resolve(tmpdir(), "w4-d-ad-binding-"));
  roots.push(root);
  return new FileLearningSessionRepository({ dataRoot: root, now });
}

describe("W4 D formal A/D capability binding", () => {
  it("uses A's formal session creation and commit path for diagnostic_completed recorded scoring", async () => {
    const sessions = await tempSessions();
    const view = await sessions.create({
      requestId: "w4-d2-d-r1-formal-session",
      subjectId: "pandas",
      mode: "recommended",
      goalId: "goal",
      availableMinutes: 20,
      profileRevision: 3,
      diagnosticRequired: true,
    });
    expect(view.sessionId).toBe("session-3da523ed0736ba9ce580f8b9");
    expect(view.sessionId).not.toBe("demo-recommended");
    const evidence = formalEvidence(view.sessionId, "formal-evidence-1");
    const knowledgeStates = [state(evidence.evidenceId, 1)];
    const commit = await sessions.commit({
      requestId: evidence.requestId,
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 3,
      candidate: {
        requestId: evidence.requestId,
        evidenceCandidates: [evidence],
        knowledgeStates,
        diagnosticCandidate: {
          diagnosticId: "diagnostic-w4-r1",
          sessionId: view.sessionId,
          profileRevision: 3,
          diagnosticVersion: 1,
          evidenceVersion: 1,
          goalId: "goal",
          status: "completed",
          states: knowledgeStates,
          insufficientKnowledgePointIds: [],
          summaryTemplateVersion: "diagnostic-summary-v1",
          createdAt: now().toISOString(),
        },
        nextStage: "path",
      },
    });
    const { adapter, service } = await createCapability(sessions);
    const diagnosticOutput: Awaited<ReturnType<LearningRuntimeFacade["completeDiagnostic"]>> = {
      requestId: "complete",
      sessionId: view.sessionId,
      sessionVersion: commit.sessionVersion,
      profileRevision: 3,
      diagnosticId: "diagnostic-w4-r1",
      evidenceVersion: 1,
      knowledgeStates,
      insufficientKnowledgePointIds: [],
      diagnosticDraftVersion: 0,
    };
    const facade = new ComposedLearningRuntimeFacade({
      session: new Proxy({}, { get: () => method({}) }) as unknown as Pick<LearningRuntimeFacade, "startSession">,
      diagnostic: {
        saveDiagnosticDraft: method({}),
        submitDiagnosticAnswer: method({}),
        completeDiagnostic: method(diagnosticOutput),
        completeDiagnosticWithContext: method({ output: diagnosticOutput, replayed: false, snapshot: commit }),
      } as never,
      path: new Proxy({}, { get: () => method({}) }) as never,
      codeActivity: new Proxy({}, { get: () => method({}) }) as never,
      quizActivity: new Proxy({}, { get: () => method({}) }) as never,
      sessions,
      profile: { async load() { return { profileRevision: 3, goals: [], knowledgePoints: [], activities: [] }; } },
      capabilityTasks: service,
      resolveActivityKind: async () => "quiz",
    });
    await facade.completeDiagnostic({} as never);
    await new Promise((resolveWake) => setTimeout(resolveWake, 0));
    await service.waitForIdle();
    expect(adapter.history[0]?.input.runId).toBe("w4-cap-8c9b5a032b938c8b3725dc6e");
    expect(adapter.history[0]?.input.runId).toBe(capabilityTaskRunId({
      trigger: "diagnostic_completed",
      sessionId: view.sessionId,
      profileRevision: 3,
      evidenceVersion: 1,
      evidenceIds: ["formal-evidence-1"],
    }, "deepseek-chat", "w4-d2-v1"));
    const snapshot = await service.getSnapshot(view.sessionId);
    expect(snapshot).toMatchObject({ evidenceVersion: 1, profileRevision: 3, status: "partial" });
    expect(snapshot?.dimensions.find((item) => item.id === "syntax_api")).toMatchObject({
      state: "verified",
      evidenceRefs: ["formal-evidence-1"],
    });
    expect(snapshot?.dimensions.filter((item) => item.state === "unverified")).toHaveLength(4);
    const afterD = await sessions.getBoundSnapshot(view.sessionId);
    expect(afterD.evidence).toEqual(commit.evidence);
    expect(afterD.knowledgeStates).toEqual(commit.knowledgeStates);
    expect(afterD.latestCommit).toEqual(commit.latestCommit);
  });

  it("uses a formal quiz transaction for node_completed recorded scoring and replays idempotently", async () => {
    const sessions = await tempSessions();
    const view = await sessions.create({
      requestId: "w4-d2-d-r1-node-session",
      subjectId: "pandas",
      mode: "recommended",
      goalId: "goal",
      availableMinutes: 20,
      profileRevision: 3,
      diagnosticRequired: false,
    });
    expect(view.sessionId).toBe("session-70a2c6663f3fd05eb4a53a51");
    const path = activeInternalPath(view.sessionId);
    await sessions.commitInternalPath({
      requestId: "path",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 3,
      candidate: { requestId: "path", knowledgeStates: [], pathCandidate: toPathSafeSnapshot({ ...path, status: "candidate" }) },
    }, { ...path, status: "candidate" });
    await sessions.commitInternalPath({
      requestId: "confirm",
      sessionId: view.sessionId,
      sessionVersion: 2,
      profileRevision: 3,
      candidate: {
        requestId: "confirm",
        knowledgeStates: [],
        pathCandidate: toPathSafeSnapshot(path),
        activityProgress: [
          { nodeId: "node-pandas.clean.read-csv", card: { cardId: "card-kp", status: "pending" }, activities: [{ activityId: "act-read-csv", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] },
          { nodeId: "node-final", activities: [{ activityId: "code", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] },
        ],
        boundLearningCards: [{ nodeId: "node-pandas.clean.read-csv", source: "fixed", card: { cardId: "card-kp", knowledgePointId: "pandas.clean.read-csv", title: "CSV", objective: "Learn CSV", explanation: ["Safe explanation"], example: "Example", commonMistake: "Mistake", sourceAnchorIds: ["source-1"], estimatedMinutes: 1 } }],
      },
    }, path);
    const assets: QuizActivityAssets = {
      activity: { activityId: "act-read-csv", activityVersion: 1, profileRevision: 3, title: "Quiz", prompt: "Answer", primaryKnowledgePointId: "pandas.clean.read-csv", supportingKnowledgePointIds: [] },
      knowledgePoint: { id: "pandas.clean.read-csv", sourceAnchorIds: ["source-1"] },
      knowledgePoints: [{ id: "pandas.clean.read-csv" }, { id: "final", requiresCodeEvidence: true }],
      fixedQuestions: questions("fixed"),
      supplementalQuestions: questions("supplemental", 2),
    };
    const runtime = new QuizActivityRuntime({
      sessions,
      content: createDeterministicContentPort(),
      loadAssets: async () => structuredClone(assets),
      pathSuffix: createActivityPathSuffixReplanner({ sessions, profile: { async load() { return structuredClone(pathProfile); } }, now }),
      now,
    });
    const { adapter, service } = await createCapability(sessions);
    const inert = new Proxy({}, { get: () => method({}) }) as unknown as LearningRuntimeFacade;
    const facade = new ComposedLearningRuntimeFacade({
      session: inert,
      diagnostic: inert,
      path: inert,
      codeActivity: inert,
      quizActivity: {
        openActivity: runtime.openActivity.bind(runtime),
        submitActivity: runtime.submitActivity.bind(runtime),
        submitActivityWithContext: runtime.submitActivityWithContext.bind(runtime),
        getActivityAttempt: runtime.getAttempt.bind(runtime),
      },
      sessions,
      profile: { async load() { return structuredClone(pathProfile); } },
      capabilityTasks: service,
      resolveActivityKind: async () => "quiz",
    });
    const opened = await facade.openActivity({ requestId: "open-node", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "act-read-csv", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "card-kp" });
    expect(opened.kind).toBe("quiz");
    if (opened.kind !== "quiz") throw new Error("Expected quiz activity");
    const answers = opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A" }));
    const submitted = await facade.submitActivity({ requestId: "submit-node", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz", activityId: "act-read-csv", activityVersion: 1, attemptId: opened.attemptId, answers });
    await new Promise((resolveWake) => setTimeout(resolveWake, 0));
    await service.waitForIdle();
    expect(submitted).toMatchObject({ committed: true, evidenceId: "evidence-5d93c633e88d99053c6c9db2", evidenceVersion: 1 });
    expect(adapter.history[0]?.input.runId).toBe("w4-cap-83d7e2b2bd0f32be7ea50f73");
    expect(adapter.history[0]?.input.runId).toBe(capabilityTaskRunId({
      trigger: "node_completed",
      sessionId: view.sessionId,
      profileRevision: 3,
      evidenceVersion: 1,
      knowledgePointId: "pandas.clean.read-csv",
      evidenceIds: ["evidence-5d93c633e88d99053c6c9db2"],
    }, "deepseek-chat", "w4-d2-v1"));
    const firstSnapshot = await service.getSnapshot(view.sessionId);
    await facade.submitActivity({ requestId: "submit-node", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz", activityId: "act-read-csv", activityVersion: 1, attemptId: opened.attemptId, answers });
    await new Promise((resolveWake) => setTimeout(resolveWake, 0));
    await service.waitForIdle();
    expect(await service.getSnapshot(view.sessionId)).toEqual(firstSnapshot);
    const aSnapshot = await sessions.getBoundSnapshot(view.sessionId);
    expect(aSnapshot.evidence).toHaveLength(1);
    expect(aSnapshot.knowledgeStates.find((item) => item.knowledgePointId === "pandas.clean.read-csv")?.evidenceIds).toEqual(["evidence-5d93c633e88d99053c6c9db2"]);
  });
});

function questions(prefix: string, count = 4): QuizQuestionPrivate[] {
  return Array.from({ length: count }, (_, index) => ({
    questionId: `${prefix}-${index}`,
    kind: "single_choice",
    prompt: `Q${index}`,
    options: ["A", "B"],
    correctAnswer: "A",
    explanation: "Safe review",
    sourceAnchorIds: ["source-1"],
  }));
}

const pathProfile: PathEngineProfile = {
  profileRevision: 3,
  goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["final"], requiredActivityIds: ["code"], finalActivityId: "code" }],
  knowledgePoints: [
    { id: "pandas.clean.read-csv", title: "CSV", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["act-read-csv"], importance: 1 },
    { id: "final", title: "Final", chapterId: "chapter", sectionId: "section", prerequisiteIds: ["pandas.clean.read-csv"], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["code"], importance: 1 },
  ],
  activities: [
    { activityId: "act-read-csv", primaryKnowledgePointId: "pandas.clean.read-csv", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
    { activityId: "code", primaryKnowledgePointId: "final", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
  ],
};

function activeInternalPath(sessionId: string): InternalPersistedPathSnapshot {
  return {
    pathId: "path", sessionId, profileRevision: 3, evidenceVersion: 0, pathVersion: 1, engineVersion: "path-engine-v1", status: "active", mode: "recommended", goalId: "goal", availableMinutes: 20, estimatedMinutes: 10,
    nodes: [
      { nodeId: "node-pandas.clean.read-csv", knowledgePointId: "pandas.clean.read-csv", activityIds: ["act-read-csv"], status: "available", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 5, reasonCodes: ["prerequisite_gap", "evidence_insufficient"] },
      { nodeId: "node-final", knowledgePointId: "final", activityIds: ["code"], status: "locked", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 5, reasonCodes: ["goal_required", "evidence_insufficient"] },
    ],
    positionLockedNodeIds: [], changeReasons: [], createdAt: now().toISOString(),
  };
}
