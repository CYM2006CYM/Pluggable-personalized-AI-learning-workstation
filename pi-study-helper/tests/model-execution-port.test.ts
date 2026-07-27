import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Graph, GraphRunResult } from "pi-loop-graph-sdk";
import { describe, expect, it } from "vitest";
import {
  PiGraphModelExecutionAdapter,
  RecordedModelExecutionAdapter,
  loadRecordedModelResponseFixtures,
} from "../src/infrastructure/model-execution-port.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");

async function buildAdapter() {
  const raw = await readFile(resolve(projectRoot, "fixtures/model-responses/review-orchestrator.json"), "utf8");
  return new RecordedModelExecutionAdapter({
    fixtures: loadRecordedModelResponseFixtures(raw),
    defaultModelId: "fixture-model",
  });
}

const baseInput = {
  graphId: "generator",
  runId: "review-normal",
  profileRevision: 1,
  promptVersion: "review-v1",
  safeContext: {
    runId: "review-normal",
    inputSummaryHash: "sha256:test",
  },
  budget: {
    timeoutMs: 1000,
    maxTokens: 256,
  },
} as const;

const piGraph = { id: "generator", version: "1.0.0" } as unknown as Graph;

function completedGraphResult(output: unknown = { artifactId: "artifact-pi" }): GraphRunResult {
  return {
    status: "completed",
    rootRunId: "sdk-run-1",
    graphId: "generator",
    graphVersion: "1.0.0",
    steps: 2,
    durationMs: 12,
    replay: { mode: "replay", status: "complete", location: "C:\\private\\replay.json" },
    output: output as never,
  };
}

function failedGraphResult(code: "validation-exhausted" | "agent-timeout" | "runtime-error"): GraphRunResult {
  return {
    status: "failed",
    rootRunId: "sdk-run-1",
    graphId: "generator",
    graphVersion: "1.0.0",
    steps: 1,
    durationMs: 9,
    replay: { mode: "replay", status: "failed", location: "C:\\private\\replay.json", issues: ["secret"] },
    failure: {
      code,
      phase: "agent",
      message: "provider secret at C:\\private\\model.log",
      retryable: false,
    },
  };
}

