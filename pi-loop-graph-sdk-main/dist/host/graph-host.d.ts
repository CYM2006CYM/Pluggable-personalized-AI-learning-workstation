import type { TSchema } from "typebox";
import type { Graph, SchemaValue } from "../core/graph.js";
import type { InvocationLimits } from "../core/limits.js";
import type { GraphRunResult } from "../core/result.js";
import type { RecordingMode } from "../core/result.js";
import { type GraphRuntimeHost } from "../runtime/graph-runtime.js";
import { type RunStore, type CheckpointStore } from "../replay/store.js";
import type { PricingResolver } from "../replay/events.js";
export interface GraphHostRunOptions {
    readonly signal?: AbortSignal;
    readonly limits?: Partial<InvocationLimits>;
    readonly maxSteps?: number;
    readonly recording?: RecordingMode;
    readonly recordingRequired?: boolean;
}
export interface GraphHostResumeOptions {
    readonly runId: string;
    readonly signal?: AbortSignal;
    readonly maxSteps?: number;
    readonly checkpointMigrator?: (saved: {
        readonly id: string;
        readonly version: string;
    }) => {
        readonly id: string;
        readonly version: string;
    };
    readonly recording?: RecordingMode;
    readonly recordingRequired?: boolean;
}
export interface GraphHost {
    execute<TInputSchema extends TSchema, TOutputSchema extends TSchema>(graph: Graph<TInputSchema, TOutputSchema>, input: SchemaValue<TInputSchema>, options?: GraphHostRunOptions): Promise<GraphRunResult<SchemaValue<TOutputSchema>>>;
    resume<TInputSchema extends TSchema, TOutputSchema extends TSchema>(graph: Graph<TInputSchema, TOutputSchema>, options: GraphHostResumeOptions): Promise<GraphRunResult<SchemaValue<TOutputSchema>>>;
    dispose(): Promise<void>;
}
export interface CreateGraphHostOptions {
    readonly runtime?: GraphRuntimeHost;
    readonly limits?: InvocationLimits;
    readonly dispose?: () => void | Promise<void>;
    readonly recording?: RecordingMode;
    readonly recordingRequired?: boolean;
    readonly runStore?: RunStore;
    readonly checkpointStore?: CheckpointStore;
    readonly artifactThresholdBytes?: number;
    readonly pricingResolver?: PricingResolver;
}
/** Owns one Core Runtime execution lane. Concurrent roots require separate hosts. */
export declare function createGraphHost(options?: CreateGraphHostOptions): GraphHost;
export interface ExecuteIsolatedGraphOptions<TInput> extends GraphHostRunOptions {
    readonly input: TInput;
    readonly createHost: () => GraphHost | Promise<GraphHost>;
}
/** Creates, runs and always disposes a one-shot host. */
export declare function executeIsolatedGraph<TInputSchema extends TSchema, TOutputSchema extends TSchema>(graph: Graph<TInputSchema, TOutputSchema>, options: ExecuteIsolatedGraphOptions<SchemaValue<TInputSchema>>): Promise<GraphRunResult<SchemaValue<TOutputSchema>>>;
