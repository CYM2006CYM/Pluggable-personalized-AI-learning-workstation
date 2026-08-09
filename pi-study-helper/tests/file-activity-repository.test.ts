import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FileActivityRepository } from "../src/repositories/file-activity-repository.js";
import { ActivityRepositoryError, activityResultToEvidence, commitFormalActivity, LearningSessionUnitOfWork, type ActivityAssignment, type RecordActivityResultInput } from "../src/repositories/activity-repository.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import type { ActivityResult } from "../src/domain/v2-types.js";

const assignment: ActivityAssignment = {
  assignmentId: "assignment-1",
  activityId: "act-inspect-dataframe",
  activityVersion: 2,
  profileRevision: 2,
  primaryKnowledgePointId: "kp-dataframe",
  kind: "code_completion",
  source: "fixed",
  assetBundleHash: `sha256:${"a".repeat(64)}`,
  environmentId: "env-node-submit",
};

const pass: ActivityResult = {
  executionStatus: "completed",
  verdict: "pass",
  score: 1,
  safeFeedback: "All deterministic checks passed.",
  evaluatorVersion: "fixture-v3",
  environmentHash: `sha256:${"b".repeat(64)}`,
  assetBundleHash: assignment.assetBundleHash,
};

async function setup(options: ConstructorParameters<typeof FileActivityRepository>[0] = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "activity-repository-"));
  const repository = new FileActivityRepository({ dataRoot: root, now: () => new Date("2026-08-08T01:02:03.000Z"), ...options });
  await repository.openActivity({ subjectId: "pandas", sessionId: "session-1", requestId: "open-1", assignment, attemptId: "attempt-1" });
  return { root, repository };
}

function resultInput(overrides: Partial<RecordActivityResultInput> = {}): RecordActivityResultInput {
  return {
    subjectId: "pandas", sessionId: "session-1", sessionVersion: 1, requestId: "submit-1", attemptId: "attempt-1", activityId: assignment.activityId,
    activityVersion: assignment.activityVersion, profileRevision: assignment.profileRevision, assignment, draftVersion: 2, code: "import pandas as pd\nprint(pd.DataFrame())", result: pass, ...overrides,
  };
}

