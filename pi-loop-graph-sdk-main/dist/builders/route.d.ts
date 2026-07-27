import type { JsonValue } from "../core/json.js";
import type { Connection, Entry, Route, Transition } from "../core/graph.js";
export interface ConnectionDraft<TCompletion extends JsonValue = JsonValue, TFrame extends JsonValue = JsonValue, TInput extends JsonValue = JsonValue> {
    readonly to: Connection["to"];
    readonly transition: Transition<TCompletion, TFrame, TInput>;
}
export declare function entry<TInput = JsonValue>(id: string, config: Omit<Entry<TInput>, "id">): Entry<TInput>;
export declare function defineTransition<TCompletion extends JsonValue = JsonValue, TFrame extends JsonValue = JsonValue, TInput extends JsonValue = JsonValue>(transition: Transition<TCompletion, TFrame, TInput>): Transition<TCompletion, TFrame, TInput>;
export declare function connect<TCompletion extends JsonValue = JsonValue, TFrame extends JsonValue = JsonValue, TInput extends JsonValue = JsonValue>(to: string, transition?: Transition<TCompletion, TFrame, TInput>): ConnectionDraft<TCompletion, TFrame, TInput>;
export declare function finish<TCompletion extends JsonValue = JsonValue, TFrame extends JsonValue = JsonValue>(transition?: Transition<TCompletion, TFrame, never>): ConnectionDraft<TCompletion, TFrame, never>;
export declare function firstMatch(connections: Readonly<Record<string, ConnectionDraft<any, any, any>>>): Route;
