import { type AuthStorage, type CompactionSettings, type CreateAgentSessionOptions, type ModelRegistry, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContextFrame } from "../type.js";
import type { Graph as CoreGraph } from "../core/graph.js";
import type { NodeContextRenderer } from "./projection.js";
import { type LoopGraphLimits, type CompletionFeedbackFormatter, type ContextRendererRegistry } from "./loop-graph-extension.js";
import type { ModelMessageFormatter } from "./model-messages.js";
import type { ToolResolver } from "../tools-resolve.js";
import type { LoopGraphLogger, LoopGraphTraceSink } from "./observability.js";
import type { SkillContentProvider, SkillContentRenderer, SkillFailurePolicies } from "./skill-content.js";
import type { DelegateHostFactory, IsolatedGraphSessionFactory } from "./graph-execution-host.js";
import type { HostBaseline } from "../host/baseline.js";
import type { SkillCatalog } from "../host/skill-catalog.js";
import type { ToolCatalog, UnsafeToolResolver } from "../host/tool-catalog.js";
import { type GraphHost } from "../host/graph-host.js";
import type { RecordingMode } from "../core/result.js";
import type { RunStore } from "../replay/store.js";
import type { PricingResolver } from "../replay/events.js";
import type { Recorder } from "../replay/recorder.js";
import type { InvocationAgentHost } from "../runtime/graph-runtime.js";
export interface IsolatedGraphSessionFactoryOptions {
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
    cwd?: string;
    agentDir?: string;
    model?: CreateAgentSessionOptions["model"];
    customTools?: ToolDefinition[];
    toolCatalog?: ToolCatalog;
    skillCatalog?: SkillCatalog;
    unsafeToolResolver?: UnsafeToolResolver;
    baseline?: HostBaseline;
    skillBasePath?: string;
    frameFormatter?: (frames: ContextFrame[]) => string | null;
    limits?: LoopGraphLimits;
    contextRenderer?: NodeContextRenderer;
    modelMessageFormatter?: Partial<ModelMessageFormatter>;
    completionFeedbackFormatter?: CompletionFeedbackFormatter;
    outputContractMaxBytes?: number;
    skillProvider?: SkillContentProvider;
    skillRenderer?: SkillContentRenderer;
    skillFailure?: SkillFailurePolicies;
    contextRenderers?: ContextRendererRegistry;
    toolResolver?: ToolResolver;
    traceSink?: LoopGraphTraceSink;
    logger?: LoopGraphLogger;
    debug?: boolean;
    debugLogPath?: string;
    thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
    /** 省略时遵循 pi 默认 compaction；可由 host 显式覆盖。 */
    compaction?: CompactionSettings;
    recording?: RecordingMode;
    recordingRequired?: boolean;
    runStore?: RunStore;
    artifactThresholdBytes?: number;
    pricingResolver?: PricingResolver;
    /** 供子图继续使用 delegate；runtime-only adapter 不注册对外入口。 */
    createDelegateHost?: DelegateHostFactory;
    /** Core graphs made available to GraphRef resolution in this isolated Host. */
    graphs?: readonly CoreGraph[];
}
/**
 * 使用 pi 官方 in-memory AgentSession 创建隔离图执行环境。
 *
 * 子会话通过 inline extension factory 安装同一套 LoopGraph Runtime，避免维护
 * 第二套 graph loop。runtimeOnly 模式只保留运行钩子，不注册对外命令或资源通知。
 */
export declare function createIsolatedGraphSessionFactory(options: IsolatedGraphSessionFactoryOptions): IsolatedGraphSessionFactory;
/**
 * 构造可递归 delegate 的一次性 host factory。每次调用创建新 host/session，
 * 子 session 内的 delegate graph-node 继续复用同一份认证、模型与真实工具实现。
 */
export declare function createIsolatedDelegateHostFactory(options: Omit<IsolatedGraphSessionFactoryOptions, "createDelegateHost">): DelegateHostFactory;
/** Creates one Pi Session that only executes Agent Runs for a Core Graph Invocation. */
export declare function createPiInvocationAgentHost(options: IsolatedGraphSessionFactoryOptions, recorder?: Recorder | null): Promise<InvocationAgentHost>;
/** Creates a Core GraphHost backed by one isolated Pi AgentSession. */
export declare function createPiGraphHost(options: IsolatedGraphSessionFactoryOptions): Promise<GraphHost>;
