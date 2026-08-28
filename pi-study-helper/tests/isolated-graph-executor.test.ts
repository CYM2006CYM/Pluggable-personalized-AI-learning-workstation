import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
  CreatePiGraphHostOptions,
  Graph,
  GraphHost,
  GraphHostRunOptions,
  GraphRunResult,
} from "pi-loop-graph-sdk";
import { describe, expect, it, vi } from "vitest";
import { createIsolatedGraphExecutor } from "../src/graphs/isolated-graph-executor.js";
import { completedRun } from "./graph-run-result.js";

const graph = { id: "test_graph", version: "1" } as Graph;
const result: GraphRunResult = completedRun(graph, { value: 1 });

type FakeHost = GraphHost & {
  execute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function commandContext(options: { model?: unknown } = {}): ExtensionCommandContext {
  const authStorage = { source: "shared-auth" };
  const modelRegistry = { authStorage };
  const model = Object.hasOwn(options, "model")
    ? options.model
    : { provider: "test", id: "test-model" };
  return {
    cwd: "C:\\workspace",
    model,
    modelRegistry,
    signal: undefined,
  } as unknown as ExtensionCommandContext;
}

function fakeHost(
  run?: (graph: Graph, input: unknown, options?: GraphHostRunOptions) => Promise<GraphRunResult>,
): FakeHost {
  return {
    execute: vi.fn(run ?? (async () => result)),
    resume: vi.fn(async () => result),
    dispose: vi.fn(async () => undefined),
  } as unknown as FakeHost;
}

describe("createIsolatedGraphExecutor", () => {
  it("缺少当前模型时立即失败", () => {
    const createHost = vi.fn();

    expect(() => createIsolatedGraphExecutor(
      commandContext({ model: undefined }),
      {},
      { createHost },
    )).toThrow("请先选择可用模型再开始学习");
    expect(createHost).not.toHaveBeenCalled();
  });

  it("复用命令上下文的认证和模型，并把 Graph Input 传给 Host", async () => {
    const ctx = commandContext();
    const signal = new AbortController().signal;
    Object.defineProperty(ctx, "signal", { get: () => signal });
    let hostOptions: CreatePiGraphHostOptions | undefined;
    let receivedGraph: Graph | undefined;
    let receivedInput: unknown;
    let receivedRunOptions: GraphHostRunOptions | undefined;
    const host = fakeHost(async (nextGraph, input, runOptions) => {
      receivedGraph = nextGraph;
      receivedInput = input;
      receivedRunOptions = runOptions;
      return result;
    });

    const execute = createIsolatedGraphExecutor(
      ctx,
      { limits: { rootMaxSteps: 7 } },
      {
        createHost(options) {
          hostOptions = options;
          return host;
        },
      },
    );
    const params = { subjectId: "demo-review" };

    await expect(execute(graph, params)).resolves.toEqual(result);
    expect(hostOptions).toMatchObject({
      cwd: ctx.cwd,
      authStorage: ctx.modelRegistry.authStorage,
      modelRegistry: ctx.modelRegistry,
      model: ctx.model,
      thinkingLevel: "off",
      recording: "replay",
      limits: { rootMaxSteps: 7 },
    });
    expect(receivedGraph).toBe(graph);
    expect(receivedInput).toEqual(params);
    expect(receivedRunOptions).toEqual({ signal });
    expect(host.dispose).toHaveBeenCalledOnce();
  });

  it("Graph Input 先归一化为 JSON 兼容值，避免 undefined 触发 invalid-input", async () => {
    let receivedInput: unknown;
    const host = fakeHost(async (_graph, input) => {
      receivedInput = input;
      return result;
    });
    const execute = createIsolatedGraphExecutor(commandContext(), {}, { createHost: () => host });

    await execute(graph, { keep: "ok", drop: undefined });

    expect(receivedInput).toEqual({ keep: "ok" });
    expect(Object.hasOwn(receivedInput as object, "drop")).toBe(false);
  });

  it("把单次模型执行的取消信号与命令上下文信号合并后传给 Host", async () => {
    const ctx = commandContext();
    const contextController = new AbortController();
    const operationController = new AbortController();
    Object.defineProperty(ctx, "signal", { get: () => contextController.signal });
    let receivedSignal: AbortSignal | undefined;
    const host = fakeHost(async (_graph, _input, runOptions) => {
      receivedSignal = runOptions?.signal;
      return result;
    });
    const execute = createIsolatedGraphExecutor(ctx, {}, { createHost: () => host });

    await execute(graph, {}, operationController.signal);
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
    operationController.abort();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("每次执行创建独立 host 并分别释放", async () => {
    const hosts: FakeHost[] = [];
    const execute = createIsolatedGraphExecutor(
      commandContext(),
      {},
      {
        createHost: () => {
          const host = fakeHost();
          hosts.push(host);
          return host;
        },
      },
    );

    await execute(graph, { call: 1 });
    await execute(graph, { call: 2 });

    expect(hosts).toHaveLength(2);
    expect(hosts[0]).not.toBe(hosts[1]);
    expect(hosts[0]?.execute).toHaveBeenCalledOnce();
    expect(hosts[1]?.execute).toHaveBeenCalledOnce();
    expect(hosts[0]?.dispose).toHaveBeenCalledOnce();
    expect(hosts[1]?.dispose).toHaveBeenCalledOnce();
  });

  it("图执行抛错时仍释放 host", async () => {
    const failure = new Error("graph failed");
    const host = fakeHost(async () => {
      throw failure;
    });
    const execute = createIsolatedGraphExecutor(
      commandContext(),
      {},
      { createHost: () => host },
    );

    await expect(execute(graph, {})).rejects.toBe(failure);
    expect(host.dispose).toHaveBeenCalledOnce();
  });
});
