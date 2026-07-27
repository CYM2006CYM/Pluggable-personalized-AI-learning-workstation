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
} from "../src/application/review-orchestrator.js";
import type {
  DefenderOutput,
  GeneratorOutput,
  HunterOutput,
  JudgeOutput,
  ReviewGraphId,
} from "../src/graphs/v2-learning-graphs.js";
import {
  RecordedModelExecutionAdapter,
  loadRecordedModelResponseFixtures,
  type ModelExecutionPort,
  type RecordedModelResponseFixture,
} from "../src/infrastructure/model-execution-port.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");

const trustedProjection = {
  sourceIds: ["source-public-1"],
  sourceSummary: "Only safe profile material may be cited.",
};

const sourceProvider: ReviewSafeSourceProvider = {
  async getProjection() {
    return {
      sourceIds: [...trustedProjection.sourceIds],
      sourceSummary: trustedProjection.sourceSummary,
    };
  },
};

async function buildAdapter() {
  const raw = await readFile(resolve(projectRoot, "fixtures/model-responses/review-orchestrator.json"), "utf8");
  return new RecordedModelExecutionAdapter({
    fixtures: loadRecordedModelResponseFixtures(raw),
    defaultModelId: "fixture-model",
  });
}

function buildInlineAdapter(
  runId: string,
  overrides: {
    generatorPayload?: GeneratorOutput;
    generatorSourceRefs?: string[];
    generatorStatus?: "ok" | "provider_error";
    generatorTraceSummary?: string;
    hunterPayload?: HunterOutput;
    defenderPayload?: DefenderOutput;
    judgePayload?: JudgeOutput;
  } = {},
): RecordedModelExecutionAdapter {
  const fixtures: RecordedModelResponseFixture[] = [{
    runId,
    graphId: "generator",
    status: overrides.generatorStatus ?? "ok",
    payload: overrides.generatorPayload ?? generatorStageOutput,
    sourceRefs: overrides.generatorSourceRefs ?? ["source-public-1"],
    traceSummary: overrides.generatorTraceSummary ?? "generator inline fixture",
    modelId: "fixture-model",
    promptVersion: "review-v1",
  }];
  if ((overrides.generatorStatus ?? "ok") === "ok") {
    fixtures.push(
      {
        runId,
        graphId: "hunter",
        status: "ok",
        payload: overrides.hunterPayload ?? {
          issues: [],
          requiresDefender: false,
          recommendedVerdict: "accepted",
        },
        sourceRefs: ["source-public-1"],
        traceSummary: "hunter inline fixture",
        modelId: "fixture-model",
        promptVersion: "review-v1",
      },
      {
        runId,
        graphId: "judge",
        status: "ok",
        payload: overrides.judgePayload ?? judgeStageOutput,
        sourceRefs: ["source-public-1"],
        traceSummary: "judge inline fixture",
        modelId: "fixture-model",
        promptVersion: "review-v1",
      },
    );
    if (overrides.defenderPayload) {
      fixtures.splice(2, 0, {
        runId,
        graphId: "defender",
        status: "ok",
        payload: overrides.defenderPayload,
        sourceRefs: ["source-public-1"],
        traceSummary: "defender inline fixture",
        modelId: "fixture-model",
        promptVersion: "review-v1",
      });
    }
  }
  return new RecordedModelExecutionAdapter({ fixtures, defaultModelId: "fixture-model" });
}

function input(runId: string): ReviewOrchestratorInput {
  return {
    requestId: "request-1",
    attemptId: "attempt-1",
    runId,
    profileRevision: 1,
    modelId: "fixture-model",
    promptVersion: "review-v1",
    activity: {
      activityId: "activity-1",
      activityVersion: 1,
      kind: "code_completion",
      title: "Clean orders",
      primaryKnowledgePointId: "kp-1",
      supportingKnowledgePointIds: ["kp-2"],
    },
    currentResult: {
      safeFeedback: "Deterministic checks passed.",
    },
  };
}

function finalizedCheckpoint(checkpointInput: ReviewOrchestratorInput): ReviewRunCheckpoint {
  const checkpoint = checkpointWithStages(checkpointInput, "judge");
  return {
    ...checkpoint,
    finalStatus: "accepted",
    finalSafeFeedback: checkpointInput.currentResult.safeFeedback,
    finalSummary: "review accepted after deterministic validation",
    finalBlockedIssueIds: [],
    usedFallback: false,
    finalCause: "judge",
    finalizedAt: "2026-07-26T10:00:01.000Z",
  };
}

function successfulAttempt(stage: ReviewStageCheckpoint): ReviewAttemptRecord {
  return {
    graphId: stage.graphId,
    attempt: stage.attempts,
    modelRunId: stage.modelRunId,
    status: "ok",
    modelId: stage.modelId,
    promptVersion: stage.promptVersion,
    ...(stage.durationMs === undefined ? {} : { durationMs: stage.durationMs }),
    traceSummary: stage.traceSummary,
    completedAt: stage.completedAt,
  };
}

const generatorStageOutput: GeneratorOutput = {
  artifactId: "artifact-stage",
  candidateFeedback: "Stage feedback.",
  rationale: "Stage rationale.",
  citedSourceIds: ["source-public-1"],
  riskFlags: [],
};

const hunterStageOutput: HunterOutput = {
  issues: [{
    issueId: "issue-stage",
    severity: "medium",
    message: "Stage issue.",
    disputed: true,
  }],
  requiresDefender: true,
  recommendedVerdict: "revise",
};

const defenderStageOutput: DefenderOutput = {
  defenseSummary: "Stage defense.",
  acceptedIssueIds: ["issue-stage"],
  rebuttedIssueIds: [],
  residualRisks: [],
};

const judgeStageOutput: JudgeOutput = {
  verdict: "accepted",
  finalSafeFeedback: "Stage accepted feedback.",
  summary: "Stage accepted summary.",
  blockedIssueIds: [],
};

function stageCheckpoint<Output>(
  checkpointInput: ReviewOrchestratorInput,
  graphId: ReviewGraphId,
  output: Output,
): ReviewStageCheckpoint<Output> {
  const { inputSummaryHash } = buildSafeReviewContext(checkpointInput, trustedProjection);
  return {
    graphId,
    attempts: 1,
    status: "ok",
    runId: checkpointInput.runId,
    modelRunId: `${checkpointInput.runId}.${graphId}.1`,
    profileRevision: checkpointInput.profileRevision,
    inputSummaryHash,
    modelId: checkpointInput.modelId,
    promptVersion: checkpointInput.promptVersion,
    sourceRefs: ["source-public-1"],
    traceSummary: `${graphId} stage fixture`,
    completedAt: "2026-07-26T10:00:01.000Z",
    output: JSON.parse(JSON.stringify(output)) as Output,
  };
}

