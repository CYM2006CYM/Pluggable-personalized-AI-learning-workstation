import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityRuntimeService } from "../src/application/activity-runtime-service.js";
import { CodeActivityFacadeAdapter, ProfileFamilyCodeActivityAssetResolver, type CodeActivityAssets } from "../src/application/code-activity-facade-adapter.js";
import { FixtureCodeEvaluationAdapter } from "../src/infrastructure/code-evaluation-port.js";
import { FileActivityRepository } from "../src/repositories/file-activity-repository.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";
import type { ActivityResult } from "../src/domain/v2-types.js";
import { hashPublicExecutionBundle, sha256Text } from "../src/application/public-execution-bundle.js";

const roots: string[] = [];
const now = () => new Date("2026-08-12T01:02:03.000Z");
const assetBundleHash = `sha256:${"a".repeat(64)}`;
const environmentHash = `sha256:${"b".repeat(64)}`;
const publicDataHash = sha256Text("x\n1\n");
const fixturesRoot = resolve(import.meta.dirname, "../fixtures/profiles");

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
  publicDatasetFiles: [{ name: "data.csv", content: "x\n1\n", hash: publicDataHash }],
  publicTestSources: ["def test_public(): pass"],
};

async function setup(result: ActivityResult, resolvedAssets: CodeActivityAssets = assets) {
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
    assets: { async load() { return structuredClone(resolvedAssets); } },
    pathSuffix: { async replan() { return { changeReasons: [] }; } },
    now,
  });
  return { adapter, sessions, view };
}

