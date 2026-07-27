import type { AgentInstance, ContextFrame, Graph, Mechanism, Node, NodeCompletion, NodeInput } from "./type.js";
export interface CallFrame {
    instance: AgentInstance;
    graph: Graph;
    /** 图调用的上下文边界。 */
    boundary: "root" | "call" | "compose";
    /** compose 复用父 Instance，但 child Graph 的目标/机制只在此调用帧生效。 */
    localGoal: string;
    localMechanisms: readonly Mechanism[];
    callBackground: Record<string, unknown>;
    parentNodeId?: string;
    /** 每个调用帧独立计数，避免同名子图节点污染 visit。 */
    nodeVisits: Map<string, number>;
    currentNodeId: string | null;
    /**
     * 节点瞬态状态也归属调用帧。子图返回时必须恢复仍在执行的父 graph node，
     * 否则 context 投影会错误地认为父节点已经结束。
     */
    activeNode: Node | null;
    activeInput: NodeInput | null;
    activeScope: NodeScopeDescriptor | null;
    isNodeActive: boolean;
    /** 已被最近一次 pi compaction 原生上下文取代的 frame 前缀长度。 */
    projectedFrameBase: number;
}
/** compose 调用在父 frames 上建立的受 Runtime 管理的临时区间。 */
export interface FrameSegmentScope {
    id: string;
    graphId: string;
    parentNodeId: string;
    instanceId: string;
    baseIndex: number;
    depth: number;
}
export interface NodeScopeDescriptor {
    protocol: 2;
    graphRunId: string;
    instanceId: string;
    scopeId: string;
    graphId: string;
    nodeId: string;
    visit: number;
    depth: number;
}
export declare class GraphRuntime {
    callStack: CallFrame[];
    isNodeActive: boolean;
    /** 当前节点的语义作用域。details 用于匹配，不依赖消息正文。 */
    currentScope: NodeScopeDescriptor | null;
    currentNode: Node | null;
    currentInput: NodeInput | null;
    readonly graphRunId: `${string}-${string}-${string}-${string}-${string}`;
    /** 当前 graph run 已发生的 compaction 次数，仅用于诊断和 checkpoint 观测。 */
    compactionGeneration: number;
    /**
     * 共享 call/compose 活跃期间异常收到 session_compact 时设为 true。
     * 此后本 session 投影中将持续过滤 compactionSummary，优先保证不泄漏。
     */
    compactionBoundaryViolated: boolean;
    /** Runtime 控制平面的 frame → NodeScope 对齐表，不进入开发者 frame/LLM。 */
    private readonly frameScopes;
    get top(): CallFrame | null;
    get topInstance(): AgentInstance | null;
    get topGraph(): Graph | null;
    get currentNodeId(): string | null;
    pushGraph(graph: Graph, background: Record<string, unknown>, boundary?: CallFrame["boundary"], sharedInstance?: AgentInstance, parentNodeId?: string): AgentInstance;
    popGraph(): CallFrame | undefined;
    beginFrameSegment(graphId: string, parentNodeId: string): FrameSegmentScope;
    readFrameSegment(scope: FrameSegmentScope): readonly ContextFrame[];
    rollbackFrameSegment(scope: FrameSegmentScope): void;
    closeFrameSegment(scope: FrameSegmentScope, completion: NodeCompletion): NodeCompletion;
    nextScope(nodeId: string): NodeScopeDescriptor;
    enterNode(nodeId: string, scope: NodeScopeDescriptor, input: NodeInput): Node;
    exitNode(frame: ContextFrame): void;
    /**
     * 记录一次 session compaction。NodeScope 的身份（scopeId）不变。
     * Runtime 只推进 projectedFrameBase；pi 原生 summary 与 recent messages
     * 是压缩历史的权威替代，SDK 不重发 scope，也不遮挡 summary。
     */
    recordCompaction(projectedFrameBase?: number): number;
    /** 当前 callStack 是否存在嵌套 call/compose（非 root-only）。 */
    get hasActiveSharedCall(): boolean;
    /** 共享调用边界被 compaction 切断后，继续运行会泄漏无法归属的 transcript。 */
    assertNoCompactionBoundaryViolation(): void;
    get completedFrameScopes(): readonly NodeScopeDescriptor[];
    /** 只返回最近一次 compaction 后新生长、仍需单独投影的开发者 frames。 */
    get projectedFrames(): ContextFrame[];
    reset(): void;
    private assertSegmentOwner;
    private restoreActiveNodeFromTop;
}
