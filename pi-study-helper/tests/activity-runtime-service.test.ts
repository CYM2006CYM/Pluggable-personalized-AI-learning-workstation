import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityRuntimeService } from "../src/application/activity-runtime-service.js";
import { FixtureCodeEvaluationAdapter } from "../src/infrastructure/code-evaluation-port.js";
import { FileActivityRepository } from "../src/repositories/file-activity-repository.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import type { ActivityResult } from "../src/domain/v2-types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const formalAssetHash = `sha256:${"a".repeat(64)}`;
const formalEnvironmentHash = `sha256:${"b".repeat(64)}`;

async function setupFormalScenario(suffix: string, result: ActivityResult) {
  const root = await mkdtemp(resolve(tmpdir(), `w3-d3-formal-${suffix}-`)); roots.push(root);
  const sessions = new FileLearningSessionRepository({ dataRoot: root });
  const repository = new FileActivityRepository({ dataRoot: root });
  const session = await sessions.create({ requestId: `create-${suffix}`, subjectId: "pandas", mode: "recommended", goalId: "goal-1", availableMinutes: 10, profileRevision: 2, diagnosticRequired: false });
  const assignment = { assignmentId: `assignment-${suffix}`, activityId: `act-${suffix}`, activityVersion: 2, profileRevision: 2, primaryKnowledgePointId: "kp-dataframe", kind: "code_completion" as const, source: "fixed" as const, assetBundleHash: formalAssetHash, environmentId: "env-node-submit" };
  const attemptId = `attempt-${suffix}`;
  await repository.openActivity({ subjectId: "pandas", sessionId: session.sessionId, requestId: `open-${suffix}`, assignment, attemptId });
  await repository.saveDraft({ subjectId: "pandas", sessionId: session.sessionId, requestId: `draft-${suffix}`, activityId: assignment.activityId, attemptId, activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
  const evaluator = new FixtureCodeEvaluationAdapter({ resultsByActivityId: { [assignment.activityId]: result } });
  const service = new ActivityRuntimeService(repository, evaluator);
  const prepared = await service.prepareActivityRun({ subjectId: "pandas", sessionId: session.sessionId, requestId: `run-${suffix}`, activityId: assignment.activityId, attemptId, activityVersion: 2, profileRevision: 2, draftVersion: 2, mode: "submit", activity: { activityId: assignment.activityId, kind: assignment.kind, profileRevision: 2, templateVersion: "v2", environmentRef: assignment.environmentId }, taskVersion: "v2", environment: { environmentId: assignment.environmentId, status: "measured", environmentHash: formalEnvironmentHash, prototypeEvidenceRef: "W3-D40-ENV-1" }, assetBundleHash: formalAssetHash });
  const evidenceId = `evidence-${attemptId}`;
  const knowledgeState = { knowledgePointId: "kp-dataframe", profileRevision: 2, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1" as const, mastery: result.score ?? 0, confidence: 1, status: result.verdict === "pass" ? "mastered" as const : "support_needed" as const, validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: [evidenceId], consideredEvidenceIds: [evidenceId], asOf: "2026-08-08T01:02:03.000Z", skipEligible: result.verdict === "pass", lastUpdatedAt: "2026-08-08T01:02:03.000Z" };
  const pathCandidate = { pathId: `path-${suffix}`, pathVersion: 1, status: "candidate" as const, goalId: "goal-1", mode: "recommended" as const, nodes: [{ nodeId: `node-${suffix}`, knowledgePointId: "kp-dataframe", activityIds: [assignment.activityId], status: "available" as const, estimatedMinutes: 5, reasonCodes: ["goal_required"] }] };
  const input = { subjectId: "pandas", sessionId: session.sessionId, sessionVersion: 1, requestId: `submit-${suffix}`, attemptId, activityId: assignment.activityId, activityVersion: 2, profileRevision: 2, assignment, draftVersion: 2, code: "print(1)", prepared: prepared.prepared, sessionRepository: sessions, knowledgeStates: [knowledgeState], pathCandidate };
  return { input, knowledgeState, pathCandidate, repository, service, session, sessions };
}

describe("D3 ActivityRuntimeService", () => {
  it("uses C's public port and persists only its public ActivityResult", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w3-d3-runtime-")); roots.push(root);
    const repository = new FileActivityRepository({ dataRoot: root });
    const hash = `sha256:${"a".repeat(64)}`;
    const assignment = { assignmentId: "assignment-1", activityId: "act-inspect-dataframe", activityVersion: 2, profileRevision: 2, primaryKnowledgePointId: "kp-dataframe", kind: "code_completion" as const, source: "fixed" as const, assetBundleHash: hash, environmentId: "env-python-pandas-candidate" };
    await repository.openActivity({ subjectId: "pandas", sessionId: "session-1", requestId: "open-1", assignment, attemptId: "attempt-1" });
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const evaluator = new FixtureCodeEvaluationAdapter({ resultsByActivityId: {
      "act-inspect-dataframe": { executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "C-formal", environmentHash: `sha256:${"b".repeat(64)}`, assetBundleHash: hash },
    } });
    const service = new ActivityRuntimeService(repository, evaluator);
    const prepared = await service.prepareActivityRun({ subjectId: "pandas", sessionId: "session-1", requestId: "run-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 2, mode: "submit", activity: { activityId: assignment.activityId, kind: assignment.kind, profileRevision: 2, templateVersion: "v2", environmentRef: assignment.environmentId }, taskVersion: "v2", environment: { environmentId: assignment.environmentId, status: "measured", environmentHash: `sha256:${"b".repeat(64)}`, prototypeEvidenceRef: "d40" }, assetBundleHash: hash });
    const submitted = await service.submitActivity({ subjectId: "pandas", sessionId: "session-1", sessionVersion: 1, requestId: "submit-1", attemptId: "attempt-1", activityId: assignment.activityId, activityVersion: 2, profileRevision: 2, assignment, draftVersion: 2, code: "print(1)", prepared: prepared.prepared, result: { executionStatus: "not_started", verdict: "not_graded", safeFeedback: "unused", evaluatorVersion: "unused", environmentHash: `sha256:${"b".repeat(64)}`, assetBundleHash: hash } }, new AbortController().signal);
    expect(submitted).toMatchObject({ attempt: { attemptId: "attempt-1" }, result: { verdict: "pass" } });
  });

  it("orchestrates the formal ActivityResult into facts, path, checkpoint, and a safe DTO", async () => {
    const { input, knowledgeState, repository, service, session, sessions } = await setupFormalScenario("formal", { executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "ok", evaluatorVersion: "C-formal", environmentHash: formalEnvironmentHash, assetBundleHash: formalAssetHash });
    const output = await service.submitFormalActivity(input, new AbortController().signal);
    expect(output).toMatchObject({ requestId: "submit-formal", attemptId: "attempt-formal", committed: true, result: { verdict: "pass" }, evidenceId: "evidence-attempt-formal", evidenceVersion: 1, sessionVersion: 2, profileRevision: 2 });
    const snapshot = await sessions.getSnapshot({ sessionId: session.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.knowledgeStates).toEqual([knowledgeState]);
    expect(snapshot.path).toMatchObject({ pathId: "path-formal", pathVersion: 1 });
    expect(snapshot.latestCommit.requestId).toBe("submit-formal");
    expect((await repository.getAttempt({ subjectId: "pandas", sessionId: session.sessionId, activityId: input.activityId, attemptId: "attempt-formal" }))?.attempt.committedAt).toEqual(expect.any(String));
    expect(await service.submitFormalActivity(input, new AbortController().signal)).toEqual(output);
    await expect(service.submitFormalActivity({ ...input, code: "print(2)" }, new AbortController().signal)).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    expect((await sessions.getSnapshot({ sessionId: session.sessionId, sessionVersion: 2, profileRevision: 2 })).evidence).toHaveLength(1);
  });

  it.each([
    ["partial", { executionStatus: "completed", verdict: "partial", score: 0.5, safeFeedback: "partial", evaluatorVersion: "C-formal", environmentHash: formalEnvironmentHash, assetBundleHash: formalAssetHash } satisfies ActivityResult, "partial"],
    ["learner-error", { executionStatus: "completed", verdict: "fail", errorKind: "learner", errorCode: "test_failed", score: 0, safeFeedback: "fix the submitted code", evaluatorVersion: "C-formal", environmentHash: formalEnvironmentHash, assetBundleHash: formalAssetHash } satisfies ActivityResult, "incorrect"],
  ])("commits %s as deterministic learner Evidence", async (suffix, result, outcome) => {
    const { input, service, session, sessions } = await setupFormalScenario(suffix, result);
    const output = await service.submitFormalActivity(input, new AbortController().signal);
    expect(output).toMatchObject({ committed: true, result: { verdict: result.verdict }, evidenceVersion: 1, sessionVersion: 2 });
    const snapshot = await sessions.getSnapshot({ sessionId: session.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(snapshot.evidence).toEqual([expect.objectContaining({ outcome, attemptId: input.attemptId })]);
  });

  it("keeps evaluator failures outside Attempt, Evidence, KnowledgeState, path, and checkpoint", async () => {
    const result: ActivityResult = { executionStatus: "failed", verdict: "not_graded", errorKind: "evaluator", errorCode: "evaluator_timeout", safeFeedback: "retry later", evaluatorVersion: "C-formal", environmentHash: formalEnvironmentHash, assetBundleHash: formalAssetHash };
    const { input, repository, service, session, sessions } = await setupFormalScenario("evaluator-error", result);
    const output = await service.submitFormalActivity(input, new AbortController().signal);
    expect(output).toMatchObject({ committed: false, errorCode: "evaluator_timeout", result: { verdict: "not_graded" }, sessionVersion: 1 });
    const snapshot = await sessions.getSnapshot({ sessionId: session.sessionId, sessionVersion: 1, profileRevision: 2 });
    expect(snapshot).toMatchObject({ evidence: [], knowledgeStates: [], latestCommit: { evidenceVersion: 0, sessionVersion: 1 } });
    expect(snapshot.path).toBeUndefined();
    expect(await repository.getAttempt({ subjectId: "pandas", sessionId: session.sessionId, activityId: input.activityId, attemptId: input.attemptId })).toBeUndefined();
  });
});
