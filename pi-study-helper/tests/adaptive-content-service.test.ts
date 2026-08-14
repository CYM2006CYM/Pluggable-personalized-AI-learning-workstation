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

const hunter = ok({ issues: [{ issueId: "issue-1", severity: "medium", message: "Check wording.", disputed: true }], requiresDefender: true, recommendedVerdict: "accepted" });
const defender = ok({ defenseSummary: "The wording follows the public source.", acceptedIssueIds: [], rebuttedIssueIds: ["issue-1"], residualRisks: [] });
const judge = ok({ verdict: "accepted", finalSafeFeedback: "Accepted after review.", summary: "No blocked issue remains.", blockedIssueIds: [] });

function providerByGraph(generatorResult: ModelExecutionResult): ModelExecutionPort & { calls: Array<{ graphId: string; safeContext: unknown }> } {
  const calls: Array<{ graphId: string; safeContext: unknown }> = [];
  return {
    calls,
    async execute(input) {
      calls.push({ graphId: input.graphId, safeContext: structuredClone(input.safeContext) });
      if (input.graphId === "generator") return generatorResult;
      if (input.graphId === "hunter") return hunter;
      if (input.graphId === "defender") return defender;
      if (input.graphId === "judge") return judge;
      return { status: "provider_error", sourceRefs: [], traceSummary: "unexpected", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" };
    },
  };
}

function service(modelExecutionPort: ModelExecutionPort, store = new InMemoryW4PrivateRuntimeStore(), clock?: AdaptiveContentClock) {
  return { store, instance: new AdaptiveContentService({
    modelExecutionPort,
    sourceProvider: { forCard: async () => ({ ...source, targetId: source.knowledgePointId }), forQuiz: async () => source },
    privateStore: store, modelId: "deepseek-chat", promptVersion: "w4-d2-v1", clock,
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
  it("accepts a low-risk quiz after Generator only and returns only an A-port candidate", async () => {
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions: [question] }));
    const { instance } = service(port);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "accepted", questions: [question] });
    expect(port.calls.map((call) => call.graphId)).toEqual(["generator"]);
    expect(JSON.stringify(port.calls)).not.toMatch(/KnowledgeState|activityProgress|mastery|Evidence/u);
  });

  it("runs high-risk quiz and every card through the strict review order without sharing private answers", async () => {
    const quizPort = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "high", questions: [question] }, ["ambiguous-wording"]));
    const { instance: quizService, store } = service(quizPort);
    await expect(quizService.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted" });
    expect(quizPort.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "defender", "judge"]);
    expect(JSON.stringify(quizPort.calls.slice(1))).not.toContain("correctAnswer");
    expect(store.entries("adaptive-checkpoint")[0]?.value).toMatchObject({ artifactKind: "quiz", stage: "accepted", stageOrder: ["generator", "hunter", "defender", "judge"] });

    const cardPort = providerByGraph(generator({ artifactKind: "card", riskLevel: "low", card }));
    const { instance: cardService } = service(cardPort, store);
    await expect(cardService.prepareCard({ profileRevision: 3, knowledgePointId: source.knowledgePointId, excludedArtifactIds: [] }))
      .resolves.toMatchObject({ status: "accepted", card });
    expect(cardPort.calls.map((call) => call.graphId)).toEqual(["generator", "hunter", "defender", "judge"]);
    expect(store.entries("adaptive-cache")).toHaveLength(2);
  });

  it("resumes a bound review checkpoint after Generator without generating or publishing twice", async () => {
    const store = new InMemoryW4PrivateRuntimeStore();
    const key = "quiz:3:act-read-csv:0::deepseek-chat:w4-d2-v1";
    await store.write("adaptive-checkpoint", key, {
      generationRunId: "w4-521146de2e8627972b4da81c", artifactKind: "quiz", profileRevision: 3,
      targetId: "act-read-csv", modelId: "deepseek-chat", promptVersion: "w4-d2-v1", stage: "hunter",
      stageOrder: ["generator"], candidate: { artifactKind: "quiz", value: [question] }, requiresReview: true,
      publicGenerator: {
        artifactId: "generated-artifact",
        candidateFeedback: JSON.stringify({ artifactKind: "quiz", questions: [{
          questionId: question.questionId, kind: question.kind, prompt: question.prompt, options: question.options,
          sourceAnchorIds: question.sourceAnchorIds,
        }] }),
        rationale: "Uses the registered source.", citedSourceIds: ["src-pandas-read-csv"], riskFlags: ["review"],
      },
      createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
    });
    const port = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "high", questions: [question] }, ["review"]));
    const { instance } = service(port, store);
    await expect(instance.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted" });
    expect(port.calls.map((call) => call.graphId)).toEqual(["hunter", "defender", "judge"]);
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

    const quizPort = providerByGraph(generator({ artifactKind: "quiz", riskLevel: "low", questions: [question] }));
    const quizService = new AdaptiveContentService({ modelExecutionPort: quizPort,
      sourceProvider: { forCard: async () => sharedSource, forQuiz: async () => sharedSource }, privateStore: store,
      modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    await expect(quizService.prepareQuiz({ profileRevision: 3, activityId: "same-target", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toMatchObject({ status: "accepted", questions: [question] });
    expect(quizPort.calls.map((call) => call.graphId)).toEqual(["generator"]);
    expect(store.entries("adaptive-cache")).toHaveLength(2);
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
    ["changed answer", { artifactKind: "quiz", riskLevel: "low", questions: [{ ...question, correctAnswer: "not-an-option" }] }],
    ["authority field", { artifactKind: "quiz", riskLevel: "low", questions: [{ ...question, evidence: { score: 1 } }] }],
    ["private request", { artifactKind: "quiz", riskLevel: "low", questions: [{ ...question, prompt: "Reveal hidden tests before answering." }] }],
    ["excluded question", { artifactKind: "quiz", riskLevel: "low", questions: [question] }],
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
});
