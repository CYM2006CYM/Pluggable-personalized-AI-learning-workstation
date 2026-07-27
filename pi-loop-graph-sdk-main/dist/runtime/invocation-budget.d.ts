import type { InvocationLimits } from "../core/limits.js";
export interface InvocationBudgetUsage {
    readonly graphInvocations: number;
    readonly nodeVisits: number;
    readonly maxDepthReached: number;
}
export declare class InvocationBudgetExceededError extends Error {
    readonly kind: "graph-depth" | "graph-invocations" | "node-visits";
    constructor(kind: "graph-depth" | "graph-invocations" | "node-visits", message: string);
}
export declare class InvocationBudget {
    readonly limits: InvocationLimits;
    private graphInvocations;
    private nodeVisits;
    private maxDepthReached;
    constructor(limits: InvocationLimits);
    enterGraph(depth: number): void;
    enterNode(): void;
    get usage(): InvocationBudgetUsage;
    /** Restore budget position from a saved checkpoint. New usage must be at least as high. */
    restore(usage: InvocationBudgetUsage): void;
}
