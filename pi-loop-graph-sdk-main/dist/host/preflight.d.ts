import type { Graph, NodeDefinition } from "../core/graph.js";
import type { SkillCatalog } from "./skill-catalog.js";
import { type ToolCatalog, type UnsafeToolResolver } from "./tool-catalog.js";
export type CapabilityPreflightCode = "invalid-graph" | "tool-unavailable" | "host-unavailable";
export declare class CapabilityPreflightError extends Error {
    readonly code: CapabilityPreflightCode;
    readonly phase: "graph" | "host";
    readonly stageId?: string | undefined;
    constructor(code: CapabilityPreflightCode, phase: "graph" | "host", message: string, stageId?: string | undefined);
}
export interface CapabilityPreflightHost {
    readonly toolCatalog?: ToolCatalog;
    readonly skillCatalog?: SkillCatalog;
    readonly unsafeToolResolver?: UnsafeToolResolver;
}
export declare function preflightGraphCapabilities(graph: Graph, host: CapabilityPreflightHost): void;
export declare function resolveNodeToolNames(graph: Graph, stageId: string, node: NodeDefinition, host: Pick<CapabilityPreflightHost, "toolCatalog" | "unsafeToolResolver">): readonly string[];
