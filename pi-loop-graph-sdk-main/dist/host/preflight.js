import { RUNTIME_PROTOCOL_TOOL_NAME, selectNodeToolNames, } from "./tool-catalog.js";
export class CapabilityPreflightError extends Error {
    code;
    phase;
    stageId;
    constructor(code, phase, message, stageId) {
        super(message);
        this.code = code;
        this.phase = phase;
        this.stageId = stageId;
        this.name = "CapabilityPreflightError";
    }
}
export function preflightGraphCapabilities(graph, host) {
    const policy = graph.tools ?? [];
    if (new Set(policy).size !== policy.length) {
        throw new CapabilityPreflightError("invalid-graph", "graph", `Graph Tool Policy contains duplicate names: ${graph.id}@${graph.version}`);
    }
    if (policy.includes(RUNTIME_PROTOCOL_TOOL_NAME)) {
        throw new CapabilityPreflightError("invalid-graph", "graph", `Graph Tool Policy cannot declare Runtime protocol tool: ${RUNTIME_PROTOCOL_TOOL_NAME}`);
    }
    if (policy.length > 0 && !host.toolCatalog) {
        throw new CapabilityPreflightError("tool-unavailable", "host", `Graph requires business tools but Host has no Tool Catalog: ${graph.id}@${graph.version}`);
    }
    for (const name of policy)
        assertToolAvailable(host.toolCatalog, name);
    assertSkillsAvailable(graph.skills, host.skillCatalog);
    for (const [stageId, stage] of Object.entries(graph.stages)) {
        const selected = resolveNodeToolNames(graph, stageId, stage.node, host);
        for (const name of selected) {
            if (name !== RUNTIME_PROTOCOL_TOOL_NAME)
                assertToolAvailable(host.toolCatalog, name, stageId);
        }
        assertSkillsAvailable(stage.node.skills, host.skillCatalog, stageId);
    }
}
export function resolveNodeToolNames(graph, stageId, node, host) {
    const policy = graph.tools ?? [];
    const nodeTools = node.kind === "graph" ? undefined : node.tools;
    const requested = nodeTools === "all" ? policy : (nodeTools ?? []);
    if (!host.unsafeToolResolver) {
        try {
            return selectNodeToolNames(graph, node);
        }
        catch (error) {
            throw new CapabilityPreflightError("invalid-graph", "graph", error instanceof Error ? error.message : String(error), stageId);
        }
    }
    const names = host.unsafeToolResolver(Object.freeze({
        graph,
        stageId,
        node,
        selected: Object.freeze([...requested]),
        hostTools: host.toolCatalog?.names ?? [],
    }));
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.length === 0)) {
        throw new CapabilityPreflightError("invalid-graph", "host", "UnsafeToolResolver must return non-empty tool names", stageId);
    }
    return Object.freeze([...new Set(names)]);
}
function assertToolAvailable(catalog, name, stageId) {
    if (!catalog?.has(name)) {
        throw new CapabilityPreflightError("tool-unavailable", "host", `Host tool unavailable: ${name}`, stageId);
    }
}
function assertSkillsAvailable(refs, catalog, stageId) {
    for (const ref of refs ?? []) {
        let resolved;
        try {
            resolved = catalog?.resolve(ref);
        }
        catch (error) {
            if (!ref.required)
                continue;
            throw new CapabilityPreflightError("host-unavailable", "host", `Required Skill resolution failed: ${ref.name}${ref.version ? `@${ref.version}` : ""}: ${error instanceof Error ? error.message : String(error)}`, stageId);
        }
        if (!ref.required || resolved)
            continue;
        throw new CapabilityPreflightError("host-unavailable", "host", `Required Skill unavailable: ${ref.name}${ref.version ? `@${ref.version}` : ""}`, stageId);
    }
}
