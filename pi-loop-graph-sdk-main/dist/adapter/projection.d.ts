import type { ContextFrame, Node } from "../type.js";
import type { NodeScopeDescriptor } from "../runtime.js";
export interface EdgeChoice {
    id: string;
    description: string;
    priority: number;
    target: string;
}
export interface ProjectionInput {
    messages: MessageEntry[];
    frames: ContextFrame[];
    currentNode: Node | null;
    activeScope?: NodeScopeDescriptor | null;
    /** agent-choice 路由下可供 agent 选择的边列表，渲染在 CURRENT 段 */
    availableEdges?: EdgeChoice[];
    /** 自定义帧折叠后的 COMPLETED 段内容格式。
     *  接收所有已完成帧，返回完整文本注入上下文。
     *  返回 null 则跳过 COMPLETED 段（不折叠）。
     *  默认：保持当前 JSON 格式（向后兼容）。 */
    frameFormatter?: (frames: ContextFrame[]) => string | null;
    /** 活动图已经历 compaction；原生 summary 是此前上下文的权威替代。 */
    compactionActive?: boolean;
    /** node-enter 时已冻结的 SDK 合成上下文。仅在活动 scope 锚点缺失时恢复，
     *  不包含 live ReAct，也不接管 GraphCallScope/compaction 清洗。 */
    renderedContext?: readonly MessageEntry[];
}
export interface MessageEntry {
    id?: string;
    role?: string;
    content?: unknown;
    /** pi CustomMessage 的 UI 展示标记。 */
    display?: boolean;
    /** pi compactionSummary / branchSummary 使用 summary 而不是 content。 */
    summary?: string;
    timestamp?: number;
    customType?: string;
    details?: unknown;
}
export declare function projectMessages(input: ProjectionInput): MessageEntry[];
/**
 * 从消息数组中删除已闭合的图调用区段。
 *
 * compose / call 子图运行时在当前 session 的 transcript 中产生内部消息（NodeScope、
 * skill、mechanism、prompt 和 live ReAct）。这些消息由 loop_graph_call_start / end
 * 区段包围。子图结束后调用方不应再看到这些内部消息——它们必须从上下文中删除。
 *
 * 算法：
 *   1. 从 tail 向 head 扫描，为每个 call_end 寻找最近的前驱 call_start（按 callId 匹配）
 *   2. 已闭合区段内的全部消息标记为删除
 *   3. 未闭合的 call_start（图仍在运行中）对应的区段保留
 *
 * 此函数始终执行（无论当前是否有活动图），因为之前图调用的闭合区段需要在后续对话中持续清洗。
 */
export declare function stripClosedGraphCalls(messages: MessageEntry[]): MessageEntry[];
/** 默认帧格式化器：保持向后兼容的 JSON 格式（=== COMPLETED === / === END === 包裹）。 */
export declare const defaultFrameFormatter: (frames: ContextFrame[]) => string;
type NodeInfoLike = Pick<Node, "id" | "kind" | "subGoal"> & {
    tools?: readonly string[];
    skill?: string;
};
export declare function buildNodeInfoContent(node: NodeInfoLike, availableEdges?: EdgeChoice[]): string;
export type RenderedContextContentBlock = {
    type: "text";
    text: string;
} | {
    type: "image";
    data: string;
    mimeType: string;
};
export interface RenderedContextMessage {
    content: string | readonly RenderedContextContentBlock[];
    kind?: "current" | "completed" | "skill" | "instruction";
}
export interface GraphContextView {
    readonly id: string;
    readonly goal: string;
}
export interface NodeContextView {
    readonly id: string;
    readonly kind: Node["kind"];
    readonly subGoal: string;
    readonly skill?: string;
    readonly tools: readonly string[];
    readonly boundary?: import("../type.js").GraphInvocationBoundary;
    readonly childGraphId?: string;
}
export interface NodeInputView {
    readonly data: Readonly<Record<string, unknown>>;
    readonly source: Readonly<import("../type.js").NodeInput["source"]>;
}
export interface NodeContextRenderInput {
    graph: GraphContextView;
    node: NodeContextView;
    input: NodeInputView;
    /** node-enter 时 Runtime 已选择的 frame 快照。COMPLETED 主投影仍由
     * frameFormatter 管理，避免 compaction 后重复投影旧 frame。 */
    frames: readonly ContextFrame[];
    availableEdges: readonly EdgeChoice[];
    skill: {
        ref: string;
        content: string;
        message: RenderedContextMessage | null;
        showRefInCurrent: boolean;
    } | null;
    completion: {
        toolName: "__graph_complete__";
        statuses: readonly ["ok", "failed", "cancelled"];
    };
    reason: "node-enter";
}
export interface RenderedNodeContext {
    /** NodeScope 锚点的模型可见正文。null 表示使用空正文，但安全锚点仍存在。 */
    anchor: RenderedContextMessage | null;
    /** 锚点之后追加的其它 SDK 合成消息。 */
    additional?: readonly RenderedContextMessage[];
}
export type NodeContextRenderer = (input: NodeContextRenderInput) => RenderedNodeContext | null;
/** 兼容 renderer：保持当前 CURRENT 与 skill 消息的正文格式。历史 frames 继续
 * 由 frameFormatter 投影，使 compaction baseline 可以独立推进。 */
export declare const defaultNodeContextRenderer: NodeContextRenderer;
export {};
