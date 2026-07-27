export const CHECKPOINT_SCHEMA_VERSION = 1;
export function encodeCheckpoint(checkpoint) {
    assertCheckpoint(checkpoint);
    return JSON.stringify(checkpoint);
}
export function decodeCheckpoint(content) {
    let value;
    try {
        value = JSON.parse(content);
    }
    catch (error) {
        throw new Error(`Invalid checkpoint JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    assertCheckpoint(value);
    return value;
}
function assertCheckpoint(value) {
    if (!isRecord(value) || value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || value.kind !== "node-boundary") {
        throw new Error(`Unsupported checkpoint schema: expected node-boundary v${CHECKPOINT_SCHEMA_VERSION}`);
    }
    if (!isNonEmpty(value.checkpointId) || !isNonEmpty(value.rootRunId) || !isNonEmpty(value.graph?.id) || !isNonEmpty(value.graph?.version)) {
        throw new Error("Checkpoint identity is incomplete");
    }
    if (!Array.isArray(value.invocationStack) || value.invocationStack.length === 0 || !Array.isArray(value.frames) || !Array.isArray(value.mechanisms)) {
        throw new Error("Checkpoint collections are invalid");
    }
    if (!isRecord(value.next) || !isNonEmpty(value.next.stageId) || !Number.isInteger(value.resumeAttempt) || value.resumeAttempt < 0) {
        throw new Error("Checkpoint next boundary is invalid");
    }
    if (value.createdAt !== undefined && (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)))) {
        throw new Error("Checkpoint createdAt is invalid");
    }
    for (const entry of value.invocationStack) {
        if (!isRecord(entry) || !isNonEmpty(entry.graphInvocationId) || !Number.isInteger(entry.depth) || entry.depth < 1
            || !["root", "call", "compose", "delegate"].includes(entry.boundary))
            throw new Error("Checkpoint invocation stack is invalid");
    }
    if (!isJson(value.next.nodeInput) || !value.frames.every(isJson) || !isJson(value.budget)
        || !value.mechanisms.every((item) => isRecord(item) && isNonEmpty(item.name) && isJson(item.snapshot))) {
        throw new Error("Checkpoint payload is not JSON-compatible");
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmpty(value) {
    return typeof value === "string" && value.length > 0;
}
function isJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isJson);
    return isRecord(value) && Object.values(value).every(isJson);
}
