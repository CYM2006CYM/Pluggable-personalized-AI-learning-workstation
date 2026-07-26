import type { Graph, GraphFailureCode, GraphRunResult, JsonValue } from "pi-loop-graph-sdk";

/**
 * 0.2 的 GraphRunResult 是判别联合：成功用 `output`，失败/取消用结构化 `failure`。
 * 测试统一通过这里构造，避免每个用例重复写公共字段。
 */
type GraphLike = Pick<Graph, "id"> & { readonly version?: string };

function common(graph: GraphLike) {
  return {
    rootRunId: `test-run-${graph.id}`,
    graphId: graph.id,
    graphVersion: graph.version ?? "1",
    steps: 1,
    durationMs: 0,
    replay: { mode: "off", status: "off" },
  } as const;
}

export function completedRun(graph: GraphLike, output: Record<string, unknown>): GraphRunResult {
  return { ...common(graph), status: "completed", output: output as unknown as JsonValue };
}

export function failedRun(
  graph: GraphLike,
  message: string,
  code: GraphFailureCode = "agent-ended-without-completion",
): GraphRunResult {
  return {
    ...common(graph),
    status: "failed",
    failure: { code, phase: "node", message, retryable: true },
  };
}

export function cancelledRun(graph: GraphLike, message = "已取消"): GraphRunResult {
  return {
    ...common(graph),
    status: "cancelled",
    failure: { code: "cancelled", phase: "root", message, retryable: false },
  };
}
