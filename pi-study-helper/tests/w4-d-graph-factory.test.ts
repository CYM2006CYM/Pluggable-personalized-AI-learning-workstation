import { describe, expect, it } from "vitest";
import type { GraphRunResult } from "pi-loop-graph-sdk";
import { createW4DModelGraphs } from "../src/graphs/w4-d-graph-factory.js";
import { PiGraphModelExecutionAdapter } from "../src/infrastructure/model-execution-port.js";

describe("W4 D graph factory", () => {
  it("registers every D graphId once and reports unknown graphs as unavailable", async () => {
    const graphs = createW4DModelGraphs();
    expect(graphs.map((graph) => graph.id).sort()).toEqual([
      "capability-scorer", "defender", "generator", "hunter", "judge",
    ]);
    expect(new Set(graphs.map((graph) => graph.id)).size).toBe(graphs.length);

    const calls: string[] = [];
    const adapter = new PiGraphModelExecutionAdapter({
      graphs,
      modelId: "deepseek-chat",
      executor: async (graph) => {
        calls.push(graph.id);
        return {
          rootRunId: `root-${graph.id}`,
          graphId: graph.id,
          graphVersion: graph.version,
          status: "completed",
          output: graph.id === "capability-scorer" ? { dimensions: [] } : {},
          steps: 1,
          durationMs: 1,
          replay: { mode: "off", status: "off" },
        } as GraphRunResult;
      },
    });
    for (const graphId of graphs.map((graph) => graph.id)) {
      await adapter.execute({ graphId, runId: `run-${graphId}`, profileRevision: 3, promptVersion: "w4-d2-v1",
        safeContext: {}, budget: { timeoutMs: 1000 } }, new AbortController().signal);
    }
    await expect(adapter.execute({ graphId: "unknown", runId: "run-unknown", profileRevision: 3,
      promptVersion: "w4-d2-v1", safeContext: {}, budget: { timeoutMs: 1000 } }, new AbortController().signal))
      .resolves.toMatchObject({ status: "provider_error", traceSummary: "graph=unavailable;status=failed" });
    expect(calls.sort()).toEqual(graphs.map((graph) => graph.id).sort());
  });
});
