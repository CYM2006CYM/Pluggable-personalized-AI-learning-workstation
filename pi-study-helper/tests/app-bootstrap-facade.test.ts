import { describe, expect, it } from "vitest";
import { FileAppBootstrapFacade } from "../src/application/app-bootstrap-facade.js";
import type { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";
import type { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

describe("FileAppBootstrapFacade", () => {
  it("returns deterministic safe profile/session recovery projections and removes private diagnostic fields", async () => {
    const manifest = { subjectId: "subject", name: "Subject", revision: 3, capabilities: { modalities: ["reading", "quiz"], diagnostic: true }, paths: { goals: "goals.json", knowledge: "knowledge.json", diagnostic: "diagnostic.json" } };
    const files: Record<string, string> = {
      "goals.json": JSON.stringify({ goals: [{ goalId: "goal", title: "Goal" }] }),
      "knowledge.json": JSON.stringify({ knowledgePoints: [{ chapterId: "chapter-b" }, { chapterId: "chapter-a" }] }),
      "diagnostic.json": JSON.stringify({
        blueprintId: "diagnostic-safe-v1", profileRevision: 3, goalIds: ["goal"], estimatedMinutes: 1, minimumCoverage: 1,
        questions: [{ questionId: "q-safe", knowledgePointId: "kp-safe", kind: "single_choice", difficulty: "S-U", prompt: "safe", options: ["A", "B", "C"], maxScore: 1, required: true, evaluatorRef: "private/answer-key.json#q-safe", sourceAnchorIds: ["source-safe"] }],
        scoringVersion: "diagnostic-safe-v1",
      }),
    };
    const profiles = {
      async listActiveProfileV2Manifests() { return [manifest]; },
      async readActiveProfileV2File(_subjectId: string, path: string) { return files[path]!; },
    } as unknown as ProfileFamilyRepository;
    const view = { sessionId: "session", sessionVersion: 4, profileRevision: 3, subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 20, status: "active", stage: "activity", diagnosticRequired: true, pathVersion: 1 };
    const recovered = {
      sessionId: "session", sessionVersion: 4, profileRevision: 3, view,
      latestCommit: { sessionVersion: 4, evidenceVersion: 0 }, evidence: [], knowledgeStates: [],
      diagnosticDraftVersion: 2, diagnosticDraft: { diagnosticDraftVersion: 2, currentQuestionId: "q-safe", processedQuestionIds: [] },
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "in_progress", attemptIds: ["attempt"], quizRetryCount: 0, updatedAt: "2026-08-12T00:00:00.000Z" }] }],
      currentAttempt: { kind: "quiz", activityId: "quiz", attemptId: "attempt", status: "draft", retryNumber: 0 },
      path: { pathId: "path", pathVersion: 1, status: "active", nodes: [{ nodeId: "node", knowledgePointId: "kp", activityIds: ["quiz"], status: "available", estimatedMinutes: 10, reasonCodes: [], difficulty: "M-U", scaffold: "hint", required: true, positionLocked: true }] },
    };
    const sessions = {
      async listBoundSnapshots() { return [recovered]; },
      async getBoundSnapshot() { return recovered; },
      async getInternalPathSnapshot() { return { ...recovered.path, nodes: [{ ...recovered.path.nodes[0], difficulty: "M-U", scaffold: "hint", required: true, positionLocked: true }] }; },
      async getBoundLearningCards() { return []; },
    } as unknown as FileLearningSessionRepository;
    const historicalProfile = {
      sessionId: "session", profileRevision: 3, evidenceVersion: 0, agentStatus: "agent_complete" as const,
      initialKnowledgeStates: [], currentKnowledgeStates: [], progress: [], strengths: [], supportNeeded: [], skippedActivityIds: [], activities: [], evidenceIds: [],
      deterministicSummary: "确定性画像已恢复。", agentExplanation: "画像Agent解释已按版本恢复。", agentEvidenceRefs: [], agentRunId: "profile-run",
    };
    const profileHistory = { async getLatest() { return {
      historyId: "profile-history", sessionId: "session", sessionVersion: 4, profileRevision: 3, evidenceVersion: 0,
      trigger: "quiz_submitted" as const, capturedAt: "2026-08-12T00:00:00.000Z", profile: historicalProfile, profileSha256: "a".repeat(64),
    }; } };
    const bootstrap = await new FileAppBootstrapFacade({ profiles, sessions, profileHistory }).getBootstrap({ recoverSessionId: "session" });
    expect(bootstrap).toMatchObject({
      profiles: [{ subjectId: "subject", revision: 3, modalities: ["reading", "quiz"] }],
      goals: [{ goalId: "goal", title: "Goal" }],
      chapters: [{ chapterId: "chapter-a" }, { chapterId: "chapter-b" }],
      recoverableSessions: [view],
      session: { diagnosticDraftVersion: 2, currentAttempt: { attemptId: "attempt" }, path: { nodes: [{ difficulty: "M-U", scaffold: "hint", required: true, positionLocked: true }] } },
    });
    expect(bootstrap.diagnostic).toEqual({ diagnosticId: "diagnostic-safe-v1", diagnosticVersion: 1, estimatedMinutes: 1, questions: [{ questionId: "q-safe", knowledgePointId: "kp-safe", kind: "single_choice", difficulty: "S-U", prompt: "safe", options: ["A", "B", "C"], required: true }] });
    expect(bootstrap.session?.learningProfile).toEqual(historicalProfile);
  });

  it("projects every nested recovery object through one allowlist", async () => {
    const manifest = { subjectId: "subject", name: "Subject", schemaVersion: 2 as const, status: "active" as const, version: "3.0.0", revision: 3, revisionOf: 2, capabilities: { modalities: ["quiz" as const], runtimes: [], diagnostic: true }, paths: { subject: "subject.json", chapters: "chapters.json", goals: "goals.json", knowledge: "knowledge.json", sources: "sources.json", quality: "quality", diagnostic: "diagnostic.json" } };
    const diagnostic = {
      blueprintId: "diagnostic-safe-v1", profileRevision: 3, goalIds: ["goal"], estimatedMinutes: 1, minimumCoverage: 1,
      questions: [{ questionId: "q-safe", knowledgePointId: "kp-safe", kind: "judgment", difficulty: "S-U", prompt: "safe", maxScore: 1, required: true, evaluatorRef: "private/answer-key.json#q-safe", sourceAnchorIds: ["source-safe"] }],
      scoringVersion: "diagnostic-safe-v1",
      "x-internal": { correctAnswer: true, hostPath: "C:\\private\\answers.json", transactionCandidate: "secret" },
    };
    const profiles: ConstructorParameters<typeof FileAppBootstrapFacade>[0]["profiles"] = {
      async listActiveProfileV2Manifests() { return [manifest]; },
      async readActiveProfileV2File(_subjectId, path) {
        if (path === "diagnostic.json") return JSON.stringify(diagnostic);
        if (path === "goals.json") return JSON.stringify({ goals: [{ goalId: "goal", title: "Goal" }] });
        return JSON.stringify({ knowledgePoints: [{ chapterId: "chapter" }] });
      },
    };
    const view = { requestId: "start", sessionId: "session", sessionVersion: 2, profileRevision: 3, subjectId: "subject", mode: "recommended" as const, goalId: "goal", availableMinutes: 20, status: "active" as const, stage: "activity" as const, diagnosticRequired: true, pathVersion: 1 };
    const recovered = {
      sessionId: "session", sessionVersion: 2, profileRevision: 3, view: { ...view, hostPath: "C:\\private\\session.json" },
      diagnosticDraftVersion: 1,
      diagnosticDraft: { diagnosticDraftVersion: 1, processedQuestionIds: ["q-safe"], answerKey: true },
      activityProgress: [{ nodeId: "node", transactionCandidate: "secret", activities: [{ activityId: "quiz", status: "in_progress" as const, attemptIds: ["attempt"], quizRetryCount: 0 as const, updatedAt: "2026-08-12T00:00:00.000Z", correctAnswer: true }] }],
      currentAttempt: { kind: "quiz" as const, activityId: "quiz", attemptId: "attempt", status: "draft" as const, retryNumber: 0 as const, result: { correctAnswer: true } },
      path: { pathId: "path", pathVersion: 1, status: "active" as const, nodes: [{ nodeId: "node", knowledgePointId: "kp", activityIds: ["quiz"], status: "available" as const, estimatedMinutes: 5, reasonCodes: [], difficulty: "S-U" as const, scaffold: "none" as const, required: true, positionLocked: false, hiddenTests: ["secret"] }] },
      evidence: [], knowledgeStates: [], latestCommit: { evidenceVersion: 0, sessionVersion: 2 },
    };
    const sessions = {
      async listBoundSnapshots() { return [recovered]; },
      async getBoundSnapshot() { return recovered; },
      async getInternalPathSnapshot() { return recovered.path; },
      async getBoundLearningCards() { return []; },
    } as unknown as FileLearningSessionRepository;
    const output = await new FileAppBootstrapFacade({ profiles, sessions }).getBootstrap({ recoverSessionId: "session" });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toMatch(/correctAnswer|answerKey|hiddenTests|transactionCandidate|C:\\\\private/u);
    expect(Object.keys(output.session!.currentAttempt!).sort()).toEqual(["activityId", "attemptId", "kind", "retryNumber", "status"]);
    expect(Object.keys(output.session!.path!.nodes[0]!).sort()).toEqual(["activityIds", "difficulty", "estimatedMinutes", "knowledgePointId", "nodeId", "positionLocked", "reasonCodes", "required", "scaffold", "status"]);
  });

  it("rejects a diagnostic question containing nested private or internal fields", async () => {
    const manifest = { subjectId: "subject", name: "Subject", schemaVersion: 2 as const, status: "active" as const, version: "3.0.0", revision: 3, revisionOf: 2, capabilities: { modalities: ["quiz" as const], runtimes: [], diagnostic: true }, paths: { subject: "subject.json", chapters: "chapters.json", goals: "goals.json", knowledge: "knowledge.json", sources: "sources.json", quality: "quality", diagnostic: "diagnostic.json" } };
    const profiles: ConstructorParameters<typeof FileAppBootstrapFacade>[0]["profiles"] = {
      async listActiveProfileV2Manifests() { return [manifest]; },
      async readActiveProfileV2File(_subjectId, path) {
        if (path !== "diagnostic.json") return path === "goals.json" ? JSON.stringify({ goals: [] }) : JSON.stringify({ knowledgePoints: [] });
        return JSON.stringify({
          blueprintId: "diagnostic", profileRevision: 3, goalIds: ["goal"], estimatedMinutes: 1, minimumCoverage: 1, scoringVersion: "scoring",
          questions: [{ questionId: "q", knowledgePointId: "kp", kind: "judgment", difficulty: "S-U", prompt: "Q", maxScore: 1, required: true, evaluatorRef: "private/answer-key.json#q", sourceAnchorIds: ["source"], correctAnswer: true, internalPath: "C:\\private\\answer.json" }],
        });
      },
    };
    const sessions = { async listBoundSnapshots() { return []; } } as unknown as FileLearningSessionRepository;
    await expect(new FileAppBootstrapFacade({ profiles, sessions }).getBootstrap({})).rejects.toMatchObject({ errorCode: "invalid_profile" });
  });
});
