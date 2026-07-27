import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentRunRequest, AgentInstance, Mechanism, MechanismContext, MechanismDecisionLog, MechanismExec, MechanismEvents, MechanismFailurePolicy, MechanismScope } from "../type.js";
import type { NodeScopeDescriptor } from "../runtime.js";
export interface MechanismCleanupError {
    mechanismName: string;
    error: unknown;
}
export type MechanismFailurePhase = "createState" | "onNodeEnter" | "onNodeExit" | "onNodeError" | "beforeAgentRun" | "onTurnStart" | "onTurnEnd" | "onToolStart" | "onToolResult" | "beforeToolCall" | "afterToolResult" | "validateCompletion" | "tool_result" | "turn_start" | "turn_end";
export interface MechanismFailureRecord {
    mechanismName: string;
    phase: MechanismFailurePhase;
    policy: MechanismFailurePolicy;
    error: unknown;
    reason: string;
    scopeId: string;
}
export interface MechanismStateResolution {
    state: unknown;
    initializationFailed: boolean;
    initializationError?: unknown;
}
export interface MechanismHookInvocation {
    mechanism: Mechanism<any>;
    context: MechanismContext<any>;
    initializationFailure?: unknown;
}
export interface MechanismRunStartResult {
    blocked: boolean;
    reason?: string;
}
export interface MechanismRuntimeOptions {
    execRoot?: string;
    execTimeoutMs?: number;
    execMaxOutputBytes?: number;
    allowExecOutsideRoot?: boolean;
    eventMaxBytes?: number;
    completionValidationTimeoutMs?: number;
}
export type MechanismCompletionGateResult = {
    action: "allow";
    verifiedResult?: Readonly<{
        checks: readonly import("../type.js").MechanismVerifiedResultEntry[];
    }>;
} | {
    action: "reject" | "fail-node" | "fail-graph";
    reason: string;
};
/**
 * mechanism state 的唯一所有者：每个 AgentInstance、每个 mechanism 对象一份。
 * WeakMap 不延长 instance 或 mechanism definition 的生命周期。
 */
export declare class MechanismStateStore {
    private readonly states;
    resolve(instance: AgentInstance, mechanism: Mechanism): MechanismStateResolution;
}
/** 同一 node visit 中全部 mechanism invocation 的所有者。 */
export declare class MechanismInvocationGroup {
    private readonly descriptor;
    private readonly runtimeScopeIsCurrent;
    private readonly invocations;
    private closed;
    constructor(descriptor: NodeScopeDescriptor, runtimeScopeIsCurrent: () => boolean);
    createScope(mechanismName: string): MechanismScope;
    close(): Promise<MechanismCleanupError[]>;
}
/**
 * pi 每类事件只注册一个底层 handler；node visit 内的订阅由 scope 托管。
 * handler 控制性失败先记录，随后由图循环在安全检查点消费。
 */
export declare class MechanismEventBroker {
    private readonly reportFailure;
    private readonly subscribers;
    private readonly pendingFailures;
    private readonly decisionTraces;
    private activeRun;
    private readonly pi;
    private readonly options;
    constructor(pi: ExtensionAPI, reportFailure: (failure: MechanismFailureRecord) => void, options?: MechanismRuntimeOptions);
    createExec(scope: MechanismScope): MechanismExec;
    createDecisionLog(scope: MechanismScope): MechanismDecisionLog;
    beginAgentRun(agentRunId: number, request: AgentRunRequest, invocations: readonly MechanismHookInvocation[]): Promise<MechanismRunStartResult>;
    endAgentRun(agentRunId: number): void;
    validateCompletion(agentRunId: number, completion: import("../type.js").NodeCompletion): Promise<MechanismCompletionGateResult>;
    createEvents(mechanismName: string, policy: MechanismFailurePolicy, scope: MechanismScope): MechanismEvents;
    consumeControlFailures(scopeId: string): MechanismFailureRecord[];
    private handleToolCall;
    private handleToolResult;
    private createToolResultView;
    private invokeObservationHook;
    private validateToolInput;
    private recordHookFailure;
    private recordCompletionDecisionFailure;
    private recordDecision;
    private subscribe;
    private removeSubscriber;
    private dispatch;
}
