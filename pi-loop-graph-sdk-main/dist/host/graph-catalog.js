export class GraphCatalog {
    graphs = new Map();
    register(graph) {
        const key = graphKey(graph);
        if (this.graphs.has(key))
            throw new Error(`Graph already registered: ${key}`);
        this.graphs.set(key, graph);
    }
    resolve(ref) {
        return this.graphs.get(refKey(ref));
    }
    has(ref) {
        return this.graphs.has(refKey(ref));
    }
    get values() {
        return Object.freeze([...this.graphs.values()]);
    }
}
function graphKey(graph) {
    return `${graph.id}@${graph.version}`;
}
function refKey(ref) {
    return `${ref.id}@${ref.version}`;
}
