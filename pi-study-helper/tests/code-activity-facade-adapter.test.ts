import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityRuntimeService } from "../src/application/activity-runtime-service.js";
import { CodeActivityFacadeAdapter, type CodeActivityAssets } from "../src/application/code-activity-facade-adapter.js";
import { FixtureCodeEvaluationAdapter } from "../src/infrastructure/code-evaluation-port.js";
import { FileActivityRepository } from "../src/repositories/file-activity-repository.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import type { ActivityResult } from "../src/domain/v2-types.js";

const roots: string[] = [];
const now = () => new Date("2026-08-12T01:02:03.000Z");
const assetBundleHash = `sha256:${"a".repeat(64)}`;
const environmentHash = `sha256:${"b".repeat(64)}`;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const assets: CodeActivityAssets = {
  activity: {
    activityId: "code",
    activityVersion: 3,
    kind: "code_completion",
    title: "Complete code",
    prompt: "Implement it",
    primaryKnowledgePointId: "kp",
    supportingKnowledgePointIds: [],
    starterCode: "print('starter')",
    templateVersion: "3.0.0",
    environmentRef: "env",
  },
  knowledgePoint: { id: "kp", requiresCodeEvidence: true },
  assignment: {
    activityId: "code", activityVersion: 3, profileRevision: 3, primaryKnowledgePointId: "kp",
    kind: "code_completion", source: "fixed", assetBundleHash, environmentId: "env",
  },
  evaluationActivity: { activityId: "code", kind: "code_completion", profileRevision: 3, templateVersion: "3.0.0", environmentRef: "env" },
  taskVersion: "3.0.0",
  environment: { environmentId: "env", status: "measured", environmentHash, prototypeEvidenceRef: "evidence" },
  assetBundleHash,
  publicDatasetFiles: [{ name: "data.csv", content: "x\n1\n", hash: assetBundleHash }],
  publicTestSources: ["def test_public(): pass"],
};

