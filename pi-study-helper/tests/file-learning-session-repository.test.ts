import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import type { Evidence, KnowledgeState, LearnerDiagnostic } from "../src/domain/v2-types.js";

const roots: string[] = [];

async function repository(options: ConstructorParameters<typeof FileLearningSessionRepository>[0] = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-w2-a-"));
  roots.push(root);
  const repo = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-07-30T12:00:00.000Z"), ...options });
  const view = await repo.create({
    requestId: "create-1",
    subjectId: "smoke-subject",
    mode: "recommended",
    goalId: "goal-1",
    availableMinutes: 10,
    profileRevision: 2,
    diagnosticRequired: true,
  });
  return { root, repo, view };
}

function state(evidenceVersion: number): KnowledgeState {
  return {
    knowledgePointId: "kp-1",
    profileRevision: 2,
    evidenceVersion,
    aggregationVersion: "knowledge-state-v1",
    mastery: null,
    confidence: 0,
    status: "unverified",
    validEvidenceCount: 0,
    evidenceFormCount: 0,
    evidenceIds: [],
    consideredEvidenceIds: [],
    asOf: "2026-07-30T12:00:00.000Z",
    skipEligible: false,
    lastUpdatedAt: "2026-07-30T12:00:00.000Z",
  };
}

function evidence(): Evidence {
  return {
    evidenceId: "evidence-1",
    requestId: "answer-1",
    sessionId: "session-" + "a".repeat(24),
    knowledgePointId: "kp-1",
    profileRevision: 2,
    kind: "diagnostic",
    source: "fixed_diagnostic",
    form: "selected_response",
    impact: "mastery",
    outcome: "correct",
    score: 1,
    independence: "independent",
    createdAt: "2026-07-30T12:00:00.000Z",
  };
}

function diagnostic(evidenceVersion: number): LearnerDiagnostic {
  return {
    diagnosticId: "diagnostic-1",
    sessionId: "session-" + "a".repeat(24),
    profileRevision: 2,
    diagnosticVersion: 1,
    evidenceVersion,
    goalId: "goal-1",
    status: "completed",
    states: [state(evidenceVersion)],
    insufficientKnowledgePointIds: [],
    summaryTemplateVersion: "diagnostic-summary-v1",
    createdAt: "2026-07-30T12:00:00.000Z",
  };
}

type MutablePreparedTransaction = {
  inputHash: string;
  input?: {
    sessionVersion: number;
    candidate: {
      evidenceCandidates?: Evidence[];
      knowledgeStates: KnowledgeState[];
      diagnosticCandidate?: LearnerDiagnostic;
    };
  };
  snapshot: {
    sessionVersion: number;
    evidence: Evidence[];
    knowledgeStates: KnowledgeState[];
    latestCommit: { evidenceVersion: number; sessionVersion: number };
  };
  response: { sessionVersion: number };
  evidenceToPublish: Evidence[];
};

function rehashPreparedInput(prepared: MutablePreparedTransaction): void {
  prepared.inputHash = createHash("sha256").update(JSON.stringify(prepared.input)).digest("hex");
}

