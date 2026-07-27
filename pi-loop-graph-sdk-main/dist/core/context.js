/** Canonical, scope-owned context state for one Graph Invocation. */
export class ContextState {
    options;
    graphLayers = Object.freeze([]);
    contributions = new Map();
    frameRevision;
    memoryCache = null;
    constructor(options) {
        this.options = options;
        this.frameRevision = options.frameRevision ?? { value: 0 };
    }
    async initialize() {
        const { graph, graphInput, graphSkills } = this.options;
        const background = await materializeProjection(graph.context.background, graphInput, {
            graph: { id: graph.id, version: graph.version, goal: graph.goal },
            skills: graphSkills,
        }, defaultGraphRenderer);
        this.graphLayers = Object.freeze([
            ...(this.options.hostContent == null ? [] : [{
                    name: "host",
                    scopeId: this.options.rootRunId,
                    retention: "sticky",
                    content: this.options.hostContent,
                }]),
            ...(background == null ? [] : [{
                    name: "graph",
                    scopeId: this.options.graphInvocationId,
                    retention: "sticky",
                    content: background,
                }]),
        ]);
    }
    bumpMemoryRevision() {
        this.frameRevision.value += 1;
    }
    async materializeNode(nodeVisitId, stageId, stage, nodeInput, nodeSkills) {
        const memory = await this.materializeMemory();
        const nodeLayer = stage.node.kind === "graph"
            ? null
            : await materializeNodeLayer(stage.node, stage, nodeInput, nodeSkills, nodeVisitId);
        const layers = [...this.graphLayers];
        if (memory != null) {
            layers.push({
                name: "memory",
                scopeId: this.options.graphInvocationId,
                retention: "foldable",
                content: memory,
            });
        }
        if (nodeLayer)
            layers.push(nodeLayer);
        return {
            nodeVisitId,
            stageId,
            snapshot: this.snapshot(nodeVisitId, layers),
        };
    }
    snapshot(nodeVisitId, layers = this.graphLayers) {
        const contributions = [
            ...(this.options.externalContributions?.(nodeVisitId) ?? []),
            ...this.contributions.values(),
        ];
        const mechanismLayers = ["sticky", "foldable", "transient"].flatMap((retention) => {
            const content = contributions
                .filter((item) => item.retention === retention)
                .flatMap((item) => typeof item.content === "string"
                ? [{ type: "text", text: item.content }]
                : item.content);
            return content.length === 0 ? [] : [{
                    name: "mechanism",
                    scopeId: nodeVisitId ?? this.options.graphInvocationId,
                    retention,
                    content: Object.freeze(content.map((block) => Object.freeze({ ...block }))),
                }];
        });
        const projectedLayers = [...layers, ...mechanismLayers];
        return Object.freeze({
            rootRunId: this.options.rootRunId,
            graphInvocationId: this.options.graphInvocationId,
            nodeVisitId,
            graphId: this.options.graph.id,
            graphVersion: this.options.graph.version,
            memoryRevision: this.frameRevision.value,
            layers: Object.freeze(projectedLayers.map((layer) => Object.freeze({ ...layer }))),
            contributions: Object.freeze(contributions.map((item) => Object.freeze({ ...item }))),
        });
    }
    refreshSnapshot(snapshot, agentRunId) {
        return Object.freeze({
            ...this.snapshot(snapshot.nodeVisitId, snapshot.layers.filter((layer) => layer.name !== "mechanism")),
            ...(agentRunId === undefined ? {} : { agentRunId }),
        });
    }
    addContribution(contribution) {
        if (this.contributions.has(contribution.id))
            throw new Error(`Context contribution already exists: ${contribution.id}`);
        this.contributions.set(contribution.id, freezeContribution(contribution));
        let active = true;
        return Object.freeze({
            id: contribution.id,
            update: (content) => {
                if (!active)
                    throw new Error(`Context contribution is disposed: ${contribution.id}`);
                const current = this.contributions.get(contribution.id);
                if (!current)
                    throw new Error(`Context contribution is unavailable: ${contribution.id}`);
                this.contributions.set(contribution.id, freezeContribution({ ...current, content }));
            },
            dispose: () => {
                if (!active)
                    return;
                active = false;
                this.contributions.delete(contribution.id);
            },
        });
    }
    async materializeMemory() {
        const projection = this.options.graph.context.memory ?? { select: "all" };
        if (this.memoryCache?.revision === this.frameRevision.value)
            return this.memoryCache.content;
        const content = await materializeProjection(projection, this.options.frames, {
            graph: { id: this.options.graph.id, version: this.options.graph.version },
            revision: this.frameRevision.value,
        }, defaultMemoryRenderer);
        this.memoryCache = { revision: this.frameRevision.value, content };
        return content;
    }
}
function freezeContribution(contribution) {
    const content = normalizeContextContent(contribution.content);
    if (content == null)
        throw new Error("Context contribution content cannot be empty");
    return Object.freeze({ ...contribution, content });
}
async function materializeNodeLayer(node, stage, nodeInput, skills, nodeVisitId) {
    const projection = node.context?.focus ?? (node.kind === "agent"
        ? { select: "all" }
        : { select: "none" });
    const content = await materializeProjection(projection, nodeInput, {
        node: {
            kind: node.kind,
            subGoal: node.subGoal,
            identity: node.identity,
        },
        skills,
        connections: stage.route.connections.map((connection) => ({
            id: connection.id,
            to: connection.to,
        })),
    }, defaultNodeRenderer);
    return content == null ? null : {
        name: "node",
        scopeId: nodeVisitId,
        retention: "sticky",
        content,
    };
}
export async function materializeProjection(projection, source, meta, fallback) {
    const selected = projection.select === "all"
        ? source
        : projection.select === "none"
            ? null
            : await projection.select(source);
    const frozen = selected == null ? null : deepFreeze(cloneJson(selected));
    const rendered = projection.render
        ? await projection.render({ selected: frozen, meta: Object.freeze(meta) })
        : fallback({ selected: frozen, meta: Object.freeze(meta) });
    return normalizeContextContent(rendered);
}
function defaultGraphRenderer(input) {
    const lines = [`=== GRAPH GOAL ===\n${input.meta.graph.goal}`];
    if (input.selected != null)
        lines.push(`=== BACKGROUND ===\n${JSON.stringify(input.selected)}`);
    for (const skill of input.meta.skills)
        lines.push(skill.content);
    return lines.join("\n");
}
function defaultMemoryRenderer(input) {
    return input.selected == null || Array.isArray(input.selected) && input.selected.length === 0
        ? null
        : `=== COMPLETED WORK ===\n${JSON.stringify(input.selected)}`;
}
function defaultNodeRenderer(input) {
    const lines = [
        `=== NODE SUBGOAL ===\n${input.meta.node.subGoal}`,
    ];
    if (input.selected != null)
        lines.push(`=== NODE FOCUS ===\n${JSON.stringify(input.selected)}`);
    if (input.meta.connections.length)
        lines.push(`=== CONNECTIONS ===\n${JSON.stringify(input.meta.connections)}`);
    for (const skill of input.meta.skills)
        lines.push(skill.content);
    return lines.join("\n");
}
function normalizeContextContent(content) {
    if (content == null)
        return null;
    const values = Array.isArray(content) ? content : [content];
    const blocks = [];
    for (const value of values) {
        if (typeof value === "string")
            blocks.push({ type: "text", text: value });
        else if (isContextBlock(value))
            blocks.push(Object.freeze({ ...value }));
        else
            throw new Error("Context renderer returned invalid content");
    }
    return Object.freeze(blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text : blocks);
}
function isContextBlock(value) {
    if (!value || typeof value !== "object")
        return false;
    const block = value;
    return block.type === "text" && typeof block.text === "string"
        || block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string";
}
function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== "object")
        return value;
    if (seen.has(value))
        return value;
    seen.add(value);
    for (const child of Object.values(value))
        deepFreeze(child, seen);
    return Object.freeze(value);
}
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
