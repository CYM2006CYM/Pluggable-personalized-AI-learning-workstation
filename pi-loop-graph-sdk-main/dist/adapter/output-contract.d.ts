import type { CompletionValidationResult, JsonSchema } from "../type.js";
export declare const DEFAULT_OUTPUT_CONTRACT_MAX_BYTES: number;
export declare const OUTPUT_CONTRACT_MESSAGE_TYPE = "loop_graph_output_contract";
export interface PreparedOutputContract {
    readonly schema: JsonSchema;
    readonly serialized: string;
    readonly modelText: string;
    readonly fingerprint: string;
    readonly byteSize: number;
    validate(result: Record<string, unknown>): CompletionValidationResult;
}
export declare function prepareOutputContract(schema: JsonSchema | undefined, maxBytes?: number): PreparedOutputContract | null;
