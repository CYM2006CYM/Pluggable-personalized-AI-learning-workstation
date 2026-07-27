import type { TSchema, Static } from "typebox";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export type JsonSchema<T extends TSchema = TSchema> = T;
export type JsonSchemaValue<T extends TSchema> = Static<T> & JsonValue;
export declare function isJsonValue(value: unknown): value is JsonValue;