async function setup(result: ActivityResult) {
  const root = await mkdtemp(resolve(tmpdir(), "code-facade-adapter-")); roots.push(root);
  const sessions = new FileLearningSessionRepository({ dataRoot: root, now });
  const activities = new FileActivityRepository({ dataRoot: root, now });
  const view = await sessions.create({ requestId: "create", subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 20, profileRevision: 3, diagnosticRequired: false });
  await sessions.commit({ requestId: "path", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 3, candidate: {
    requestId: "path", knowledgeStates: [], pathCandidate: { pathId: "path", pathVersion: 1, status: "candidate", goalId: "goal", mode: "recommended", nodes: [{ nodeId: "node", knowledgePointId: "kp", activityIds: ["code"], status: "available", estimatedMinutes: 10, reasonCodes: [], difficulty: "S-U", scaffold: "none", required: true, positionLocked: false }] },
  } });
  await sessions.commit({ requestId: "confirm", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 3, candidate: {
    requestId: "confirm", knowledgeStates: [], pathCandidate: { pathId: "path", pathVersion: 1, status: "active", goalId: "goal", mode: "recommended", nodes: [{ nodeId: "node", knowledgePointId: "kp", activityIds: ["code"], status: "available", estimatedMinutes: 10, reasonCodes: [], difficulty: "S-U", scaffold: "none", required: true, positionLocked: false }] },
    activityProgress: [{ nodeId: "node", card: { cardId: "card-kp", status: "pending" }, activities: [{ activityId: "code", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] }],
    boundLearningCards: [{ nodeId: "node", source: "fixed", card: { cardId: "card-kp", knowledgePointId: "kp", title: "KP", objective: "Learn KP", explanation: ["Safe explanation"], example: "Example", commonMistake: "Mistake", sourceAnchorIds: [], estimatedMinutes: 1 } }],
  } });
  const evaluator = new FixtureCodeEvaluationAdapter({ resultsByActivityId: { code: result }, now });
  const runtime = new ActivityRuntimeService(activities, evaluator);
  const adapter = new CodeActivityFacadeAdapter({
    sessions,
    activities,
    runtime,
    assets: { async load() { return structuredClone(assets); } },
    pathSuffix: { async replan() { return { changeReasons: [] }; } },
    now,
  });
  return { adapter, sessions, view };
}

describe("CodeActivityFacadeAdapter", () => {
  it("connects all six code Activity methods and derives formal facts internally", async () => {
    const { adapter, sessions, view } = await setup({ executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash, assetBundleHash });
    const opened = await adapter.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    expect(opened).toMatchObject({ sessionVersion: 4, draftVersion: 2, userText: "print('starter')", activity: { title: "Complete code" } });
    await expect(adapter.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" })).resolves.toEqual(opened);
    await expect(adapter.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-other" })).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    const recovered = await adapter.recoverActivity({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", attemptId: opened.attemptId });
    expect(recovered).toMatchObject({ recoveryAction: "resume_draft", draftVersion: 2, userText: "print('starter')" });
    const saved = await adapter.saveActivityDraft({ requestId: "save", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, userText: "print(1)" });
    expect(saved).toMatchObject({ draftVersion: 3, userText: "print(1)", sessionVersion: 4 });
    const preview = await adapter.prepareActivityRun({ requestId: "preview", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 3, mode: "preview" });
    expect(preview).toMatchObject({ mode: "preview", environmentId: "env", publicDatasetFiles: [{ name: "data.csv" }], publicTestSources: ["def test_public(): pass"] });
    const submission = { requestId: "submit", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code" as const, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 3, userText: "print(1)" };
    const committedContext = await adapter.submitActivityWithContext(submission);
    const submitted = committedContext.output;
    expect(committedContext).toMatchObject({ replayed: false, snapshot: { sessionVersion: 5, latestCommit: { evidenceVersion: 1 } } });
    expect(submitted).toMatchObject({ committed: true, sessionVersion: 5, evidenceVersion: 1, result: { verdict: "pass" } });
    await expect(adapter.submitActivityWithContext(submission)).resolves.toMatchObject({ output: submitted, replayed: true, snapshot: { sessionVersion: 5 } });
    expect(await adapter.getActivityAttempt({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", attemptId: opened.attemptId })).toMatchObject({ status: "submitted", result: { verdict: "pass" } });
    expect(await adapter.recoverActivity({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", attemptId: opened.attemptId })).toMatchObject({ recoveryAction: "show_submitted" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot).toMatchObject({ activityProgress: [{ activities: [{ status: "completed", result: "pass" }] }] });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.knowledgeStates).toEqual([expect.objectContaining({ knowledgePointId: "kp", evidenceVersion: 1 })]);
  });

  it("rejects caller-supplied derived facts on code submission", async () => {
    const { adapter, view } = await setup({ executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash, assetBundleHash });
    const opened = await adapter.openActivity({ requestId: "open-derived", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    await expect(adapter.submitActivity({ requestId: "submit-derived", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code", activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, userText: "print(1)", evidenceCandidate: {} } as never))
      .rejects.toMatchObject({ errorCode: "submission_contract_error" });
  });

  it("keeps evaluator errors recoverable without advancing session facts", async () => {
    const { adapter, sessions, view } = await setup({ executionStatus: "failed", verdict: "not_graded", errorKind: "evaluator", errorCode: "evaluator_timeout", safeFeedback: "retry", evaluatorVersion: "fixture", environmentHash, assetBundleHash });
    const opened = await adapter.openActivity({ requestId: "open-error", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    const submitted = await adapter.submitActivity({ requestId: "submit-error", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code", activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, userText: "print('starter')" });
    expect(submitted).toMatchObject({ committed: false, sessionVersion: 4, errorCode: "evaluator_timeout" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3 });
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.knowledgeStates).toEqual([]);
    expect(snapshot.activityProgress[0]?.activities[0]).toMatchObject({ status: "in_progress" });
    expect(await adapter.recoverActivity({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", attemptId: opened.attemptId })).toMatchObject({ recoveryAction: "retry_after_evaluator_error" });
  });

  it("rejects missing and incorrect card acknowledgements without changing formal state", async () => {
    const { adapter, sessions, view } = await setup({ executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash, assetBundleHash });
    const input = { sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1 } as const;
    await expect(adapter.openActivity({ ...input, requestId: "missing-card" })).rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    await expect(adapter.openActivity({ ...input, requestId: "wrong-card", acknowledgedCardId: "card-other" })).rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3 });
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot.activityProgress[0]?.card).toEqual({ cardId: "card-kp", status: "pending" });
    expect(snapshot.evidence).toEqual([]);
  });
});
