import type { Edge, NodeRouting, NodeCompletion, AgentInstance } from "./type.js";
import type { Connection, NodeCompletion as CoreNodeCompletion, Route } from "./core/graph.js";
export declare function selectConnection(route: Route, completion: CoreNodeCompletion): Promise<Connection | null>;
export declare function selectEdge(routing: NodeRouting, completion: NodeCompletion, instance: AgentInstance): Promise<Edge | null>;
