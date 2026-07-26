import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  createPiGraphHost,
  type CreatePiGraphHostOptions,
  type Graph,
  type GraphHost,
  type GraphRunResult,
  type LoopGraphLimits,
  type RecordingMode,
} from "pi-loop-graph-sdk";

export type IsolatedGraphExecutor = (
  graph: Graph,
  input: Record<string, unknown>,
) => Promise<GraphRunResult>;

export interface IsolatedGraphExecutorOptions {
  /** Root/Child 步数与 Agent Run 超时；0.2 由 Host 统一持有。 */
  limits?: LoopGraphLimits;
  /** 0.1 的 JSONL traceSink 在 0.2 由 recording + RunStore 取代。 */
  recording?: RecordingMode;
  runStore?: CreatePiGraphHostOptions["runStore"];
  /** 允许被 GraphRef 解析的图；单图执行时可省略。 */
  graphs?: readonly Graph[];
}

/** @internal 仅用于替换 Host 构造，以便测试生命周期契约。 */
export interface IsolatedGraphExecutorDependencies {
  createHost?: (options: CreatePiGraphHostOptions) => Promise<GraphHost> | GraphHost;
}

/**
 * Graph Input 会被 Runtime 按 Graph input 契约校验，且必须是 JSON 兼容值。
 * 业务对象里可能带 `undefined` 字段，这里统一做一次 JSON 归一化。
 */
function toGraphInput(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input ?? {})) as Record<string, unknown>;
}

/**
 * 为业务命令创建隔离图执行器。
 *
 * 每次执行都会创建并释放一个新的 in-memory AgentSession，图内的模型消息、
 * completion 工具反馈和 SDK 完成通知不会进入产品主会话。
 */
export function createIsolatedGraphExecutor(
  ctx: ExtensionCommandContext,
  options: IsolatedGraphExecutorOptions = {},
  dependencies: IsolatedGraphExecutorDependencies = {},
): IsolatedGraphExecutor {
  const model = ctx.model;
  if (!model) throw new Error("请先选择可用模型再开始学习");

  const createHost = dependencies.createHost ?? createPiGraphHost;
  const hostOptions: CreatePiGraphHostOptions = {
    cwd: ctx.cwd,
    authStorage: ctx.modelRegistry.authStorage,
    modelRegistry: ctx.modelRegistry,
    model,
    thinkingLevel: "off",
    limits: options.limits,
    recording: options.recording ?? "replay",
    runStore: options.runStore,
    graphs: options.graphs,
  };

  return async (graph, input) => {
    const host = await createHost(hostOptions);
    try {
      return await host.execute(
        graph,
        toGraphInput(input) as never,
        { signal: ctx.signal },
      ) as GraphRunResult;
    } finally {
      await host.dispose();
    }
  };
}
