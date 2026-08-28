import type { GraphHost } from "pi-loop-graph-sdk";
import { describe, expect, it, vi } from "vitest";
import { createW4DModelGraphs } from "../src/graphs/w4-d-graph-factory.js";
import { createLiveModelExecutionPort } from "../src/infrastructure/live-model-execution-port.js";

describe("W4 D live ModelExecutionPort", () => {
  it("requires all live-only environment values without persisting credentials", () => {
    const graphs = createW4DModelGraphs();
    expect(() => createLiveModelExecutionPort({ cwd: process.cwd(), graphs })).toThrow(/OPENAI_MODEL/u);
    expect(() => createLiveModelExecutionPort({ cwd: process.cwd(), graphs, modelId: "m", baseUrl: "file:///tmp", apiKey: "secret" })).toThrow(/HTTP\(S\)/u);
  });

  it("executes D graphs through the SDK adapter and an isolated host", async () => {
    const graphs = createW4DModelGraphs();
    const dispose = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({
      status: "completed" as const,
      output: { artifactId: "card-1" },
      steps: 1,
      durationMs: 3,
      replay: { status: "not-requested" as const },
    }));
    const createHost = vi.fn(async () => ({ execute, dispose }) as unknown as GraphHost);
    const port = createLiveModelExecutionPort({
      cwd: process.cwd(),
      modelId: "deepseek-chat",
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-only-key",
      graphs,
      createHost,
    });
    const controller = new AbortController();
    const result = await port.execute({
      graphId: "generator",
      runId: "live-test",
      profileRevision: 3,
      promptVersion: "w4-d2-v1",
      safeContext: {},
      budget: { timeoutMs: 1_000 },
    }, controller.signal);

    expect(result).toMatchObject({ status: "ok", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    expect(createHost).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect((execute.mock.calls as unknown[][])[0]?.[2]).toEqual({ signal: controller.signal });
    expect(dispose).toHaveBeenCalledOnce();
    expect(JSON.stringify(createHost.mock.calls)).not.toContain("test-only-key");
  });
});
