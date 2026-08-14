import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityEvidenceProjectionStaleError } from "../src/application/capability-task-service.js";
import type { Evidence, KnowledgeState } from "../src/contracts/index.js";
import { SessionCapabilityEvidenceProvider } from "../src/infrastructure/session-capability-evidence-provider.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

const roots: string[] = [];
const now = () => new Date("2026-08-14T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evidence(sessionId: string, evidenceId = "evidence-1", knowledgePointId = "pandas.clean.read-csv"): Evidence {
  return {
    evidenceId,
    requestId: `request-${evidenceId}`,
    sessionId,
    knowledgePointId,
    profileRevision: 3,
    kind: "mcq",
    source: "deterministic_quiz",
    form: "selected_response",
    impact: "mastery",
    outcome: "correct",
    score: 1,
    difficulty: "S-U",
    independence: "independent",
    activityId: "act-read-csv",
    attemptId: `attempt-${evidenceId}`,
    createdAt: now().toISOString(),
  };
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

async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "w4-d-cap-evidence-"));
  roots.push(root);
  const sessions = new FileLearningSessionRepository({ dataRoot: root, now });
  const view = await sessions.create({
    requestId: "create-formal-session",
    subjectId: "pandas",
    mode: "recommended",
    goalId: "goal",
    availableMinutes: 20,
    profileRevision: 3,
    diagnosticRequired: false,
  });
  const first = evidence(view.sessionId);
  await sessions.commit({
    requestId: first.requestId,
    sessionId: view.sessionId,
    sessionVersion: 1,
    profileRevision: 3,
    candidate: { requestId: first.requestId, evidenceCandidate: first, knowledgeStates: [state(first.evidenceId, 1)] },
  });
  return { sessions, view, provider: new SessionCapabilityEvidenceProvider({ sessions }) };
}

describe("SessionCapabilityEvidenceProvider", () => {
  it("projects formal bound Evidence through a safe field whitelist", async () => {
    const { provider, view } = await setup();
    const projected = await provider.load({
      sessionId: view.sessionId,
      profileRevision: 3,
      evidenceVersion: 1,
      evidenceIds: ["evidence-1"],
      knowledgePointId: "pandas.clean.read-csv",
    });
    expect(view.sessionId).toMatch(/^session-[a-f0-9]{24}$/u);
    expect(projected).toEqual([{
      evidenceId: "evidence-1",
      observableDimensionIds: ["syntax_api"],
      safeSummary: expect.stringContaining("source=deterministic_quiz"),
    }]);
    expect(projected[0]!.safeSummary).not.toMatch(/correctAnswer|answer key|hidden|rubric|[A-Za-z]:\\/iu);
  });

  it("rejects foreign, missing, duplicate, cross-knowledge-point, revision, and future-version requests", async () => {
    const { provider, view } = await setup();
    const base = { sessionId: view.sessionId, profileRevision: 3, evidenceVersion: 1, evidenceIds: ["evidence-1"] };
    await expect(provider.load({ ...base, evidenceIds: ["missing"] })).rejects.toMatchObject({ errorCode: "evidence_invalid" });
    await expect(provider.load({ ...base, evidenceIds: ["evidence-1", "evidence-1"] })).rejects.toMatchObject({ errorCode: "evidence_invalid" });
    await expect(provider.load({ ...base, sessionId: "session-ffffffffffffffffffffffff" })).rejects.toMatchObject({ errorCode: "session_not_found" });
    await expect(provider.load({ ...base, profileRevision: 2 })).rejects.toMatchObject({ errorCode: "profile_revision_conflict" });
    await expect(provider.load({ ...base, evidenceVersion: 2 })).rejects.toMatchObject({ errorCode: "evidence_invalid" });
    await expect(provider.load({ ...base, knowledgePointId: "kp-other" })).rejects.toMatchObject({ errorCode: "evidence_invalid" });
  });

  it("marks an old task stale when the bound session has newer formal Evidence", async () => {
    const { sessions, provider, view } = await setup();
    const second = evidence(view.sessionId, "evidence-2");
    await sessions.commit({
      requestId: second.requestId,
      sessionId: view.sessionId,
      sessionVersion: 2,
      profileRevision: 3,
      candidate: { requestId: second.requestId, evidenceCandidate: second, knowledgeStates: [state(second.evidenceId, 2)] },
    });
    await expect(provider.load({
      sessionId: view.sessionId,
      profileRevision: 3,
      evidenceVersion: 1,
      evidenceIds: ["evidence-1"],
    })).rejects.toBeInstanceOf(CapabilityEvidenceProjectionStaleError);
  });

  it("accepts all cumulative Evidence at the current session version", async () => {
    const { sessions, provider, view } = await setup();
    const second = evidence(view.sessionId, "evidence-2");
    await sessions.commit({
      requestId: second.requestId,
      sessionId: view.sessionId,
      sessionVersion: 2,
      profileRevision: 3,
      candidate: { requestId: second.requestId, evidenceCandidate: { ...second, activityId: "act-read-csv" }, knowledgeStates: [state(second.evidenceId, 2)] },
    });
    await expect(provider.load({
      sessionId: view.sessionId,
      profileRevision: 3,
      evidenceVersion: 2,
      evidenceIds: ["evidence-1", "evidence-2"],
      knowledgePointId: "pandas.clean.read-csv",
    })).resolves.toHaveLength(2);
  });

  it("does not infer a new dimension from the outcome or an unknown combination", async () => {
    const { sessions, provider, view } = await setup();
    const incorrect = evidence(view.sessionId, "evidence-incorrect");
    incorrect.outcome = "incorrect";
    await sessions.commit({
      requestId: incorrect.requestId,
      sessionId: view.sessionId,
      sessionVersion: 2,
      profileRevision: 3,
      candidate: { requestId: incorrect.requestId, evidenceCandidate: { ...incorrect, activityId: "act-read-csv" }, knowledgeStates: [state(incorrect.evidenceId, 2)] },
    });
    await expect(provider.load({ sessionId: view.sessionId, profileRevision: 3, evidenceVersion: 2,
      evidenceIds: ["evidence-incorrect"], knowledgePointId: "pandas.clean.read-csv" })).resolves.toMatchObject([
      { observableDimensionIds: ["syntax_api"] },
    ]);
    const unknown = { ...incorrect, requestId: "request-evidence-unknown", evidenceId: "evidence-unknown", knowledgePointId: "unmapped-kp", activityId: "unmapped-activity" };
    await sessions.commit({ requestId: unknown.requestId, sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3,
      candidate: { requestId: unknown.requestId, evidenceCandidate: unknown, knowledgeStates: [state(unknown.evidenceId, 3, "unmapped-kp")] } });
    await expect(provider.load({ sessionId: view.sessionId, profileRevision: 3, evidenceVersion: 3,
      evidenceIds: ["evidence-unknown"], knowledgePointId: "unmapped-kp" })).resolves.toMatchObject([
      { observableDimensionIds: [] },
    ]);
  });
});
