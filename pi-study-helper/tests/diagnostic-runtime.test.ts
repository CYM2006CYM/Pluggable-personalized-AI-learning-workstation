import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticRuntime, type DiagnosticRuntimeAssets } from "../src/application/diagnostic-runtime.js";
import { FileLearningSessionRepository } from "../src/repositories/file-learning-session-repository.js";

const roots: string[] = [];

const assets: DiagnosticRuntimeAssets = {
  blueprint: {
    blueprintId: "javascript-diagnostic-v1",
    profileRevision: 2,
    goalIds: ["goal-1"],
    estimatedMinutes: 1,
    minimumCoverage: 1,
    questions: [
      {
        questionId: "q-1",
        knowledgePointId: "kp-1",
        kind: "single_choice",
        difficulty: "S-U",
        prompt: "Which declaration is immutable?",
        options: ["const", "let", "var"],
        maxScore: 1,
        required: true,
        evaluatorRef: "private/answer-key.json#q-1",
        sourceAnchorIds: ["source-1"],
      },
      {
        questionId: "q-2",
        knowledgePointId: "kp-2",
        kind: "judgment",
        difficulty: "S-R",
        prompt: "A boolean can be true.",
        maxScore: 1,
        required: true,
        evaluatorRef: "private/answer-key.json#q-2",
        sourceAnchorIds: ["source-1"],
      },
    ],
    scoringVersion: "javascript-diagnostic-v1",
  },
  answerKey: {
    blueprintId: "javascript-diagnostic-v1",
    evaluatorVersion: "javascript-answer-v1",
    answers: [
      { questionId: "q-1", kind: "single_choice", correctAnswer: "const" },
      { questionId: "q-2", kind: "judgment", correctAnswer: true },
    ],
  },
  knowledgePoints: [{ id: "kp-1" }, { id: "kp-2" }],
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(runtimeAssets: DiagnosticRuntimeAssets = assets) {
  const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-diagnostic-"));
  roots.push(root);
  const repository = new FileLearningSessionRepository({
    dataRoot: root,
    now: () => new Date("2026-07-30T12:00:00.000Z"),
  });
  const view = await repository.create({
    requestId: "create-1",
    subjectId: "smoke-subject",
    mode: "recommended",
    goalId: "goal-1",
    availableMinutes: 10,
    profileRevision: 2,
    diagnosticRequired: true,
  });
  const runtime = new DiagnosticRuntime({
    repository,
    dataRoot: root,
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    loadAssets: async () => runtimeAssets,
  });
  return { root, repository, runtime, view };
}

describe("DiagnosticRuntime", () => {
  it("saves a draft, deterministically grades an answer, and is idempotent", async () => {
    const { runtime, view } = await setup();
    const draft = await runtime.saveDiagnosticDraft({
      requestId: "draft-1",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
      currentQuestionId: "q-1",
      background: [{ fieldId: "pythonExperience", value: "unknown" }],
    });
    expect(draft.currentQuestionId).toBe("q-1");

    const input = {
      requestId: "answer-1",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
      questionId: "q-1",
      action: "answer",
      answer: "const",
    } as const;
    const first = await runtime.submitDiagnosticAnswer(input);
    const retry = await runtime.submitDiagnosticAnswer(input);
    expect(first).toEqual(retry);
    expect(first).toMatchObject({ result: "pass" });
    expect(first).not.toHaveProperty("evidenceId");

    await expect(runtime.submitDiagnosticAnswer({ ...input, requestId: "answer-2" })).rejects.toMatchObject({
      errorCode: "diagnostic_answer_conflict",
    });
  });

  it("supports explicit skip through the internal discriminated input", async () => {
    const { runtime, repository, view } = await setup();
    const skip = {
      action: "skip",
      requestId: "skip-1",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
      questionId: "q-1",
    } as const;
    const answer = await runtime.submitDiagnosticAnswer(skip);
    expect(answer.result).toBe("skipped");
    await runtime.submitDiagnosticAnswer({
      requestId: "answer-2",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
      questionId: "q-2",
      action: "answer",
      answer: true,
    });
    const completed = await runtime.completeDiagnostic({
      requestId: "complete-1",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
    });
    expect(completed.evidenceVersion).toBe(1);
    expect(completed.insufficientKnowledgePointIds).toEqual(["kp-1"]);
    expect(completed.knowledgeStates.find((item) => item.knowledgePointId === "kp-1")).toMatchObject({
      mastery: null,
      confidence: 0,
      status: "unverified",
    });
    const snapshot = await repository.getSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(snapshot.latestDiagnostic?.insufficientKnowledgePointIds).toEqual(["kp-1"]);
  });

  it("allows all questions to be skipped without creating Evidence or advancing evidenceVersion", async () => {
    const { runtime, repository, view } = await setup();
    const base = {
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
    } as const;
    await runtime.submitDiagnosticAnswer({ ...base, action: "skip", requestId: "skip-1", questionId: "q-1" });
    await runtime.submitDiagnosticAnswer({ ...base, action: "skip", requestId: "skip-2", questionId: "q-2" });
    const completed = await runtime.completeDiagnostic({ ...base, requestId: "complete-1" });
    expect(completed.evidenceVersion).toBe(0);
    expect(completed.insufficientKnowledgePointIds).toEqual(["kp-1", "kp-2"]);
    const snapshot = await repository.getSnapshot({ sessionId: view.sessionId, sessionVersion: 2, profileRevision: 2 });
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.latestCommit.evidenceVersion).toBe(0);
  });

  it("deduplicates skipped knowledge points and keeps existing direct Evidence authoritative", async () => {
    const samePointAssets: DiagnosticRuntimeAssets = {
      ...assets,
      blueprint: {
        ...assets.blueprint,
        questions: assets.blueprint.questions.map((question) => ({ ...question, knowledgePointId: "kp-1" })),
      },
      knowledgePoints: [{ id: "kp-1" }],
    };
    const { runtime, view } = await setup(samePointAssets);
    const base = {
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
    } as const;
    await runtime.submitDiagnosticAnswer({ ...base, requestId: "answer-1", questionId: "q-1", action: "answer", answer: "const" });
    await runtime.submitDiagnosticAnswer({ ...base, action: "skip", requestId: "skip-2", questionId: "q-2" });
    const completionInput = { ...base, requestId: "complete-1" };
    const completed = await runtime.completeDiagnostic(completionInput);
    const retry = await runtime.completeDiagnostic(completionInput);
    expect(retry).toEqual(completed);
    expect(completed.insufficientKnowledgePointIds).toEqual(["kp-1"]);
    expect(completed.knowledgeStates).toHaveLength(1);
    expect(completed.knowledgeStates[0]).toMatchObject({ knowledgePointId: "kp-1", mastery: 1, status: "ready" });
  });

  it("deduplicates repeated skips for one knowledge point without manufacturing zero Evidence", async () => {
    const samePointAssets: DiagnosticRuntimeAssets = {
      ...assets,
      blueprint: {
        ...assets.blueprint,
        questions: assets.blueprint.questions.map((question) => ({ ...question, knowledgePointId: "kp-1" })),
      },
      knowledgePoints: [{ id: "kp-1" }],
    };
    const { runtime, view } = await setup(samePointAssets);
    const base = {
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
    } as const;
    await runtime.submitDiagnosticAnswer({ ...base, action: "skip", requestId: "skip-1", questionId: "q-1" });
    await runtime.submitDiagnosticAnswer({ ...base, action: "skip", requestId: "skip-2", questionId: "q-2" });
    const completed = await runtime.completeDiagnostic({ ...base, requestId: "complete-1" });
    expect(completed.insufficientKnowledgePointIds).toEqual(["kp-1"]);
    expect(completed.knowledgeStates).toEqual([
      expect.objectContaining({ knowledgePointId: "kp-1", mastery: null, confidence: 0, status: "unverified" }),
    ]);
  });

  it("rejects invalid answers and incomplete completion", async () => {
    const { runtime, view } = await setup();
    const base = {
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
    } as const;
    await expect(runtime.submitDiagnosticAnswer({ ...base, requestId: "bad", questionId: "q-1", action: "answer", answer: "let" }))
      .resolves.toMatchObject({ result: "fail" });
    await expect(runtime.completeDiagnostic({ ...base, requestId: "incomplete" })).rejects.toMatchObject({
      errorCode: "diagnostic_incomplete",
    });
  });

  it("enforces the public action discriminant and request-id content binding", async () => {
    const { runtime, view } = await setup();
    const base = {
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
    } as const;

    await expect(runtime.submitDiagnosticAnswer({ ...base, requestId: "missing-action", questionId: "q-1", answer: "const" } as never))
      .rejects.toMatchObject({ errorCode: "diagnostic_answer_invalid" });
    await expect(runtime.submitDiagnosticAnswer({ ...base, requestId: "skip-with-answer", questionId: "q-1", action: "skip", answer: "const" } as never))
      .rejects.toMatchObject({ errorCode: "diagnostic_answer_invalid" });
    await expect(runtime.submitDiagnosticAnswer({ ...base, requestId: "answer-without-answer", questionId: "q-1", action: "answer" } as never))
      .rejects.toMatchObject({ errorCode: "diagnostic_answer_invalid" });

    await runtime.submitDiagnosticAnswer({ ...base, requestId: "shared-request", questionId: "q-1", action: "answer", answer: "const" });
    await expect(runtime.submitDiagnosticAnswer({ ...base, requestId: "shared-request", questionId: "q-2", action: "answer", answer: true }))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
  });

  it("serializes concurrent submissions so the first answer cannot be overwritten", async () => {
    const { root, runtime, view } = await setup();
    const base = {
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
      questionId: "q-1",
      action: "answer",
    } as const;
    const results = await Promise.allSettled([
      runtime.submitDiagnosticAnswer({ ...base, requestId: "concurrent-1", answer: "const" }),
      runtime.submitDiagnosticAnswer({ ...base, requestId: "concurrent-2", answer: "let" }),
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof runtime.submitDiagnosticAnswer>>> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ errorCode: "diagnostic_answer_conflict" });

    const answerPath = resolve(
      root,
      "profile_families",
      "smoke-subject",
      "_user",
      "learning_sessions",
      view.sessionId,
      "diagnostic",
      "answers",
      "q-1.json",
    );
    const stored = JSON.parse(await readFile(answerPath, "utf8")) as { requestId: string; output: { requestId: string } };
    expect(stored.requestId).toBe(fulfilled[0]?.value.requestId);
    expect(stored.output.requestId).toBe(fulfilled[0]?.value.requestId);
  });

  it("returns one stable result for concurrent retries of the same request", async () => {
    const { runtime, view } = await setup();
    const input = {
      requestId: "concurrent-idempotent",
      sessionId: view.sessionId,
      sessionVersion: view.sessionVersion,
      profileRevision: 2,
      diagnosticId: "javascript-diagnostic-v1",
      diagnosticVersion: 1,
      questionId: "q-1",
      action: "answer",
      answer: "const",
    } as const;
    const [first, retry] = await Promise.all([
      runtime.submitDiagnosticAnswer(input),
      runtime.submitDiagnosticAnswer(input),
    ]);
    expect(retry).toEqual(first);
  });
});
