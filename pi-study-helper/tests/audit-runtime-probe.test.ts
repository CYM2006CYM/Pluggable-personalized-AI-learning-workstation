import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileAppBootstrapFacade } from "../src/application/app-bootstrap-facade.js";
import { ComposedLearningRuntimeFacade } from "../src/application/composed-learning-runtime-facade.js";
import type { LearningRuntimeFacade } from "../src/contracts/index.js";
import { PathEngine, type PathEngineProfile } from "../src/domain/path-engine.js";
import type { LearningSessionRepository } from "../src/repositories/learning-session-repository.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

function method<T>(value: T) {
  return vi.fn(async () => value);
}

function inertFacade(): LearningRuntimeFacade {
  return new Proxy({}, { get: () => method({}) }) as unknown as LearningRuntimeFacade;
}

describe("W4-D1-A independent audit probes", () => {
  it("uses ReadRequestMeta.sessionVersion to reject a stale snapshot read", async () => {
    const dataRoot = await mkdtemp(resolve(tmpdir(), "w4-a-audit-read-version-"));
    const repository = new FileLearningSessionRepository({ dataRoot });
    const view = await repository.create({ requestId: "create", subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 10, profileRevision: 3, diagnosticRequired: true });
    await repository.commit({
      requestId: "advance", sessionId: view.sessionId, sessionVersion: 1, profileRevision: 3,
      candidate: { requestId: "advance", knowledgeStates: [], nextStage: "path" },
    });
    await expect(repository.getSnapshot({ sessionId: view.sessionId, sessionVersion: 1, profileRevision: 3 }))
      .rejects.toMatchObject({ errorCode: "session_version_conflict" });
  });

  it("retains the goal-required final practical for an all_in_order revision-3 core point", () => {
    const profile: PathEngineProfile = {
      profileRevision: 3,
      goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["kp"], requiredActivityIds: ["final-practical"], finalActivityId: "final-practical" }],
      knowledgePoints: [{
        id: "kp", title: "KP", chapterId: "chapter", sectionId: "section", prerequisiteIds: [],
        relatedKnowledgePointIds: [], sourceAnchorIds: ["source"], activityIds: ["quiz", "completion"],
        importance: 1, activityPolicy: "all_in_order", contentEstimatedMinutes: 2,
      }],
      activities: [
        { activityId: "quiz", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
        { activityId: "completion", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
        { activityId: "final-practical", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 10, difficulty: "M-A", allowedScaffolds: ["none"] },
      ],
    };
    const result = new PathEngine(profile).build({
      sessionId: "session", profileRevision: 3, evidenceVersion: 0, goalId: "goal", mode: "recommended",
      availableMinutes: 30, selectedKnowledgePointIds: [], lockedNodeIds: [], knowledgeStates: [],
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.path.nodes[0]?.activityIds).toEqual(["quiz", "completion", "final-practical"]);
  });

  it("projects Bootstrap path node status from authoritative activityProgress", async () => {
    const manifest = {
      subjectId: "subject", name: "Subject", schemaVersion: 2 as const,
      status: "active" as const, version: "3.0.0", revision: 3, revisionOf: 2,
      capabilities: { modalities: ["quiz" as const], runtimes: [], diagnostic: true },
      paths: { subject: "subject.json", chapters: "chapters.json", goals: "goals.json", knowledge: "knowledge.json", sources: "sources.json", quality: "quality", diagnostic: "diagnostic.json" },
    };
    const profiles: ConstructorParameters<typeof FileAppBootstrapFacade>[0]["profiles"] = {
      async listActiveProfileV2Manifests() { return [manifest]; },
      async readActiveProfileV2File(_subjectId, path) {
        if (path === "diagnostic.json") return JSON.stringify({
          blueprintId: "diagnostic", profileRevision: 3, goalIds: ["goal"], estimatedMinutes: 1,
          minimumCoverage: 1, scoringVersion: "scoring",
          questions: [{ questionId: "q", knowledgePointId: "kp", kind: "judgment", difficulty: "S-U", prompt: "Q", maxScore: 1, required: true, evaluatorRef: "private/answer-key.json#q", sourceAnchorIds: ["source"] }],
        });
        if (path === "goals.json") return JSON.stringify({ goals: [{ goalId: "goal", title: "Goal" }] });
        return JSON.stringify({ knowledgePoints: [{ chapterId: "chapter" }] });
      },
    };
    const view = { requestId: "start", sessionId: "session", sessionVersion: 5, profileRevision: 3, subjectId: "subject", mode: "recommended" as const, goalId: "goal", availableMinutes: 20, status: "active" as const, stage: "learning" as const, diagnosticRequired: true, pathVersion: 1 };
    const stalePath = { pathId: "path", pathVersion: 1, status: "active" as const, nodes: [{ nodeId: "node", knowledgePointId: "kp", activityIds: ["quiz"], status: "available" as const, estimatedMinutes: 5, reasonCodes: [], difficulty: "S-U" as const, scaffold: "none" as const, required: true, positionLocked: false }] };
    const recovered = {
      ...view, view, evidence: [], knowledgeStates: [], diagnosticDraftVersion: 0,
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "completed" as const, attemptIds: ["attempt"], result: "pass" as const, quizRetryCount: 0 as const, updatedAt: "2026-08-13T00:00:00.000Z" }] }],
      path: stalePath, latestCommit: { evidenceVersion: 1, sessionVersion: 5 },
    };
    const sessions = {
      async listBoundSnapshots() { return [recovered]; },
      async getBoundSnapshot() { return recovered; },
      async getInternalPathSnapshot() { return stalePath; },
    } as unknown as LearningSessionRepository;

    const output = await new FileAppBootstrapFacade({ profiles, sessions: sessions as never }).getBootstrap({ recoverSessionId: "session" });
    expect(output.session?.activityProgress[0]?.activities[0]?.status).toBe("completed");
    expect(output.session?.path?.nodes[0]?.status).toBe("completed");
  });

  it("does not enqueue the same node-completed event twice on idempotent submit replay", async () => {
    const enqueue = vi.fn(async () => ({ taskStatus: "not_updated" as const }));
    const snapshot = {
      latestCommit: { evidenceVersion: 1 }, evidence: [{ evidenceId: "e1", knowledgePointId: "kp" }],
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "completed" }] }],
      path: { nodes: [{ nodeId: "node", knowledgePointId: "kp" }] },
    };
    const sessions = { getSnapshot: method(snapshot) } as unknown as LearningSessionRepository;
    const inert = inertFacade();
    const submitted = { kind: "quiz" as const, requestId: "submit", sessionId: "session", sessionVersion: 3, profileRevision: 3, attemptId: "attempt", committed: true, evidenceId: "e1", evidenceVersion: 1, result: { kind: "quiz" as const, verdict: "pass" as const, correctCount: 4, totalCount: 4, requiredCorrectCount: 3, retryAllowed: false, safeFeedback: "passed" } };
    const submitActivityWithContext = vi.fn()
      .mockResolvedValueOnce({ output: submitted, replayed: false, snapshot })
      .mockResolvedValueOnce({ output: submitted, replayed: true, snapshot });
    const quiz = { ...inert, submitActivity: method(submitted), submitActivityWithContext };
    const facade = new ComposedLearningRuntimeFacade({ session: inert, diagnostic: inert, path: inert, codeActivity: inert, quizActivity: quiz, sessions, profile: { load: async () => ({ profileRevision: 3, goals: [], knowledgePoints: [], activities: [] }) }, capabilityTasks: { enqueue }, resolveActivityKind: async () => "quiz" });
    const input = { kind: "quiz" as const, requestId: "submit", sessionId: "session", sessionVersion: 2, profileRevision: 3, activityId: "quiz", activityVersion: 1, attemptId: "attempt", answers: [] };

    await facade.submitActivity(input);
    await facade.submitActivity(input);
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
  });

  it("binds node-completed work to the committed submission version", async () => {
    const enqueue = vi.fn(async () => ({ taskStatus: "not_updated" as const }));
    const laterSnapshot = {
      latestCommit: { evidenceVersion: 9 }, evidence: [{ evidenceId: "later", knowledgePointId: "kp" }],
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "completed" }] }],
      path: { nodes: [{ nodeId: "node", knowledgePointId: "kp" }] },
    };
    const sessions = { getSnapshot: method(laterSnapshot) } as unknown as LearningSessionRepository;
    const inert = inertFacade();
    const submitted = { kind: "quiz" as const, requestId: "submit", sessionId: "session", sessionVersion: 3, profileRevision: 3, attemptId: "attempt", committed: true, evidenceId: "e1", evidenceVersion: 1, result: { kind: "quiz" as const, verdict: "pass" as const, correctCount: 4, totalCount: 4, requiredCorrectCount: 3, retryAllowed: false, safeFeedback: "passed" } };
    const committedSnapshot = {
      latestCommit: { evidenceVersion: 1 }, evidence: [{ evidenceId: "e1", knowledgePointId: "kp" }],
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "completed" }] }],
      path: { nodes: [{ nodeId: "node", knowledgePointId: "kp" }] },
    };
    const quiz = { ...inert, submitActivity: method(submitted), submitActivityWithContext: method({ output: submitted, replayed: false, snapshot: committedSnapshot }) };
    const facade = new ComposedLearningRuntimeFacade({ session: inert, diagnostic: inert, path: inert, codeActivity: inert, quizActivity: quiz, sessions, profile: { load: async () => ({ profileRevision: 3, goals: [], knowledgePoints: [], activities: [] }) }, capabilityTasks: { enqueue }, resolveActivityKind: async () => "quiz" });

    await facade.submitActivity({ kind: "quiz", requestId: "submit", sessionId: "session", sessionVersion: 2, profileRevision: 3, activityId: "quiz", activityVersion: 1, attemptId: "attempt", answers: [] });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ evidenceVersion: 1, evidenceIds: ["e1"] }));
  });
});
