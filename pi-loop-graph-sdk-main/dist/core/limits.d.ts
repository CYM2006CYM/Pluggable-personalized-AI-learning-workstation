export interface InvocationLimits {
    readonly maxGraphDepth: number;
    readonly maxGraphInvocations: number;
    readonly maxTotalNodeVisits: number;
}
export declare const DEFAULT_INVOCATION_LIMITS: InvocationLimits;
export declare function resolveInvocationLimits(limits?: Partial<InvocationLimits>): InvocationLimits;
