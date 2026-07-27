export function graphRef(id, version) {
    if (!id || !version)
        throw new Error("GraphRef requires id and version");
    return Object.freeze({ id, version });
}
export function defineGraph(graph) {
    validateGraphDefinition(graph);
    const stages = Object.fromEntries(Object.entries(graph.stages).map(([id, stage]) => [
        id,
        Object.freeze({
            ...stage,
            route: Object.freeze({
                ...stage.route,
                connections: Object.freeze(stage.route.connections.map((connection) => Object.freeze({
                    ...connection,
                    transition: Object.freeze({ ...connection.transition }),
                }))),
            }),
        }),
    ]));
    return Object.freeze({
        ...graph,
        stages: Object.freeze(stages),
        entries: Object.freeze(graph.entries.map((item) => Object.freeze({ ...item }))),
    });
}
export function validateGraphDefinition(graph) {
    if (!graph.id || !graph.version || !graph.goal)
        throw new Error("Graph requires id, version, and goal");
    if (!graph.entries.length)
        throw new Error("Graph requires at least one entry");
    const entryIds = new Set();
    for (const entry of graph.entries) {
        if (entryIds.has(entry.id))
            throw new Error(`Duplicate Entry ID: ${entry.id}`);
        entryIds.add(entry.id);
    }
    for (const [stageId, stage] of Object.entries(graph.stages)) {
        if (!stageId)
            throw new Error("Stage ID cannot be empty");
        const connectionIds = new Set();
        for (const connection of stage.route.connections) {
            if (connectionIds.has(connection.id))
                throw new Error(`Duplicate Connection ID in Stage "${stageId}": ${connection.id}`);
            connectionIds.add(connection.id);
            if (connection.to !== "__graph_finish__" && !(connection.to in graph.stages)) {
                throw new Error(`Connection "${connection.id}" targets missing Stage "${connection.to}"`);
            }
            if (connection.to === "__graph_finish__" && !connection.transition.output) {
                throw new Error(`Finish Connection "${connection.id}" requires an explicit output mapper`);
            }
        }
    }
    for (const entry of graph.entries)
        if (!(entry.to in graph.stages))
            throw new Error(`Entry "${entry.id}" targets missing Stage "${entry.to}"`);
}