describe("ModelExecutionPort recorded fixture adapter", () => {
  it("keeps the D role fixture matrix complete without freezing new runtime schemas", async () => {
    const raw = await readFile(resolve(projectRoot, "fixtures/model-responses/d-agent-role-matrix.json"), "utf8");
    const fixture = JSON.parse(raw) as {
      roles: Array<{ role: string; schemaStatus: string; normal: unknown; failure: unknown; timeout: unknown }>;
    };

    expect(fixture.roles.map((entry) => entry.role)).toEqual([
      "diagnosis",
      "generator",
      "hunter",
      "defender",
      "judge",
      "cidpp",
      "capabilityScorer",
      "explanation",
    ]);
    expect(fixture.roles.every((entry) => entry.normal && entry.failure && entry.timeout)).toBe(true);
    expect(fixture.roles.filter((entry) => entry.schemaStatus === "implemented").map((entry) => entry.role)).toEqual([
      "generator",
      "hunter",
      "defender",
      "judge",
    ]);
  });

  it("replays a C.1-shaped single model call", async () => {
    const adapter = await buildAdapter();

    const result = await adapter.execute(baseInput, new AbortController().signal);

    expect(result).toMatchObject({
      status: "ok",
      modelId: "fixture-model",
      promptVersion: "review-v1",
      sourceRefs: ["source-public-1"],
    });
    expect(result.payload).toMatchObject({ artifactId: "artifact-normal" });
    expect(adapter.history[0]?.input).toEqual(baseInput);
  });

  it("returns timeout and invalid_output without changing the public status union", async () => {
    const adapter = await buildAdapter();

    const timeout = await adapter.execute({
      ...baseInput,
      runId: "review-retry",
    }, new AbortController().signal);
    const invalidOutput = await adapter.execute({
      ...baseInput,
      runId: "review-invalid-output",
    }, new AbortController().signal);

    expect(timeout.status).toBe("timeout");
    expect(invalidOutput.status).toBe("invalid_output");
  });

  it("treats missing recordings as provider_error, not a hidden adapter status", async () => {
    const adapter = await buildAdapter();

    const result = await adapter.execute({
      ...baseInput,
      runId: "missing-run",
    }, new AbortController().signal);

    expect(result).toMatchObject({
      status: "provider_error",
      errorCode: "provider_error",
      sourceRefs: [],
    });
  });

  it("throws AbortError before reading a recording when the signal is cancelled", async () => {
    const adapter = await buildAdapter();
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.execute(baseInput, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.history).toHaveLength(0);
  });

  it.each([
    ["unknown top-level field", { recordings: [], extra: true }],
    ["unknown recording field", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: [], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1", extra: true }] }],
    ["malformed sourceRefs", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: ["../private"], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["drive-like sourceRefs", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: ["C:private"], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["missing sourceRefs", { recordings: [{ graphId: "generator", runId: "run-1", status: "timeout", errorCode: "timeout", traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["invalid duration", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: [], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1", durationMs: -1 }] }],
    ["fractional duration", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: [], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1", durationMs: 1.5 }] }],
    ["empty model", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: [], traceSummary: "trace", modelId: "", promptVersion: "prompt-1" }] }],
    ["invalid model identifier", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: [], traceSummary: "trace", modelId: "../model", promptVersion: "prompt-1" }] }],
    ["ok with error", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, errorCode: "provider_error", sourceRefs: [], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["timeout with provider error", { recordings: [{ graphId: "generator", runId: "run-1", status: "timeout", errorCode: "provider_error", sourceRefs: [], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["too many sourceRefs", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: Array.from({ length: 65 }, (_, index) => `source-${index}`), traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["over-limit trace", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: {}, sourceRefs: [], traceSummary: "x".repeat(6401), modelId: "model-1", promptVersion: "prompt-1" }] }],
    ["over-limit payload text", { recordings: [{ graphId: "generator", runId: "run-1", status: "ok", payload: { text: "x".repeat(801) }, sourceRefs: [], traceSummary: "trace", modelId: "model-1", promptVersion: "prompt-1" }] }],
  ])("rejects strict recorded fixture violation: %s", (_label, fixture) => {
    expect(() => loadRecordedModelResponseFixtures(JSON.stringify(fixture))).toThrow();
  });
});

describe("PiGraphModelExecutionAdapter", () => {
  it("maps completed SDK output and projects only safe source IDs", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    const adapter = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async (_graph, input) => {
        receivedInput = input;
        return completedGraphResult();
      },
    });

    const result = await adapter.execute({
      ...baseInput,
      safeContext: { context: { sourceIds: ["source-public-1"] } },
    }, new AbortController().signal);

    expect(result).toMatchObject({
      status: "ok",
      modelId: "pi-model-1",
      promptVersion: "review-v1",
      sourceRefs: ["source-public-1"],
      durationMs: 12,
    });
    expect(result.payload).toEqual({ artifactId: "artifact-pi" });
    expect(receivedInput).toEqual({
      runId: baseInput.runId,
      profileRevision: baseInput.profileRevision,
      promptVersion: baseInput.promptVersion,
      safeContext: { context: { sourceIds: ["source-public-1"] } },
      budget: baseInput.budget,
    });
    expect(result.traceSummary).not.toContain("private");
    expect(result.traceSummary).not.toContain("replay.json");
  });

  it.each([
    ["validation-exhausted", "invalid_output", "invalid_json"],
    ["agent-timeout", "timeout", "timeout"],
    ["runtime-error", "provider_error", "provider_error"],
  ] as const)("maps SDK failure %s to %s", async (failureCode, status, errorCode) => {
    const adapter = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => failedGraphResult(failureCode),
    });

    const result = await adapter.execute(baseInput, new AbortController().signal);

    expect(result).toMatchObject({ status, errorCode });
    expect(result.traceSummary).toContain(`failure=${failureCode}`);
    expect(result.traceSummary).not.toContain("provider secret");
    expect(result.traceSummary).not.toContain("model.log");
  });

  it("returns provider_error without calling the executor for an unknown Graph", async () => {
    let calls = 0;
    const adapter = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => {
        calls += 1;
        return completedGraphResult();
      },
    });

    const result = await adapter.execute({ ...baseInput, graphId: "unknown" }, new AbortController().signal);

    expect(result).toMatchObject({ status: "provider_error", errorCode: "provider_error", sourceRefs: [] });
    expect(calls).toBe(0);
  });

  it("maps ordinary executor rejection to a fixed provider_error", async () => {
    const adapter = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => { throw new Error("secret provider failure"); },
    });

    const result = await adapter.execute(baseInput, new AbortController().signal);

    expect(result).toMatchObject({ status: "provider_error", errorCode: "provider_error" });
    expect(result.traceSummary).not.toContain("secret provider failure");
  });

  it("throws AbortError for pre-cancelled, executor-cancelled, and SDK-cancelled calls", async () => {
    let calls = 0;
    const preCancelled = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => {
        calls += 1;
        return completedGraphResult();
      },
    });
    const preController = new AbortController();
    preController.abort();
    await expect(preCancelled.execute(baseInput, preController.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);

    const rejected = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => {
        const error = new Error("cancelled by host");
        error.name = "AbortError";
        throw error;
      },
    });
    await expect(rejected.execute(baseInput, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });

    const sdkCancelled = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => ({
        status: "cancelled",
        rootRunId: "sdk-run-1",
        graphId: "generator",
        graphVersion: "1.0.0",
        steps: 1,
        durationMs: 4,
        replay: { mode: "replay", status: "incomplete" },
        failure: { code: "cancelled", phase: "root", message: "cancelled", retryable: false },
      }),
    });
    await expect(sdkCancelled.execute(baseInput, new AbortController().signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws AbortError when cancellation happens during executor completion", async () => {
    const controller = new AbortController();
    const adapter = new PiGraphModelExecutionAdapter({
      graphs: [piGraph],
      modelId: "pi-model-1",
      executor: async () => {
        controller.abort();
        return completedGraphResult();
      },
    });

    await expect(adapter.execute(baseInput, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
