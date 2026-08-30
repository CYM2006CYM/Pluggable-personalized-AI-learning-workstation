import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QuizActivityRuntime, type QuizActivityAssets } from "../src/application/quiz-activity-runtime.js";
import type { LearnerProfileAgentPort } from "../src/application/learner-profile-agent-service.js";
import { createActivityPathSuffixReplanner } from "../src/application/activity-path-suffix.js";
import { createDeterministicContentPort, type AdaptiveContentPort, type QuizQuestionPrivate } from "../src/contracts/index.js";
import { quizQuestionSetSha256 } from "../src/domain/quiz-runtime.js";
import type { PathEngineProfile } from "../src/domain/path-engine.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";
import { toPathSafeSnapshot, type InternalPersistedPathSnapshot } from "../src/repositories/internal-path-session-port.js";
import { InMemoryAgentRunRepository, type AgentRunRepository } from "../src/infrastructure/agent-run-repository.js";

const roots: string[] = [];
const now = () => new Date("2026-08-12T00:00:00.000Z");

function questions(prefix: string, count = 4): QuizQuestionPrivate[] {
  return Array.from({ length: count }, (_, index) => ({ questionId: `${prefix}-${index}`, kind: "single_choice", prompt: `Q${index}`, options: ["A", "B"], correctAnswer: "A", explanation: "Safe review", sourceAnchorIds: ["source-1"] }));
}

const assets: QuizActivityAssets = {
  activity: { activityId: "quiz", activityVersion: 1, profileRevision: 3, title: "Quiz", prompt: "Answer", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [] },
  knowledgePoint: { id: "kp", sourceAnchorIds: ["source-1"] },
  knowledgePoints: [{ id: "kp" }, { id: "final", requiresCodeEvidence: true }],
  fixedQuestions: questions("fixed"),
  supplementalQuestions: questions("supplemental", 2),
};

