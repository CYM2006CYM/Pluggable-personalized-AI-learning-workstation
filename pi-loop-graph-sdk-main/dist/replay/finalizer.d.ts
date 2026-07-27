import type { GraphRunResult } from "../core/result.js";
import type { ReplayArtifactRef, ReplayEventEnvelope, PricingResolver, RecordingMode } from "./events.js";
import type { RunStore } from "./store.js";
export interface ReplayRecordingSummary {
    readonly status: "complete" | "incomplete" | "failed";
    readonly issues: readonly string[];
}
export interface ReplayDocument {
    readonly schemaVersion: 1;
    readonly rootRunId: string;
    readonly mode: Exclude<RecordingMode, "off">;
    readonly createdAt: string;
    readonly result: GraphRunResult | ReplayArtifactRef;
    readonly events: readonly ReplayEventEnvelope[];
    readonly recording: ReplayRecordingSummary;
    readonly totalCost?: number;
}
export interface FinalizeJournalOptions {
    readonly store: RunStore;
    readonly runId: string;
    readonly mode: Exclude<RecordingMode, "off">;
    readonly result: GraphRunResult | ReplayArtifactRef;
    readonly pricingResolver?: PricingResolver;
    readonly initialIssues?: readonly string[];
}
export declare function finalizeJournal(options: FinalizeJournalOptions): Promise<ReplayDocument>;
