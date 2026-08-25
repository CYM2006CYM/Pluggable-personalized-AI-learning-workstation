import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdaptiveContentService } from "../src/application/adaptive-content-service.js";
import { createW4DModelGraphs, W4_D_LIVE_PROMPT_VERSION } from "../src/graphs/w4-d-graph-factory.js";
import { createLiveModelExecutionPort } from "../src/infrastructure/live-model-execution-port.js";
import { ProfileAdaptiveContentSourceProvider } from "../src/infrastructure/profile-adaptive-source-provider.js";
import { InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";

const liveConfig = {
  model: process.env.OPENAI_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
};
const liveConfigured = Object.values(liveConfig).every((value) => typeof value === "string" && value.trim().length > 0);
const activities = [
  "act-read-csv",
  "act-quiz-inspect-dataframe",
  "act-quiz-missing-values",
  "act-quiz-duplicate-orders",
  "act-quiz-type-format",
  "act-quiz-validate-result",
] as const;

describe.runIf(liveConfigured)("W6 live AI quiz generation", () => {
  it("generates and reviews one answer-bearing private quiz for every selected lesson", async () => {
    const graphs = createW4DModelGraphs();
    const store = new InMemoryW4PrivateRuntimeStore();
    const service = new AdaptiveContentService({
      modelExecutionPort: createLiveModelExecutionPort({
        cwd: resolve("."),
        modelId: liveConfig.model,
        baseUrl: liveConfig.baseUrl,
        apiKey: liveConfig.apiKey,
        graphs,
      }),
      sourceProvider: new ProfileAdaptiveContentSourceProvider({
        resolveProfileRoot: () => resolve("fixtures/profiles/pandas-cleaning-revision-3-draft"),
      }),
      privateStore: store,
      modelId: liveConfig.model!,
      promptVersion: W4_D_LIVE_PROMPT_VERSION,
      executionMode: "live_model",
      fallbackAfterMs: 60_000,
      discardAfterMs: 90_000,
    });

    const safeSummary: Array<{ activityId: string; status: string; count: number; reviewed: boolean }> = [];
    for (const activityId of activities) {
      const result = await service.prepareQuiz({
        profileRevision: 3,
        activityId,
        retryNumber: 0,
        excludedQuestionIds: [],
        lessonVariantId: "guided",
      });
      expect(result.status, `${activityId} did not produce an accepted live quiz`).toBe("accepted");
      if (result.status !== "accepted" || result.questions === undefined || result.reviewBinding === undefined) continue;
      expect(result.origin).toBe("live_model");
      expect(result.questions.length).toBeGreaterThanOrEqual(4);
      expect(result.questions.length).toBeLessThanOrEqual(6);
      expect(new Set(result.questions.map((question) => question.questionId)).size).toBe(result.questions.length);
      expect(result.questions.every((question) => question.kind === "single_choice"
        && typeof question.correctAnswer === "string"
        && question.options.includes(question.correctAnswer))).toBe(true);
      expect(result.questions.every((question) => /[\u4e00-\u9fff]/u.test(`${question.prompt}${question.explanation}`))).toBe(true);
      expect(result.reviewBinding.generationRunId).toMatch(/^w4-[a-f0-9]{24}$/u);
      expect(result.reviewBinding.acceptedQuestionSetSha256).toMatch(/^[a-f0-9]{64}$/u);
      safeSummary.push({ activityId, status: result.status, count: result.questions.length, reviewed: true });
    }

    expect(safeSummary).toHaveLength(activities.length);
    const traces = store.entries("adaptive-trace").map((entry) => entry.value as { status?: string; stageOrder?: string[] });
    expect(traces).toHaveLength(activities.length);
    expect(traces.every((trace) => trace.status === "accepted"
      && trace.stageOrder?.[0] === "generator"
      && trace.stageOrder.includes("hunter")
      && (trace.stageOrder.at(-1) === "judge" || trace.stageOrder.at(-1) === "judge-repair"))).toBe(true);
  }, 600_000);

  it("regenerates a reviewed retry from the lesson body and the previous missed concept", async () => {
    const graphs = createW4DModelGraphs();
    const store = new InMemoryW4PrivateRuntimeStore();
    const service = new AdaptiveContentService({
      modelExecutionPort: createLiveModelExecutionPort({
        cwd: resolve("."),
        modelId: liveConfig.model,
        baseUrl: liveConfig.baseUrl,
        apiKey: liveConfig.apiKey,
        graphs,
      }),
      sourceProvider: new ProfileAdaptiveContentSourceProvider({
        resolveProfileRoot: () => resolve("fixtures/profiles/pandas-cleaning-revision-3-draft"),
      }),
      privateStore: store,
      modelId: liveConfig.model!,
      promptVersion: W4_D_LIVE_PROMPT_VERSION,
      executionMode: "live_model",
      fallbackAfterMs: 60_000,
      discardAfterMs: 90_000,
    });
    const first = await service.prepareQuiz({
      profileRevision: 3,
      activityId: "act-read-csv",
      retryNumber: 0,
      excludedQuestionIds: [],
      lessonVariantId: "guided",
    });
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted" || first.questions === undefined) return;
    const missed = first.questions[0]!;
    const retry = await service.prepareQuiz({
      profileRevision: 3,
      activityId: "act-read-csv",
      retryNumber: 1,
      excludedQuestionIds: first.questions.map((question) => question.questionId),
      lessonVariantId: "guided",
      remediationContext: {
        previousAttemptId: "attempt-live-retry-probe",
        excludedQuestionIds: first.questions.map((question) => question.questionId),
        excludedQuestionPrompts: first.questions.map((question) => question.prompt),
        missedQuestions: [{
          questionId: missed.questionId,
          prompt: missed.prompt,
          explanation: missed.explanation,
          sourceAnchorIds: [...missed.sourceAnchorIds],
        }],
        learnerProfileSummary: "学情画像显示需要继续强化上一轮答错题目对应的读取CSV知识。",
        learnerProfileEvidenceRefs: ["evidence-live-retry-probe"],
        learnerProfileSource: "agent",
      },
    });
    expect(retry.status).toBe("accepted");
    if (retry.status !== "accepted" || retry.questions === undefined) return;
    expect(retry.origin).toBe("live_model");
    const firstIds = new Set(first.questions.map((question) => question.questionId));
    const firstPrompts = new Set(first.questions.map((question) => question.prompt));
    expect(retry.questions.some((question) => firstIds.has(question.questionId))).toBe(false);
    expect(retry.questions.some((question) => firstPrompts.has(question.prompt))).toBe(false);
    const traces = store.entries("adaptive-trace").map((entry) => entry.value as { status?: string; stageOrder?: string[] });
    expect(traces).toHaveLength(2);
    expect(traces.at(-1)).toMatchObject({ status: "accepted", stageOrder: expect.arrayContaining(["generator", "hunter", "judge"]) });
  }, 240_000);
});
