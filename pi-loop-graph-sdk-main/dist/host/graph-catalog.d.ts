import type { Graph, GraphRef } from "../core/graph.js";
export declare class GraphCatalog {
    private readonly graphs;
    register(graph: Graph): void;
    resolve(ref: GraphRef): Graph | undefined;
    has(ref: GraphRef): boolean;
    get values(): readonly Graph[];
}
