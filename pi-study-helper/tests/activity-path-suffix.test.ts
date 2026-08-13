import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivityPathSuffixReplanner } from "../src/application/activity-path-suffix.js";
import type { KnowledgeState } from "../src/domain/v2-types.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { toPathSafeSnapshot, type InternalPersistedPathSnapshot } from "../src/repositories/internal-path-session-port.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const profile: PathEngineProfile = {
  profileRevision: 3,
  goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["target"], requiredActivityIds: ["act-target"] }],
  knowledgePoints: [
    { id: "prerequisite", title: "Prerequisite", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["act-prerequisite"], importance: 1 },
    { id: "target", title: "Target", chapterId: "chapter", sectionId: "section", prerequisiteIds: ["prerequisite"], relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["act-target"], importance: 1 },
  ],
  activities: [
    { activityId: "act-prerequisite", primaryKnowledgePointId: "prerequisite", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 1, difficulty: "S-U", allowedScaffolds: ["none"] },
    { activityId: "act-target", primaryKnowledgePointId: "target", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 1, difficulty: "S-U", allowedScaffolds: ["none"] },
  ],
};

function state(knowledgePointId: string, overrides: Partial<KnowledgeState>): KnowledgeState {
  return {
    knowledgePointId, profileRevision: 3, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: null, confidence: 0,
    status: "unverified", validEvidenceCount: 0, evidenceFormCount: 0, evidenceIds: [], consideredEvidenceIds: [],
    asOf: "2026-08-12T00:00:00.000Z", skipEligible: false, lastUpdatedAt: "2026-08-12T00:00:00.000Z", ...overrides,
  };
}

function activePath(sessionId: string): InternalPersistedPathSnapshot {
  return {
    pathId: "path", sessionId, profileRevision: 3, evidenceVersion: 0, pathVersion: 1, engineVersion: "path-engine-v1", status: "active", mode: "recommended", goalId: "goal", availableMinutes: 10, estimatedMinutes: 2,
    nodes: [
      { nodeId: "node-prerequisite", knowledgePointId: "prerequisite", activityIds: ["act-prerequisite"], status: "completed", positionLocked: true, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 1, reasonCodes: ["goal_required"] },
      { nodeId: "node-target", knowledgePointId: "target", activityIds: ["act-target"], status: "available", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 1, reasonCodes: ["goal_required"] },
    ],
    positionLockedNodeIds: ["node-prerequisite"], changeReasons: [], createdAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("activity path suffix replanner", () => {
  it("reuses PathEngine, locks the completed prefix, and emits one new path version", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "activity-path-suffix-")); roots.push(root);
    const sessions = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-08-12T00:00:00.000Z") });
    const view = await sessions.create({ requestId: "create", subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 10, profileRevision: 3, diagnosticRequired: false });
    const path = activePath(view.sessionId);
    await sessions.commitInternalPath({ requestId: "path", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 3, candidate: { requestId: "path", knowledgeStates: [], pathCandidate: toPathSafeSnapshot({ ...path, status: "candidate" }) } }, { ...path, status: "candidate" });
    await sessions.commitInternalPath({ requestId: "confirm", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 3, candidate: { requestId: "confirm", knowledgeStates: [], pathCandidate: toPathSafeSnapshot(path) } }, path);
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3 });
    const progress = [
      { nodeId: "node-prerequisite", activities: [{ activityId: "act-prerequisite", status: "completed" as const, attemptIds: ["attempt"], result: "pass" as const, quizRetryCount: 0 as const, updatedAt: "2026-08-12T00:00:00.000Z" }] },
      { nodeId: "node-target", activities: [{ activityId: "act-target", status: "pending" as const, attemptIds: [], quizRetryCount: 0 as const, updatedAt: "2026-08-12T00:00:00.000Z" }] },
    ];
    const replanner = createActivityPathSuffixReplanner({ sessions, profile: { load: async () => structuredClone(profile) }, now: () => new Date("2026-08-12T00:00:00.000Z") });
    const result = await replanner.replan({ snapshot: { ...snapshot, activityProgress: progress }, knowledgeStates: [state("prerequisite", { status: "mastered", mastery: 1, confidence: 1, skipEligible: true }), state("target", { status: "support_needed", mastery: 0.2, confidence: 0.4 })], evidenceVersion: 1, trigger: "knowledge_state_changed" });
    expect(result.path).toMatchObject({ pathVersion: 2, status: "active", evidenceVersion: 1 });
    expect(result.changeReasons).toContain("low_mastery");
    expect(result.path?.nodes[0]).toMatchObject({ nodeId: "node-prerequisite", status: "completed", positionLocked: true });
  });
});
