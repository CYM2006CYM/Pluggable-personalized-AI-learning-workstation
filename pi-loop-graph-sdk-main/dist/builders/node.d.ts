import type { TSchema } from "typebox";
import type { AgentNodeDefinition, CodeNodeDefinition, GraphNodeDefinition } from "../core/graph.js";
import type { JsonValue } from "../core/json.js";
export declare function agentNode<TInputSchema extends TSchema, TOutputSchema extends TSchema, TFocus extends JsonValue = JsonValue>(input: Omit<AgentNodeDefinition<TInputSchema, TOutputSchema, TFocus>, "kind">): AgentNodeDefinition<TInputSchema, TOutputSchema, TFocus>;
export declare function codeNode<TInputSchema extends TSchema, TOutputSchema extends TSchema, TFocus extends JsonValue = JsonValue>(input: Omit<CodeNodeDefinition<TInputSchema, TOutputSchema, TFocus>, "kind">): CodeNodeDefinition<TInputSchema, TOutputSchema, TFocus>;
export declare function graphNode<TInputSchema extends TSchema, TOutputSchema extends TSchema>(input: Omit<GraphNodeDefinition<TInputSchema, TOutputSchema>, "kind" | "boundary"> & {
    boundary?: GraphNodeDefinition["boundary"];
}): GraphNodeDefinition<TInputSchema, TOutputSchema>;
