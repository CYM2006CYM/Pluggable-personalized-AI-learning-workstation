import type { GraphFailure } from "../core/result.js";
import type { InvocationBudgetUsage } from "./invocation-budget.js";
export type RuntimeEvent = {
    readonly type: "root_started";
    readonly rootRunId: string;
    readonly graphId: string;
    readonly graphVersion: string;
} | {
    readonly type: "host_baseline_selected";
    readonly rootRunId: string;
    readonly baseline: "isolated" | "inherit" | "custom";
    readonly id?: string;
    readonly fingerprint?: string;
} | {
    readonly type: "root_finished";
    readonly rootRunId: string;
    readonly status: "completed" | "failed" | "cancelled";
    readonly usage: InvocationBudgetUsage;
} | {
    readonly type: "graph_entered";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly parentGraphInvocationId?: string;
    readonly graphId: string;
    readonly graphVersion: string;
    readonly boundary: "root" | "call" | "compose" | "delegate";
    readonly depth: number;
} | {
    readonly type: "graph_exited";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly status: "completed" | "failed" | "cancelled";
    readonly failure?: GraphFailure;
} | {
    readonly type: "node_entered";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly stageId: string;
    readonly visit: number;
} | {
    readonly type: "node_exited";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly stageId: string;
} | {
    readonly type: "agent_started";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly agentRunId: string;
    readonly index: number;
} | {
    readonly type: "agent_finished";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly agentRunId: string;
} | {
    readonly type: "context_snapshot_materialized";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly memoryRevision: number;
    readonly layerCount: number;
} | {
    readonly type: "mechanism_scope_opened" | "mechanism_scope_closed";
    readonly rootRunId: string;
    readonly graphInvocationId?: string;
    readonly nodeVisitId?: string;
    readonly installation: "host" | "graph" | "node";
    readonly count: number;
} | {
    readonly type: "transition_selected";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly stageId: string;
    readonly connectionId: string;
    readonly target: string;
} | {
    readonly type: "checkpoint_saved";
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly checkpointId: string;
    readonly nextStageId: string;
} | {
    readonly type: "runtime_warning";
    readonly rootRunId: string;
    readonly graphInvocationId?: string;
    readonly stageId?: string;
    readonly code: "unsafe-tool-policy-bypass" | "unsafe-host-baseline" | "unmanaged-mechanism-access";
    readonly message: string;
};
export type RuntimeEventListener = (event: RuntimeEvent) => void;
export declare class RuntimeEventBus {
    private readonly listeners;
    subscribe(listener: RuntimeEventListener): () => void;
    emit(event: RuntimeEvent): void;
}
