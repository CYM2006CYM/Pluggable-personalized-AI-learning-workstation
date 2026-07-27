import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ContextSnapshot } from "../core/context.js";
import type { ReplayEventScope } from "../replay/events.js";
import type { CompletionSubmissionDecision, CompletionValidationStage, NodeCompletion, NodeContext } from "../type.js";
import type { AgentRunRequest } from "../type.js";
import { type ModelMessageFormatter } from "./model-messages.js";
export interface AgentRunMechanismLifecycle {
    beforeAgentRun(agentRunId: number, request: AgentRunRequest): Promise<{
        blocked: boolean;
        reason?: string;
    }>;
    validateCompletion(agentRunId: number, completion: NodeCompletion): Promise<{
        action: "allow";
        verifiedResult?: NodeCompletion["verifiedResult"];
    } | {
        action: "reject" | "fail-node" | "fail-graph";
        reason: string;
    }>;
    afterAgentRun(agentRunId: number): void;
}
export type AgentRunTelemetryEvent = {
    type: "output_contract.prepared";
    agentRunId: number;
    schemaFingerprint: string;
    schemaBytes: number;
} | {
    type: "completion.submitted";
    agentRunId: number;
    schemaFingerprint?: string;
} | {
    type: "completion.validation_started";
    agentRunId: number;
    validatorStage: CompletionValidationStage;
    schemaFingerprint?: string;
} | {
    type: "completion.accepted";
    agentRunId: number;
    completionStatus: NodeCompletion["status"];
    schemaFingerprint?: string;
    durationMs: number;
} | {
    type: "completion.rejected";
    agentRunId: number;
    reason: string;
    validatorStage?: CompletionValidationStage;
    schemaFingerprint?: string;
    durationMs: number;
} | {
    type: "completion.failed";
    agentRunId: number;
    scope: "node" | "graph";
    reason: string;
    validatorStage?: CompletionValidationStage;
    schemaFingerprint?: string;
    durationMs: number;
};
type CompletionState = "submitted" | "validating" | "accepted" | "rejected" | "failed";
export declare const CONTEXT_SNAPSHOT_MESSAGE_TYPE = "loop_graph_context";
export declare class PiNodeContext implements NodeContext {
    private readonly outputContractMaxBytes;
    private readonly telemetry?;
    readonly signal: AbortSignal;
    private pi;
    private currentNodeId;
    /** __graph_complete__ 捕获的 completion 列表（同节点内可能调多次） */
    private pendingCompletions;
    private readonly completionFingerprints;
    /** 活跃 run 的 resolve */
    private activeResolve;
    private activeRunId;
    private nextRunId;
    private readonly agentRunTimeoutMs;
    private readonly messageFormatter;
    private readonly completionValidationTimeoutMs;
    private nodeValidateFn;
    private routeValidateFn;
    private postMechanismValidateFn;
    private mechanismLifecycle;
    private validationInFlight;
    private activeOutputContract;
    private activeOutputContractMessage;
    private activeContextSnapshot;
    private contextProjectionCount;
    private foldableContextCompacted;
    private submissionQueue;
    private rejectionCount;
    private completionState;
    get completionSubmissionState(): CompletionState;
    constructor(pi: ExtensionAPI, agentRunTimeoutMs?: number, messageFormatter?: ModelMessageFormatter, completionValidationTimeoutMs?: number, outputContractMaxBytes?: number, telemetry?: ((event: AgentRunTelemetryEvent) => void) | undefined);
    private runValidateFn;
    runAgent(request: AgentRunRequest): Promise<NodeCompletion>;
    /**
     * 直接执行 pi 平台上的工具。当前占用位，未实现。
     *
     * 纯代码节点不需要此方法——你可以在 execute 里直接
     * import 并使用任何 Node.js 或第三方库：
     *
     * ```typescript
     * execute: async (instance, input, ctx) => {
     *   const data = fs.readFileSync(input.data.path, "utf-8");
     *   const result = await fetch("https://api.example.com", {...});
     *   return { nodeId: "parse", status: "ok", result: { data, result } };
     * }//讨论在有纯代码节点的前提下该功能是否必要
     * ```
     */
    callTool(_name: string, _input: Record<string, unknown>): Promise<unknown>;
    /** 当前节点内调用 __graph_complete__ 的次数 */
    get completeCount(): number;
    getActiveOutputContractMessage(): Readonly<Record<string, unknown>> | null;
    setContextSnapshot(snapshot: ContextSnapshot | null): void;
    markContextCompacted(): void;
    getContextSnapshotMessage(): Readonly<Record<string, unknown>> | null;
    getReplayScope(): ReplayEventScope | null;
    submitCompletion(params: {
        result: Record<string, unknown>;
    }): Promise<CompletionSubmissionDecision>;
    onAgentEnd(): Promise<void>;
    private processAgentEnd;
    private processCompletionSubmission;
    private rejectOrExhaust;
    setCurrentNodeId(nodeId: string): void;
    setNodeCompletionValidator(validate: AgentRunRequest["validateCompletion"]): void;
    setRouteCompletionValidator(validate: AgentRunRequest["validateCompletion"]): void;
    setPostMechanismCompletionValidator(validate: AgentRunRequest["validateCompletion"]): void;
    setMechanismLifecycle(lifecycle: AgentRunMechanismLifecycle | null): void;
    private runValidationStage;
    private emitValidationStarted;
    private emitTelemetry;
    private clearAgentRunArtifacts;
    reset(): void;
}
export {};
