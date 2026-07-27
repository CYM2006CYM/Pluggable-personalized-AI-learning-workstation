import type { ContextContribution } from "../core/context.js";
import { type JsonValue } from "../core/json.js";
import type { Mechanism, MechanismCompletionDecision, MechanismContext, MechanismDecisionTrace, MechanismFailurePolicy, MechanismHookName, MechanismInstallation, MechanismScope } from "../core/mechanism.js";
export interface MechanismRuntimeOptions {
    readonly hookTimeoutMs?: number;
    readonly execRoot?: string;
    readonly execTimeoutMs?: number;
    readonly execMaxOutputBytes?: number;
    readonly allowExecOutsideRoot?: boolean;
    readonly pi?: unknown;
}
export interface MechanismFailureRecord {
    readonly mechanismName: string;
    readonly installation: MechanismInstallation;
    readonly hook: MechanismHookName | "createState" | "cleanup";
    readonly policy: MechanismFailurePolicy;
    readonly message: string;
    readonly error: unknown;
    readonly scopeId: string;
}
export declare class MechanismRuntimeError extends Error {
    readonly failure: MechanismFailureRecord;
    constructor(failure: MechanismFailureRecord);
}
interface Invocation {
    readonly definition: Mechanism;
    readonly installation: MechanismInstallation;
    readonly context: MechanismContext;
    readonly scope: ManagedScope;
}
export interface MechanismChain {
    readonly invocations: readonly Invocation[];
}
export declare class MechanismRuntime {
    private readonly warn?;
    private readonly options;
    private readonly activeNames;
    private readonly decisions;
    private readonly failures;
    private unmanagedWarningEmitted;
    private readonly contributions;
    private agentRunHandles;
    private naturalLifetime;
    constructor(options?: MechanismRuntimeOptions, warn?: ((message: string) => void) | undefined);
    get decisionTrace(): readonly MechanismDecisionTrace[];
    get failureTrace(): readonly MechanismFailureRecord[];
    get contextContributions(): readonly ContextContribution[];
    open(installation: MechanismInstallation, scopeId: string, definitions: readonly Mechanism[], identity: {
        rootRunId: string;
        graphInvocationId?: string;
        nodeVisitId?: string;
        stageId?: string;
    }, _contextState?: import("../core/context.js").ContextState): Promise<MechanismChain>;
    beforeAgentRun(chains: readonly MechanismChain[], agentRunId: string, prompt: string): Promise<void>;
    afterAgentRun(chains: readonly MechanismChain[], agentRunId: string): Promise<void>;
    enter(chains: readonly MechanismChain[], hookName: "onRootEnter" | "onGraphEnter" | "onNodeEnter"): Promise<void>;
    validateCompletion(chains: readonly MechanismChain[], agentRunId: string, completion: JsonValue): Promise<MechanismCompletionDecision>;
    nodeExit(chains: readonly MechanismChain[], completion: JsonValue): Promise<void>;
    nodeError(chains: readonly MechanismChain[], error: unknown): Promise<void>;
    graphExit(chains: readonly MechanismChain[], error?: unknown): Promise<void>;
    rootExit(chain: MechanismChain): Promise<void>;
    close(chain: MechanismChain): Promise<void>;
    /** Yield JSON-compatible snapshots for all mechanisms that implement snapshot. */
    snapshotAll(chains: readonly MechanismChain[]): readonly {
        readonly name: string;
        readonly snapshot: JsonValue;
    }[];
    /** Restore mechanism state from a checkpoint. A declared restore hook is fail-closed. */
    restoreState(chains: readonly MechanismChain[], saved: readonly {
        readonly name: string;
        readonly snapshot: JsonValue;
    }[]): void;
    private observe;
    private observeInvocation;
    private control;
    private createContext;
    private exec;
    private validateDuplicates;
    private record;
    private error;
    private failure;
}
declare class ManagedScope {
    readonly scopeId: string;
    private active;
    private readonly controller;
    private readonly cleanups;
    readonly view: MechanismScope;
    constructor(scopeId: string, installation: MechanismInstallation);
    close(): Promise<unknown[]>;
}
export {};
