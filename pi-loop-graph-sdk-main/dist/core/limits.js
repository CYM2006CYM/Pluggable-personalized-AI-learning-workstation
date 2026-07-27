export const DEFAULT_INVOCATION_LIMITS = Object.freeze({
    maxGraphDepth: 8,
    maxGraphInvocations: 64,
    maxTotalNodeVisits: 500,
});
export function resolveInvocationLimits(limits = {}) {
    const resolved = { ...DEFAULT_INVOCATION_LIMITS, ...limits };
    for (const [name, value] of Object.entries(resolved)) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive integer`);
        }
    }
    return Object.freeze(resolved);
}
