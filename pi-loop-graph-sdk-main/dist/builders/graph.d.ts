import type { TSchema } from "typebox";
import type { Graph, GraphDefinition, NodeDefinition } from "../core/graph.js";
export { defineGraph } from "../core/graph.js";
export declare function defineSingleAgentGraph<TInputSchema extends TSchema, TOutputSchema extends TSchema, TBackground extends import("../core/json.js").JsonValue, TMemory extends import("../core/json.js").JsonValue = import("../core/json.js").JsonValue>(input: {
    id: string;
    version: string;
    goal: string;
    input: TInputSchema;
    output: TOutputSchema;
    context: GraphDefinition<TInputSchema, TOutputSchema, TBackground, TMemory>["context"];
    node: Extract<NodeDefinition, {
        kind: "agent";
    }>;
    tools?: GraphDefinition<TInputSchema, TOutputSchema>["tools"];
    skills?: GraphDefinition<TInputSchema, TOutputSchema>["skills"];
}): Graph<TInputSchema, TOutputSchema, TBackground, TMemory>;
export declare function defineLinearGraph<TInputSchema extends TSchema, TOutputSchema extends TSchema, TBackground extends import("../core/json.js").JsonValue, TMemory extends import("../core/json.js").JsonValue = import("../core/json.js").JsonValue>(input: {
    id: string;
    version: string;
    goal: string;
    input: TInputSchema;
    output: TOutputSchema;
    context: GraphDefinition<TInputSchema, TOutputSchema, TBackground, TMemory>["context"];
    nodes: readonly NodeDefinition[];
    tools?: GraphDefinition<TInputSchema, TOutputSchema>["tools"];
    skills?: GraphDefinition<TInputSchema, TOutputSchema>["skills"];
}): Graph<TInputSchema, TOutputSchema, TBackground, TMemory>;
