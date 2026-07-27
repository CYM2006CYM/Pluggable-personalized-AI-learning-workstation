export declare const FRAMEWORK_TOOLS: readonly ["read", "__graph_complete__"];
export interface ToolResolverInput {
    readonly defaultTools: readonly string[];
    readonly nodeTools: readonly string[];
    readonly frameworkTools: typeof FRAMEWORK_TOOLS;
    readonly graphId?: string;
    readonly nodeId?: string;
}
/** 返回候选工具；SDK 随后统一去重并恢复 framework tools 的首尾不变量。 */
export type ToolResolver = (input: ToolResolverInput) => readonly string[];
export declare const defaultToolResolver: ToolResolver;
/**
 * 计算节点的最终工具列表。
 *
 * 规则：
 *   [read, ...defaultTools, ...nodeTools, __graph_complete__]
 *   去重（保留首次出现的位置），read 始终在第一位，
 *   __graph_complete__ 始终在最后。
 */
export declare function resolveNodeTools(defaultTools: readonly string[], nodeTools: readonly string[], resolver?: ToolResolver, identity?: Pick<ToolResolverInput, "graphId" | "nodeId">): string[];