describe("CodeActivityFacadeAdapter", () => {
  it("normalizes every revision 3 code asset to the public activityVersion", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "code-asset-resolver-")); roots.push(dataRoot);
    const profiles = new ProfileFamilyRepository({ dataRoot, fixturesRoot, now });
    await profiles.activateRevision3Draft("pandas-cleaning");
    const resolver = new ProfileFamilyCodeActivityAssetResolver(profiles);
    for (const activityId of ["act-load-csv", "act-inspect-dataframe", "act-missing", "act-duplicates", "act-types", "act-practical"]) {
      const assets = await resolver.load("pandas-cleaning", 3, activityId);
      expect(assets.activity.activityVersion).toBe(3);
      expect(assets.assignment.activityVersion).toBe(3);
      expect(assets.evaluationActivity.profileRevision).toBe(3);
      expect(assets.publicDatasetFiles).toEqual([
        expect.objectContaining({ name: "orders-learning.csv", hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) }),
      ]);
      expect(assets.publicTestSources).toHaveLength(1);
      expect(assets.activity.problemStatement).toMatchObject({
        background: expect.any(String),
        inputDescription: expect.any(String),
        outputDescription: expect.any(String),
        rules: expect.arrayContaining([expect.any(String)]),
        prohibitedActions: expect.arrayContaining([expect.any(String)]),
        sample: { inputFileName: expect.stringMatching(/\.csv$/u), inputCsv: expect.stringContaining("order_id"), outputFileName: expect.stringMatching(/\.csv$/u), outputCsv: expect.stringContaining("order_id"), explanation: expect.any(String) },
      });
      expect(assets.activity.publicAcceptanceCriteria).toHaveLength(activityId === "act-practical" ? 6 : 4);
      expect(assets.activity.publicAcceptanceCriteria?.join(" ")).toContain(activityId === "act-load-csv" ? "csv_path" : "原始 DataFrame");
      expect(JSON.stringify({ datasets: assets.publicDatasetFiles, tests: assets.publicTestSources }))
        .not.toMatch(/private|hidden|reference-solutions|rubric|[A-Za-z]:[\\/]/iu);
    }
  });

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
    const beforePreview = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3 });
    const preview = await adapter.prepareActivityRun({ requestId: "preview", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 3, mode: "preview" });
    expect(preview).toMatchObject({ activityId: "code", mode: "preview", environmentId: "env", publicDatasetFiles: [{ name: "data.csv", hash: publicDataHash }], publicTestSources: ["def test_public(): pass"] });
    expect(preview.starterCodeHash).toBe(sha256Text("print('starter')"));
    expect(preview.bundleHash).toBe(hashPublicExecutionBundle(preview));
    expect(await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3 })).toEqual(beforePreview);
    const submission = { requestId: "submit", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code" as const, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 3, userText: "print(1)" };
    const committedContext = await adapter.submitActivityWithContext(submission);
    const submitted = committedContext.output;
    expect(committedContext).toMatchObject({ replayed: false, snapshot: { sessionVersion: 5, latestCommit: { evidenceVersion: 1 } } });
    expect(submitted).toMatchObject({ committed: true, sessionVersion: 5, evidenceVersion: 1, result: { verdict: "pass" } });
    await expect(adapter.submitActivityWithContext(submission)).resolves.toMatchObject({ output: submitted, replayed: true, snapshot: { sessionVersion: 5 } });
    await expect(adapter.submitActivityWithContext({ ...submission, userText: "print(2)" }))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    expect(await adapter.getActivityAttempt({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", attemptId: opened.attemptId })).toMatchObject({ status: "submitted", result: { verdict: "pass" } });
    expect(await adapter.recoverActivity({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", attemptId: opened.attemptId })).toMatchObject({ recoveryAction: "show_submitted" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot).toMatchObject({ activityProgress: [{ activities: [{ status: "completed", result: "pass" }] }] });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.knowledgeStates).toEqual([expect.objectContaining({ knowledgePointId: "kp", evidenceVersion: 1 })]);
    expect(snapshot.path?.pathVersion).toBe(1);
  });

  it("rejects caller-supplied derived facts on code submission", async () => {
    const { adapter, view } = await setup({ executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash, assetBundleHash });
    const opened = await adapter.openActivity({ requestId: "open-derived", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    await expect(adapter.submitActivity({ requestId: "submit-derived", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code", activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, userText: "print(1)", evidenceCandidate: {} } as never))
      .rejects.toMatchObject({ errorCode: "submission_contract_error" });
  });

  it("rejects preview for a non-current Attempt without changing session facts", async () => {
    const { adapter, sessions, view } = await setup({ executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash, assetBundleHash });
    const opened = await adapter.openActivity({ requestId: "open-preview-binding", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    const before = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3 });
    await expect(adapter.prepareActivityRun({ requestId: "wrong-preview", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: `${opened.attemptId}-old`, draftVersion: 2, mode: "preview" }))
      .rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    await expect(adapter.prepareActivityRun({ requestId: "stale-preview", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, mode: "preview" }))
      .rejects.toMatchObject({ errorCode: "session_version_conflict" });
    await expect(adapter.prepareActivityRun({ requestId: "revision-preview", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, mode: "preview" }))
      .rejects.toMatchObject({ errorCode: "profile_revision_conflict" });
    expect(await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3 })).toEqual(before);
  });

  it("rejects a mismatched public execution environment", async () => {
    const mismatched = structuredClone(assets);
    mismatched.environment.environmentId = "other-env";
    const { adapter, view } = await setup({ executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "fixture", environmentHash, assetBundleHash }, mismatched);
    const opened = await adapter.openActivity({ requestId: "open-env", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    await expect(adapter.prepareActivityRun({ requestId: "preview-env", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, mode: "preview" }))
      .rejects.toMatchObject({ errorCode: "environment_mismatch" });
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

  it("keeps a learner failure in progress and opens a new editable Attempt with the submitted code", async () => {
    const { adapter, sessions, view } = await setup({
      executionStatus: "completed",
      verdict: "fail",
      score: 0,
      errorKind: "learner",
      errorCode: "test_failed",
      safeFeedback: "modify and retry",
      evaluatorVersion: "fixture",
      environmentHash,
      assetBundleHash,
    });
    const opened = await adapter.openActivity({ requestId: "open-fail", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    const submittedCode = "print('needs revision')";
    const saved = await adapter.saveActivityDraft({ requestId: "save-fail", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: 2, userText: submittedCode });
    if (saved.kind !== "code") throw new Error("code_draft_expected");
    const submitted = await adapter.submitActivity({ requestId: "submit-fail", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code", activityId: "code", activityVersion: 3, attemptId: opened.attemptId, draftVersion: saved.draftVersion, userText: submittedCode });
    expect(submitted).toMatchObject({ committed: true, sessionVersion: 5, result: { verdict: "fail" } });
    const failedSnapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    expect(failedSnapshot.currentAttempt).toBeUndefined();
    expect(failedSnapshot.activityProgress[0]?.activities[0]).toMatchObject({ status: "in_progress", result: "fail" });
    expect(failedSnapshot.evidence).toHaveLength(1);

    const retry = await adapter.openActivity({ requestId: "open-retry", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1 });
    expect(retry.attemptId).not.toBe(opened.attemptId);
    expect(retry).toMatchObject({ sessionVersion: 6, draftVersion: 1, userText: submittedCode });
    const retrySnapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 6, profileRevision: 3 });
    expect(retrySnapshot.currentAttempt).toMatchObject({ kind: "code", activityId: "code", attemptId: retry.attemptId, status: "draft" });
  });

  it("allows an idempotent gap continuation only after a second submitted learner failure", async () => {
    const { adapter, sessions, view } = await setup({
      executionStatus: "completed",
      verdict: "fail",
      score: 0,
      errorKind: "learner",
      errorCode: "test_failed",
      safeFeedback: "modify and retry",
      evaluatorVersion: "fixture",
      environmentHash,
      assetBundleHash,
    });
    const first = await adapter.openActivity({ requestId: "open-first-gap", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1, acknowledgedCardId: "card-kp" });
    if (first.kind !== "code") throw new Error("code_draft_expected");
    const firstResult = await adapter.submitActivity({ requestId: "submit-first-gap", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "code", activityId: "code", activityVersion: 3, attemptId: first.attemptId, draftVersion: 2, userText: first.userText });
    expect(firstResult).toMatchObject({ sessionVersion: 5, result: { verdict: "fail" } });
    const afterFirst = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    await expect(adapter.continueActivityWithGap({ requestId: "gap-too-early", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", attemptId: first.attemptId }))
      .rejects.toMatchObject({ errorCode: "prerequisite_violation" });
    expect(await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 })).toEqual(afterFirst);

    const second = await adapter.openActivity({ requestId: "open-second-gap", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "code", activityVersion: 3, pathVersion: 1 });
    if (second.kind !== "code") throw new Error("code_draft_expected");
    const secondResult = await adapter.submitActivity({ requestId: "submit-second-gap", sessionId: view.sessionId, sessionVersion: 6, profileRevision: 3, kind: "code", activityId: "code", activityVersion: 3, attemptId: second.attemptId, draftVersion: 1, userText: second.userText });
    expect(secondResult).toMatchObject({ sessionVersion: 7, result: { verdict: "fail" } });
    const beforeContinue = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3 });
    expect(beforeContinue.activityProgress[0]?.activities[0]).toMatchObject({ status: "in_progress", result: "fail", attemptIds: [first.attemptId, second.attemptId] });
    expect(beforeContinue.evidence).toHaveLength(2);

    const continuationInput = { requestId: "continue-code-gap", sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3, activityId: "code", attemptId: second.attemptId } as const;
    const continued = await adapter.continueActivityWithGap(continuationInput);
    expect(continued).toMatchObject({ sessionVersion: 8, status: "insufficient", result: "fail", attemptCount: 2 });
    await expect(adapter.continueActivityWithGap(continuationInput)).resolves.toEqual(continued);

    const finalSnapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 8, profileRevision: 3 });
    expect(finalSnapshot.currentAttempt).toBeUndefined();
    expect(finalSnapshot.activityProgress[0]?.activities[0]).toMatchObject({
      status: "insufficient",
      result: "fail",
      continuedWithGap: true,
      attemptIds: [first.attemptId, second.attemptId],
    });
    expect(finalSnapshot.evidence).toEqual(beforeContinue.evidence);
    expect(finalSnapshot.knowledgeStates).toEqual(beforeContinue.knowledgeStates);
    expect(finalSnapshot.latestCommit.evidenceVersion).toBe(beforeContinue.latestCommit.evidenceVersion);
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
