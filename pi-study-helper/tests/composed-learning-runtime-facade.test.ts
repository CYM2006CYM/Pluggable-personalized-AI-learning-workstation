import { describe, expect, it, vi } from "vitest";
import { ComposedLearningRuntimeFacade } from "../src/application/composed-learning-runtime-facade.js";
import type { LearningRuntimeFacade } from "../src/contracts/index.js";
import type { LearningSessionRepository } from "../src/repositories/learning-session-repository.js";

function method<T>(value: T) {
  return vi.fn(async () => value);
}

const profile = { load: async () => ({ profileRevision: 3, goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["kp"], requiredActivityIds: ["final"], finalActivityId: "final" }], knowledgePoints: [], activities: [] }) };

describe("ComposedLearningRuntimeFacade", () => {
  it("exposes and dispatches the complete public method surface", async () => {
    const session = { startSession: method({ operation: "start" }) };
    const diagnostic = { saveDiagnosticDraft: method({ operation: "draft" }), submitDiagnosticAnswer: method({ operation: "answer" }), completeDiagnostic: method({ operation: "diagnostic", sessionId: "s", sessionVersion: 2, profileRevision: 3, evidenceVersion: 0, knowledgeStates: [], insufficientKnowledgePointIds: [] }) };
    const path = { recoverSession: method({ operation: "recover-session" }), buildPath: method({ operation: "build" }), confirmPath: method({ operation: "confirm" }), getNextStep: method({ operation: "next" }), replanPath: method({ operation: "replan" }) };
    const codeActivity = { openActivity: method({ operation: "open-code" }), saveActivityDraft: method({ operation: "save-code" }), prepareActivityRun: method({ operation: "prepare-code" }), submitActivity: method({ operation: "submit-code", committed: false }), getActivityAttempt: method({ operation: "attempt-code" }), recoverActivity: method({ operation: "recover-code" }) };
    const quizActivity = { openActivity: method({ operation: "open-quiz" }), submitActivity: method({ operation: "submit-quiz", committed: false }), getActivityAttempt: method({ operation: "attempt-quiz" }) };
    const sessions = { getSnapshot: method({}) } as unknown as LearningSessionRepository;
    const facade = new ComposedLearningRuntimeFacade({
      session: session as unknown as Pick<LearningRuntimeFacade, "startSession">,
      diagnostic: diagnostic as unknown as Pick<LearningRuntimeFacade, "saveDiagnosticDraft" | "submitDiagnosticAnswer" | "completeDiagnostic">,
      path: path as unknown as Pick<LearningRuntimeFacade, "recoverSession" | "buildPath" | "confirmPath" | "getNextStep" | "replanPath">,
      codeActivity: codeActivity as unknown as Pick<LearningRuntimeFacade, "openActivity" | "saveActivityDraft" | "prepareActivityRun" | "submitActivity" | "getActivityAttempt" | "recoverActivity">,
      quizActivity: quizActivity as unknown as Pick<LearningRuntimeFacade, "openActivity" | "submitActivity" | "getActivityAttempt">,
      sessions,
      profile,
      resolveActivityKind: async ({ activityId }) => activityId === "quiz" ? "quiz" : "code",
    });

    await expect(facade.startSession({} as never)).resolves.toEqual({ operation: "start" });
    await expect(facade.recoverSession({} as never)).resolves.toEqual({ operation: "recover-session" });
    await expect(facade.saveDiagnosticDraft({} as never)).resolves.toEqual({ operation: "draft" });
    await expect(facade.submitDiagnosticAnswer({} as never)).resolves.toEqual({ operation: "answer" });
    await expect(facade.completeDiagnostic({} as never)).resolves.toMatchObject({ operation: "diagnostic" });
    await expect(facade.buildPath({} as never)).resolves.toEqual({ operation: "build" });
    await expect(facade.confirmPath({} as never)).resolves.toEqual({ operation: "confirm" });
    await expect(facade.getNextStep({} as never)).resolves.toEqual({ operation: "next" });
    await expect(facade.replanPath({} as never)).resolves.toEqual({ operation: "replan" });
    await expect(facade.openActivity({ activityId: "code" } as never)).resolves.toEqual({ operation: "open-code" });
    await expect(facade.openActivity({ activityId: "quiz" } as never)).resolves.toEqual({ operation: "open-quiz" });
    await expect(facade.saveActivityDraft({} as never)).resolves.toEqual({ operation: "save-code" });
    await expect(facade.prepareActivityRun({} as never)).resolves.toEqual({ operation: "prepare-code" });
    await expect(facade.submitActivity({ kind: "code" } as never)).resolves.toMatchObject({ operation: "submit-code" });
    await expect(facade.submitActivity({ kind: "quiz" } as never)).resolves.toMatchObject({ operation: "submit-quiz" });
    await expect(facade.getActivityAttempt({ activityId: "code" } as never)).resolves.toEqual({ operation: "attempt-code" });
    await expect(facade.getActivityAttempt({ activityId: "quiz" } as never)).resolves.toEqual({ operation: "attempt-quiz" });
    await expect(facade.recoverActivity({} as never)).resolves.toEqual({ operation: "recover-code" });
  });

  it("completes after a formal practical fail, summarizes issues, and returns a fixed safe context fallback", async () => {
    const snapshot = {
      sessionId: "session", sessionVersion: 4, profileRevision: 3,
      view: { subjectId: "pandas", goalId: "goal" },
      evidence: [{ evidenceId: "e-practical", requestId: "submit", sessionId: "session", knowledgePointId: "kp", profileRevision: 3, kind: "coding_practical", source: "practical_rubric", form: "practical_rubric", impact: "mastery", outcome: "incorrect", score: 0, independence: "independent", activityId: "final", attemptId: "attempt", createdAt: "2026-08-12T00:00:00.000Z" }],
      knowledgeStates: [{ knowledgePointId: "kp", profileRevision: 3, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: 0, confidence: 1, status: "support_needed", validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: ["e-practical"], consideredEvidenceIds: ["e-practical"], asOf: "2026-08-12T00:00:00.000Z", skipEligible: false, lastUpdatedAt: "2026-08-12T00:00:00.000Z" }],
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "final", status: "completed", attemptIds: ["attempt"], result: "fail", quizRetryCount: 0, updatedAt: "2026-08-12T00:00:00.000Z" }] }],
      path: { pathId: "path", pathVersion: 1, status: "active", goalId: "goal", mode: "recommended", nodes: [{ nodeId: "node", knowledgePointId: "kp", activityIds: ["final"], status: "available", estimatedMinutes: 10, reasonCodes: [] }] },
    };
    const sessions = {
      getSnapshot: method(snapshot),
      commit: method({ ...snapshot, sessionVersion: 5, committed: true }),
    } as unknown as LearningSessionRepository;
    const inert = new Proxy({}, { get: () => method({}) }) as unknown as LearningRuntimeFacade;
    const facade = new ComposedLearningRuntimeFacade({
      session: inert, diagnostic: inert, path: inert, codeActivity: inert, quizActivity: inert,
      sessions, profile, resolveActivityKind: async () => "code", now: () => new Date("2026-08-12T01:00:00.000Z"),
    });
    const completed = await facade.completeSession({ requestId: "complete", sessionId: "session", sessionVersion: 4, profileRevision: 3 });
    expect(completed).toMatchObject({ sessionVersion: 5, completedAt: "2026-08-12T01:00:00.000Z", nextRecommendation: expect.any(String) });
    expect(completed.summary).toContain("final:fail");
    expect(completed.summary).toContain("kp:support_needed");
    const answer = await facade.askContextQuestion({ requestId: "ask", sessionId: "session", sessionVersion: 4, profileRevision: 3, pathVersion: 1, nodeId: "node", question: "help" });
    expect(answer.sourceAnchorIds).toEqual([]);
    expect(answer.answer).not.toMatch(/[A-Za-z]:\\|\/assessments\/private|reference-solutions/u);
  });

  it("queues capability work only after committed diagnostic and terminal node results", async () => {
    const enqueue = vi.fn(async () => ({ taskStatus: "not_updated" as const }));
    const snapshot = { latestCommit: { evidenceVersion: 1 }, evidence: [{ evidenceId: "e1", knowledgePointId: "kp" }], activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "completed" }] }], path: { nodes: [{ nodeId: "node", knowledgePointId: "kp" }] } };
    const sessions = { getSnapshot: method(snapshot) } as unknown as LearningSessionRepository;
    const inert = new Proxy({}, { get: () => method({}) }) as unknown as LearningRuntimeFacade;
    const diagnosticOutput: Awaited<ReturnType<LearningRuntimeFacade["completeDiagnostic"]>> = {
      requestId: "diagnostic", sessionId: "session", sessionVersion: 2, profileRevision: 3, evidenceVersion: 1,
      knowledgeStates: [{ knowledgePointId: "kp", profileRevision: 3, evidenceVersion: 1, aggregationVersion: "knowledge-state-v1", mastery: 1, confidence: 1, status: "ready", validEvidenceCount: 1, evidenceFormCount: 1, evidenceIds: ["e1"], consideredEvidenceIds: ["e1"], asOf: "2026-08-12T00:00:00.000Z", skipEligible: false, lastUpdatedAt: "2026-08-12T00:00:00.000Z" }],
      insufficientKnowledgePointIds: [],
      diagnosticDraftVersion: 2,
    };
    const quizOutput: Awaited<ReturnType<LearningRuntimeFacade["submitActivity"]>> = {
      kind: "quiz", requestId: "submit", sessionId: "session", sessionVersion: 3, profileRevision: 3, attemptId: "attempt", committed: true, evidenceId: "e1", evidenceVersion: 1,
      result: { kind: "quiz", verdict: "pass", correctCount: 4, totalCount: 4, requiredCorrectCount: 3, retryAllowed: false, safeFeedback: "passed" },
    };
    const diagnostic = { ...inert, completeDiagnostic: method(diagnosticOutput), completeDiagnosticWithContext: method({ output: diagnosticOutput, replayed: false, snapshot }) };
    const quiz = { ...inert, submitActivity: method(quizOutput), submitActivityWithContext: method({ output: quizOutput, replayed: false, snapshot }) };
    const facade = new ComposedLearningRuntimeFacade({ session: inert, diagnostic, path: inert, codeActivity: inert, quizActivity: quiz, sessions, profile, capabilityTasks: { enqueue }, resolveActivityKind: async () => "quiz" });
    await facade.completeDiagnostic({} as never);
    await facade.submitActivity({ kind: "quiz", activityId: "quiz" } as never);
    await Promise.resolve();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ trigger: "diagnostic_completed", evidenceIds: ["e1"] }));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ trigger: "node_completed", knowledgePointId: "kp", evidenceIds: ["e1"] }));
  });

  it("queues node completion after a terminal insufficient result without new Evidence", async () => {
    const enqueue = vi.fn(async () => ({ taskStatus: "not_updated" as const }));
    const snapshot = {
      latestCommit: { evidenceVersion: 4 },
      evidence: [],
      activityProgress: [{ nodeId: "node", activities: [{ activityId: "quiz", status: "insufficient" }] }],
      path: { nodes: [{ nodeId: "node", knowledgePointId: "kp" }] },
    };
    const sessions = { getSnapshot: method(snapshot) } as unknown as LearningSessionRepository;
    const inert = new Proxy({}, { get: () => method({}) }) as unknown as LearningRuntimeFacade;
    const quizOutput: Awaited<ReturnType<LearningRuntimeFacade["submitActivity"]>> = {
      kind: "quiz", requestId: "submit-insufficient", sessionId: "session", sessionVersion: 8, profileRevision: 3, attemptId: "attempt-2", committed: true,
      result: { kind: "quiz", verdict: "insufficient", correctCount: 0, totalCount: 3, requiredCorrectCount: 3, retryAllowed: false, safeFeedback: "insufficient" },
    };
    const quiz = { ...inert, submitActivity: method(quizOutput), submitActivityWithContext: method({ output: quizOutput, replayed: false, snapshot }) };
    const facade = new ComposedLearningRuntimeFacade({ session: inert, diagnostic: inert, path: inert, codeActivity: inert, quizActivity: quiz, sessions, profile, capabilityTasks: { enqueue }, resolveActivityKind: async () => "quiz" });
    await facade.submitActivity({ kind: "quiz", activityId: "quiz" } as never);
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledWith({
      trigger: "node_completed",
      sessionId: "session",
      profileRevision: 3,
      evidenceVersion: 4,
      knowledgePointId: "kp",
      evidenceIds: [],
    }));
  });
});
