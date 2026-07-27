import { createHash } from "node:crypto";
export async function finalizeJournal(options) {
    const issues = [...(options.initialIssues ?? [])];
    const events = [];
    let journal = "";
    try {
        journal = await options.store.readJournal(options.runId);
    }
    catch (error) {
        issues.push(`journal unavailable: ${errorMessage(error)}`);
    }
    const lines = journal.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim())
            continue;
        try {
            const parsed = JSON.parse(line);
            if (!isEnvelope(parsed, options.runId))
                throw new Error("invalid envelope");
            events.push(parsed);
        }
        catch {
            issues.push(`invalid journal line ${index + 1}`);
        }
    }
    for (let index = 0; index < events.length; index += 1) {
        if (events[index].sequence !== index + 1) {
            issues.push(`journal sequence gap at event ${index + 1}`);
            break;
        }
    }
    for (const envelope of events) {
        const data = envelope.event.data;
        if (!isArtifactRef(data))
            continue;
        await verifyArtifact(options.store, options.runId, data, issues);
    }
    if (isArtifactRef(options.result))
        await verifyArtifact(options.store, options.runId, options.result, issues);
    const totalCost = await calculateCost(events, options.store, options.runId, options.pricingResolver, issues);
    return Object.freeze({
        schemaVersion: 1,
        rootRunId: options.runId,
        mode: options.mode,
        createdAt: new Date().toISOString(),
        result: options.result,
        events: Object.freeze(events),
        recording: Object.freeze({
            status: issues.length === 0 ? "complete" : (events.length > 0 ? "incomplete" : "failed"),
            issues: Object.freeze(issues),
        }),
        ...(totalCost == null ? {} : { totalCost }),
    });
}
async function verifyArtifact(store, runId, artifact, issues) {
    try {
        const content = await store.readArtifact(runId, artifact.artifactId);
        const digest = createHash("sha256").update(content).digest("hex");
        if (digest !== artifact.sha256)
            issues.push(`artifact ${artifact.artifactId} checksum mismatch`);
    }
    catch (error) {
        issues.push(`artifact ${artifact.artifactId} unavailable: ${errorMessage(error)}`);
    }
}
async function calculateCost(events, store, runId, resolver, issues) {
    if (!resolver)
        return undefined;
    let total = 0;
    let found = false;
    for (const envelope of events) {
        if (envelope.event.type !== "model_turn_finished")
            continue;
        let data = envelope.event.data;
        if (isArtifactRef(data)) {
            try {
                data = JSON.parse(await store.readArtifact(runId, data.artifactId));
            }
            catch {
                continue;
            }
        }
        if (!isObject(data))
            continue;
        const { provider, model, usage } = data;
        if (typeof provider !== "string" || typeof model !== "string" || !isObject(usage))
            continue;
        try {
            const value = await resolver({ provider, model, usage });
            if (value != null) {
                total += value;
                found = true;
            }
        }
        catch (error) {
            issues.push(`pricing resolver failed: ${errorMessage(error)}`);
        }
    }
    return found ? total : undefined;
}
function isArtifactRef(value) {
    return isObject(value) && typeof value.artifactId === "string" && typeof value.sha256 === "string";
}
function isEnvelope(value, runId) {
    if (!isObject(value) || value.schemaVersion !== 1 || value.rootRunId !== runId)
        return false;
    if (!Number.isInteger(value.sequence) || value.sequence <= 0 || typeof value.timestamp !== "string")
        return false;
    return isObject(value.event) && typeof value.event.domain === "string" && typeof value.event.type === "string";
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
