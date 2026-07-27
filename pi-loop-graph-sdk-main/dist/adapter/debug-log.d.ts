import type { ContextFrame, NodeCompletion, NodeInput } from "../type.js";
import type { ProjectionInput, MessageEntry } from "./projection.js";
/** 截断序列化帧的预览，避免日志爆量。 */
export declare function safePreview(value: unknown, maxLength?: number): string;
export declare const debugLog: {
    preview(value: unknown, maxLength?: number): string;
    /** 图启动 */
    graphStart(graphId: string, trigger: unknown): void;
    /** 进入节点 */
    enterNode(depth: number, nodeId: string, scopeId: string, input: NodeInput, frames: ContextFrame[]): void;
    /** 退出节点（折叠帧）。控制信息来自 completion；frame 作为 opaque payload。 */
    exitNode(depth: number, nodeId: string, completion: NodeCompletion, frame: ContextFrame, allFrames: ContextFrame[]): void;
    /** context 钩子投影 */
    projection(input: ProjectionInput, output: MessageEntry[]): void;
    /** 图运行期间发生 compaction 后记录 checkpoint 信息。 */
    scopeCheckpoint(scopeId: string, generation: number, reason: unknown, willRetry: unknown): void;
    /** 共享 Session 的嵌套调用期间阻止 compaction 跨越 GraphCallScope。 */
    compactionBlocked(reason: unknown, depth: number): void;
    /** agent 完成（__graph_complete__ 被调用） */
    agentComplete(nodeId: string, completion: NodeCompletion): void;
    /** agent 未调用 __graph_complete__ 就结束 */
    agentIncomplete(nodeId: string): void;
    /** 完成验证不通过，触发重试 */
    agentRetry(nodeId: string, reason: string): void;
    /** 图结束。控制信息来自 result；frames 作为 opaque payload。 */
    graphEnd(graphId: string, steps: number, resultStatus: string, resultPreview: string, frames: ContextFrame[]): void;
    /** 图错误 */
    graphError(graphId: string, error: string): void;
    /** 子图 push */
    subgraphPush(parentNodeId: string, childGraphId: string): void;
    /** 子图 pop */
    subgraphPop(parentNodeId: string, childGraphId: string, result: unknown): void;
    frameSegmentStart(graphId: string, parentNodeId: string, baseIndex: number, depth: number): void;
    frameSegmentClose(graphId: string, parentNodeId: string, frames: readonly ContextFrame[], completion: NodeCompletion): void;
    frameSegmentRollback(graphId: string, parentNodeId: string, reason: string): void;
    /** 工具切换 */
    toolsChanged(nodeId: string, tools: string[]): void;
};