const pathProfile: PathEngineProfile = {
  profileRevision: 3,
  goals: [{ goalId: "goal", title: "Goal", targetKnowledgePointIds: ["final"], requiredActivityIds: ["code"], finalActivityId: "code" }],
  knowledgePoints: [
    { id: "kp", title: "KP", chapterId: "chapter", sectionId: "section", prerequisiteIds: [], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["quiz"], importance: 1 },
    { id: "final", title: "Final", chapterId: "chapter", sectionId: "section", prerequisiteIds: ["kp"], relatedKnowledgePointIds: [], sourceAnchorIds: ["source-1"], activityIds: ["code"], importance: 1 },
  ],
  activities: [
    { activityId: "quiz", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
    { activityId: "code", primaryKnowledgePointId: "final", supportingKnowledgePointIds: [], goalIds: ["goal"], estimatedMinutes: 5, difficulty: "S-U", allowedScaffolds: ["none"] },
  ],
};

function activeInternalPath(sessionId: string): InternalPersistedPathSnapshot {
  return {
    pathId: "path", sessionId, profileRevision: 3, evidenceVersion: 0, pathVersion: 1, engineVersion: "path-engine-v1", status: "active", mode: "recommended", goalId: "goal", availableMinutes: 20, estimatedMinutes: 10,
    nodes: [
      { nodeId: "node-kp", knowledgePointId: "kp", activityIds: ["quiz"], status: "available", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 5, reasonCodes: ["prerequisite_gap", "evidence_insufficient"] },
      { nodeId: "node-final", knowledgePointId: "final", activityIds: ["code"], status: "locked", positionLocked: false, required: true, difficulty: "S-U", scaffold: "none", estimatedMinutes: 5, reasonCodes: ["goal_required", "evidence_insufficient"] },
    ],
    positionLockedNodeIds: [], changeReasons: [], createdAt: now().toISOString(),
  };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup(
  runtimeAssets: QuizActivityAssets = assets,
  content: AdaptiveContentPort = createDeterministicContentPort(),
  profileAgent?: LearnerProfileAgentPort,
  agentRuns?: AgentRunRepository,
  dynamicGenerationTimeoutMs?: number,
) {
  const root = await mkdtemp(resolve(tmpdir(), "quiz-activity-runtime-")); roots.push(root);
  const sessions = new FileLearningSessionRepository({ dataRoot: root, now });
  const view = await sessions.create({ requestId: "create", subjectId: "subject", mode: "recommended", goalId: "goal", availableMinutes: 20, profileRevision: 3, diagnosticRequired: false });
  const path = activeInternalPath(view.sessionId);
  await sessions.commitInternalPath({
    requestId: "path",
    sessionId: view.sessionId,
    sessionVersion: 1,
    profileRevision: 3,
    candidate: { requestId: "path", knowledgeStates: [], pathCandidate: toPathSafeSnapshot({ ...path, status: "candidate" }) },
  }, { ...path, status: "candidate" });
  await sessions.commitInternalPath({
    requestId: "confirm",
    sessionId: view.sessionId,
    sessionVersion: 2,
    profileRevision: 3,
    candidate: {
      requestId: "confirm", knowledgeStates: [], pathCandidate: toPathSafeSnapshot(path),
      activityProgress: [
        { nodeId: "node-kp", card: { cardId: "actual-card-kp", status: "pending" }, activities: [{ activityId: "quiz", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] },
        { nodeId: "node-final", activities: [{ activityId: "code", status: "pending", attemptIds: [], quizRetryCount: 0, updatedAt: now().toISOString() }] },
      ],
      boundLearningCards: [{ nodeId: "node-kp", source: "fixed", card: { cardId: "actual-card-kp", knowledgePointId: "kp", title: "KP", objective: "Learn KP", explanation: ["Safe explanation"], example: "Example", commonMistake: "Mistake", sourceAnchorIds: ["source-1"], estimatedMinutes: 1 } }],
    },
  }, path);
  const pathSuffix = createActivityPathSuffixReplanner({ sessions, profile: { async load() { return structuredClone(pathProfile); } }, now });
  const runtime = new QuizActivityRuntime({ sessions, content, loadAssets: async () => structuredClone(runtimeAssets), pathSuffix, profileAgent, agentRuns, dynamicGenerationTimeoutMs, now });
  return { root, sessions, view, runtime };
}

describe("QuizActivityRuntime", () => {
  it("创建并发布可恢复的同一Agent run引用", async () => {
    const generated = questions("agent-dynamic");
    const agentRuns = new InMemoryAgentRunRepository(now);
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz(input) {
        expect(input.agentRunId).toBeDefined();
        for (const [role, status] of [
          ["generator", "succeeded"], ["safety", "succeeded"], ["hunter", "succeeded"],
          ["defender", "skipped"], ["judge", "succeeded"],
        ] as const) {
          await agentRuns.append(input.agentRunId!, {
            role, label: role, status, startedAt: now().toISOString(), finishedAt: now().toISOString(), durationMs: 0,
            attemptNumber: 1, publicSummary: `${role}形成安全结果。`,
          });
        }
        return {
          status: "accepted", questions: generated, origin: "live_model",
          reviewBinding: { generationRunId: "w6-agent-run-binding", acceptedQuestionSetSha256: quizQuestionSetSha256(generated) },
        };
      },
    };
    const { view, runtime } = await setup(assets, content, undefined, agentRuns);
    const opened = await runtime.openActivity({
      requestId: "open-agent-run", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3,
      activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp",
    });
    expect(opened.activity.agentRunId).toMatch(/^agent-[a-f0-9]{32}$/u);
    const stored = await agentRuns.getByRunId(opened.activity.agentRunId!);
    expect(stored).toMatchObject({ status: "succeeded", resultOrigin: "ai_live", questionCount: 4 });
    expect(stored?.stages.at(-1)).toMatchObject({ role: "publish", status: "succeeded" });
  });

  it("同一请求复用半截run时会补齐依据和画像工位，不会停在第一步", async () => {
    const generated = questions("partial-agent-run");
    const agentRuns = new InMemoryAgentRunRepository(now);
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz(input) {
        expect(input.agentRunId).toBeDefined();
        for (const role of ["generator", "safety", "hunter", "defender", "judge"] as const) {
          await agentRuns.append(input.agentRunId!, {
            role, label: role, status: role === "defender" ? "skipped" : "succeeded", startedAt: now().toISOString(), finishedAt: now().toISOString(),
            durationMs: 0, attemptNumber: 1, publicSummary: `${role}形成安全结果。`,
          });
        }
        return {
          status: "accepted", questions: generated, origin: "live_model",
          reviewBinding: { generationRunId: "partial-agent-binding", acceptedQuestionSetSha256: quizQuestionSetSha256(generated) },
        };
      },
    };
    const { view, runtime } = await setup(assets, content, undefined, agentRuns);
    const partial = await agentRuns.create({
      requestId: "open-partial-agent-run", sessionId: view.sessionId, activityId: "quiz",
      profileRevision: 3, pathVersion: 1, evidenceVersion: 0,
    });
    await agentRuns.append(partial.runId, {
      role: "source", label: "教学依据准备", status: "running", startedAt: now().toISOString(), attemptNumber: 1,
      publicSummary: "正在绑定正文。",
    });
    await agentRuns.append(partial.runId, {
      role: "source", label: "教学依据准备", status: "succeeded", startedAt: now().toISOString(), finishedAt: now().toISOString(),
      durationMs: 0, attemptNumber: 1, publicSummary: "正文绑定完成。", sourceClaimIds: ["source-1"],
    });
    const opened = await runtime.openActivity({
      requestId: "open-partial-agent-run", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3,
      activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp",
    });
    const stored = await agentRuns.getByRunId(opened.activity.agentRunId!);
    expect(stored?.stages.filter((stage) => stage.role === "profile" && stage.status === "succeeded")).toHaveLength(1);
    expect(stored?.status).toBe("succeeded");
  });

  it("AI执行失败时在同一run中如实记录固定保障发布", async () => {
    const agentRuns = new InMemoryAgentRunRepository(now);
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz(input) {
        await agentRuns.append(input.agentRunId!, {
          role: "generator", label: "Generator", status: "failed", startedAt: now().toISOString(), finishedAt: now().toISOString(),
          durationMs: 0, attemptNumber: 1, publicSummary: "模型服务未形成有效候选。",
        });
        return { status: "unavailable" };
      },
    };
    const { view, runtime } = await setup(assets, content, undefined, agentRuns);
    const opened = await runtime.openActivity({
      requestId: "open-agent-fallback", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3,
      activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp",
    });
    expect(opened.activity.questionSource).toBe("profile_fixed");
    const stored = await agentRuns.getByRunId(opened.activity.agentRunId!);
    expect(stored).toMatchObject({ status: "fallback", resultOrigin: "profile_fixed", fallbackReasonCode: "AI_UNAVAILABLE_FIXED" });
    expect(stored?.stages.at(-1)).toMatchObject({ role: "publish", status: "fallback" });
  });

  it("超出客观题总生成时限后停止等待并记录固定保障原因", async () => {
    const agentRuns = new InMemoryAgentRunRepository(now);
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz() { return new Promise<never>(() => {}); },
    };
    const { view, runtime } = await setup(assets, content, undefined, agentRuns, 5);
    const opened = await runtime.openActivity({
      requestId: "open-agent-timeout", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3,
      activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp",
    });
    expect(opened.activity.questionSource).toBe("profile_fixed");
    const stored = await agentRuns.getByRunId(opened.activity.agentRunId!);
    expect(stored).toMatchObject({ status: "fallback", resultOrigin: "profile_fixed", fallbackReasonCode: "AI_GENERATION_TIMEOUT_FIXED" });
    expect(stored?.stages.at(-1)?.publicSummary).toContain("超过1秒");
  });

  it("locks the accepted AI answer set to the Attempt and never grades it with the fixed key", async () => {
    const generated = questions("dynamic").map((question) => ({
      ...question,
      options: ["A", "B"],
      correctAnswer: "B",
      explanation: "The reviewed AI candidate intentionally uses an answer different from the fixed fallback.",
      sourceAnchorIds: ["activity-source"],
    }));
    const runtimeAssets: QuizActivityAssets = {
      ...assets,
      allowedSourceAnchorIds: ["source-1", "activity-source"],
    };
    let requestedTargets: string[] | undefined;
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz(input) {
        requestedTargets = input.targetKnowledgePointIds;
        return {
          status: "accepted",
          questions: generated,
          origin: "live_model",
          reviewBinding: {
            generationRunId: "w6-live-reviewed-quiz",
            acceptedQuestionSetSha256: quizQuestionSetSha256(generated),
          },
        };
      },
    };
    const { sessions, view, runtime } = await setup(runtimeAssets, content);
    const opened = await runtime.openActivity({ requestId: "activity-source-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    expect(opened.activity.questionSource).toBe("ai_live");
    expect(requestedTargets).toEqual(["kp"]);
    expect(opened.activity.targetKnowledgePointIds).toEqual(["kp"]);
    expect(opened.activity.questions.map((question) => question.questionId)).toEqual(generated.map((question) => question.questionId));
    expect(JSON.stringify(opened)).not.toMatch(/correctAnswer|gradingBinding|generationRunId/iu);
    const attempt = await sessions.getQuizAttempt({
      sessionId: view.sessionId,
      sessionVersion: opened.sessionVersion,
      profileRevision: 3,
      activityId: "quiz",
      attemptId: opened.attemptId,
    });
    expect(attempt?.gradingBinding).toEqual({
      source: "ai_reviewed",
      generationRunId: "w6-live-reviewed-quiz",
      questionSetSha256: quizQuestionSetSha256(generated),
    });
    expect(attempt?.questions.every((question) => question.correctAnswer === "B")).toBe(true);
    const submitted = await runtime.submitActivity({
      requestId: "activity-source-submit",
      sessionId: view.sessionId,
      sessionVersion: opened.sessionVersion,
      profileRevision: 3,
      kind: "quiz",
      activityId: "quiz",
      activityVersion: 1,
      attemptId: opened.attemptId,
      answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })),
    });
    expect(submitted.result).toMatchObject({ verdict: "pass", correctCount: 4 });
  });

  it("binds a retry to the current lesson, latest missed questions, and accepted learner-profile Agent summary", async () => {
    const firstQuestions = questions("first");
    const retryQuestions = questions("retry").map((question, index) => ({ ...question, prompt: `重做题面${index}` }));
    const requests: Parameters<AdaptiveContentPort["prepareQuiz"]>[0][] = [];
    const agentRuns = new InMemoryAgentRunRepository(now);
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz(input) {
        requests.push(structuredClone(input));
        if (input.agentRunId !== undefined) {
          for (const [role, status] of [
            ["generator", "succeeded"], ["safety", "succeeded"], ["hunter", "succeeded"],
            ["defender", "skipped"], ["judge", "succeeded"],
          ] as const) {
            await agentRuns.append(input.agentRunId, {
              role, label: role, status, startedAt: now().toISOString(), finishedAt: now().toISOString(), durationMs: 0,
              attemptNumber: 1, publicSummary: `${role}形成安全结果。`,
            });
          }
        }
        const selected = input.retryNumber === 0 ? firstQuestions : retryQuestions;
        return { status: "accepted", questions: selected, origin: "live_model", reviewBinding: { generationRunId: `remediation-run-${input.retryNumber}`, acceptedQuestionSetSha256: quizQuestionSetSha256(selected) } };
      },
    };
    let profileCalls = 0;
    const profileAgent: LearnerProfileAgentPort = {
      async summarize({ profile }) {
        profileCalls += 1;
        return { status: "accepted", runId: "profile-retry-run", explanation: "画像显示当前读取CSV环节仍需强化。", evidenceRefs: [...profile.evidenceIds] };
      },
    };
    const { sessions, view, runtime } = await setup(assets, content, profileAgent, agentRuns);
    const first = await runtime.openActivity({ requestId: "first-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    await runtime.submitActivity({
      requestId: "first-submit", sessionId: view.sessionId, sessionVersion: first.sessionVersion, profileRevision: 3,
      kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: first.attemptId,
      answers: first.activity.questions.map((question, index) => ({ questionId: question.questionId, answer: index < 2 ? "B" : "A" })),
    });
    const afterFirst = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: first.sessionVersion + 1, profileRevision: 3 });
    const retry = await runtime.openActivity({ requestId: "retry-open", sessionId: view.sessionId, sessionVersion: afterFirst.sessionVersion, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: afterFirst.path!.pathVersion });

    expect(profileCalls).toBe(1);
    expect(requests[0]).toMatchObject({
      retryNumber: 0,
      targetKnowledgePointIds: ["kp"],
      personalizationContext: {
        knowledgeStatus: "unverified",
        mastery: null,
        confidence: 0,
        validEvidenceCount: 0,
        evidenceFormCount: 0,
        explanationPreference: "step_by_step",
      },
    });
    expect(requests[1]).toMatchObject({
      retryNumber: 1,
      targetKnowledgePointIds: ["kp"],
      personalizationContext: {
        knowledgeStatus: "learning",
        mastery: 0.5,
        confidence: 0.25,
        validEvidenceCount: 1,
        evidenceFormCount: 1,
        explanationPreference: "step_by_step",
      },
      excludedQuestionIds: firstQuestions.map((question) => question.questionId),
      remediationContext: {
        previousAttemptId: first.attemptId,
        excludedQuestionPrompts: firstQuestions.map((question) => question.prompt),
        learnerProfileSource: "agent",
        learnerProfileSummary: "画像显示当前读取CSV环节仍需强化。",
        missedQuestions: firstQuestions.slice(0, 2).map((question) => ({
          questionId: question.questionId,
          prompt: question.prompt,
          explanation: question.explanation,
          sourceAnchorIds: question.sourceAnchorIds,
        })),
      },
    });
    expect(retry.activity.targetKnowledgePointIds).toEqual(["kp"]);
    expect(retry.activity.questions.map((question) => question.questionId)).toEqual(retryQuestions.map((question) => question.questionId));
    expect(JSON.stringify(retry)).not.toMatch(/missedQuestions|learnerProfileSummary|evidence-/u);
    const retryRun = await agentRuns.getByRunId(retry.activity.agentRunId!);
    expect(retryRun?.remediation).toMatchObject({
      lessonVariantId: "guided",
      previousAttemptId: first.attemptId,
      missedQuestionCount: 2,
      weakKnowledgePointIds: ["kp"],
      learnerProfileSource: "agent",
      evidenceVersion: 1,
    });
    expect(retryRun?.remediation?.publicRecommendation).toBe("画像显示当前读取CSV环节仍需强化。");
    const retried = await runtime.submitActivity({
      requestId: "retry-submit", sessionId: view.sessionId, sessionVersion: retry.sessionVersion, profileRevision: 3,
      kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: retry.attemptId,
      answers: retry.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A" })),
    });
    if (retried.kind !== "quiz") throw new Error("expected quiz result");
    expect(retried.result.remediationOutcome).toEqual({
      status: "improved",
      previousMissedQuestionCount: 2,
      currentMissedQuestionCount: 0,
      targetKnowledgePointIds: ["kp"],
      improvedKnowledgePointIds: ["kp"],
      stillWeakKnowledgePointIds: [],
    });
  });

  it("uses the deterministic learner profile when the profile Agent is unavailable", async () => {
    const requests: Parameters<AdaptiveContentPort["prepareQuiz"]>[0][] = [];
    const content: AdaptiveContentPort = {
      async prepareCard() { return { status: "unavailable" }; },
      async prepareQuiz(input) {
        requests.push(structuredClone(input));
        const selected = input.retryNumber === 0 ? questions("first-fallback") : questions("retry-fallback");
        return { status: "accepted", questions: selected, origin: "live_model", reviewBinding: { generationRunId: `fallback-profile-${input.retryNumber}`, acceptedQuestionSetSha256: quizQuestionSetSha256(selected) } };
      },
    };
    const profileAgent: LearnerProfileAgentPort = { async summarize() { return { status: "unavailable", runId: "profile-unavailable", errorCode: "provider_error" }; } };
    const { sessions, view, runtime } = await setup(assets, content, profileAgent);
    const first = await runtime.openActivity({ requestId: "fallback-first-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    await runtime.submitActivity({
      requestId: "fallback-first-submit", sessionId: view.sessionId, sessionVersion: first.sessionVersion, profileRevision: 3,
      kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: first.attemptId,
      answers: first.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })),
    });
    const afterFirst = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: first.sessionVersion + 1, profileRevision: 3 });
    await runtime.openActivity({ requestId: "fallback-retry-open", sessionId: view.sessionId, sessionVersion: afterFirst.sessionVersion, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: afterFirst.path!.pathVersion });
    expect(requests[1]?.remediationContext).toMatchObject({ learnerProfileSource: "deterministic" });
    expect(requests[1]?.remediationContext?.learnerProfileSummary).toContain("正式 Evidence");
  });

  it("opens a legal legacy single-question helper without routing it through W4 group selection", async () => {
    const legacyQuestion = questions("legacy", 1)[0]!;
    const legacyAssets: QuizActivityAssets = {
      ...assets,
      fixedQuestions: [],
      supplementalQuestions: [],
      legacyQuestion,
      legacySubtype: "single_choice",
    };
    const { view, runtime } = await setup(legacyAssets);
    const opened = await runtime.openActivity({ requestId: "legacy-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    expect(opened.activity.questions).toHaveLength(1);
    expect(opened.activity.questions[0]).toMatchObject({ questionId: "legacy-0", options: ["A", "B"] });
    expect(JSON.stringify(opened)).not.toContain("correctAnswer");
  });

  it("scores a legal legacy single-question helper with single-question semantics", async () => {
    const legacyQuestion = questions("legacy", 1)[0]!;
    const legacyAssets: QuizActivityAssets = {
      ...assets,
      fixedQuestions: [],
      supplementalQuestions: [],
      legacyQuestion,
      legacySubtype: "single_choice",
    };
    const { sessions, view, runtime } = await setup(legacyAssets);
    const opened = await runtime.openActivity({ requestId: "legacy-score-open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    const submitted = await runtime.submitActivity({
      requestId: "legacy-score-submit",
      sessionId: view.sessionId,
      sessionVersion: opened.sessionVersion,
      profileRevision: 3,
      kind: "quiz",
      activityId: "quiz",
      activityVersion: 1,
      attemptId: opened.attemptId,
      answers: [{ questionId: "legacy-0", answer: "A" }],
    });
    expect(submitted.result).toMatchObject({ verdict: "pass", correctCount: 1, totalCount: 1, requiredCorrectCount: 1, retryAllowed: false });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: submitted.sessionVersion, profileRevision: 3 });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.activityProgress[0]?.activities[0]).toMatchObject({ status: "completed", result: "pass" });
  });

  it("opens a safe persisted Attempt, commits one Evidence, and advances to the next activity", async () => {
    const { sessions, view, runtime } = await setup();
    const opened = await runtime.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    expect(JSON.stringify(opened)).not.toContain("correctAnswer");
    expect(opened.activity.questions).toHaveLength(4);
    await expect(runtime.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" })).resolves.toEqual(opened);
    await expect(runtime.openActivity({ requestId: "open", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "previous-card" })).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    const refreshed = await runtime.openActivity({ requestId: "refresh", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1 });
    expect(refreshed).toMatchObject({ attemptId: opened.attemptId, activity: { title: "Quiz", prompt: "Answer", primaryKnowledgePointId: "kp", supportingKnowledgePointIds: [] } });
    const submission = { requestId: "submit", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz" as const, activityId: "quiz", activityVersion: 1, attemptId: opened.attemptId, answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A" })) };
    const committedContext = await runtime.submitActivityWithContext(submission);
    const submitted = committedContext.output;
    expect(committedContext).toMatchObject({ replayed: false, snapshot: { sessionVersion: 5, latestCommit: { evidenceVersion: 1 } } });
    expect(submitted).toMatchObject({ committed: true, result: { verdict: "pass" }, evidenceVersion: 1, sessionVersion: 5 });
    const input = submission;
    await expect(runtime.submitActivityWithContext(input)).resolves.toMatchObject({ output: submitted, replayed: true, snapshot: { sessionVersion: 5 } });
    await expect(runtime.submitActivity({ ...input, answers: input.answers.map((answer, index) => index === 0 ? { ...answer, answer: "B" } : answer) })).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot.activityProgress[0]?.activities).toMatchObject([{ activityId: "quiz", status: "completed" }]);
    expect(snapshot.path).toMatchObject({ pathVersion: 2, nodes: [{ status: "completed" }, { status: "available" }] });
  });

  it("opens disjoint retries beyond the second attempt", async () => {
    const { sessions, view, runtime } = await setup();
    const first = await runtime.openActivity({ requestId: "open-1", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    await runtime.submitActivity({ requestId: "submit-1", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: first.attemptId, answers: first.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const afterFirst = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3 });
    const retry = await runtime.openActivity({ requestId: "open-2", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: afterFirst.path!.pathVersion });
    const firstIds = new Set(first.activity.questions.map((question) => question.questionId));
    expect(retry.activity.questions.filter((question) => firstIds.has(question.questionId))).toHaveLength(0);
    await runtime.submitActivity({ requestId: "submit-2", sessionId: view.sessionId, sessionVersion: 6, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: retry.attemptId, answers: retry.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const afterSecond = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3 });
    const third = await runtime.openActivity({ requestId: "open-3", sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: afterSecond.path!.pathVersion });
    expect(third.activity.retryNumber).toBe(2);
    expect(third.activity.questions).toHaveLength(4);
  });

  it("publishes a recomputed path suffix and archives the prior path in the quiz transaction", async () => {
    const { root, sessions, view, runtime } = await setup();
    const first = await runtime.openActivity({ requestId: "open-suffix-1", sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1, acknowledgedCardId: "actual-card-kp" });
    await runtime.submitActivity({ requestId: "submit-suffix-1", sessionId: view.sessionId, sessionVersion: 4, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: first.attemptId, answers: first.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const retry = await runtime.openActivity({ requestId: "open-suffix-2", sessionId: view.sessionId, sessionVersion: 5, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1 });
    await runtime.submitActivity({ requestId: "submit-suffix-2", sessionId: view.sessionId, sessionVersion: 6, profileRevision: 3, kind: "quiz", activityId: "quiz", activityVersion: 1, attemptId: retry.attemptId, answers: retry.activity.questions.map((question) => ({ questionId: question.questionId, answer: "B" })) });
    const continued = await runtime.continueActivityWithGap({ requestId: "continue-suffix", sessionId: view.sessionId, sessionVersion: 7, profileRevision: 3, activityId: "quiz", attemptId: retry.attemptId });
    expect(continued).toMatchObject({ status: "insufficient", result: "insufficient", attemptCount: 2, sessionVersion: 8 });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 8, profileRevision: 3 });
    expect(snapshot.path).toMatchObject({ pathVersion: 2, status: "active" });
    expect(snapshot.path?.nodes).toMatchObject([{ status: "completed", positionLocked: true }, { status: "available" }]);
    expect(snapshot.activityProgress[0]?.activities[0]).toMatchObject({ status: "insufficient", continuedWithGap: true, bestResult: "fail" });
    expect(snapshot.latestCommit.evidenceVersion).toBe(1);
    await expect(runtime.openActivity({
      requestId: "reopen-without-explicit-choice", sessionId: view.sessionId, sessionVersion: 8,
      profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 2,
    })).rejects.toMatchObject({ errorCode: "prerequisite_violation" });
    const relearned = await runtime.openActivity({
      requestId: "reopen-skipped-quiz", sessionId: view.sessionId, sessionVersion: 8,
      profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 2, relearn: true,
    });
    expect(relearned).toMatchObject({ sessionVersion: 9, activity: { activityId: "quiz", retryNumber: 2 } });
    const relearningSnapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 9, profileRevision: 3 });
    expect(relearningSnapshot.activityProgress[0]?.activities[0]).toMatchObject({ status: "in_progress", continuedWithGap: true });
    const archived = JSON.parse(await readFile(resolve(root, "profile_families", "subject", "_user", "learning_sessions", view.sessionId, "paths", "superseded", "1.json"), "utf8"));
    expect(archived).toMatchObject({ pathVersion: 1, status: "superseded" });
  });

  it("rejects missing and incorrect card acknowledgements before creating a Quiz Attempt", async () => {
    const { sessions, view, runtime } = await setup();
    const input = { sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3, activityId: "quiz", activityVersion: 1, pathVersion: 1 } as const;
    await expect(runtime.openActivity({ ...input, requestId: "missing-card" })).rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    await expect(runtime.openActivity({ ...input, requestId: "wrong-card", acknowledgedCardId: "previous-card" })).rejects.toMatchObject({ errorCode: "activity_lifecycle_conflict" });
    const snapshot = await sessions.getSnapshot({ sessionId: view.sessionId, sessionVersion: 3, profileRevision: 3 });
    expect(snapshot.currentAttempt).toBeUndefined();
    expect(snapshot.activityProgress[0]?.card).toEqual({ cardId: "actual-card-kp", status: "pending" });
    expect(snapshot.activityProgress[0]?.activities[0]?.attemptIds).toEqual([]);
    expect(snapshot.evidence).toEqual([]);
  });
});
