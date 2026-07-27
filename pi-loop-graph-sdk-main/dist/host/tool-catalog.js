export const RUNTIME_PROTOCOL_TOOL_NAME = "__graph_complete__";
export class ToolCatalog {
    tools = new Map();
    register(tool) {
        if (!tool.name || tool.name === RUNTIME_PROTOCOL_TOOL_NAME) {
            throw new Error(`Invalid business tool name: ${tool.name}`);
        }
        if (this.tools.has(tool.name))
            throw new Error(`Tool already registered: ${tool.name}`);
        this.tools.set(tool.name, Object.freeze({ ...tool }));
    }
    has(name) {
        return this.tools.has(name);
    }
    resolve(name) {
        return this.tools.get(name);
    }
    get names() {
        return Object.freeze([...this.tools.keys()]);
    }
}
export function selectNodeToolNames(graph, node) {
    const policy = graph.tools ?? [];
    const nodeTools = node.kind === "graph" ? undefined : node.tools;
    const selected = nodeTools === "all" ? policy : (nodeTools ?? []);
    const allowed = new Set(policy);
    for (const name of selected) {
        if (!allowed.has(name)) {
            throw new Error(`Node selects tool outside Graph policy: ${name}`);
        }
    }
    return Object.freeze([...new Set(selected)]);
}
