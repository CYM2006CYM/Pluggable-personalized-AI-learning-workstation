import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPathRuntimeMethods } from "../src/application/path-learning-facade.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import {
  toPathSafeSnapshot,
  type InternalPathSessionPort,
  type InternalPersistedPathSnapshot,
} from "../src/repositories/internal-path-session-port.js";
import type { LearningSessionRepository } from "../src/repositories/learning-session-repository.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(requestId: string) {
  const root = await mkdtemp(resolve(tmpdir(), "w3-r6-owner-audit-"));
  roots.push(root);
  const repository = new FileLearningSessionRepository({
    dataRoot: root,
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });
  const view = await repository.create({
    requestId,
    subjectId: "subject",
    mode: "recommended",
    goalId: "goal",
    availableMinutes: 10,
    profileRevision: 2,
    diagnosticRequired: false,
  });
  return { repository, view };
}

function internalPath(sessionId: string): InternalPersistedPathSnapshot {
  return {
    pathId: "path-1",
    sessionId,
    profileRevision: 2,
    evidenceVersion: 0,
    pathVersion: 1,
    engineVersion: "path-engine-v1",
    status: "candidate",
    mode: "recommended",
    goalId: "goal",
    availableMinutes: 10,
    estimatedMinutes: 5,
    nodes: [{
      nodeId: "node-kp",
      knowledgePointId: "kp",
      activityIds: ["activity"],
      status: "available",
      positionLocked: false,
      required: true,
      difficulty: "S-U",
      scaffold: "none",
      estimatedMinutes: 5,
      reasonCodes: ["goal_required"],
    }],
    positionLockedNodeIds: [],
    changeReasons: ["goal_required"],
    createdAt: "2026-08-07T00:00:00.000Z",
  };
}

const profile: PathEngineProfile = {
  profileRevision: 2,
  goals: [{ goalId: "goal", title: "goal", targetKnowledgePointIds: ["kp"], requiredActivityIds: ["activity"] }],
  knowledgePoints: [{ id: "kp", title: "kp", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["activity"], importance: 1 }],
  activities: [{ activityId: "activity", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U" }],
};

describe("path session boundary and transaction closure", () => {
  it("does not manufacture a full internal path from public-only safe fields", async () => {
    const { repository, view } = await setup("public-create");
    const path = internalPath(view.sessionId);
    await repository.commit({
      requestId: "public-path",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: { requestId: "public-path", knowledgeStates: [], pathCandidate: toPathSafeSnapshot(path) },
    });

    const internal = await repository.getInternalPathSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(internal).toBeUndefined();
  });

  it("rejects a stale internal snapshot read instead of returning a newer path", async () => {
    const { repository, view } = await setup("stale-create");
    const path = internalPath(view.sessionId);
    await repository.commitInternalPath({
      requestId: "stale-path",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: { requestId: "stale-path", knowledgeStates: [], pathCandidate: toPathSafeSnapshot(path) },
    }, path);

    await expect(repository.getInternalPathSnapshot({ sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2 }))
      .rejects.toMatchObject({ errorCode: "session_version_conflict" });
  });

  it("treats different internal path content under one requestId as an idempotency conflict", async () => {
    const { repository, view } = await setup("idempotency-create");
    const first = internalPath(view.sessionId);
    const input = {
      requestId: "same-path-request",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      candidate: { requestId: "same-path-request", knowledgeStates: [], pathCandidate: toPathSafeSnapshot(first) },
    };
    await repository.commitInternalPath(input, first);
    const different = {
      ...structuredClone(first),
      createdAt: "2026-08-07T01:00:00.000Z",
      nodes: [{ ...structuredClone(first.nodes[0]!), difficulty: "M-A" as const }],
    };

    await expect(repository.commitInternalPath(input, different))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
  });

  it("returns the snapshot committed by buildPath even when another commit follows immediately", async () => {
    const { repository, view } = await setup("race-create");
    let injectConcurrentCommit = true;
    const sessions = {
      create: (input) => repository.create(input),
      getSnapshot: (input) => repository.getSnapshot(input),
      commit: (input) => repository.commit(input),
      recover: (input) => repository.recover(input),
      getInternalPathSnapshot: (input) => repository.getInternalPathSnapshot(input),
      commitInternalPath: async (input, path) => {
        const result = await repository.commitInternalPath(input, path);
        if (!injectConcurrentCommit) return result;
        injectConcurrentCommit = false;
        const committed = await repository.getSnapshot({
          sessionId: input.sessionId,
          sessionVersion: input.sessionVersion + 1,
          profileRevision: input.profileRevision,
        });
        await repository.commit({
          requestId: "immediate-follow-up",
          sessionId: input.sessionId,
          sessionVersion: committed.sessionVersion,
          profileRevision: input.profileRevision,
          candidate: { requestId: "immediate-follow-up", knowledgeStates: committed.knowledgeStates },
        });
        return result;
      },
    } satisfies LearningSessionRepository & InternalPathSessionPort;
    const runtime = createPathRuntimeMethods({
      sessions,
      profile: { load: async () => structuredClone(profile) },
      now: () => new Date("2026-08-07T00:00:00.000Z"),
    });

    await expect(runtime.buildPath({
      requestId: "race-build",
      sessionId: view.sessionId,
      sessionVersion: 1,
      profileRevision: 2,
      goalId: "goal",
      mode: "recommended",
      availableMinutes: 10,
      evidenceVersion: 0,
      selectedKnowledgePointIds: [],
      lockedNodeIds: [],
    })).resolves.toMatchObject({ status: "candidate", sessionVersion: 2 });
  });
});
