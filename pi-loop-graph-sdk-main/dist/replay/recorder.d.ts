import type { GraphRunResult, ReplayReference } from "../core/result.js";
import type { JsonValue } from "../core/json.js";
import type { RuntimeEventBus } from "../runtime/event-bus.js";
import { type PricingResolver, type RecordingMode, type ReplayEvent, type ReplayEventScope } from "./events.js";
import type { RunStore } from "./store.js";
export interface RecorderOptions {
    readonly mode: Exclude<RecordingMode, "off">;
    readonly store: RunStore;
    readonly artifactThresholdBytes?: number;
    readonly pricingResolver?: PricingResolver;
    readonly now?: () => Date;
}
export declare class Recorder {
    private readonly options;
    private sequence;
    private queue;
    private readonly issues;
    private rootRunId;
    private unsubscribe?;
    constructor(options: RecorderOptions);
    attach(eventBus: RuntimeEventBus): void;
    record(event: ReplayEvent, scope: ReplayEventScope): void;
    finalize<T>(result: GraphRunResult<T>): Promise<{
        readonly replay: ReplayReference;
        readonly documentWritten: boolean;
    }>;
    private recordRuntimeEvent;
    private persist;
}
export declare function toRecordedJson(value: unknown, mode: RecordingMode): JsonValue;
