import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QuizActivityRuntime, type QuizActivityAssets } from "../src/application/quiz-activity-runtime.js";
import { createActivityPathSuffixReplanner } from "../src/application/activity-path-suffix.js";
import { createDeterministicContentPort, type QuizQuestionPrivate } from "../src/contracts/index.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { toPathSafeSnapshot, type InternalPersistedPathSnapshot } from "../src/repositories/internal-path-session-port.js";

const roots: string[] = [];
const now = () => new Date("2026-08-12T00:00:00.000Z");

function questions(prefix: string, count = 4): QuizQuestionPrivate[] {
  return Array.from({ length: count }, (_, index) => ({ questionId: `${prefix}-${index}`, kind: "single_choice", prompt: `Q${index}`, options: ["A", "B"], correctAnswer: "A", explanation: "Safe review", sourceAnchorIds: ["source-1"] }));
}

const assets: QuizActivityAssets = {
  activity: { activityId: "quiz", activityVersion: 1, profileRevision: 3, title: "Quiz", prompt: "Answer", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [] },
  knowledgePoint: { id: "kp", sourceAnchorIds: ["source-1"] },
  knowledgePoints: [{ id: "kp" }, { id: "final", requiresCodeEvidence: true }],
  fixedQuestions: questions("fixed"),
  supplementalQuestions: questions("supplemental", 2),
};