function checkpointWithStages(
  checkpointInput: ReviewOrchestratorInput,
  targetStage: ReviewGraphId,
): ReviewRunCheckpoint {
  const { inputBindingHash, inputSummaryHash } = buildSafeReviewContext(checkpointInput, trustedProjection);
  const checkpoint: ReviewRunCheckpoint = {
    runId: checkpointInput.runId,
    requestId: checkpointInput.requestId,
    attemptId: checkpointInput.attemptId,
    profileRevision: checkpointInput.profileRevision,
    inputBindingHash,
    inputSummaryHash,
    modelId: checkpointInput.modelId,
    promptVersion: checkpointInput.promptVersion,
    redactions: [],
    createdAt: "2026-07-26T10:00:00.000Z",
    stageAttempts: {},
  };

  if (targetStage !== "generator") {
    checkpoint.generator = stageCheckpoint(checkpointInput, "generator", generatorStageOutput);
  }
  if (targetStage === "defender" || targetStage === "judge") {
    checkpoint.hunter = stageCheckpoint(checkpointInput, "hunter", hunterStageOutput);
  } else if (targetStage === "hunter") {
    checkpoint.hunter = stageCheckpoint(checkpointInput, "hunter", hunterStageOutput);
  }
  if (targetStage === "judge") {
    checkpoint.defender = stageCheckpoint(checkpointInput, "defender", defenderStageOutput);
  }

  if (targetStage === "generator") {
    checkpoint.generator = stageCheckpoint(checkpointInput, "generator", generatorStageOutput);
  } else if (targetStage === "hunter") {
    checkpoint.hunter = stageCheckpoint(checkpointInput, "hunter", hunterStageOutput);
  } else if (targetStage === "defender") {
    checkpoint.defender = stageCheckpoint(checkpointInput, "defender", defenderStageOutput);
  } else {
    checkpoint.judge = stageCheckpoint(checkpointInput, "judge", judgeStageOutput);
  }

  for (const graphId of ["generator", "hunter", "defender", "judge"] as const) {
    const stage = checkpoint[graphId];
    if (stage) checkpoint.stageAttempts[graphId] = [successfulAttempt(stage)];
  }

  return checkpoint;
}

type StageBindingField = "graphId" | "runId" | "modelRunId" | "profileRevision" | "inputSummaryHash" | "modelId" | "promptVersion";
type StageBindingMutation = (stage: ReviewStageCheckpoint) => void;

const stageBindingCases: Array<[ReviewGraphId, StageBindingField, StageBindingMutation]> = [];
for (const graphId of ["generator", "hunter", "defender", "judge"] as const) {
  stageBindingCases.push(
    [graphId, "graphId", (stage) => { stage.graphId = graphId === "judge" ? "generator" : "judge"; }],
    [graphId, "runId", (stage) => { stage.runId = "stale-run"; }],
    [graphId, "modelRunId", (stage) => { stage.modelRunId = "stale-model-run"; }],
    [graphId, "profileRevision", (stage) => { stage.profileRevision += 1; }],
    [graphId, "inputSummaryHash", (stage) => { stage.inputSummaryHash = "sha256:stale"; }],
    [graphId, "modelId", (stage) => { stage.modelId = "stale-model"; }],
    [graphId, "promptVersion", (stage) => { stage.promptVersion = "review-stale"; }],
  );
}

const stageIntegrityCases: Array<[ReviewGraphId, "invalid_json" | "source_conflict", StageBindingMutation]> = [];
for (const graphId of ["generator", "hunter", "defender", "judge"] as const) {
  stageIntegrityCases.push(
    [graphId, "invalid_json", (stage) => { stage.output = { invalid: true }; }],
    [graphId, "source_conflict", (stage) => { stage.sourceRefs = ["source-private"]; }],
  );
}

