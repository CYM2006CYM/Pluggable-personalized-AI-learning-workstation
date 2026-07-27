import type { Graph, GraphInvocationBoundary } from "./type.js";
import type { Graph as CoreGraph } from "./core/graph.js";
export interface GraphValidationIssue {
    code: "NO_ENTRY" | "ENTRY_TARGET_MISSING" | "ROUTING_NODE_MISSING" | "EDGE_FROM_MISMATCH" | "EDGE_TARGET_MISSING" | "NODE_ROUTING_MISSING" | "DUPLICATE_TOOL_IN_NODE" | "TOOL_NOT_REGISTERED" | "AGENT_CHOICE_EDGE_MISSING_DESCRIPTION" | "INVALID_BOUNDARY_FOLD" | "GRAPH_REFERENCE_CYCLE" | "UNSUPPORTED_GRAPH_BOUNDARY" | "DELEGATE_HOST_UNAVAILABLE";
    message: string;
    path: string;
}
export interface GraphValidationOptions {
    /** 当前执行载体已实现的 graph-node 边界。省略时只做结构校验。 */
    supportedBoundaries?: readonly GraphInvocationBoundary[];
    /** 当前注册/执行环境是否声明了 delegate host。 */
    delegateHostAvailable?: boolean;
}
export declare function validateGraph(graph: Graph | CoreGraph, options?: GraphValidationOptions): GraphValidationIssue[];
export declare function assertValidGraph(graph: Graph | CoreGraph, options?: GraphValidationOptions): void;
/**
 * 校验图中所有节点的工具配置。
 *
 * - 同一节点 tools 数组内有重复名 → 报错
 * - 如果提供 registeredNames，检查所有引用的工具是否已注册 → 报错
 *
 * defaultTools 与 node.tools 之间的重叠不做报错（那是故意注入），
 * 在 resolveNodeTools 中去重即可。
 */
export declare function validateGraphTools(graph: Graph, defaultTools: string[], registeredNames?: Set<string>, resolveTools?: (nodeId: string, nodeTools: readonly string[]) => readonly string[]): GraphValidationIssue[];
