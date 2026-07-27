import type { ContextContent, ContextProjection, Graph, Stage } from "./graph.js";
import type { JsonValue } from "./json.js";
import type { ResolvedSkillView } from "./skill.js";
export type ContextRetention = "sticky" | "foldable" | "transient";
export type ContextLifetime = "agent-run" | "node-visit" | "graph-invocation" | "root-run";
export interface ContextContribution {
    readonly id: string;
    readonly owner: "host" | "graph" | "node" | "agent-run" | "runtime";
    readonly scopeId: string;
    readonly lifetime: ContextLifetime;
    readonly retention: ContextRetention;
    readonly content: ContextContent;
}
export interface ContextContributionHandle {
    readonly id: string;
    update(content: ContextContent): void;
    dispose(): void;
}
export interface ContextLayer {
    readonly name: "host" | "graph" | "memory" | "node" | "mechanism" | "output-contract" | "prompt";
    readonly scopeId: string;
    readonly retention: ContextRetention;
    readonly content: ContextContent;
}
export interface ContextSnapshot {
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId?: string;
    readonly agentRunId?: string;
    readonly graphId: string;
    readonly graphVersion: string;
    readonly memoryRevision: number;
    readonly layers: readonly ContextLayer[];
    readonly contributions: readonly ContextContribution[];
}
export interface ContextStateOptions {
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly graph: Graph;
    readonly graphInput: JsonValue;
    readonly graphSkills: readonly ResolvedSkillView[];
    readonly frames: readonly JsonValue[];
    readonly hostContent?: ContextContent | null;
    readonly frameRevision?: {
        value: number;
    };
    readonly externalContributions?: (nodeVisitId?: string) => readonly ContextContribution[];
}
export interface NodeContextMaterialization {
    readonly nodeVisitId: string;
    readonly stageId: string;
    readonly snapshot: ContextSnapshot;
}
/** Canonical, scope-owned context state for one Graph Invocation. */
export declare class ContextState {
    private readonly options;
    private graphLayers;
    private readonly contributions;
    private readonly frameRevision;
    private memoryCache;
    constructor(options: ContextStateOptions);
    initialize(): Promise<void>;
    bumpMemoryRevision(): void;
    materializeNode(nodeVisitId: string, stageId: string, stage: Stage, nodeInput: JsonValue, nodeSkills: readonly ResolvedSkillView[]): Promise<NodeContextMaterialization>;
    snapshot(nodeVisitId?: string, layers?: readonly ContextLayer[]): ContextSnapshot;
    refreshSnapshot(snapshot: ContextSnapshot, agentRunId?: string): ContextSnapshot;
    addContribution(contribution: ContextContribution): ContextContributionHandle;
    private materializeMemory;
}
export declare function materializeProjection<TSource, TSelected extends JsonValue, TMeta>(projection: ContextProjection<TSource, TSelected, TMeta>, source: TSource, meta: TMeta, fallback: (input: {
    readonly selected: Readonly<TSelected> | null;
    readonly meta: Readonly<TMeta>;
}) => ContextContent | null): Promise<ContextContent | null>;