describe("FileActivityRepository W3-D2 local candidate", () => {
  it("persists drafts separately from code and enforces draft CAS", async () => {
    const { root, repository } = await setup();
    const saved = await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    expect(saved).toMatchObject({ draftVersion: 2, codeHash: expect.any(String) });
    const metadata = await readFile(resolve(root, "profile_families/pandas/_user/learning_sessions/session-1/activities/act-inspect-dataframe/draft.json"), "utf8");
    expect(metadata).not.toContain("print(1)");
    await expect(repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-stale", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "stale" })).rejects.toMatchObject({ errorCode: "draft_version_conflict" });
  });

  it("creates a durable Attempt candidate and maps only the primary point to Evidence", async () => {
    const { repository } = await setup();
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const record = await repository.recordResult(resultInput({ code: "print(1)" }));
    expect(record).toHaveProperty("attempt.attemptStatus", "completed");
    if (!("attempt" in record)) throw new Error("expected attempt");
    const evidence = activityResultToEvidence(record.attempt, record.result);
    expect(evidence).toMatchObject({ knowledgePointId: "kp-dataframe", source: "code_submit", impact: "mastery", outcome: "correct" });
    expect(evidence?.evidenceVersion).toBeUndefined();
  });

  it("is idempotent for the same identity and rejects content conflicts", async () => {
    const { repository } = await setup();
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const first = await repository.recordResult(resultInput({ code: "print(1)" }));
    const replay = await repository.recordResult(resultInput({ code: "print(1)" }));
    expect(replay).toEqual(first);
    await expect(repository.recordResult(resultInput({ code: "print(2)" }))).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
  });

  it("replays an already published attempt even after a newer draft exists", async () => {
    const { repository } = await setup();
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const first = await repository.recordResult(resultInput({ code: "print(1)" }));
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-2", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 2, code: "print(2)" });
    expect(await repository.recordResult(resultInput({ code: "print(1)" }))).toEqual(first);
  });

  it("stores evaluator failures without creating an Attempt or Evidence", async () => {
    const { repository } = await setup();
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const failure = await repository.recordResult(resultInput({ code: "print(1)", result: { ...pass, executionStatus: "failed", verdict: "not_graded", errorKind: "evaluator", errorCode: "evaluator_timeout" }, requestId: "failed-1" }));
    expect(failure).toMatchObject({ errorCode: "evaluator_timeout", stage: "user_code" });
    expect(await repository.getAttempt({ subjectId: "pandas", sessionId: "session-1", activityId: assignment.activityId, attemptId: "attempt-1" })).toBeUndefined();
  });

  it("rejects a graded result whose asset or environment binding changed", async () => {
    const { repository } = await setup();
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    await expect(repository.recordResult(resultInput({ code: "print(1)", result: { ...pass, assetBundleHash: `sha256:${"c".repeat(64)}` } }))).rejects.toMatchObject({ errorCode: "environment_mismatch" });
  });

  it("recovers a result transaction left after a publication fault", async () => {
    let fail = true;
    const { repository } = await setup({ beforePublish: async (stage) => { if (stage === "result" && fail) { fail = false; throw new Error("simulated publication fault"); } } });
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    await expect(repository.recordResult(resultInput({ code: "print(1)" }))).rejects.toThrow("simulated publication fault");
    const report = await repository.recover({ subjectId: "pandas", sessionId: "session-1" });
    expect(report.publishedCandidates).toEqual(["act-inspect-dataframe/attempt-1"]);
    expect(await repository.getAttempt({ subjectId: "pandas", sessionId: "session-1", activityId: assignment.activityId, attemptId: "attempt-1" })).toMatchObject({ attempt: { attemptId: "attempt-1" } });
  });

  it("does not allow a traversal identifier to escape the session root", async () => {
    const { repository } = await setup();
    await expect(repository.openActivity({ subjectId: "pandas", sessionId: "session-1", requestId: "open-bad", assignment: { ...assignment, activityId: "../secret" } })).rejects.toBeInstanceOf(ActivityRepositoryError);
  });

  it("removes the Attempt candidate when the formal session transaction rejects", async () => {
    const { repository } = await setup();
    await repository.saveDraft({ subjectId: "pandas", sessionId: "session-1", requestId: "draft-1", activityId: assignment.activityId, attemptId: "attempt-1", activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const failingSession = {
      commit: async () => { throw new Error("session-cas"); },
    } as never;
    await expect(commitFormalActivity({ repository, sessionRepository: failingSession, activity: resultInput({ code: "print(1)" }), knowledgeStates: [] })).rejects.toThrow("session-cas");
    expect(await repository.getAttempt({ subjectId: "pandas", sessionId: "session-1", activityId: assignment.activityId, attemptId: "attempt-1" })).toBeUndefined();
  });

  it.each(["evidence_written", "knowledge_state_written", "path_written", "checkpoint_written"] as const)("recovers Attempt and formal facts together after %s fault", async (faultStage) => {
    const root = await mkdtemp(resolve(tmpdir(), `cross-repository-${faultStage}-`));
    let injected: typeof faultStage | undefined = faultStage;
    const sessions = new FileLearningSessionRepository({
      dataRoot: root,
      now: () => new Date("2026-08-08T01:02:03.000Z"),
      beforePublish: async (_sessionId, _requestId, stage) => {
        if (stage === injected) {
          injected = undefined;
          throw new Error(`session-fault:${stage}`);
        }
      },
    });
    const activities = new FileActivityRepository({ dataRoot: root, now: () => new Date("2026-08-08T01:02:03.000Z") });
    const view = await sessions.create({ requestId: `create-${faultStage}`, subjectId: "pandas", mode: "recommended", goalId: "goal-1", availableMinutes: 10, profileRevision: 2, diagnosticRequired: false });
    const input = resultInput({ sessionId: view.sessionId, requestId: `submit-${faultStage}`, attemptId: `attempt-${faultStage}`, code: "print(1)" });
    await activities.openActivity({ subjectId: "pandas", sessionId: view.sessionId, requestId: `open-${faultStage}`, assignment, attemptId: input.attemptId });
    await activities.saveDraft({ subjectId: "pandas", sessionId: view.sessionId, requestId: `draft-${faultStage}`, activityId: assignment.activityId, attemptId: input.attemptId, activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const pathCandidate = {
      pathId: `path-${faultStage}`,
      pathVersion: 1,
      status: "candidate" as const,
      goalId: "goal-1",
      mode: "recommended" as const,
      nodes: [{ nodeId: `node-${faultStage}`, knowledgePointId: "kp-dataframe", activityIds: [assignment.activityId], status: "available" as const, estimatedMinutes: 5, reasonCodes: ["goal_required"] }],
    };
    const unit = new LearningSessionUnitOfWork(activities, sessions);
    await expect(unit.commit({ repository: activities, sessionRepository: sessions, activity: input, knowledgeStates: [{ knowledgePointId: "kp-dataframe", profileRevision: 2, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: 1, confidence: 1, status: "mastered", validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: [`evidence-${input.attemptId}`], consideredEvidenceIds: [`evidence-${input.attemptId}`], asOf: "2026-08-08T01:02:03.000Z", skipEligible: true, lastUpdatedAt: "2026-08-08T01:02:03.000Z" }], pathCandidate })).rejects.toThrow(`session-fault:${faultStage}`);
    expect((await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 })).evidence).toEqual([]);
    const pending = await activities.getAttempt({ subjectId: "pandas", sessionId: view.sessionId, activityId: assignment.activityId, attemptId: input.attemptId });
    expect(pending).toMatchObject({ attempt: { attemptId: input.attemptId } });
    expect((pending as { attempt: { committedAt?: string } }).attempt.committedAt).toBeUndefined();

    const recovered = await unit.recover({ subjectId: "pandas", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2, requestId: input.requestId, activityId: assignment.activityId, attemptId: input.attemptId });
    expect(recovered).toMatchObject({ recoveryAction: "completed_candidate_commit", sessionVersion: 2, latestCommit: { requestId: input.requestId } });
    const committed = await activities.getAttempt({ subjectId: "pandas", sessionId: view.sessionId, activityId: assignment.activityId, attemptId: input.attemptId });
    expect(committed).toMatchObject({ attempt: { attemptId: input.attemptId, committedAt: expect.any(String) } });
    expect(recovered.evidence).toHaveLength(1);
    expect(recovered.knowledgeStates).toHaveLength(1);
    expect(recovered.path).toMatchObject({ pathId: `path-${faultStage}` });

    const replay = await unit.commit({ repository: activities, sessionRepository: sessions, activity: input, knowledgeStates: [{ knowledgePointId: "kp-dataframe", profileRevision: 2, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: 1, confidence: 1, status: "mastered", validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: [`evidence-${input.attemptId}`], consideredEvidenceIds: [`evidence-${input.attemptId}`], asOf: "2026-08-08T01:02:03.000Z", skipEligible: true, lastUpdatedAt: "2026-08-08T01:02:03.000Z" }], pathCandidate });
    expect(replay).toMatchObject({ sessionVersion: 2, evidence: [{ evidenceId: `evidence-${input.attemptId}` }] });
    const secondRecovery = await unit.recover({ subjectId: "pandas", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2, requestId: input.requestId, activityId: assignment.activityId, attemptId: input.attemptId });
    expect(secondRecovery).toMatchObject({ recoveryAction: "none", sessionVersion: 2 });
  });

  it("keeps the Attempt when recovery published facts but markCommitted fails, then retries", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "recover-mark-commit-"));
    let failCheckpoint = true;
    const sessions = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-08-08T01:02:03.000Z"), beforePublish: async (_sessionId, _requestId, stage) => {
      if (stage === "checkpoint_written" && failCheckpoint) {
        failCheckpoint = false;
        throw new Error("checkpoint-fault");
      }
    } });
    const activities = new FileActivityRepository({ dataRoot: root, now: () => new Date("2026-08-08T01:02:03.000Z") });
    const view = await sessions.create({ requestId: "create-mark-commit", subjectId: "pandas", mode: "recommended", goalId: "goal-1", availableMinutes: 10, profileRevision: 2, diagnosticRequired: false });
    const input = resultInput({ sessionId: view.sessionId, requestId: "submit-mark-commit", attemptId: "attempt-mark-commit", code: "print(1)" });
    await activities.openActivity({ subjectId: "pandas", sessionId: view.sessionId, requestId: "open-mark-commit", assignment, attemptId: input.attemptId });
    await activities.saveDraft({ subjectId: "pandas", sessionId: view.sessionId, requestId: "draft-mark-commit", activityId: assignment.activityId, attemptId: input.attemptId, activityVersion: 2, profileRevision: 2, draftVersion: 1, code: "print(1)" });
    const unitBeforeRecovery = new LearningSessionUnitOfWork(activities, sessions);
    await expect(unitBeforeRecovery.commit({ repository: activities, sessionRepository: sessions, activity: input, knowledgeStates: [] })).rejects.toThrow("checkpoint-fault");

    let failMark = true;
    const failingActivities = Object.create(activities) as FileActivityRepository;
    failingActivities.markCommitted = async (markInput) => {
      if (failMark) {
        failMark = false;
        throw new Error("mark-committed-fault");
      }
      return activities.markCommitted(markInput);
    };
    const unit = new LearningSessionUnitOfWork(failingActivities, sessions);
    await expect(unit.recover({ subjectId: "pandas", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2, requestId: input.requestId, activityId: assignment.activityId, attemptId: input.attemptId })).rejects.toThrow("mark-committed-fault");
    expect(await activities.getAttempt({ subjectId: "pandas", sessionId: view.sessionId, activityId: assignment.activityId, attemptId: input.attemptId })).toMatchObject({ attempt: { attemptId: input.attemptId }, result: { verdict: "pass" } });

    const recovered = await unit.recover({ subjectId: "pandas", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2, requestId: input.requestId, activityId: assignment.activityId, attemptId: input.attemptId });
    expect(recovered).toMatchObject({ recoveryAction: "none", sessionVersion: 2 });
    expect(await activities.getAttempt({ subjectId: "pandas", sessionId: view.sessionId, activityId: assignment.activityId, attemptId: input.attemptId })).toMatchObject({ attempt: { committedAt: expect.any(String) } });
    expect(recovered.evidence).toHaveLength(1);
  });
});
