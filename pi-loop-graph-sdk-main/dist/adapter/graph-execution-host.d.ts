import type { Graph, GraphInvocationBoundary, GraphRunRequest, GraphRunResult } from "../type.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
/** 为旧调用（仅有 invocationKind，无 boundary）填补默认值。
 *  旧 `"subgraph"` → `graph-node` + `call`。 */
export declare function normalizeGraphRunRequest(partial: {
    background: Record<string, unknown>;
    invocationKind: string;
    boundary?: GraphInvocationBoundary;
    signal?: AbortSignal;
}): GraphRunRequest;
/** 图执行载体。不同实现可以承载进程内子会话、子进程或远程 worker。 */
export interface GraphExecutionHost {
    run(graph: Graph, request: GraphRunRequest): Promise<GraphRunResult>;
    dispose(): Promise<void>;
}
/** 创建 delegate host 时可用的调用现场；不包含外层 transcript。 */
export interface GraphHostContext {
    pi: ExtensionAPI;
    extensionContext?: ExtensionContext;
    graph: Graph;
    request: GraphRunRequest;
}
export type DelegateHostFactory = (context: GraphHostContext) => Promise<GraphExecutionHost>;
/** 入口无关的统一图调用器。第三个参数只提供运行配置，不改变业务请求。 */
export interface GraphInvoker {
    invoke(graph: Graph, request: GraphRunRequest, extensionContext?: ExtensionContext): Promise<GraphRunResult>;
}
/** 每次 invoke 创建一次性 host，并固定执行 run → abort/dispose 生命周期。 */
export declare class DelegateGraphInvoker implements GraphInvoker {
    private readonly pi;
    private readonly createHost;
    constructor(pi: ExtensionAPI, createHost: DelegateHostFactory);
    invoke(graph: Graph, request: GraphRunRequest, extensionContext?: ExtensionContext): Promise<GraphRunResult>;
}
/**
 * IsolatedSessionGraphHost 使用的最小子会话句柄。
 *
 * sessionFactory 后续由 pi adapter 通过 createAgentSession() 构造，并在
 * runtime-only extension factory 中绑定 executeGraph。Host 本身只负责严格的
 * run/abort/dispose 生命周期，不依赖 pi 的私有 API。
 */
export interface IsolatedGraphSession {
    run(graph: Graph, request: GraphRunRequest): Promise<GraphRunResult>;
    abort(): Promise<void>;
    dispose(): void;
}
export type IsolatedGraphSessionFactory = (request: GraphRunRequest) => Promise<IsolatedGraphSession>;
export interface IsolatedSessionGraphHostOptions {
    createSession: IsolatedGraphSessionFactory;
}
/**
 * 为一次 graph-tool 调用持有一个独立子 AgentSession 的生命周期外壳。
 *
 * 契约：
 * - 一个 host 同时只运行一张图；并发调用应创建多个 host。
 * - outer AbortSignal 会转发给子会话 abort()。
 * - dispose 顺序固定为 abort() -> dispose()。
 * - dispose 后拒绝 run()，弥补 AgentSession.dispose() 仍允许 prompt 的行为。
 */
export declare class IsolatedSessionGraphHost implements GraphExecutionHost {
    private readonly options;
    private session;
    private sessionPromise;
    private cleanedSession;
    private disposed;
    private running;
    private disposing;
    constructor(options: IsolatedSessionGraphHostOptions);
    run(graph: Graph, request: GraphRunRequest): Promise<GraphRunResult>;
    dispose(): Promise<void>;
    private assertUsable;
    private cleanupSession;
}
