import type { TSchema } from "typebox";
import type { AgentNodeDefinition, AgentRunRequest, CodeNodeDefinition, Graph, GraphRef, SchemaValue } from "../core/graph.js";
import type { InvocationLimits } from "../core/limits.js";
import type { GraphFailure, GraphRunResult } from "../core/result.js";
import type { JsonValue } from "../core/json.js";
import type { Mechanism, MechanismCompletionDecision } from "../core/mechanism.js";
import { type ContextSnapshot } from "../core/context.js";
import type { ResolvedSkillView } from "../core/skill.js";
import type { GraphCatalog } from "../host/graph-catalog.js";
import type { HostBaseline } from "../host/baseline.js";
import type { SkillCatalog } from "../host/skill-catalog.js";
import { type ToolCatalog, type ToolImplementation, type UnsafeToolResolver } from "../host/tool-catalog.js";
import { RuntimeEventBus } from "./event-bus.js";
import { InvocationBudget } from "./invocation-budget.js";
import { type MechanismChain, type MechanismRuntimeOptions } from "./mechanism-runtime.js";
import type { CheckpointStore } from "../replay/store.js";
export type InvocationBoundary = "root" | "call" | "compose" | "delegate";
export interface RootRunState {
    readonly rootRunId: string;
    readonly startedAt: number;
    readonly budget: InvocationBudget;
    readonly signal?: AbortSignal;
    readonly baseline: HostBaseline;
}
export interface GraphInvocationState {
    readonly graphInvocationId: string;
    readonly rootRunId: string;
    readonly parentGraphInvocationId?: string;
    readonly graph: GraphRef;
    readonly boundary: InvocationBoundary;
    readonly depth: number;
    readonly frames: JsonValue[];
    readonly frameRevision: {
        value: number;
    };
}
export interface NodeVisitState {
    readonly nodeVisitId: string;
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly stageId: string;
    readonly visit: number;
}
export interface AgentRunState {
    readonly agentRunId: string;
    readonly rootRunId: string;
    readonly graphInvocationId: string;
    readonly nodeVisitId: string;
    readonly index: number;
}
export interface AgentExecutionContext {
    readonly root: RootRunState;
    readonly invocation: GraphInvocationState;
    readonly nodeVisit: NodeVisitState;
    readonly agentRun: AgentRunState;
    readonly tools: readonly ToolImplementation[];
    readonly skills: readonly ResolvedSkillView[];
    readonly baseline: HostBaseline;
    readonly snapshot: ContextSnapshot;
    readonly mechanisms?: MechanismChain;
    validateNodeCompletion(result: JsonValue): Promise<{
        readonly valid: boolean;
        readonly reason?: string;
    }>;
    validateRouteStructure(result: JsonValue): Promise<{
        readonly valid: boolean;
        readonly reason?: string;
    }>;
    validateMechanismCompletion(result: JsonValue): Promise<MechanismCompletionDecision>;
    validateAgentChoice(result: JsonValue): Promise<{
        readonly valid: boolean;
        readonly reason?: string;
    }>;
    invokeGraph(ref: GraphRef, input: JsonValue, boundary?: Exclude<InvocationBoundary, "root">): Promise<InvocationOutcome>;
}
export interface DelegateGraphRequest {
    readonly graph: Graph;
    readonly input: JsonValue;
    readonly root: RootRunState;
    readonly parentInvocation: GraphInvocationState;
    readonly execute: () => Promise<InvocationOutcome>;
}
export interface InvocationAgentHost {
    runAgent?: GraphRuntimeHost["runAgent"];
    runAgentFromCode?: GraphRuntimeHost["runAgentFromCode"];
    dispose(): void | Promise<void>;
}
export interface InvocationAgentHostRequest {
    readonly root: RootRunState;
    readonly invocation: GraphInvocationState;
}
export interface GraphRuntimeHost {
    /** Hard upper bound; per-run limits may only reduce these values. */
    readonly limits?: InvocationLimits;
    readonly catalog?: GraphCatalog;
    readonly eventBus?: RuntimeEventBus;
    readonly toolCatalog?: ToolCatalog;
    readonly skillCatalog?: SkillCatalog;
    readonly unsafeToolResolver?: UnsafeToolResolver;
    readonly protocolTools?: readonly ToolImplementation[];
    readonly baseline?: HostBaseline;
    /** Maximum UTF-8 bytes of canonical sticky context allowed before an Agent Run. */
    readonly maxStickyContextBytes?: number;
    readonly mechanisms?: readonly Mechanism[];
    readonly mechanismRuntime?: MechanismRuntimeOptions;
    /** Store for persisting node-boundary checkpoints. */
    readonly checkpointStore?: CheckpointStore;
    runAgent?(node: AgentNodeDefinition, input: JsonValue, context: AgentExecutionContext): Promise<JsonValue>;
    runAgentFromCode?(request: AgentRunRequest, node: CodeNodeDefinition, context: AgentExecutionContext): Promise<JsonValue>;
    resolveGraph?(ref: GraphRef): Graph | undefined;
    delegateGraph?(request: DelegateGraphRequest): Promise<InvocationOutcome>;
    /** Creates an Agent execution lane for one call/compose Graph Invocation. */
    createInvocationAgentHost?(request: InvocationAgentHostRequest): Promise<InvocationAgentHost>;
}
/** Lets an Agent host terminate execution with a stable Runtime failure. */
export declare class AgentExecutionFailure extends Error {
    readonly failure: GraphFailure;
    constructor(failure: GraphFailure);
}
export interface GraphExecutionOptions {
    readonly limits?: Partial<InvocationLimits>;
    readonly signal?: AbortSignal;
    readonly maxSteps?: number;
}
export interface InvocationOutcome {
    readonly status: "completed" | "failed" | "cancelled";
    readonly output?: JsonValue;
    readonly failure?: GraphFailure;
}
export declare class GraphRuntime {
    private readonly host;
    readonly eventBus: RuntimeEventBus;
    private readonly mechanismRuns;
    private readonly invocationAgentHosts;
    private readonly activeInvocations;
    private readonly activeGraphMechanisms;
    constructor(host?: GraphRuntimeHost);
    execute<TInputSchema extends TSchema, TOutputSchema extends TSchema>(graph: Graph<TInputSchema, TOutputSchema>, input: SchemaValue<TInputSchema>, options?: number | GraphExecutionOptions): Promise<GraphRunResult<SchemaValue<TOutputSchema>>>;
    private runInvocation;
    private exitInvocation;
    private executeNode;
    private runAgent;
    private runCodeAgent;
    private beginAgent;
    private finishAgent;
    private createAgentContext;
    private assertStickyContextBudget;
    private executeGraphNode;
    private invokeGraph;
    private validateGraphTools;
    private resolveNodeCapabilities;
    private resolveSkills;
    private resolveGraph;
    private buildInvocationStack;
    private writeNodeCheckpoint;
    /** Resume a root graph run from the latest checkpoint. */
    resume<TInputSchema extends TSchema, TOutputSchema extends TSchema>(graph: Graph<TInputSchema, TOutputSchema>, options: {
        readonly runId: string;
        readonly signal?: AbortSignal;
        readonly checkpointMigrator?: (saved: {
            readonly id: string;
            readonly version: string;
        }) => {
            readonly id: string;
            readonly version: string;
        };
        readonly maxSteps?: number;
    }): Promise<GraphRunResult<SchemaValue<TOutputSchema>>>;
    private resumeFromCheckpoint;
    private executeNodeWithResume;
    private assertNotCancelled;
    private validateSchemaBoundary;
}
