import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InMemoryReviewCheckpointStore,
  ReviewOrchestrator,
  buildSafeReviewContext,
  type ReviewAttemptRecord,
  type ReviewOrchestratorInput,
  type ReviewRunCheckpoint,
  type ReviewSafeSourceProvider,
  type ReviewStageCheckpoint,
} from "../../../src/application/review-orchestrator.js";
import type {
  GeneratorOutput,
  HunterOutput,
  ReviewGraphId,
} from "../../../src/graphs/v2-learning-graphs.js";
import {
  RecordedModelExecutionAdapter,
  loadRecordedModelResponseFixtures,
} from "../../../src/infrastructure/model-execution-port.js";

const here = dirname(fileURLToPath(import.meta.url));
const EXPECTED_MODEL_ID = "deepseek-chat";
const PROMPT_VERSION = "w2-d4-v1";
const RUN_ID = "w2-d4-judge-version-conflict";

const projection = {
  sourceIds: ["source-public-1"],
  sourceSummary: "Only registered public material may be cited.",
};

const sourceProvider: ReviewSafeSourceProvider = {
  async getProjection() {
    return { sourceIds: [...projection.sourceIds], sourceSummary: projection.sourceSummary };
  },
};

function input(): ReviewOrchestratorInput {
  return {
    requestId: "request-d-fixture",
    attemptId: "attempt-d-fixture",
    runId: RUN_ID,
    profileRevision: 2,
    modelId: EXPECTED_MODEL_ID,
    promptVersion: PROMPT_VERSION,
    activity: {
      activityId: "activity-public-1",
      activityVersion: 1,
      kind: "code_completion",
      title: "Public fixture activity",
      primaryKnowledgePointId: "kp-public-1",
      supportingKnowledgePointIds: [],
    },
    currentResult: { safeFeedback: "A pre-reviewed public activity remains available." },
  };
}

function stage<Output>(
  reviewInput: ReviewOrchestratorInput,
  graphId: ReviewGraphId,
  output: Output,
): ReviewStageCheckpoint<Output> {
  const { inputSummaryHash } = buildSafeReviewContext(reviewInput, projection);
  return {
    graphId,
    attempts: 1,
    status: "ok",
    runId: reviewInput.runId,
    modelRunId: `${reviewInput.runId}.${graphId}.1`,
    profileRevision: reviewInput.profileRevision,
    inputSummaryHash,
    modelId: reviewInput.modelId,
    promptVersion: reviewInput.promptVersion,
    sourceRefs: ["source-public-1"],
    traceSummary: `${graphId} preloaded public checkpoint`,
    completedAt: "2026-08-01T00:00:00.000Z",
    output,
  };
}

function successfulAttempt(checkpoint: ReviewStageCheckpoint): ReviewAttemptRecord {
  return {
    graphId: checkpoint.graphId,
    attempt: checkpoint.attempts,
    modelRunId: checkpoint.modelRunId,
    status: "ok",
    modelId: checkpoint.modelId,
    promptVersion: checkpoint.promptVersion,
    traceSummary: checkpoint.traceSummary,
    completedAt: checkpoint.completedAt,
  };
}

describe("W2 D recorded response correction", () => {
  it("loads through the formal port and lets ReviewOrchestrator own version_conflict", async () => {
    const raw = await readFile(resolve(here, "recorded-responses.json"), "utf8");
    const fixtures = loadRecordedModelResponseFixtures(raw);
    const corrected = fixtures.find(({ runId }) => runId === RUN_ID);

    expect(corrected).toMatchObject({
      graphId: "judge",
      status: "ok",
      modelId: "stale-deepseek-chat",
      promptVersion: PROMPT_VERSION,
    });
    expect(corrected?.errorCode).toBeUndefined();

    const reviewInput = input();
    const generator = stage<GeneratorOutput>(reviewInput, "generator", {
      artifactId: "artifact-public-1",
      candidateFeedback: "Use the registered public summary.",
      rationale: "Uses only registered public material.",
      citedSourceIds: ["source-public-1"],
      riskFlags: [],
    });
    const hunter = stage<HunterOutput>(reviewInput, "hunter", {
      issues: [],
      requiresDefender: false,
      recommendedVerdict: "accepted",
    });
    const { inputBindingHash, inputSummaryHash } = buildSafeReviewContext(reviewInput, projection);
    const checkpoint: ReviewRunCheckpoint = {
      runId: reviewInput.runId,
      requestId: reviewInput.requestId,
      attemptId: reviewInput.attemptId,
      profileRevision: reviewInput.profileRevision,
      inputBindingHash,
      inputSummaryHash,
      modelId: reviewInput.modelId,
      promptVersion: reviewInput.promptVersion,
      redactions: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      stageAttempts: {
        generator: [successfulAttempt(generator)],
        hunter: [successfulAttempt(hunter)],
      },
      generator,
      hunter,
    };
    const checkpointStore = new InMemoryReviewCheckpointStore();
    await checkpointStore.save(checkpoint);
    const adapter = new RecordedModelExecutionAdapter({ fixtures, defaultModelId: EXPECTED_MODEL_ID });
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      checkpointStore,
      maxAttemptsPerRole: 1,
    });

    const result = await orchestrator.run(reviewInput, new AbortController().signal);
    const saved = await checkpointStore.load(RUN_ID);

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "version_conflict",
      usedFallback: false,
    });
    expect(adapter.history.map(({ input: call }) => call.graphId)).toEqual(["judge"]);
    expect(saved?.stageAttempts.judge).toMatchObject([
      { status: "ok", errorCode: "version_conflict", modelId: EXPECTED_MODEL_ID, promptVersion: PROMPT_VERSION },
    ]);
  });
});