const pathProfile: PathEngineProfile = {
  profileRevision: 3,
  goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["final"], requiredActivityIds: ["code"], finalActivityId: "code" }],
  knowledgePoints: [
    { id: "kp", title: "KP", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["quiz"], importance: 1 },
    { id: "final", title: "Final", chapterId: "chapter", sectionId: "section", prerequisiteIds: ["kp"], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["code"], importance: 1 },
  ],
  activities: [
    { activityId: "quiz", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
    { activityId: "code", primaryKnowledgePointId: "final", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
  ],
};

function activeInternalPath(sessionId: string): InternalPersistedPathSnapshot {
  return {
    pathId: "path", sessionId, profileRevision: 3, evidenceVersion: 0, pathVersion: 1, engineVersion: "path-engine-v1", status: "active", mode: "recommended", goalId: "goal", availableMinutes: 20, estimatedMinutes: 10,
    nodes: [
      { nodeId: "node-kp", knowledgePointId: "kp", activityIds: ["quiz"], status: "available", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 5, reasonCodes: ["prerequisite_gap", "evidence_insufficient"] },
      { nodeId: "node-final", knowledgePointId: "final", activityIds: ["code"], status: "locked", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 5, reasonCodes: ["goal_required", "evidence_insufficient"] },
    ],
    positionLockedNodeIds: [], changeReasons: [], createdAt: now().toISOString(),
  };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup(runtimeAssets: QuizActivityAssets = assets) {
  const root = await mkdtemp(resolve(tmpdir(), "quiz-activity-runtime-")); roots.push(root);
  const sessions = new FileLearningSessionRepository({ dataRoot: root, now });
  const view = await sessions.create({ requestId: "create", subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 20, profileRevision: 3, diagnosticRequired: false });
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
      requestId: "confirm", knowledgeStates: [], pathCandidate: toPathSafeSnapshot(path),
      activityProgress: [
        { nodeId: "node-kp", card: { cardId: "actual-card-kp", status: "pending" }, activities: [{ activityId: "quiz", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] },
        { nodeId: "node-final", activities: [{ activityId: "code", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] },
      ],
      boundLearningCards: [{ nodeId: "node-kp", source: "fixed", card: { cardId: "actual-card-kp", knowledgePointId: "kp", title: "KP", objective: "Learn KP", explanation: ["Safe explanation"], example: "Example", commonMistake: "Mistake", sourceAnchorIds: ["source-1"], estimatedMinutes: 1 } }],
    },
  }, path);
  const pathSuffix = createActivityPathSuffixReplanner({ sessions, profile: { async load() { return structuredClone(pathProfile); } }, now });
  const runtime = new QuizActivityRuntime({ sessions, content: createDeterministicContentPort(), loadAssets: async () => structuredClone(runtimeAssets), pathSuffix, now });
  return { root, sessions, view, runtime };
}

describe("QuizActivityRuntime", () => {
  it("opens a legal legacy single-question helper without routing it through W4 group selection", async () => {
    const legacyQuestion = questions("legacy", 1)[0]!;
    const legacyAssets: QuizActivityAssets = {
      ...assets,
      fixedQuestions: [],
      supplementalQuestions: [],
      legacyQuestion,
      legacySubtype: "single_choice",
    };
    const { view, runtime } = await setup(legacyAssets);
    const opened = await runtime.openActivity({ requestId: "legacy-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    expect(opened.activity.questions).toHaveLength(1);
    expect(opened.activity.questions[0]).toMatchObject({ questionId: "legacy-0", options: ["A", "B"] });
    expect(JSON.stringify(opened)).not.toContain("correctAnswer");
  });

  it("scores a legal legacy single-question helper with single-question semantics", async () => {
    const legacyQuestion = questions("legacy", 1)[0]!;
    const legacyAssets: QuizActivityAssets = {
      ...assets,
      fixedQuestions: [],
      supplementalQuestions: [],
      legacyQuestion,
      legacySubtype: "single_choice",
    };
    const { sessions, view, runtime } = await setup(legacyAssets);
    const opened = await runtime.openActivity({ requestId: "legacy-score-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    const submitted = await runtime.submitActivity({
      requestId: "legacy-score-submit",
      sessionId: view.sessionId,
      sessionVersion: opened.sessionVersion,
      profileRevision: 3,
      kind: "quiz",
      activityId: "quiz",
      activityVersion: 1,
      attemptId: opened.attemptId,
      answers: [{ questionId: "legacy-0", answer: "A" }],
    });
    expect(submitted.result).toMatchObject({ verdict: "pass", correctCount: 1, totalCount: 1, requiredCorrectCount: 1, retryAllowed: false });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: submitted.sessionVersion, profileRevision: 3 });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.activityProgress[0]?.activities[0]).toMatchObject({ status: "completed", result: "pass" });
  });

  it("opens a safe persisted Attempt, commits one Evidence, and advances to the next activity", async () => {
    const { sessions, view, runtime } = await setup();
    const opened = await runtime.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    expect(JSON.stringify(opened)).not.toContain("correctAnswer");
    expect(opened.activity.questions).toHaveLength(4);
    await expect(runtime.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" })).resolves.toEqual(opened);
    await expect(runtime.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "previous-card" })).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    const refreshed = await runtime.openActivity({ requestId: "refresh", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1 });
    expect(refreshed).toMatchObject({ attemptId: opened.attemptId, activity: { title: "Quiz", prompt: "Answer", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [] } });
    const submission = { requestId: "submit", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz" as const, activityId: "quiz", activityVersion: 1, attemptId: opened.attemptId, answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A" })) };
    const committedContext = await runtime.submitActivityWithContext(submission);
    const submitted = committedContext.output;
    expect(committedContext).toMatchObject({ replayed: false, snapshot: { sessionVersion: 5, latestCommit: { evidenceVersion: 1 } } });
    expect(submitted).toMatchObject({ committed: true, result: { verdict: "pass" }, evidenceVersion: 1, sessionVersion: 5 });
    const input = submission;
    await expect(runtime.submitActivityWithContext(input)).resolves.toMatchObject({ output: submitted, replayed: true, snapshot: { sessionVersion: 5 } });
    await expect(runtime.submitActivity({ ...input, answers: input.answers.map((answer, index) => index === 0 ? { ...answer, answer: "B" } : answer) })).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot.activityProgress[0]?.activities).toMatchObject([{ activityId: "quiz", status: "completed" }]);
    expect(snapshot.path).toMatchObject({ pathVersion: 2, nodes: [{ status: "completed" }, { status: "available" }] });
  });

  it("opens one disjoint retry and rejects a third attempt", async () => {
    const { sessions, view, runtime } = await setup();
    const first = await runtime.openActivity({ requestId: "open-1", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    await runtime.submitActivity({ requestId: "submit-1", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: first.attemptId, answers: first.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const afterFirst = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    const retry = await runtime.openActivity({ requestId: "open-2", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: afterFirst.path!.pathVersion });
    const firstIds = new Set(first.activity.questions.map((question) => question.questionId));
    expect(retry.activity.questions.filter((question) => firstIds.has(question.questionId))).toHaveLength(0);
    await runtime.submitActivity({ requestId: "submit-2", sessionId: view.sessionId, sessionVersion: 6, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: retry.attemptId, answers: retry.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const afterSecond = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3 });
    await expect(runtime.openActivity({ requestId: "open-3", sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: afterSecond.path!.pathVersion })).rejects.toMatchObject({ errorCode: "prerequisite_violation" });
  });

  it("publishes a recomputed path suffix and archives the prior path in the quiz transaction", async () => {
    const { root, sessions, view, runtime } = await setup();
    const first = await runtime.openActivity({ requestId: "open-suffix-1", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    await runtime.submitActivity({ requestId: "submit-suffix-1", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: first.attemptId, answers: first.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const retry = await runtime.openActivity({ requestId: "open-suffix-2", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1 });
    await runtime.submitActivity({ requestId: "submit-suffix-2", sessionId: view.sessionId, sessionVersion: 6, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: retry.attemptId, answers: retry.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3 });
    expect(snapshot.path).toMatchObject({ pathVersion: 2, status: "active" });
    expect(snapshot.path?.nodes).toMatchObject([{ status: "completed", positionLocked: true }, { status: "available" }]);
    expect(snapshot.latestCommit.evidenceVersion).toBe(1);
    const archived = JSON.parse(await readFile(resolve(root, "profile_families", "subject", "_user", "learning_sessions", view.sessionId, "paths", "superseded", "1.json"), "utf8"));
    expect(archived).toMatchObject({ pathVersion: 1, status: "superseded" });
  });

  it("rejects missing and incorrect card acknowledgements before creating a Quiz Attempt", async () => {
    const { sessions, view, runtime } = await setup();
    const input = { sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1 } as const;
    await expect(runtime.openActivity({ ...input, requestId: "missing-card" })).rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    await expect(runtime.openActivity({ ...input, requestId: "wrong-card", acknowledgedCardId: "previous-card" })).rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3 });
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot.activityProgress[0]?.card).toEqual({ cardId: "actual-card-kp", status: "pending" });
    expect(snapshot.activityProgress[0]?.activities[0]?.attemptIds).toEqual([]);
    expect(snapshot.evidence).toEqual([]);
  });
});