describe("ReviewOrchestrator", () => {
  it("runs the normal serial chain without Defender", async () => {
    const adapter = await buildAdapter();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

    const result = await orchestrator.run(input("review-normal"), new AbortController().signal);

    expect(result).toEqual({
      status: "accepted",
      finalSafeFeedback: "Deterministic checks passed.",
      summary: "review accepted after deterministic validation",
      blockedIssueIds: [],
      usedFallback: false,
    });
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(["generator", "hunter", "judge"]);
    expect(JSON.stringify(adapter.history.map((entry) => entry.input.safeContext))).not.toContain("def clean_orders(df): return df");
    expect(JSON.stringify(adapter.history.map((entry) => entry.input.safeContext))).not.toContain("private-case");
  });

  it("runs Defender only when Hunter marks a dispute", async () => {
    const adapter = await buildAdapter();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

    const result = await orchestrator.run(input("review-dispute"), new AbortController().signal);

    expect(result).toMatchObject({
      status: "accepted",
      finalSafeFeedback: "Deterministic checks passed.",
      usedFallback: false,
    });
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(["generator", "hunter", "defender", "judge"]);
  });

  it("retries a timed-out role once and then succeeds", async () => {
    const adapter = await buildAdapter();
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      maxAttemptsPerRole: 2,
    });

    const result = await orchestrator.run(input("review-retry"), new AbortController().signal);

    expect(result).toMatchObject({
      status: "accepted",
      finalSafeFeedback: "Deterministic checks passed.",
      usedFallback: false,
    });
    expect(adapter.history.map((entry) => `${entry.input.runId}:${entry.input.graphId}`)).toEqual([
      "review-retry.generator.1:generator",
      "review-retry.generator.2:generator",
      "review-retry.hunter.1:hunter",
      "review-retry.judge.1:judge",
    ]);
  });

  it("falls back to deterministic safeFeedback after repeated provider failure", async () => {
    const adapter = await buildAdapter();
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      maxAttemptsPerRole: 2,
    });

    const result = await orchestrator.run(input("review-fallback"), new AbortController().signal);

    expect(result).toMatchObject({
      status: "fallback",
      finalSafeFeedback: "Deterministic checks passed.",
      usedFallback: true,
    });
    expect(result.summary).toContain("hunter");
  });

  it("resumes from a serializable checkpoint without rerunning completed stages", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const checkpointInput = input("review-checkpoint");
    const { inputBindingHash, inputSummaryHash } = buildSafeReviewContext(checkpointInput, trustedProjection);
    await store.save({
      runId: "review-checkpoint",
      requestId: "request-1",
      attemptId: "attempt-1",
      profileRevision: 1,
      inputBindingHash,
      inputSummaryHash,
      modelId: "fixture-model",
      promptVersion: "review-v1",
      redactions: [],
      createdAt: "2026-07-26T10:00:00.000Z",
      stageAttempts: {
        generator: [{
          graphId: "generator",
          attempt: 1,
          modelRunId: "review-checkpoint.generator.1",
          status: "ok",
          modelId: "fixture-model",
          promptVersion: "review-v1",
          traceSummary: "checkpointed generator",
          completedAt: "2026-07-26T10:00:01.000Z",
        }],
      },
      generator: {
        graphId: "generator",
        attempts: 1,
        status: "ok",
        runId: "review-checkpoint",
        modelRunId: "review-checkpoint.generator.1",
        profileRevision: 1,
        inputSummaryHash,
        modelId: "fixture-model",
        promptVersion: "review-v1",
        sourceRefs: ["source-public-1"],
        traceSummary: "checkpointed generator",
        completedAt: "2026-07-26T10:00:01.000Z",
        output: {
          artifactId: "artifact-checkpoint",
          candidateFeedback: "Checkpointed feedback.",
          rationale: "Saved generator output.",
          citedSourceIds: ["source-public-1"],
          riskFlags: [],
        },
      },
    });
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      checkpointStore: store,
    });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);
    const saved = await store.load("review-checkpoint");

    expect(result).toMatchObject({
      status: "accepted",
      finalSafeFeedback: "Deterministic checks passed.",
      usedFallback: false,
    });
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(["hunter", "judge"]);
    expect(JSON.stringify(result)).toContain("Deterministic checks passed.");
    expect(JSON.stringify(saved)).toContain("finalStatus");
  });

  it("fails fast when checkpoint binding does not match the current review input", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    await store.save({
      runId: "review-normal",
      requestId: "request-1",
      attemptId: "attempt-1",
      profileRevision: 99,
      inputBindingHash: `sha256:${"a".repeat(64)}`,
      inputSummaryHash: "sha256:mismatch",
      modelId: "fixture-model",
      promptVersion: "review-v1",
      redactions: [],
      createdAt: "2026-07-26T10:00:00.000Z",
      stageAttempts: {},
    });
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      checkpointStore: store,
    });
    const savedBeforeRun = await store.load("review-normal");

    const result = await orchestrator.run(input("review-normal"), new AbortController().signal);
    const savedAfterRun = await store.load("review-normal");

    expect(result).toMatchObject({
      status: "failed",
      finalSafeFeedback: "Deterministic checks passed.",
      usedFallback: false,
    });
    expect(result.summary).toContain("version_conflict");
    expect(adapter.history).toHaveLength(0);
    expect(savedAfterRun).toEqual(savedBeforeRun);
  });

  it("returns a finalized checkpoint only after its binding matches", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const checkpointInput = input("review-finalized");
    await store.save(finalizedCheckpoint(checkpointInput));
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      checkpointStore: store,
    });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result).toEqual({
      status: "accepted",
      finalSafeFeedback: "Deterministic checks passed.",
      summary: "review accepted after deterministic validation",
      blockedIssueIds: [],
      usedFallback: false,
    });
    expect(adapter.history).toHaveLength(0);
  });

  it.each([
    ["profileRevision", (checkpoint: ReviewRunCheckpoint) => { checkpoint.profileRevision += 1; }],
    ["inputSummaryHash", (checkpoint: ReviewRunCheckpoint) => { checkpoint.inputSummaryHash = "sha256:stale"; }],
    ["modelId", (checkpoint: ReviewRunCheckpoint) => { checkpoint.modelId = "stale-model"; }],
    ["promptVersion", (checkpoint: ReviewRunCheckpoint) => { checkpoint.promptVersion = "review-stale"; }],
  ])("rejects a finalized checkpoint with a mismatched %s without overwriting it", async (_field, mutate) => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const checkpointInput = input("review-finalized-conflict");
    const checkpoint = finalizedCheckpoint(checkpointInput);
    mutate(checkpoint);
    await store.save(checkpoint);
    const savedBeforeRun = await store.load(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      checkpointStore: store,
    });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);
    const savedAfterRun = await store.load(checkpointInput.runId);

    expect(result).toEqual({
      status: "failed",
      finalSafeFeedback: "Deterministic checks passed.",
      summary: "version_conflict: checkpoint binding does not match this review input",
      blockedIssueIds: [],
      usedFallback: false,
      errorCode: "version_conflict",
    });
    expect(adapter.history).toHaveLength(0);
    expect(savedAfterRun).toEqual(savedBeforeRun);
  });

  it.each(stageBindingCases)(
    "rejects a %s stage checkpoint with a mismatched %s without overwriting it",
    async (targetStage, _field, mutate) => {
      const adapter = await buildAdapter();
      const store = new InMemoryReviewCheckpointStore();
      const checkpointInput = input(`review-stage-${targetStage}`);
      const checkpoint = checkpointWithStages(checkpointInput, targetStage);
      const stage = checkpoint[targetStage];
      if (!stage) throw new Error(`missing ${targetStage} test checkpoint`);
      mutate(stage);
      await store.save(checkpoint);
      const savedBeforeRun = await store.load(checkpointInput.runId);
      const orchestrator = new ReviewOrchestrator({
        modelExecutionPort: adapter,
        sourceProvider,
        checkpointStore: store,
      });

      const result = await orchestrator.run(checkpointInput, new AbortController().signal);
      const savedAfterRun = await store.load(checkpointInput.runId);

      expect(result).toMatchObject({
        status: "failed",
        finalSafeFeedback: "Deterministic checks passed.",
        usedFallback: false,
      });
      expect(result.summary).toContain("version_conflict");
      expect(result.summary).toContain(targetStage);
      expect(adapter.history).toHaveLength(0);
      expect(savedAfterRun).toEqual(savedBeforeRun);
    },
  );

  it.each(stageIntegrityCases)(
    "rejects a %s stage checkpoint with %s integrity failure without overwriting it",
    async (targetStage, errorCode, mutate) => {
      const adapter = await buildAdapter();
      const store = new InMemoryReviewCheckpointStore();
      const checkpointInput = input(`review-stage-integrity-${targetStage}`);
      const checkpoint = checkpointWithStages(checkpointInput, targetStage);
      const stage = checkpoint[targetStage];
      if (!stage) throw new Error(`missing ${targetStage} test checkpoint`);
      mutate(stage);
      await store.save(checkpoint);
      const savedBeforeRun = await store.load(checkpointInput.runId);
      const orchestrator = new ReviewOrchestrator({
        modelExecutionPort: adapter,
        sourceProvider,
        checkpointStore: store,
      });

      const result = await orchestrator.run(checkpointInput, new AbortController().signal);
      const savedAfterRun = await store.load(checkpointInput.runId);

      expect(result).toMatchObject({
        status: "failed",
        finalSafeFeedback: "Deterministic checks passed.",
        usedFallback: false,
      });
      expect(result.summary).toContain(errorCode);
      expect(result.summary).toContain(targetStage);
      expect(adapter.history).toHaveLength(0);
      expect(savedAfterRun).toEqual(savedBeforeRun);
    },
  );

  it.each([
    ["orphan Hunter", (checkpoint: ReviewRunCheckpoint) => {
      delete checkpoint.generator;
      delete checkpoint.stageAttempts.generator;
    }],
    ["orphan Defender", (checkpoint: ReviewRunCheckpoint) => {
      delete checkpoint.generator;
      delete checkpoint.stageAttempts.generator;
    }],
    ["orphan Judge", (checkpoint: ReviewRunCheckpoint) => {
      delete checkpoint.generator;
      delete checkpoint.hunter;
      delete checkpoint.defender;
      delete checkpoint.stageAttempts.generator;
      delete checkpoint.stageAttempts.hunter;
      delete checkpoint.stageAttempts.defender;
    }],
    ["Judge without required Defender", (checkpoint: ReviewRunCheckpoint) => {
      delete checkpoint.defender;
      delete checkpoint.stageAttempts.defender;
    }],
  ] as const)("rejects non-prefix checkpoint topology: %s", async (_label, mutate) => {
    const checkpointInput = input(`review-topology-${_label.replaceAll(" ", "-")}`);
    const checkpoint = checkpointWithStages(
      checkpointInput,
      _label === "orphan Hunter" ? "hunter" : _label === "orphan Defender" ? "defender" : "judge",
    );
    mutate(checkpoint);
    const store = new InMemoryReviewCheckpointStore();
    await store.save(checkpoint);
    const before = await store.load(checkpointInput.runId);
    const adapter = buildInlineAdapter(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json", usedFallback: false });
    expect(adapter.history).toHaveLength(0);
    expect(await store.load(checkpointInput.runId)).toEqual(before);
  });

  it("rejects a Defender checkpoint when Hunter has no dispute", async () => {
    const checkpointInput = input("review-topology-unexpected-defender");
    const checkpoint = checkpointWithStages(checkpointInput, "defender");
    if (!checkpoint.hunter) throw new Error("missing hunter checkpoint");
    checkpoint.hunter.output = { issues: [], requiresDefender: false, recommendedVerdict: "accepted" };
    const store = new InMemoryReviewCheckpointStore();
    await store.save(checkpoint);
    const before = await store.load(checkpointInput.runId);
    const adapter = buildInlineAdapter(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
    expect(adapter.history).toHaveLength(0);
    expect(await store.load(checkpointInput.runId)).toEqual(before);
  });

  it.each([
    ["no-dispute", "hunter" as const, ["judge"]],
    ["dispute", "defender" as const, ["judge"]],
  ])("resumes a legal %s serial checkpoint prefix", async (label, targetStage, expectedCalls) => {
    const checkpointInput = input(`review-prefix-${label}`);
    const checkpoint = checkpointWithStages(checkpointInput, targetStage);
    if (label === "no-dispute" && checkpoint.hunter) {
      checkpoint.hunter.output = { issues: [], requiresDefender: false, recommendedVerdict: "accepted" };
    }
    const store = new InMemoryReviewCheckpointStore();
    await store.save(checkpoint);
    const adapter = buildInlineAdapter(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result.status, JSON.stringify(result)).toBe("accepted");
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(expectedCalls);
  });

  it("persists every retry attempt with a safe structured audit record", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const orchestrator = new ReviewOrchestrator({
      modelExecutionPort: adapter,
      sourceProvider,
      checkpointStore: store,
      maxAttemptsPerRole: 2,
    });

    const result = await orchestrator.run(input("review-retry"), new AbortController().signal);
    const saved = await store.load("review-retry");

    expect(result).toMatchObject({ status: "accepted", usedFallback: false });
    expect(saved?.stageAttempts.generator).toMatchObject([
      { attempt: 1, modelRunId: "review-retry.generator.1", status: "timeout", errorCode: "timeout", modelId: "fixture-model", promptVersion: "review-v1" },
      { attempt: 2, modelRunId: "review-retry.generator.2", status: "ok", modelId: "fixture-model", promptVersion: "review-v1" },
    ]);
    expect(JSON.stringify(saved)).not.toContain("C:\\Users\\");
  });

  it.each([
    ["review-refusal", "fallback", "refusal"],
    ["review-source-conflict-live", "fallback", "source_conflict"],
    ["review-version-conflict-live", "failed", "version_conflict"],
    ["review-invalid-output", "fallback", "invalid_json"],
  ] as const)("fails closed for recorded C.5 scenario %s", async (runId, status, errorCode) => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);
    const saved = await store.load(runId);

    expect(result).toMatchObject({ status, errorCode });
    expect(saved?.stageAttempts.generator).toHaveLength(1);
    expect(saved?.stageAttempts.generator?.[0]?.errorCode).toBe(errorCode);
  });

  it("uses fixed safe feedback when the recorded Judge rejects the candidate", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(input("review-judge-rejected"), new AbortController().signal);

    expect(result).toMatchObject({
      status: "failed",
      finalSafeFeedback: "Deterministic checks passed.",
      blockedIssueIds: ["issue-reject-1"],
      usedFallback: false,
    });
    expect(result.finalSafeFeedback).not.toContain("Candidate must not be published");
  });

  it.each([
    ["duplicate Hunter issue IDs", {
      hunterPayload: {
        issues: [
          { issueId: "issue-duplicate", severity: "low", message: "First issue.", disputed: false },
          { issueId: "issue-duplicate", severity: "medium", message: "Second issue.", disputed: false },
        ],
        requiresDefender: false,
        recommendedVerdict: "revise",
      } as HunterOutput,
    }],
    ["invalid Defender issue closure", {
      hunterPayload: hunterStageOutput,
      defenderPayload: { ...defenderStageOutput, rebuttedIssueIds: ["issue-stage"] } as DefenderOutput,
    }],
    ["unknown Judge blocked issue", {
      judgePayload: { ...judgeStageOutput, blockedIssueIds: ["issue-unknown"] } as JudgeOutput,
    }],
  ] as const)("rejects live role references with %s", async (_label, overrides) => {
    const runId = `review-role-reference-${_label.replaceAll(" ", "-")}`;
    const adapter = buildInlineAdapter(runId, overrides);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result).toMatchObject({ status: "fallback", errorCode: "invalid_json" });
  });

  it("rejects unknown Judge references restored from checkpoint without model calls", async () => {
    const checkpointInput = input("review-cached-judge-reference");
    const checkpoint = checkpointWithStages(checkpointInput, "judge");
    if (!checkpoint.judge) throw new Error("missing judge checkpoint");
    checkpoint.judge.output.blockedIssueIds = ["issue-unknown"];
    const store = new InMemoryReviewCheckpointStore();
    await store.save(checkpoint);
    const before = await store.load(checkpointInput.runId);
    const adapter = buildInlineAdapter(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
    expect(adapter.history).toHaveLength(0);
    expect(await store.load(checkpointInput.runId)).toEqual(before);
  });

  it("rejects complete Windows, UNC, and POSIX paths in trusted source text", () => {
    const pathInput = input("review-path-redaction");
    expect(() => buildSafeReviewContext(pathInput, {
      sourceIds: ["source-public-1"],
      sourceSummary: "Use C:\\Users\\FixtureUser\\private\\answer.py and \\\\fixture-server\\share\\hidden.txt plus /home/fixture-user/private/data.csv.",
    })).toThrow(/safety boundary/u);
  });

  it.each([0, -1, 1.5, 6, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid maxAttemptsPerRole value %s",
    async (maxAttemptsPerRole) => {
      const adapter = await buildAdapter();
      expect(() => new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole })).toThrow(RangeError);
    },
  );

  it("does not call the model when the signal is already aborted", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const controller = new AbortController();
    controller.abort();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 5 });

    await expect(orchestrator.run(input("review-normal"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.history).toHaveLength(0);
    expect(await store.load("review-normal")).toBeUndefined();
  });

  it("stops retrying when the signal is aborted after the first model call", async () => {
    const controller = new AbortController();
    const store = new InMemoryReviewCheckpointStore();
    let calls = 0;
    const modelExecutionPort: ModelExecutionPort = {
      execute: async (modelInput) => {
        calls += 1;
        controller.abort();
        return {
          status: "provider_error",
          errorCode: "provider_error",
          sourceRefs: [],
          traceSummary: "provider failed",
          modelId: "fixture-model",
          promptVersion: modelInput.promptVersion,
        };
      },
    };
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 5 });

    await expect(orchestrator.run(input("review-cancel-after-first"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    const checkpoint = await store.load("review-cancel-after-first");
    expect(checkpoint?.stageAttempts.generator).toBeUndefined();
    expect(checkpoint?.finalStatus).toBeUndefined();
  });

  it("propagates a port AbortError without fallback or failure checkpoint records", async () => {
    const store = new InMemoryReviewCheckpointStore();
    let calls = 0;
    const modelExecutionPort: ModelExecutionPort = {
      execute: async () => {
        calls += 1;
        const error = new Error("cancelled by SDK");
        error.name = "AbortError";
        throw error;
      },
    };
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort, sourceProvider, checkpointStore: store });

    await expect(orchestrator.run(input("review-port-abort"), new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    const checkpoint = await store.load("review-port-abort");
    expect(checkpoint?.stageAttempts.generator).toBeUndefined();
    expect(checkpoint?.finalStatus).toBeUndefined();
  });

  it("rejects Generator body citations outside the safe source allowlist", async () => {
    const runId = "review-generator-citation-conflict";
    const adapter = buildInlineAdapter(runId, {
      generatorPayload: { ...generatorStageOutput, citedSourceIds: ["source-private"] },
    });
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result.status).toBe("fallback");
    expect(result.summary).toContain("source_conflict");
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(["generator"]);
  });

  it("rejects model collections above the resource limit", async () => {
    const runId = "review-oversized-model-array";
    const adapter = buildInlineAdapter(runId, {
      generatorPayload: { ...generatorStageOutput, riskFlags: Array.from({ length: 65 }, (_, index) => `risk-${index}`) },
    });
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result).toMatchObject({ status: "fallback", errorCode: "invalid_json" });
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(["generator"]);
  });

  it("rejects over-limit live Judge output without exposing path text", async () => {
    const runId = "review-safe-judge-output";
    const adapter = buildInlineAdapter(runId, {
      judgePayload: {
        ...judgeStageOutput,
        finalSafeFeedback: "Inspect C:\\Users\\FixtureUser\\private\\answer.py and \\\\fixture-server\\share\\hidden.txt.",
        summary: "/home/fixture-user/private/data.csv " + "x".repeat(1000),
      },
    });
    const store = new InMemoryReviewCheckpointStore();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(input(runId), new AbortController().signal);
    const saved = await store.load(runId);

    expect(result.status, JSON.stringify(result)).toBe("fallback");
    expect(result.errorCode).toBe("invalid_json");
    expect(result.finalSafeFeedback).toBe("Deterministic checks passed.");
    expect(result.summary).toBe("invalid_json: judge review stage failed safely");
    for (const residue of ["FixtureUser", "answer.py", "fixture-server", "hidden.txt", "/home", "data.csv"]) {
      expect(JSON.stringify(result)).not.toContain(residue);
    }
    expect(saved?.redactions).toEqual(expect.arrayContaining(["hostPath", "truncatedText"]));
  });

  it("rejects forbidden sensitive text in live Judge output", async () => {
    const runId = "review-forbidden-judge-output";
    const adapter = buildInlineAdapter(runId, {
      judgePayload: {
        ...judgeStageOutput,
        summary: "Reference solution secret details.",
      },
    });
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result.status).toBe("fallback");
    expect(result.summary).toContain("invalid_json");
    expect(JSON.stringify(result)).not.toContain("secret details");
  });

  it("redacts every host path from provider traces before fallback and checkpoint storage", async () => {
    const runId = "review-unsafe-trace";
    const adapter = buildInlineAdapter(runId, {
      generatorStatus: "provider_error",
      generatorTraceSummary: "Failed at C:\\Users\\FixtureUser\\private\\answer.py and /home/fixture-user/private/data.csv.",
    });
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result.status).toBe("fallback");
    expect(result.summary).toBe("provider_error: generator review stage failed safely");
    for (const residue of ["FixtureUser", "answer.py", "/home", "data.csv"]) {
      expect(result.summary).not.toContain(residue);
    }
  });

  it("rejects unsafe finalized checkpoint text without overwriting it", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const checkpointInput = input("review-finalized-unsafe");
    const checkpoint = finalizedCheckpoint(checkpointInput);
    checkpoint.finalSummary = "Read C:\\Users\\FixtureUser\\private\\answer.py";
    await store.save(checkpoint);
    const savedBeforeRun = await store.load(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);
    const savedAfterRun = await store.load(checkpointInput.runId);

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("invalid_json");
    expect(adapter.history).toHaveLength(0);
    expect(savedAfterRun).toEqual(savedBeforeRun);
  });

  it("rejects unsafe stage output and unregistered cached Generator citations", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const unsafeInput = input("review-stage-output-unsafe");
    const unsafeCheckpoint = checkpointWithStages(unsafeInput, "generator");
    if (!unsafeCheckpoint.generator) throw new Error("missing generator checkpoint");
    unsafeCheckpoint.generator.output.candidateFeedback = "Read C:\\Users\\FixtureUser\\private\\answer.py";
    await store.save(unsafeCheckpoint);
    const unsafeBefore = await store.load(unsafeInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const unsafeResult = await orchestrator.run(unsafeInput, new AbortController().signal);
    expect(unsafeResult.summary).toContain("invalid_json");
    expect(await store.load(unsafeInput.runId)).toEqual(unsafeBefore);

    const citationInput = input("review-stage-citation-unsafe");
    const citationCheckpoint = checkpointWithStages(citationInput, "generator");
    if (!citationCheckpoint.generator) throw new Error("missing generator checkpoint");
    citationCheckpoint.generator.output.citedSourceIds = ["source-private"];
    await store.save(citationCheckpoint);
    const citationBefore = await store.load(citationInput.runId);

    const citationResult = await orchestrator.run(citationInput, new AbortController().signal);
    expect(citationResult.summary).toContain("source_conflict");
    expect(adapter.history).toHaveLength(0);
    expect(await store.load(citationInput.runId)).toEqual(citationBefore);
  });

  it.each(["pass", "partial", "learnerFailure", "evaluatorFailure", "cancelled"] as const)(
    "preserves C safeFeedback verbatim for the %s evaluator fixture",
    async (fixtureName) => {
      const raw = await readFile(resolve(projectRoot, "fixtures/evaluator-results/activity-results.json"), "utf8");
      const parsed = JSON.parse(raw) as { results: Record<string, { safeFeedback: string }> };
      const safeFeedback = parsed.results[fixtureName]?.safeFeedback;
      if (!safeFeedback) throw new Error(`missing C fixture ${fixtureName}`);
      const runId = `review-c-${fixtureName}`;
      const adapter = buildInlineAdapter(runId, {
        judgePayload: {
          ...judgeStageOutput,
          finalSafeFeedback: "Contradictory model feedback must not replace C.",
          summary: "Contradictory model summary.",
        },
      });
      const reviewInput = input(runId);
      reviewInput.currentResult.safeFeedback = safeFeedback;
      const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

      const result = await orchestrator.run(reviewInput, new AbortController().signal);
      const serializedModelInputs = JSON.stringify(adapter.history.map((entry) => entry.input.safeContext));

      expect(result.finalSafeFeedback).toBe(safeFeedback);
      expect(result.summary).toBe("review accepted after deterministic validation");
      expect(serializedModelInputs).toContain(safeFeedback);
      for (const forbidden of ["executionStatus", "verdict", "score", "errorKind", "errorCode", "submissionDigest", "starterCode"]) {
        expect(serializedModelInputs).not.toContain(forbidden);
      }
    },
  );

  it("rejects runtime injection of learner submission and C authority fields before any model call", async () => {
    const runId = "review-extra-input";
    const adapter = buildInlineAdapter(runId);
    const unsafeInput = {
      ...input(runId),
      learnerSubmission: "raw learner answer",
      currentResult: {
        safeFeedback: "C feedback.",
        verdict: "pass",
      },
    } as unknown as ReviewOrchestratorInput;
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

    const result = await orchestrator.run(unsafeInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
    expect(adapter.history).toHaveLength(0);
  });

  it.each([
    ["null input", null],
    ["missing currentResult", { ...input("review-invalid-input"), currentResult: undefined }],
    ["null currentResult", { ...input("review-invalid-input"), currentResult: null }],
    ["missing safeFeedback", { ...input("review-invalid-input"), currentResult: {} }],
    ["forged input binding", { ...input("review-invalid-input"), inputBindingHash: `sha256:${"a".repeat(64)}` }],
  ] as const)("rejects malformed private input before reading model fields: %s", async (_label, candidate) => {
    const runId = "review-invalid-input";
    const adapter = buildInlineAdapter(runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

    const result = await orchestrator.run(candidate as unknown as ReviewOrchestratorInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
    expect(adapter.history).toHaveLength(0);
  });

  it.each(["mcq", "code_completion", "coding_practical", "explain", "debug"] as const)(
    "accepts frozen ActivityKind %s",
    async (kind) => {
      const runId = `review-kind-${kind}`;
      const adapter = buildInlineAdapter(runId);
      const reviewInput = input(runId);
      reviewInput.activity.kind = kind;
      const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

      const result = await orchestrator.run(reviewInput, new AbortController().signal);

      expect(result.status).toBe("accepted");
    },
  );

  it("rejects an unknown ActivityKind and sensitive visible input before model execution", async () => {
    for (const [label, mutate] of [
      ["unknown kind", (value: ReviewOrchestratorInput) => { (value.activity as { kind: string }).kind = "essay"; }],
      ["sensitive feedback", (value: ReviewOrchestratorInput) => { value.currentResult.safeFeedback = "reference solution secret"; }],
      ["sensitive title", (value: ReviewOrchestratorInput) => { value.activity.title = "full rubric and hidden tests"; }],
    ] as const) {
      const runId = `review-sensitive-${label.replaceAll(" ", "-")}`;
      const reviewInput = input(runId);
      mutate(reviewInput);
      const adapter = buildInlineAdapter(runId);
      const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider });

      const result = await orchestrator.run(reviewInput, new AbortController().signal);

      expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
      expect(adapter.history).toHaveLength(0);
    }
  });

  it("converts provider rejection and malformed model results into safe persisted attempts", async () => {
    for (const mode of ["rejection", "malformed"] as const) {
      const runId = `review-model-${mode}`;
      const store = new InMemoryReviewCheckpointStore();
      const port: ModelExecutionPort = {
        async execute(modelInput) {
          if (mode === "rejection") throw new Error("provider payload must not escape");
          return { status: "unknown", sourceRefs: [], traceSummary: "bad", modelId: "fixture-model", promptVersion: modelInput.promptVersion } as never;
        },
      };
      const orchestrator = new ReviewOrchestrator({ modelExecutionPort: port, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 1 });

      const result = await orchestrator.run(input(runId), new AbortController().signal);
      const saved = await store.load(runId);

      expect(result).toMatchObject({ status: "fallback", errorCode: "provider_error" });
      expect(saved?.stageAttempts.generator?.[0]).toMatchObject({ status: "provider_error", errorCode: "provider_error", modelRunId: `${runId}.generator.1` });
      expect(JSON.stringify(saved)).not.toContain("provider payload must not escape");
    }
  });

  it.each([
    ["unknown status", { status: "unknown", payload: generatorStageOutput, sourceRefs: [], traceSummary: "trace", modelId: "fixture-model", promptVersion: "review-v1" }],
    ["missing sourceRefs", { status: "ok", payload: generatorStageOutput, traceSummary: "trace", modelId: "fixture-model", promptVersion: "review-v1" }],
    ["negative duration", { status: "ok", payload: generatorStageOutput, sourceRefs: ["source-public-1"], traceSummary: "trace", modelId: "fixture-model", promptVersion: "review-v1", durationMs: -1 }],
    ["illegal status error", { status: "ok", payload: generatorStageOutput, errorCode: "provider_error", sourceRefs: ["source-public-1"], traceSummary: "trace", modelId: "fixture-model", promptVersion: "review-v1" }],
    ["invalid model identifier", { status: "ok", payload: generatorStageOutput, sourceRefs: ["source-public-1"], traceSummary: "trace", modelId: "../private-model", promptVersion: "review-v1" }],
    ["invalid prompt identifier", { status: "ok", payload: generatorStageOutput, sourceRefs: ["source-public-1"], traceSummary: "trace", modelId: "fixture-model", promptVersion: "../prompt" }],
    ["unknown response field", { status: "ok", payload: generatorStageOutput, sourceRefs: ["source-public-1"], traceSummary: "trace", modelId: "fixture-model", promptVersion: "review-v1", providerRaw: "secret" }],
  ] as const)("rejects malformed live model response: %s", async (_label, malformedResult) => {
    const runId = `review-malformed-${_label.replaceAll(" ", "-")}`;
    const store = new InMemoryReviewCheckpointStore();
    const port: ModelExecutionPort = { async execute() { return malformedResult as never; } };
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: port, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);
    const saved = await store.load(runId);

    expect(result).toMatchObject({ status: "fallback", errorCode: "provider_error" });
    expect(saved?.stageAttempts.generator?.[0]).toMatchObject({
      status: "provider_error",
      errorCode: "provider_error",
      modelId: "fixture-model",
      promptVersion: "review-v1",
    });
    expect(JSON.stringify(saved)).not.toContain("providerRaw");
    expect(JSON.stringify(saved)).not.toContain("../private-model");
  });

  it("rebuilds the same technical result from a saved exhausted failure", async () => {
    const reviewInput = input("review-exhausted-timeout");
    const { inputBindingHash, inputSummaryHash } = buildSafeReviewContext(reviewInput, trustedProjection);
    const store = new InMemoryReviewCheckpointStore();
    await store.save({
      runId: reviewInput.runId,
      requestId: reviewInput.requestId,
      attemptId: reviewInput.attemptId,
      profileRevision: reviewInput.profileRevision,
      inputBindingHash,
      inputSummaryHash,
      modelId: reviewInput.modelId,
      promptVersion: reviewInput.promptVersion,
      redactions: [],
      createdAt: "2026-07-26T10:00:00.000Z",
      stageAttempts: {
        generator: [{
          graphId: "generator",
          attempt: 1,
          modelRunId: "review-exhausted-timeout.generator.1",
          status: "timeout",
          errorCode: "timeout",
          modelId: reviewInput.modelId,
          promptVersion: reviewInput.promptVersion,
          traceSummary: "timeout",
          completedAt: "2026-07-26T10:00:01.000Z",
        }],
      },
    });
    const adapter = buildInlineAdapter(reviewInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(reviewInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "fallback", errorCode: "timeout" });
    expect(adapter.history).toHaveLength(0);
  });

  it("returns fixed provider_error when checkpoint storage fails", async () => {
    const throwingStore = {
      async load() { throw new Error("storage failure"); },
      async save() { throw new Error("storage failure"); },
    };
    const adapter = buildInlineAdapter("review-store-error");
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: throwingStore });

    const result = await orchestrator.run(input("review-store-error"), new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "provider_error" });
    expect(adapter.history).toHaveLength(0);
  });

  it("rejects sensitive trusted source summaries before model execution", async () => {
    const runId = "review-sensitive-source-summary";
    const adapter = buildInlineAdapter(runId);
    const unsafeSourceProvider: ReviewSafeSourceProvider = {
      async getProjection() {
        return { sourceIds: ["source-public-1"], sourceSummary: "完整 Rubric 与参考实现和访问密钥" };
      },
    };
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider: unsafeSourceProvider });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "source_conflict" });
    expect(adapter.history).toHaveLength(0);
  });

  it.each([
    ["top-level extra field", (checkpoint: ReviewRunCheckpoint) => { (checkpoint as unknown as Record<string, unknown>).extra = true; }],
    ["invalid createdAt", (checkpoint: ReviewRunCheckpoint) => { checkpoint.createdAt = "yesterday"; }],
    ["unknown redaction", (checkpoint: ReviewRunCheckpoint) => { checkpoint.redactions = ["providerRaw"]; }],
    ["stage extra field", (checkpoint: ReviewRunCheckpoint) => { (checkpoint.generator as unknown as Record<string, unknown>).extra = true; }],
    ["stage negative duration", (checkpoint: ReviewRunCheckpoint) => { if (checkpoint.generator) checkpoint.generator.durationMs = -1; }],
    ["stage invalid timestamp", (checkpoint: ReviewRunCheckpoint) => { if (checkpoint.generator) checkpoint.generator.completedAt = "yesterday"; }],
    ["attempt fractional duration", (checkpoint: ReviewRunCheckpoint) => { if (checkpoint.stageAttempts.generator?.[0]) checkpoint.stageAttempts.generator[0].durationMs = 1.5; }],
    ["attempt invalid timestamp", (checkpoint: ReviewRunCheckpoint) => { if (checkpoint.stageAttempts.generator?.[0]) checkpoint.stageAttempts.generator[0].completedAt = "yesterday"; }],
  ] as const)("rejects malformed checkpoint audit data: %s", async (_label, mutate) => {
    const checkpointInput = input(`review-checkpoint-audit-${_label.replaceAll(" ", "-")}`);
    const checkpoint = checkpointWithStages(checkpointInput, "generator");
    mutate(checkpoint);
    const store = new InMemoryReviewCheckpointStore();
    await store.save(checkpoint);
    const before = await store.load(checkpointInput.runId);
    const adapter = buildInlineAdapter(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
    expect(adapter.history).toHaveLength(0);
    expect(await store.load(checkpointInput.runId)).toEqual(before);
  });

  it("rejects trusted source identifiers containing path characters", async () => {
    const runId = "review-source-path-id";
    const adapter = buildInlineAdapter(runId);
    const unsafeSourceProvider: ReviewSafeSourceProvider = {
      async getProjection() {
        return { sourceIds: ["source/../../private"], sourceSummary: "Safe summary." };
      },
    };
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider: unsafeSourceProvider });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "source_conflict" });
    expect(adapter.history).toHaveLength(0);
  });

  it("requires Generator body citations to be covered by model sourceRefs", async () => {
    const runId = "review-citation-subset";
    const adapter = buildInlineAdapter(runId, { generatorSourceRefs: [] });
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);

    expect(result).toMatchObject({ status: "fallback", errorCode: "source_conflict" });
    expect(adapter.history.map((entry) => entry.input.graphId)).toEqual(["generator"]);
  });

  it("redacts localized sensitive Provider traces without echoing their text", async () => {
    const runId = "review-localized-trace";
    const store = new InMemoryReviewCheckpointStore();
    const adapter = buildInlineAdapter(runId, {
      generatorStatus: "provider_error",
      generatorTraceSummary: "泄漏了原始提交和参考实现内容",
    });
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 1 });

    const result = await orchestrator.run(input(runId), new AbortController().signal);
    const saved = await store.load(runId);

    expect(result.summary).toBe("provider_error: generator review stage failed safely");
    expect(saved?.stageAttempts.generator?.[0]?.traceSummary).toBe("[REDACTED_TRACE]");
    expect(JSON.stringify({ result, saved })).not.toContain("原始提交");
  });

  it("rejects forged finalized metadata by recomputing the result from Judge", async () => {
    const checkpointInput = input("review-forged-final");
    const checkpoint = finalizedCheckpoint(checkpointInput);
    checkpoint.finalStatus = "fallback";
    checkpoint.usedFallback = true;
    const store = new InMemoryReviewCheckpointStore();
    await store.save(checkpoint);
    const before = await store.load(checkpointInput.runId);
    const adapter = buildInlineAdapter(checkpointInput.runId);
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

    const result = await orchestrator.run(checkpointInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
    expect(adapter.history).toHaveLength(0);
    expect(await store.load(checkpointInput.runId)).toEqual(before);
  });

  it("rejects null and successful-without-stage attempt records deterministically", async () => {
    for (const [suffix, mutate] of [
      ["null", (checkpoint: ReviewRunCheckpoint) => { checkpoint.stageAttempts.generator = [null as never]; }],
      ["orphan-success", (checkpoint: ReviewRunCheckpoint) => { delete checkpoint.generator; }],
    ] as const) {
      const checkpointInput = input(`review-attempt-${suffix}`);
      const checkpoint = checkpointWithStages(checkpointInput, "generator");
      mutate(checkpoint);
      const store = new InMemoryReviewCheckpointStore();
      await store.save(checkpoint);
      const before = await store.load(checkpointInput.runId);
      const adapter = buildInlineAdapter(checkpointInput.runId);
      const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store });

      const result = await orchestrator.run(checkpointInput, new AbortController().signal);

      expect(result).toMatchObject({ status: "failed", errorCode: "invalid_json" });
      expect(adapter.history).toHaveLength(0);
      expect(await store.load(checkpointInput.runId)).toEqual(before);
    }
  });

  it("replays a saved live model version conflict deterministically", async () => {
    const adapter = await buildAdapter();
    const store = new InMemoryReviewCheckpointStore();
    const orchestrator = new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, checkpointStore: store, maxAttemptsPerRole: 1 });
    const reviewInput = input("review-version-conflict-live");

    const first = await orchestrator.run(reviewInput, new AbortController().signal);
    const callsAfterFirst = adapter.history.length;
    const second = await orchestrator.run(reviewInput, new AbortController().signal);

    expect(second).toEqual(first);
    expect(adapter.history).toHaveLength(callsAfterFirst);
    expect(first).toMatchObject({ status: "failed", errorCode: "version_conflict" });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid timeoutMs value %s",
    async (timeoutMs) => {
      const adapter = await buildAdapter();
      expect(() => new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, timeoutMs })).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid maxTokens value %s",
    async (maxTokens) => {
      const adapter = await buildAdapter();
      expect(() => new ReviewOrchestrator({ modelExecutionPort: adapter, sourceProvider, maxTokens })).toThrow(RangeError);
    },
  );

  it("builds a safe model context without raw learner answers or hidden assets", () => {
    const built = buildSafeReviewContext(input("review-normal"), trustedProjection);
    const serialized = JSON.stringify(built.context);

    expect(built.redactions).toEqual([]);
    expect(Object.keys(built.context).sort()).toEqual(["activity", "safeFeedback", "sourceIds", "sourceSummary"]);
    expect(serialized).not.toContain("submissionDigest");
    expect(serialized).not.toContain("def clean_orders(df): return df");
    expect(serialized).not.toContain("private-case");
    expect(serialized).not.toContain("secret solution");
    expect(serialized).not.toContain("C:\\Users\\FixtureUser");
  });
});
