import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CompletionSubmissionDecision } from "../type.js";
import type { Graph as CoreGraph } from "../core/graph.js";
import type { JsonValue } from "../core/json.js";
import type { Mechanism } from "../core/mechanism.js";
import type { GraphRunResult as CoreGraphRunResult } from "../core/result.js";
import type { InvocationLimits } from "../core/limits.js";
import type { RecordingMode } from "../core/result.js";
import type { HostBaseline } from "../host/baseline.js";
import type { SkillCatalog } from "../host/skill-catalog.js";
import { ToolCatalog, type UnsafeToolResolver } from "../host/tool-catalog.js";
import { type ModelMessageFormatter } from "./model-messages.js";
import type { NodeContextRenderer } from "./projection.js";
import type { GraphRef } from "../core/graph.js";
import { type RunStore } from "../replay/store.js";
import { Recorder } from "../replay/recorder.js";
import type { PricingResolver } from "../replay/events.js";
import type { InvocationAgentHost, InvocationAgentHostRequest } from "../runtime/graph-runtime.js";
export interface LoopGraphLimits {
    readonly rootMaxSteps?: number;
    readonly childMaxSteps?: number;
    readonly agentRunTimeoutMs?: number;
    readonly completionValidationTimeoutMs?: number;
}
export interface ContextRendererRegistry {
    readonly graphs?: Readonly<Record<string, NodeContextRenderer>>;
    readonly nodes?: Readonly<Record<string, Readonly<Record<string, NodeContextRenderer>>>>;
}
export interface LoopGraphExecutionOptions {
    readonly contextRenderer?: NodeContextRenderer;
    readonly signal?: AbortSignal;
    readonly limits?: Partial<InvocationLimits>;
    readonly maxSteps?: number;
    readonly recording?: RecordingMode;
    readonly recordingRequired?: boolean;
}
export interface CompletionFeedbackInput {
    readonly nodeId: string;
    readonly decision: CompletionSubmissionDecision;
}
export type CompletionFeedbackFormatter = (input: CompletionFeedbackInput) => string;
export declare const defaultCompletionFeedbackFormatter: CompletionFeedbackFormatter;
export interface LoopGraphExtensionOptions {
    readonly runtimeOnly?: boolean;
    /**
     * @internal Identifies one isolated Pi resource-loading lifecycle. Completion
     * tools must be registered once per such lifecycle, not once per process.
     */
    readonly protocolToolRegistrationScope?: object;
    readonly toolCatalog?: ToolCatalog;
    readonly skillCatalog?: SkillCatalog;
    readonly unsafeToolResolver?: UnsafeToolResolver;
    readonly baseline?: HostBaseline;
    readonly limits?: LoopGraphLimits;
    readonly outputContractMaxBytes?: number;
    readonly contextMaxBytes?: number;
    readonly mechanisms?: readonly Mechanism[];
    readonly modelMessageFormatter?: Partial<ModelMessageFormatter>;
    readonly completionFeedbackFormatter?: CompletionFeedbackFormatter;
    readonly recording?: RecordingMode;
    readonly recordingRequired?: boolean;
    readonly runStore?: RunStore;
    readonly artifactThresholdBytes?: number;
    readonly pricingResolver?: PricingResolver;
    readonly createInvocationAgentHost?: (request: InvocationAgentHostRequest, recorder: Recorder | null) => Promise<InvocationAgentHost>;
}
export interface LoopGraphExtension {
    registerGraph(graph: CoreGraph): void;
    exposeGraph(ref: GraphRef, exposure: GraphExposure): void;
    executeGraph(graph: CoreGraph, trigger: {
        readonly source: "command";
        readonly args?: string;
        readonly params?: Record<string, unknown>;
    } | {
        readonly source: "tool";
        readonly params?: Record<string, unknown>;
    }, options?: LoopGraphExecutionOptions): Promise<CoreGraphRunResult>;
    /** @internal Creates an Agent-only lane; it never owns a GraphRuntime. */
    createAgentHost(recorder?: Recorder | null): InvocationAgentHost;
}
export type GraphExposure = {
    readonly kind: "command";
    readonly name: string;
    readonly description?: string;
    readonly execution?: "isolated" | "current-session";
    readonly parseInput?: (args: string) => JsonValue;
} | {
    readonly kind: "tool";
    readonly name: string;
    readonly description?: string;
    readonly execution?: "isolated" | "current-session";
    readonly parameters?: ToolDefinition["parameters"];
    readonly parseInput?: (params: unknown) => JsonValue;
    readonly formatResult?: (result: CoreGraphRunResult) => unknown;
};
export declare function createLoopGraphExtension(pi: ExtensionAPI, options?: LoopGraphExtensionOptions): LoopGraphExtension;
