import type { Graph, NodeDefinition } from "../core/graph.js";
import type { TSchema } from "typebox";
export declare const RUNTIME_PROTOCOL_TOOL_NAME: "__graph_complete__";
export interface ToolImplementation {
    readonly name: string;
    readonly label?: string;
    readonly description?: string;
    readonly parameters?: TSchema;
    readonly execute?: (...args: readonly unknown[]) => unknown | Promise<unknown>;
    readonly protocol?: boolean;
}
export interface UnsafeToolResolverInput {
    readonly graph: Graph;
    readonly stageId: string;
    readonly node: NodeDefinition;
    readonly selected: readonly string[];
    readonly hostTools: readonly string[];
}
export type UnsafeToolResolver = (input: UnsafeToolResolverInput) => readonly string[];
export declare class ToolCatalog {
    private readonly tools;
    register(tool: ToolImplementation): void;
    has(name: string): boolean;
    resolve(name: string): ToolImplementation | undefined;
    get names(): readonly string[];
}
export declare function selectNodeToolNames(graph: Graph, node: NodeDefinition): readonly string[];
