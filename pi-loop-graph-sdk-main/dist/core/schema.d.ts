import type { TSchema } from "typebox";
import { type JsonValue } from "./json.js";
export interface SchemaCheckResult {
    readonly valid: boolean;
    readonly value?: JsonValue;
    readonly message?: string;
}
export declare function checkJsonSchemaValue(schema: TSchema, value: unknown): SchemaCheckResult;
