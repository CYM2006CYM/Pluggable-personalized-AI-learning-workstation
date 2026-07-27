import type { JsonValue } from "../core/json.js";
export type { RecordingMode } from "../core/result.js";
export declare const REPLAY_SCHEMA_VERSION: 1;
export interface ReplayArtifactRef {
    readonly artifactId: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly sha256: string;
}
export type ReplayEventDomain = "root" | "graph" | "node" | "agent" | "model" | "tool" | "completion" | "mechanism" | "context" | "compaction" | "transition" | "checkpoint" | "recording";
export interface ReplayEvent {
    readonly domain: ReplayEventDomain;
    readonly type: string;
    readonly data?: JsonValue | ReplayArtifactRef;
}
export interface ReplayEventScope {
    readonly rootRunId: string;
    readonly graphInvocationId?: string;
    readonly nodeVisitId?: string;
    readonly agentRunId?: string;
    readonly toolCallId?: string;
}
export interface ReplayEventEnvelope extends ReplayEventScope {
    readonly schemaVersion: typeof REPLAY_SCHEMA_VERSION;
    readonly sequence: number;
    readonly timestamp: string;
    readonly event: ReplayEvent;
}
export interface ModelUsage {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
}
export interface PricingInput {
    readonly provider: string;
    readonly model: string;
    readonly usage: ModelUsage;
}
export type PricingResolver = (input: PricingInput) => number | null | Promise<number | null>;
