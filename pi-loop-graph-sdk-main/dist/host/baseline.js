export const DEFAULT_HOST_BASELINE = Object.freeze({ kind: "isolated" });
export function resolveHostBaseline(baseline) {
    return Object.freeze({ ...(baseline ?? DEFAULT_HOST_BASELINE) });
}