const semanticCorruptions: Array<[string, (prepared: MutablePreparedTransaction) => void]> = [
  ["input hash", (prepared) => { prepared.inputHash = "0".repeat(64); }],
  ["missing original input", (prepared) => { delete prepared.input; }],
  ["unsafe Evidence path", (prepared) => {
    prepared.input!.candidate.evidenceCandidates![0]!.evidenceId = "../escape";
    rehashPreparedInput(prepared);
  }],
  ["KnowledgeState semantics", (prepared) => {
    prepared.input!.candidate.knowledgeStates[0]!.confidence = 2;
    rehashPreparedInput(prepared);
  }],
  ["Diagnostic state closure", (prepared) => {
    prepared.input!.candidate.diagnosticCandidate!.states[0]!.mastery = 0.5;
    rehashPreparedInput(prepared);
  }],
  ["session version", (prepared) => {
    prepared.input!.sessionVersion = 2;
    rehashPreparedInput(prepared);
  }],
  ["snapshot Evidence tail", (prepared) => {
    prepared.snapshot.evidence.at(-1)!.evidenceId = "different-evidence";
  }],
  ["response closure", (prepared) => { prepared.response.sessionVersion = 99; }],
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileLearningSessionRepository", () => {
  it("creates a session and reads only the committed snapshot", async () => {
    const { repo, view } = await repository();
    const snapshot = await repo.getSnapshot({ sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 });
    expect(snapshot.view).toMatchObject({ sessionId: view.sessionId, sessionVersion: 1, stage: "diagnostic" });
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.latestCommit).toMatchObject({ evidenceVersion: 0, sessionVersion: 1 });
  });

  it("publishes a diagnostic Evidence batch and snapshot in one commit", async () => {
    const { repo, view } = await repository();
    const item = { ...evidence(), sessionId: view.sessionId };
    const candidate = { ...diagnostic(1), sessionId: view.sessionId, states: [state(1)] };
    const committed = await repo.commit({
      requestId: "complete-1",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: {
        requestId: "complete-1",
        evidenceCandidates: [item],
        knowledgeStates: [state(1)],
        diagnosticCandidate: candidate,
        nextStage: "path",
      },
    });
    expect(committed).toMatchObject({ committed: true, committedEvidenceIds: ["evidence-1"], committedDiagnosticId: "diagnostic-1" });
    expect(committed.latestCommit).toMatchObject({ evidenceVersion: 1, sessionVersion: 2 });
    expect(committed.evidence[0]?.evidenceVersion).toBe(1);
    const reread = await repo.getSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(reread.latestDiagnostic?.diagnosticId).toBe("diagnostic-1");
  });

  it("keeps evidenceVersion unchanged when every diagnostic question is skipped", async () => {
    const { repo, view } = await repository();
    const committed = await repo.commit({
      requestId: "skip-complete",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: {
        requestId: "skip-complete",
        knowledgeStates: [state(0)],
        diagnosticCandidate: { ...diagnostic(0), sessionId: view.sessionId, states: [state(0)] },
        nextStage: "path",
      },
    });
    expect(committed.latestCommit).toMatchObject({ evidenceVersion: 0, sessionVersion: 2 });
    expect(committed.evidence).toEqual([]);
  });

  it("preserves a valid public PathSafeSnapshot without requiring internal fields", async () => {
    const { repo, view, root } = await repository();
    const pathCandidate = {
      pathId: "public-path-1",
      pathVersion: 1,
      status: "candidate" as const,
      goalId: "goal-1",
      mode: "recommended" as const,
      nodes: [{ nodeId: "node-kp-1", knowledgePointId: "kp-1", activityIds: ["activity-1"], status: "available" as const, estimatedMinutes: 5, reasonCodes: ["goal_required"] }],
    };
    const committed = await repo.commit({
      requestId: "public-path-commit",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: { requestId: "public-path-commit", knowledgeStates: [state(0)], pathCandidate },
    });
    expect(committed.sessionVersion).toBe(2);
    expect(committed.path).toEqual(pathCandidate);
    expect(committed.path?.nodes).toHaveLength(1);
    const reread = await repo.getSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(reread.path).toEqual(pathCandidate);
    const restarted = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-07-30T12:00:00.000Z") });
    expect(await restarted.getInternalPathSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 })).toBeUndefined();
  });

  it("rejects an invalid public path candidate without changing the committed session", async () => {
    const { repo, view } = await repository();
    const invalid = {
      pathId: "invalid-path",
      pathVersion: 1,
      status: "candidate" as const,
      goalId: "goal-1",
      mode: "recommended" as const,
      nodes: [{ nodeId: "node-kp-1", knowledgePointId: "kp-1", activityIds: [], status: "available" as const, estimatedMinutes: 5, reasonCodes: [] }],
    };
    await expect(repo.commit({ requestId: "invalid-public-path", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2, candidate: { requestId: "invalid-public-path", knowledgeStates: [state(0)], pathCandidate: invalid } })).rejects.toMatchObject({ errorCode: "evidence_invalid" });
    const snapshot = await repo.getSnapshot({ sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 });
    expect(snapshot.sessionVersion).toBe(1);
    expect(snapshot.path).toBeUndefined();
  });

  it("uses one public safe path projection for getSnapshot, commit and recover", async () => {
    const { repo, view } = await repository();
    const pathCandidate = { pathId: "public-path-2", pathVersion: 1, status: "candidate" as const, goalId: "goal-1", mode: "recommended" as const, nodes: [{ nodeId: "node-kp-2", knowledgePointId: "kp-1", activityIds: ["activity-2"], status: "available" as const, estimatedMinutes: 6, reasonCodes: [] }] };
    const committed = await repo.commit({ requestId: "public-path-2", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2, candidate: { requestId: "public-path-2", knowledgeStates: [state(0)], pathCandidate } });
    const recovered = await repo.recover({ requestId: "recover-public-path", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    for (const output of [committed, await repo.getSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 }), recovered]) {
      expect(output.path).toEqual(pathCandidate);
      const node = output.path?.nodes[0]!;
      expect(Object.keys(node).sort()).toEqual(["activityIds", "estimatedMinutes", "knowledgePointId", "nodeId", "reasonCodes", "status"]);
      expect(node).not.toHaveProperty("difficulty");
      expect(node).not.toHaveProperty("scaffold");
      expect(node).not.toHaveProperty("positionLocked");
      expect(node).not.toHaveProperty("required");
    }
  });

  it("makes same request retries idempotent and rejects stale versions", async () => {
    const { repo, view } = await repository();
    const input = {
      requestId: "empty-commit",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: { requestId: "empty-commit", knowledgeStates: [state(0)] },
    };
    const first = await repo.commit(input);
    const retry = await repo.commit(input);
    expect(retry).toEqual(first);
    await expect(repo.commit({ ...input, requestId: "stale-commit" })).rejects.toMatchObject({ errorCode: "session_version_conflict" });
  });

  it("recovers a complete candidate left before latest.json publication", async () => {
    let fail = true;
    const { repo, view } = await repository({ beforePublish: async () => { if (fail) throw new Error("simulated interruption"); } });
    const input = {
      requestId: "interrupted",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: { requestId: "interrupted", knowledgeStates: [state(0)] },
    };
    await expect(repo.commit(input)).rejects.toThrow("simulated interruption");
    const before = await repo.getSnapshot({ sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 });
    expect(before.sessionVersion).toBe(1);
    fail = false;
    const recovered = await repo.recover({ requestId: "recover-1", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 });
    expect(recovered.recoveryAction).toBe("completed_candidate_commit");
    expect(recovered.sessionVersion).toBe(2);
  });

  it.each(semanticCorruptions)("isolates a JSON-valid candidate with corrupted %s", async (_label, corrupt) => {
    const { repo, root, view } = await repository({ beforePublish: async () => { throw new Error("simulated interruption"); } });
    const directory = resolve(root, "profile_families", "smoke-subject", "_user", "learning_sessions", view.sessionId);
    const item = { ...evidence(), sessionId: view.sessionId };
    const candidate = { ...diagnostic(1), sessionId: view.sessionId, states: [state(1)] };
    await expect(repo.commit({
      requestId: "semantic-candidate",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: {
        requestId: "semantic-candidate",
        evidenceCandidates: [item],
        knowledgeStates: [state(1)],
        diagnosticCandidate: candidate,
        nextStage: "path",
      },
    })).rejects.toThrow("simulated interruption");

    const transactionPath = resolve(directory, ".candidates", "semantic-candidate", "transaction.json");
    const prepared = JSON.parse(await readFile(transactionPath, "utf8")) as MutablePreparedTransaction;
    corrupt(prepared);
    await writeFile(transactionPath, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
    const markerBefore = await readFile(resolve(directory, "checkpoints", "latest.json"), "utf8");

    const recovered = await repo.recover({
      requestId: "recover-semantic",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
    });
    expect(recovered.recoveryAction).toBe("isolated_incomplete_candidate");
    expect(recovered.sessionVersion).toBe(1);
    expect(recovered.evidence).toEqual([]);
    expect(await readFile(resolve(directory, "checkpoints", "latest.json"), "utf8")).toBe(markerBefore);
    expect(await readdir(resolve(directory, "evidence"))).toEqual([]);
    expect(await readdir(resolve(directory, "quarantine"))).toHaveLength(1);
    expect(await existsForTest(resolve(directory, ".candidates", "semantic-candidate"))).toBe(false);
  });

  it("isolates malformed candidates and rebuilds derived state", async () => {
    const { repo, root, view } = await repository();
    const directory = resolve(root, "profile_families", "smoke-subject", "_user", "learning_sessions", view.sessionId);
    await mkdir(resolve(directory, ".candidates", "broken"), { recursive: true });
    await writeFile(resolve(directory, ".candidates", "broken", "transaction.json"), "not-json", "utf8");
    await writeFile(resolve(directory, "knowledge_state.json"), "[]\n", "utf8");
    const recovered = await repo.recover({ requestId: "recover-2", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 });
    expect(recovered.recoveryAction).toBe("isolated_incomplete_candidate");
    expect(await existsForTest(resolve(directory, "quarantine"))).toBe(true);
  });
});

async function existsForTest(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
