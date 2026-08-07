import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPathRuntimeMethods, type PathProfileResolver } from "../src/application/path-learning-facade.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { toPathSafeSnapshot } from "../src/repositories/internal-path-session-port.js";

const roots: string[] = [];
const profile: PathEngineProfile = {
  profileRevision: 2,
  goals: [{ goalId: "goal", title: "目标", targetKnowledgePointIds: ["kp"], requiredActivityIds: ["activity"] }],
  knowledgePoints: [{ id: "kp", title: "知识点", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["activity"], importance: 1 }],
  activities: [{ activityId: "activity", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", kind: "mcq", title: "活动", prompt: "题目" }],
};
const resolver: PathProfileResolver = { load: async () => structuredClone(profile) };

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup(requestId: string, beforePublish?: (sessionId: string, requestId: string) => Promise<void> | void) {
  const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-path-runtime-"));
  roots.push(root);
  const sessions = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-08-06T00:00:00.000Z"), beforePublish });
  const view = await sessions.create({ requestId, subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 10, profileRevision: 2, diagnosticRequired: false });
  return { sessions, view, root };
}

async function activePath(requestId: string, beforePublish?: (sessionId: string, requestId: string) => Promise<void> | void) {
  const prepared = await setup(requestId, beforePublish);
  const runtime = createPathRuntimeMethods({ sessions: prepared.sessions, profile: resolver, now: () => new Date("2026-08-06T00:00:00.000Z") });
  const candidate = await runtime.buildPath({ requestId: `${requestId}-build`, sessionId: prepared.view.sessionId, sessionVersion: 1, profileRevision: 2, goalId: "goal", mode: "recommended", availableMinutes: 10, evidenceVersion: 0, selectedKnowledgePointIds: [], lockedNodeIds: [] });
  if (candidate.status !== "candidate") throw new Error("expected candidate");
  await runtime.confirmPath({ requestId: `${requestId}-confirm`, sessionId: prepared.view.sessionId, sessionVersion: 2, profileRevision: 2, pathId: candidate.pathId!, pathVersion: candidate.pathVersion! });
  return { ...prepared, runtime, candidate };
}

describe("path runtime collaborator", () => {
  it("persists candidates through the repository so a fresh collaborator can confirm after restart", async () => {
    const { sessions, view } = await setup("create-one");
    const first = createPathRuntimeMethods({ sessions, profile: resolver, now: () => new Date("2026-08-06T00:00:00.000Z") });
    const candidate = await first.buildPath({ requestId: "build-one", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2, goalId: "goal", mode: "recommended", availableMinutes: 10, evidenceVersion: 0, selectedKnowledgePointIds: [], lockedNodeIds: [] });
    expect(candidate.status).toBe("candidate");
    if (candidate.status !== "candidate") return;
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(snapshot.path).toMatchObject({ status: "candidate", pathId: candidate.pathId, pathVersion: 1, goalId: "goal", mode: "recommended", nodes: [{ nodeId: "node-kp", knowledgePointId: "kp", activityIds: ["activity"], status: "available", estimatedMinutes: 5, reasonCodes: expect.any(Array) }] });
    expect(snapshot.path?.nodes[0]).not.toHaveProperty("difficulty");
    expect(snapshot.path?.nodes[0]).not.toHaveProperty("scaffold");
    expect(snapshot.path?.nodes[0]).not.toHaveProperty("positionLocked");
    expect(snapshot.path?.nodes[0]).not.toHaveProperty("required");
    const internal = await sessions.getInternalPathSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(internal?.nodes[0]).toMatchObject({ difficulty: "S-U", scaffold: "none", required: true, positionLocked: false });
    const restarted = createPathRuntimeMethods({ sessions, profile: resolver, now: () => new Date("2026-08-06T00:00:00.000Z") });
    const confirmed = await restarted.confirmPath({ requestId: "confirm-one", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2, pathId: candidate.pathId!, pathVersion: candidate.pathVersion! });
    expect(confirmed).toMatchObject({ status: "active", sessionVersion: 3 });
  });

  it("rejects cross-session and stale-version candidate confirmation", async () => {
    const first = await setup("create-first");
    const second = await setup("create-second");
    const runtime = createPathRuntimeMethods({ sessions: first.sessions, profile: resolver });
    const candidate = await runtime.buildPath({ requestId: "build-first", sessionId: first.view.sessionId, sessionVersion: 1, profileRevision: 2, goalId: "goal", mode: "recommended", availableMinutes: 10, evidenceVersion: 0, selectedKnowledgePointIds: [], lockedNodeIds: [] });
    if (candidate.status !== "candidate") throw new Error("expected candidate");
    const secondRuntime = createPathRuntimeMethods({ sessions: second.sessions, profile: resolver });
    await expect(secondRuntime.confirmPath({ requestId: "cross", sessionId: second.view.sessionId, sessionVersion: 1, profileRevision: 2, pathId: candidate.pathId!, pathVersion: candidate.pathVersion! }))
      .rejects.toMatchObject({ errorCode: "path_version_conflict" });
    await expect(runtime.confirmPath({ requestId: "stale", sessionId: first.view.sessionId, sessionVersion: 1, profileRevision: 2, pathId: candidate.pathId!, pathVersion: candidate.pathVersion! }))
      .rejects.toMatchObject({ errorCode: "session_version_conflict" });
  });

  it("archives the previous active path and atomically publishes the replan replacement", async () => {
    const { sessions, view, root, runtime } = await activePath("replan-success");
    const replanned = await runtime.replanPath({ requestId: "replan-success-replan", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, pathVersion: 1, evidenceVersion: 0, trigger: "user_constraint_changed", availableMinutes: 10, selectedKnowledgePointIds: ["kp"], lockedNodeIds: [] });
    expect(replanned).toMatchObject({ changed: true, fallbackToPrevious: false, pathVersion: 2, sessionVersion: 4 });
    const active = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2 });
    expect(active.path).toMatchObject({ status: "active", pathVersion: 2 });
    const archived = JSON.parse(await readFile(resolve(root, "profile_families", "subject", "_user", "learning_sessions", view.sessionId, "paths", "superseded", "1.json"), "utf8"));
    expect(archived).toMatchObject({ status: "superseded", pathVersion: 1 });
    await expect(runtime.getNextStep({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2, pathVersion: 2 })).resolves.toMatchObject({ completed: false, node: { knowledgePointId: "kp" } });
  });

  it("keeps old active on replan calculation failure, validation failure, and CAS conflict", async () => {
    const { sessions, view, runtime } = await activePath("replan-fallback");
    const infeasible = await runtime.replanPath({ requestId: "replan-fallback-infeasible", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, pathVersion: 1, evidenceVersion: 0, trigger: "knowledge_state_changed", availableMinutes: 1, selectedKnowledgePointIds: [], lockedNodeIds: [] });
    expect(infeasible).toMatchObject({ changed: false, fallbackToPrevious: true, pathVersion: 1, errorCode: "path_infeasible" });
    const invalidResolver: PathProfileResolver = { load: async () => ({ ...profile, knowledgePoints: [{ ...profile.knowledgePoints[0]!, activityIds: ["missing"] }] }) };
    const invalidRuntime = createPathRuntimeMethods({ sessions, profile: invalidResolver });
    await expect(invalidRuntime.replanPath({ requestId: "replan-fallback-invalid", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, pathVersion: 1, evidenceVersion: 0, trigger: "knowledge_state_changed", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: [] })).rejects.toMatchObject({ errorCode: "invalid_profile" });
    await expect(runtime.replanPath({ requestId: "replan-fallback-cas", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2, pathVersion: 1, evidenceVersion: 0, trigger: "knowledge_state_changed", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: [] })).rejects.toMatchObject({ errorCode: "session_version_conflict" });
    await expect(runtime.getNextStep({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, pathVersion: 1 })).resolves.toMatchObject({ completed: false, node: { knowledgePointId: "kp" } });
  });

  it("keeps old active through a write failure and publishes the validated replacement on recovery", async () => {
    let fail = false;
    const { sessions, view, runtime } = await activePath("replan-recovery", async () => { if (fail) throw new Error("simulated path write failure"); });
    fail = true;
    await expect(runtime.replanPath({ requestId: "replan-recovery-replan", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, pathVersion: 1, evidenceVersion: 0, trigger: "user_constraint_changed", availableMinutes: 10, selectedKnowledgePointIds: ["kp"], lockedNodeIds: [] })).rejects.toThrow("simulated path write failure");
    await expect(runtime.getNextStep({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, pathVersion: 1 })).resolves.toMatchObject({ completed: false, node: { knowledgePointId: "kp" } });
    fail = false;
    const recovered = await runtime.recoverSession({ requestId: "replan-recovery-recover", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2 });
    expect(recovered).toMatchObject({ recoveryAction: "completed_candidate_commit", view: { pathVersion: 2, sessionVersion: 4 } });
    const active = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2 });
    expect(active.path).toMatchObject({ status: "active", pathVersion: 2 });
  });

  it("falls back to the old active when fixed content makes the final replan over budget", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-path-runtime-fixed-budget-"));
    roots.push(root);
    const sessions = new FileLearningSessionRepository({ dataRoot: root, now: () => new Date("2026-08-06T00:00:00.000Z") });
    const fixedProfile: PathEngineProfile = {
      profileRevision: 2,
      goals: [{ goalId: "fixed-budget", title: "fixed", targetKnowledgePointIds: ["p"], requiredActivityIds: ["required-p"], finalActivityId: "required-p" }],
      knowledgePoints: [{ id: "p", title: "p", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["required-p", "optional-p"], importance: 1 }],
      activities: [
        { activityId: "required-p", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["fixed-budget"], estimatedMinutes: 10, difficulty: "S-U", allowedScaffolds: ["none"] },
        { activityId: "optional-p", primaryKnowledgePointId: "p", supportingKnowledgePointIds: [], goalIds: ["fixed-budget"], estimatedMinutes: 10, difficulty: "M-U", allowedScaffolds: ["none"] },
      ],
    };
    const view = await sessions.create({ requestId: "fixed-create", subjectId: "subject", mode: "recommended", goalId: "fixed-budget", availableMinutes: 20, profileRevision: 2, diagnosticRequired: false });
    const runtime = createPathRuntimeMethods({ sessions, profile: { load: async () => structuredClone(fixedProfile) }, now: () => new Date("2026-08-06T00:00:00.000Z") });
    const candidate = await runtime.buildPath({ requestId: "fixed-build", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 2, goalId: "fixed-budget", mode: "recommended", availableMinutes: 20, evidenceVersion: 0, selectedKnowledgePointIds: [], lockedNodeIds: [] });
    if (candidate.status !== "candidate") throw new Error("expected candidate");
    await runtime.confirmPath({ requestId: "fixed-confirm", sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2, pathId: candidate.pathId!, pathVersion: 1 });
    const active = await sessions.getInternalPathSnapshot({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2 });
    if (active === undefined) throw new Error("expected active path");
    active.nodes[0]!.status = "in_progress";
    await sessions.commitInternalPath({ requestId: "fixed-progress", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 2, candidate: { requestId: "fixed-progress", knowledgeStates: [], pathCandidate: toPathSafeSnapshot({ ...active, pathVersion: 2, status: "active" }) } }, { ...active, pathVersion: 2, status: "active" });
    const before = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2 });
    const replanned = await runtime.replanPath({ requestId: "fixed-replan", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2, pathVersion: 2, evidenceVersion: 0, trigger: "knowledge_state_changed", availableMinutes: 10, selectedKnowledgePointIds: [], lockedNodeIds: ["node-p"] });
    expect(replanned).toMatchObject({ changed: false, fallbackToPrevious: true, pathVersion: 2, sessionVersion: 4, errorCode: "path_infeasible" });
    const after = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2 });
    expect(after).toEqual(before);
    await expect(runtime.getNextStep({ sessionId: view.sessionId, sessionVersion: 4, profileRevision: 2, pathVersion: 2 })).resolves.toMatchObject({ completed: false, node: { status: "in_progress", knowledgePointId: "p" } });
    expect(await readdir(resolve(root, "profile_families", "subject", "_user", "learning_sessions", view.sessionId, "paths", "superseded"))).toEqual(["1.json"]);
  });
});
