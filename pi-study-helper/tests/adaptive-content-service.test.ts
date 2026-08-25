import { describe, expect, it, vi } from "vitest";
import {
  AdaptiveContentService,
  type AdaptiveContentClock,
  type AdaptiveContentSourceContext,
} from "../src/application/adaptive-content-service.js";
import type { ModelExecutionPort, ModelExecutionResult } from "../src/infrastructure/model-execution-port.js";
import { InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";

const source: AdaptiveContentSourceContext = {
  profileRevision: 3,
  knowledgePointId: "pandas.clean.read-csv",
  targetId: "act-read-csv",
  title: "Read CSV",
  sourceAnchorIds: ["src-pandas-read-csv"],
  publicSourceSummary: "src-pandas-read-csv: public registered summary; sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  estimatedMinutes: 8,
};

const question = {
  questionId: "dynamic-read-1",
  kind: "single_choice" as const,
  prompt: "Which function reads a CSV into a DataFrame?",
  options: ["pandas.read_csv", "pandas.to_csv", "DataFrame.shape"],
  correctAnswer: "pandas.read_csv",
  explanation: "read_csv parses a CSV source into a DataFrame.",
  sourceAnchorIds: ["src-pandas-read-csv"],
};

const questions = Array.from({ length: 4 }, (_, index) => ({
  ...question,
  questionId: `dynamic-read-${index + 1}`,
  prompt: `${index + 1}. ${question.prompt}`,
}));

const card = {
  cardId: "dynamic-card-read",
  knowledgePointId: "pandas.clean.read-csv",
  title: "Read CSV safely",
  objective: "Read a CSV and inspect the resulting table.",
  explanation: ["Reading creates a DataFrame but does not clean its values."],
  example: "const table = pandas.read_csv(source)",
  commonMistake: "Assuming parsed values are already normalized.",
  sourceAnchorIds: ["src-pandas-read-csv"],
  estimatedMinutes: 8,
};

function ok(payload: unknown): ModelExecutionResult {
  return {
    status: "ok", payload, sourceRefs: ["src-pandas-read-csv"], traceSummary: "recorded safe stage",
    modelId: "deepseek-chat", promptVersion: "w4-d2-v1",
  };
}

function generator(candidate: unknown, riskFlags: string[] = []): ModelExecutionResult {
  return ok({
    artifactId: "generated-artifact", candidateFeedback: JSON.stringify(candidate), rationale: "Uses the registered source.",
    citedSourceIds: ["src-pandas-read-csv"], riskFlags,
  });
}

function objectGenerator(candidate: Record<string, unknown>, riskFlags: string[] = []): ModelExecutionResult {
  return ok({
    artifactId: "generated-artifact", candidateFeedback: candidate, rationale: "Uses the registered source.",
    citedSourceIds: ["src-pandas-read-csv"], riskFlags,
  });
}

const hunter = ok({ issues: [{ issueId: "issue-1", severity: "medium", message: "Check wording.", disputed: true }], requiresDefender: true, recommendedVerdict: "revise" });
const cleanHunter = ok({ issues: [], requiresDefender: false, recommendedVerdict: "accepted" });
const defender = ok({ defenseSummary: "The wording follows the public source.", acceptedIssueIds: [], rebuttedIssueIds: ["issue-1"], residualRisks: [] });
const judge = ok({ verdict: "accepted", finalSafeFeedback: "Accepted after review.", summary: "No blocked issue remains.", blockedIssueIds: [] });

function providerByGraph(generatorResult: ModelExecutionResult, hunterResult = hunter): ModelExecutionPort & { calls: Array<{ graphId: string; safeContext: unknown }> } {
  const calls: Array<{ graphId: string; safeContext: unknown }> = [];
  return {
    calls,
    async execute(input) {
      calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") return generatorResult;
      if (input.graphId === "hunter") return hunterResult;
      if (input.graphId === "defender") return defender;
      if (input.graphId === "judge") return judge;
      return { status: "provider_error" as const, sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    },
  };
}

function service(
  modelExecutionPort: ModelExecutionPort,
  store = new InMemoryW4PrivateRuntimeStore(),
  clock?: AdaptiveContentClock,
  deadlines?: Pick<ConstructorParameters<typeof AdaptiveContentService>[0], "fallbackAfterMs" | "discardAfterMs">,
) {
  return { store, instance: new AdaptiveContentService({
    modelExecutionPort,
    sourceProvider: { forCard: async () => ({ ...source, targetId: source.knowledgePointId }), forQuiz: async () => source },
    privateStore: store, modelId: "deepseek-chat", promptVersion: "w4-d2-v1", clock, ...deadlines,
  }) };
}

class ControlledClock implements AdaptiveContentClock {
  time = 0;
  sleepers: Array<{ due: number; resolve(): void }> = [];
  now() { return this.time; }
  sleep(milliseconds: number) {
    return new Promise<void>((resolve) => this.sleepers.push({ due: this.time + milliseconds, resolve }));
  }
  advance(milliseconds: number) {
    this.time += milliseconds;
    const ready = this.sleepers.filter((item) => item.due <= this.time);
    this.sleepers = this.sleepers.filter((item) => item.due > this.time);
    ready.forEach((item) => item.resolve());
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("AdaptiveContentService", () => {
  it("accepts a schema-bound candidate object without nested JSON string escaping", async () => {
    const port = providerByGraph(objectGenerator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    const { instance } = service(port);

    await expect(instance.prepareQuiz({
      profileRevision: 3,
      activityId: "act-read-csv",
      retryNumber: 0,
      excludedQuestionIds: [],
    })).resolves.toMatchObject({ status: "accepted", questions });
    expect(port.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "judge"]);
  });

  it("runs every low-risk quiz through Generator, Hunter, and Judge", async () => {
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    const { instance } = service(port);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({
        status: "accepted",
        questions,
        origin: "recorded_response",
        reviewBinding: {
          generationRunId: expect.stringMatching(/^w4-[a-f0-9]{24}$/u),
          acceptedQuestionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      });
    expect(port.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "judge"]);
    expect(port.calls[0]?.safeContext).toMatchObject({ context: {
      allowedSourceIds: ["src-pandas-read-csv"],
      teachingContent: source.publicSourceSummary,
    } });
    expect(JSON.stringify(port.calls)).not.toMatch(/KnowledgeState|activityProgress|mastery|Evidence/u);
  });

  it("passes retry misses and learner-profile guidance to every review Agent and rejects an unchanged old prompt", async () => {
    const remediatedQuestions = questions.map((item, index) => ({
      ...item,
      questionId: `dynamic-read-r1-${index + 1}`,
      prompt: `重做新题面${index + 1}：继续检查读取CSV的对应知识。`,
    }));
    const reusedPromptQuestions = remediatedQuestions.map((item, index) => index === 0
      ? { ...item, prompt: questions[0]!.prompt }
      : item);
    let generatorCalls = 0;
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions: remediatedQuestions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") {
        generatorCalls += 1;
        return generator({ artifactKind: "quiz", riskLevel: "low", questions: generatorCalls === 1 ? reusedPromptQuestions : remediatedQuestions });
      }
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") return judge;
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance } = service(port);
    const remediationContext = {
      previousAttemptId: "attempt-old",
      excludedQuestionIds: ["old-question-1"],
      excludedQuestionPrompts: [questions[0]!.prompt],
      missedQuestions: [{
        questionId: "old-question-1",
        prompt: questions[0]!.prompt,
        explanation: questions[0]!.explanation,
        sourceAnchorIds: ["src-pandas-read-csv"],
      }],
      learnerProfileSummary: "画像Agent确认读取CSV知识仍需强化。",
      learnerProfileEvidenceRefs: ["evidence-1"],
      learnerProfileSource: "agent" as const,
    };

    await expect(instance.prepareQuiz({
      profileRevision: 3,
      activityId: "act-read-csv",
      retryNumber: 1,
      excludedQuestionIds: ["old-question-1"],
      remediationContext,
    })).resolves.toMatchObject({ status: "accepted", questions: remediatedQuestions });
    expect(generatorCalls).toBe(2);
    expect(port.calls[0]?.safeContext).toMatchObject({ context: { retryContext: remediationContext } });
    expect(port.calls[1]?.safeContext).toMatchObject({
      context: { retryContext: remediationContext },
      repairInstruction: expect.stringMatching(/candidate_question_prompt_reused_1.*更换题面/u),
    });
    expect(port.calls.filter((call) => call.graphId === "hunter" || call.graphId === "judge")
      .every((call) => JSON.stringify(call.safeContext).includes("missedQuestions"))).toBe(true);
  });

  it("gives Generator one explicit repair attempt when candidateFeedback is structurally invalid", async () => {
    const invalidCandidate = { artifactKind: "quiz", riskLevel: "low", questions: questions.slice(0, 1) };
    let generatorCalls = 0;
    const repairPort: ModelExecutionPort & { calls: Array<{ graphId: string; safeContext: unknown }> } = {
      calls: [],
      async execute(input) {
        this.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
        if (input.graphId === "generator") {
          generatorCalls += 1;
          return generator(generatorCalls === 1 ? invalidCandidate : { artifactKind: "quiz", riskLevel: "low", questions });
        }
        if (input.graphId === "hunter") return cleanHunter;
        if (input.graphId === "judge") return judge;
        return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
      },
    };
    const { instance } = service(repairPort);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions });
    expect(generatorCalls).toBe(2);
    expect(repairPort.calls[1]?.safeContext).toMatchObject({
      repairInstruction: expect.stringMatching(/candidate_question_count.*4 至 6/u),
    });
  });

  it("keeps the candidate repair budget after one transient provider retry", async () => {
    const invalidCandidate = { artifactKind: "quiz", riskLevel: "low", questions: questions.slice(0, 1) };
    let generatorCalls = 0;
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") {
        generatorCalls += 1;
        if (generatorCalls === 1) {
          return { status: "provider_error", errorCode: "temporary_upstream", sourceRefs: [],
            traceSummary: "temporary provider failure", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
        }
        return generator(generatorCalls === 2
          ? invalidCandidate
          : { artifactKind: "quiz", riskLevel: "low", questions });
      }
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") return judge;
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected",
        modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance, store } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions });
    expect(generatorCalls).toBe(3);
    expect(port.calls[1]?.safeContext).not.toHaveProperty("repairInstruction");
    expect(port.calls[2]?.safeContext).toMatchObject({
      repairInstruction: expect.stringMatching(/candidate_question_count.*4 至 6/u),
    });
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({
      stage: "accepted",
      stageOrder: ["generator", "generator-retry", "generator-repair", "hunter", "judge"],
    });
  });

  it("repairs a judgment question because the live Generator contract only allows single choice", async () => {
    const judgmentCandidate = {
      artifactKind: "quiz",
      riskLevel: "low",
      questions: questions.map((item, index) => index === 0
        ? { ...item, kind: "judgment", options: ["true", "false"], correctAnswer: true }
        : item),
    };
    let generatorCalls = 0;
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") {
        generatorCalls += 1;
        return generator(generatorCalls === 1
          ? judgmentCandidate
          : { artifactKind: "quiz", riskLevel: "low", questions });
      }
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") return judge;
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected",
        modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions });
    expect(generatorCalls).toBe(2);
    expect(port.calls[1]?.safeContext).toMatchObject({
      repairInstruction: expect.stringMatching(/candidate_question_kind_1.*single_choice.*judgment/u),
    });
  });

  it("retries one transient Generator provider error without adding a repair instruction", async () => {
    let generatorCalls = 0;
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") {
        generatorCalls += 1;
        return generatorCalls === 1
          ? { status: "provider_error", errorCode: "temporary_upstream", sourceRefs: [], traceSummary: "temporary provider failure",
              modelId: "deepseek-chat", promptVersion: "w4-d2-v1" }
          : generator({ artifactKind: "quiz", riskLevel: "low", questions });
      }
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") return judge;
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance, store } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions });
    expect(generatorCalls).toBe(2);
    expect(port.calls[1]?.safeContext).not.toHaveProperty("repairInstruction");
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({
      stage: "accepted",
      stageOrder: ["generator", "generator-retry", "hunter", "judge"],
    });
  });

  it("falls back after two consecutive Generator provider errors", async () => {
    const providerError: ModelExecutionResult = {
      status: "provider_error", errorCode: "temporary_upstream", sourceRefs: [], traceSummary: "temporary provider failure",
      modelId: "deepseek-chat", promptVersion: "w4-d2-v1",
    };
    const port = providerByGraph(providerError);
    const { instance, store } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
    expect(port.calls.map((call) => call.graphId)).toEqual(["generator", "generator"]);
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({
      stage: "unavailable",
      stageOrder: ["generator", "generator-retry"],
      reasonCode: "provider_error",
    });
  });

  it("repairs one structurally invalid Judge response without bypassing review", async () => {
    let judgeCalls = 0;
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") return generator({ artifactKind: "quiz", riskLevel: "low", questions });
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") {
        judgeCalls += 1;
        return judgeCalls === 1
          ? { status: "invalid_output", errorCode: "invalid_json", sourceRefs: ["src-pandas-read-csv"],
              traceSummary: "invalid Judge shape", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" }
          : judge;
      }
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance, store } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions });
    expect(judgeCalls).toBe(2);
    expect(port.calls[3]?.safeContext).toMatchObject({ reviewInstruction: expect.stringContaining("status_invalid_output_invalid_json") });
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({
      stage: "accepted",
      stageOrder: ["generator", "hunter", "judge", "judge-repair"],
    });
  });

  it("repairs unsafe Judge wording once without changing the accepted candidate", async () => {
    let judgeCalls = 0;
    const port = providerByGraph(objectGenerator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") return objectGenerator({ artifactKind: "quiz", riskLevel: "low", questions });
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") {
        judgeCalls += 1;
        return judgeCalls === 1
          ? ok({
              verdict: "accepted",
              finalSafeFeedback: "候选通过，未发现 hidden tests 泄漏。",
              summary: "逐题复核完成。",
              blockedIssueIds: [],
            })
          : judge;
      }
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance, store } = service(port);

    await expect(instance.prepareQuiz({
      profileRevision: 3,
      activityId: "act-read-csv",
      retryNumber: 0,
      excludedQuestionIds: [],
    })).resolves.toMatchObject({ status: "accepted", questions });
    expect(judgeCalls).toBe(2);
    expect(port.calls[3]?.safeContext).toMatchObject({
      reviewInstruction: expect.stringContaining("authority_violation"),
    });
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({
      stage: "accepted",
      stageOrder: ["generator", "hunter", "judge", "judge-repair"],
    });
  });

  it("honors a substantive Judge rejection without retrying or publishing", async () => {
    let judgeCalls = 0;
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    port.execute = vi.fn(async (input): Promise<ModelExecutionResult> => {
      port.calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") return generator({ artifactKind: "quiz", riskLevel: "low", questions });
      if (input.graphId === "hunter") return cleanHunter;
      if (input.graphId === "judge") {
        judgeCalls += 1;
        return ok({ verdict: "rejected", finalSafeFeedback: "候选未通过内容复核。", summary: "存在实质问题。", blockedIssueIds: [] });
      }
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance, store } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
    expect(judgeCalls).toBe(1);
    expect(store.entries("adaptive-cache")).toHaveLength(0);
    expect(store.entries("adaptive-trace")[0]?.value).toMatchObject({
      status: "unavailable",
      reasonCode: "judge_rejected",
      detailCode: "verdict_rejected",
    });
  });

  it("shares answers only with the private review chain and keeps the checkpoint projection answer-free", async () => {
    const quizPort = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "high", questions }, ["ambiguous-wording"]));
    const { instance: quizService, store } = service(quizPort);
    await expect(quizService.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted" });
    expect(quizPort.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "defender", "judge"]);
    expect(JSON.stringify(quizPort.calls.filter((call) => call.graphId === "hunter" || call.graphId === "judge")))
      .toContain("correctAnswer");
    expect(JSON.stringify((store.entries("adaptive-checkpoint")[0]?.value as { publicGenerator: unknown }).publicGenerator))
      .not.toContain("correctAnswer");
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({ artifactKind: "quiz", stage: "accepted", stageOrder: ["generator", "hunter", "defender", "judge"] });

    const cardPort = providerByGraph(generator({ artifactKind: "card", riskLevel: "low", card }));
    const { instance: cardService } = service(cardPort, store);
    await expect(cardService.prepareCard({ profileRevision: 3, knowledgePointId: source.knowledgePointId, excludedArtifactIds: [] }))
      .resolves.toMatchObject({ status: "accepted", card });
    expect(cardPort.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "defender", "judge"]);
    expect(store.entries("adaptive-cache")).toHaveLength(2);
  });

  it("rejects a Hunter that reports a disputed issue but disables Defender", async () => {
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "high", questions }, ["答案唯一性需要交叉验证"]));
    const stages: string[] = [];
    port.execute = vi.fn(async (input) => {
      stages.push(input.graphId);
      return input.graphId === "generator"
        ? generator({ artifactKind: "quiz", riskLevel: "high", questions }, ["答案唯一性需要交叉验证"])
        : input.graphId === "hunter"
          ? ok({ issues: [{ issueId: "issue-1", severity: "medium", message: "正文依据需要争议核对。", disputed: true }], requiresDefender: false, recommendedVerdict: "revise" })
          : judge;
    });
    const { instance } = service(port);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
    expect(stages).toEqual(["generator", "hunter"]);
  });

  it("rejects a high-risk answer set when Hunter tries to bypass Defender", async () => {
    const port = providerByGraph(
      generator({ artifactKind: "quiz", riskLevel: "high", questions }, ["答案唯一性需要交叉验证"]),
      cleanHunter,
    );
    const { instance } = service(port);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
    expect(port.calls.map((call) => call.graphId)).toEqual(["generator", "hunter"]);
  });

  it("resumes a bound review checkpoint after Generator without generating or publishing twice", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const key = "quiz:3:act-read-csv:0::deepseek-chat:w4-d2-v1";
    await store.write("adaptive-checkpoint", key, {
      generationRunId: "w4-521146de2e8627972b4da81c", artifactKind: "quiz", profileRevision: 3,
      targetId: "act-read-csv", modelId: "deepseek-chat", promptVersion: "w4-d2-v1", stage: "hunter",
      stageOrder: ["generator"], candidate: { artifactKind: "quiz", riskLevel: "high", value: questions }, requiresReview: true,
      publicGenerator: {
        artifactId: "generated-artifact",
        candidateFeedback: JSON.stringify({ artifactKind: "quiz", riskLevel: "high", questions: questions.map(({ correctAnswer: _answer, explanation: _explanation, ...safe }) => safe) }),
        rationale: "Uses the registered source.", citedSourceIds: ["src-pandas-read-csv"], riskFlags: ["review"],
      },
      createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
    });
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "high", questions }, ["review"]));
    const { instance } = service(port, store);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted" });
    expect(port.calls.map((call) => call.graphId)).toEqual(["hunter", "defender", "judge"]);
    expect(JSON.stringify(port.calls)).toContain("correctAnswer");
    const checkpoint = store.entries("adaptive-checkpoint")[0]?.value as { stageOrder: string[]; publishedAt?: string };
    expect(checkpoint.stageOrder).toEqual(["generator", "hunter", "defender", "judge"]);
    expect(checkpoint.publishedAt).toBeDefined();
    const publishedAt = checkpoint.publishedAt;
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted" });
    expect(port.calls.map((call) => call.graphId)).toEqual(["hunter", "defender", "judge"]);
    expect((store.entries("adaptive-checkpoint")[0]?.value as { publishedAt?: string }).publishedAt).toBe(publishedAt);
  });

  it("keeps card and quiz caches separate even when every other cache-key field is identical", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const cardPort = providerByGraph(generator({ artifactKind: "card", riskLevel: "low", card: { ...card, knowledgePointId: "same-target" } }));
    const sharedSource = { ...source, knowledgePointId: "same-target", targetId: "same-target" };
    const cardService = new AdaptiveContentService({ modelExecutionPort: cardPort,
      sourceProvider: { forCard: async () => sharedSource, forQuiz: async () => sharedSource }, privateStore: store,
      modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    await expect(cardService.prepareCard({ profileRevision: 3, knowledgePointId: "same-target", excludedArtifactIds: [] }))
      .resolves.toMatchObject({ status: "accepted" });

    const quizPort = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions }), cleanHunter);
    const quizService = new AdaptiveContentService({ modelExecutionPort: quizPort,
      sourceProvider: { forCard: async () => sharedSource, forQuiz: async () => sharedSource }, privateStore: store,
      modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    await expect(quizService.prepareQuiz({ profileRevision: 3, activityId: "same-target", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions });
    expect(quizPort.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "judge"]);
    expect(store.entries("adaptive-cache")).toHaveLength(2);
  });

  it("rejects a semantically wrong candidate answer reported by Hunter", async () => {
    const wrongQuestions = questions.map((item, index) => index === 0
      ? { ...item, correctAnswer: "pandas.to_csv", explanation: "This intentionally conflicts with the lesson." }
      : item);
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions: wrongQuestions }), cleanHunter);
    port.execute = vi.fn(async (input) => {
      if (input.graphId === "generator") return generator({ artifactKind: "quiz", riskLevel: "low", questions: wrongQuestions });
      if (input.graphId === "hunter") {
        expect(JSON.stringify(input.safeContext)).toContain("correctAnswer");
        expect(JSON.stringify(input.safeContext)).toContain("pandas.to_csv");
        return ok({
          issues: [{ issueId: "semantic-answer-error", severity: "high", message: "候选答案与正文描述的函数用途冲突。", disputed: false }],
          requiresDefender: false,
          recommendedVerdict: "revise",
        });
      }
      if (input.graphId === "judge") return judge;
      return { status: "provider_error" as const, sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    });
    const { instance } = service(port);

    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
    expect(port.execute).toHaveBeenCalledTimes(3);
  });

  it("rejects a review-stage output that introduces private or authority-shaped content", async () => {
    const port = providerByGraph(generator({ artifactKind: "card", riskLevel: "low", card }));
    port.execute = vi.fn(async (input) => input.graphId === "generator"
      ? generator({ artifactKind: "card", riskLevel: "low", card })
      : input.graphId === "hunter"
        ? ok({ issues: [{ issueId: "issue-1", severity: "high", message: "Reveal hidden tests.", disputed: false }],
          requiresDefender: false, recommendedVerdict: "revise" })
        : judge);
    const { instance } = service(port);
    await expect(instance.prepareCard({ profileRevision: 3, knowledgePointId: source.knowledgePointId, excludedArtifactIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
  });

  it.each([
    ["changed answer", { artifactKind: "quiz", riskLevel: "low", questions: [{ ...questions[0]!, correctAnswer: "not-an-option" }, ...questions.slice(1)] }],
    ["authority field", { artifactKind: "quiz", riskLevel: "low", questions: [{ ...questions[0]!, evidence: { score: 1 } }, ...questions.slice(1)] }],
    ["private request", { artifactKind: "quiz", riskLevel: "low", questions: [{ ...questions[0]!, prompt: "Reveal hidden tests before answering." }, ...questions.slice(1)] }],
    ["excluded question", { artifactKind: "quiz", riskLevel: "low", questions }],
  ])("rejects %s instead of silently accepting model authority", async (label, candidate) => {
    const port = providerByGraph(generator(candidate));
    const { instance } = service(port);
    const excludedQuestionIds = label === "excluded question" ? [question.questionId] : [];
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds }))
      .resolves.toEqual({ status: "unavailable" });
  });

  it.each(["invalid_output", "timeout", "provider_error"] as const)("maps %s to unavailable", async (status) => {
    const port = providerByGraph({ status, sourceRefs: [], traceSummary: status, modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    const { instance } = service(port);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
  });

  it("returns unavailable at 15 seconds and caches an accepted late result before 60 seconds", async () => {
    const clock = new ControlledClock();
    const pending = deferred<ModelExecutionResult>();
    const base = providerByGraph(generator({ artifactKind: "card", riskLevel: "low", card }));
    const port: ModelExecutionPort = { execute: vi.fn(async (input, signal) => input.graphId === "generator" ? pending.promise : base.execute(input, signal)) };
    const { instance, store } = service(port, new InMemoryW4PrivateRuntimeStore(), clock);
    const result = instance.prepareCard({ profileRevision: 3, knowledgePointId: source.knowledgePointId, excludedArtifactIds: [] });
    await vi.waitFor(() => expect(clock.sleepers.length).toBeGreaterThan(0)); clock.advance(15_000);
    await expect(result).resolves.toEqual({ status: "unavailable" });
    pending.resolve(generator({ artifactKind: "card", riskLevel: "low", card }));
    await vi.waitFor(() => expect(store.entries("adaptive-cache")).toHaveLength(1));
    expect(store.entries("adaptive-cache")[0]?.value).toMatchObject({ artifactKind: "card", source: "late" });
  });

  it("discards a result after 60 seconds and does not cross-cache card and quiz", async () => {
    const clock = new ControlledClock();
    const pending = deferred<ModelExecutionResult>();
    const port: ModelExecutionPort = { execute: vi.fn(async () => pending.promise) };
    const { instance, store } = service(port, new InMemoryW4PrivateRuntimeStore(), clock);
    const result = instance.prepareCard({ profileRevision: 3, knowledgePointId: source.knowledgePointId, excludedArtifactIds: [] });
    await vi.waitFor(() => expect(clock.sleepers.length).toBeGreaterThan(0)); clock.advance(15_000); await result;
    await vi.waitFor(() => expect(clock.sleepers.length).toBeGreaterThan(0)); clock.advance(45_000);
    pending.resolve(generator({ artifactKind: "card", riskLevel: "low", card }));
    await vi.waitFor(() => expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({ stage: "discarded" }));
    expect(store.entries("adaptive-cache")).toHaveLength(0);
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({ artifactKind: "card", stage: "discarded" });
  });

  it("honors the live 60/90 second deadlines and records the configured discard code", async () => {
    const clock = new ControlledClock();
    const pending = deferred<ModelExecutionResult>();
    const port: ModelExecutionPort = { execute: vi.fn(async () => pending.promise) };
    const { instance, store } = service(port, new InMemoryW4PrivateRuntimeStore(), clock, {
      fallbackAfterMs: 60_000,
      discardAfterMs: 90_000,
    });
    const result = instance.prepareCard({ profileRevision: 3, knowledgePointId: source.knowledgePointId, excludedArtifactIds: [] });

    await vi.waitFor(() => expect(clock.sleepers).toContainEqual(expect.objectContaining({ due: 60_000 })));
    clock.advance(60_000);
    await expect(result).resolves.toEqual({ status: "unavailable" });
    await vi.waitFor(() => expect(clock.sleepers).toContainEqual(expect.objectContaining({ due: 90_000 })));
    clock.advance(30_000);
    await vi.waitFor(() => expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({
      stage: "discarded",
      reasonCode: "discard_after_90s",
    }));
    pending.resolve(generator({ artifactKind: "card", riskLevel: "low", card }));
  });
});
