import type { JsonValue } from "../core/json.js";
export declare const CHECKPOINT_SCHEMA_VERSION: 1;
export interface CheckpointNodeBoundary {
    readonly kind: "node-boundary";
    readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
    readonly checkpointId: string;
    /** Monotonic wall-clock ordering metadata; checkpoint ids are opaque. */
    readonly createdAt?: string;
    readonly rootRunId: string;
    readonly graph: {
        readonly id: string;
        readonly version: string;
    };
    readonly invocationStack: readonly {
        readonly graphInvocationId: string;
        readonly parentGraphInvocationId?: string;
        readonly boundary: "root" | "call" | "compose" | "delegate";
        readonly depth: number;
        readonly graph?: {
            readonly id: string;
            readonly version: string;
        };
    }[];
    readonly next: {
        readonly stageId: string;
        readonly nodeInput: JsonValue;
        /** Stable identity for repeated attempts to resume this pending Node Visit. */
        readonly nodeVisitId?: string;
    };
    readonly frames: readonly JsonValue[];
    readonly budget: JsonValue;
    readonly resumeAttempt: number;
    readonly mechanisms: readonly {
        readonly name: string;
        readonly snapshot: JsonValue;
    }[];
}
export type CheckpointDocument = CheckpointNodeBoundary;
export declare function encodeCheckpoint(checkpoint: CheckpointDocument): string;
export declare function decodeCheckpoint(content: string): CheckpointDocument;
