import type { Graph, GraphRunResult } from "pi-loop-graph-sdk";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";

export type ModelExecutionStatus = "ok" | "invalid_output" | "timeout" | "provider_error";

export interface ModelExecutionBudget {
  timeoutMs: number;
  maxTokens?: number;
}

export interface ModelExecutionInput {
  graphId: string;
  runId: string;
  profileRevision: number;
  promptVersion: string;
  safeContext: Readonly<Record<string, unknown>>;
  budget: ModelExecutionBudget;
}

export interface ModelExecutionResult {
  status: ModelExecutionStatus;
  payload?: unknown;
  errorCode?: string;
  sourceRefs: string[];
  traceSummary: string;
  modelId: string;
  promptVersion: string;
  durationMs?: number;
}

export interface ModelExecutionPort {
  execute(input: ModelExecutionInput, signal: AbortSignal): Promise<ModelExecutionResult>;
}

export interface RecordedModelResponseFixture {
  graphId: string;
  runId: string;
  status: ModelExecutionStatus;
  payload?: unknown;
  errorCode?: string;
  sourceRefs?: string[];
  traceSummary?: string;
  modelId?: string;
  promptVersion?: string;
  durationMs?: number;
}

export interface RecordedModelExecutionAdapterOptions {
  fixtures: readonly RecordedModelResponseFixture[];
  defaultModelId?: string;
}

export interface RecordedExecutionHistoryEntry {
  input: ModelExecutionInput;
  signalAborted: boolean;
}

export interface PiGraphModelExecutionAdapterOptions {
  executor: IsolatedGraphExecutor;
  graphs: readonly Graph[];
  modelId: string;
}

const MAX_TEXT_LENGTH = 800;
const MAX_CANDIDATE_FEEDBACK_LENGTH = 4096;
const MAX_TRACE_LENGTH = MAX_TEXT_LENGTH * 8;
const MAX_COLLECTION_ITEMS = 64;
const MAX_OBJECT_KEYS = 32;
const MAX_NESTING_DEPTH = 8;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function isStatus(value: unknown): value is ModelExecutionStatus {
  return value === "ok" || value === "invalid_output" || value === "timeout" || value === "provider_error";
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isSourceRef(value: unknown): value is string {
  return isStableId(value);
}

function abortError(): Error {
  const error = new Error("Model execution was cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function safeSourceRefs(safeContext: Readonly<Record<string, unknown>>): string[] {
  const nestedContext = isRecord(safeContext.context) ? safeContext.context : undefined;
  const sourceIds = nestedContext?.sourceIds ?? safeContext.sourceIds;
  if (!Array.isArray(sourceIds)
    || sourceIds.length > MAX_COLLECTION_ITEMS
    || !sourceIds.every(isSourceRef)
    || new Set(sourceIds).size !== sourceIds.length) {
    return [];
  }
  return [...sourceIds];
}

function graphTrace(graphId: string, result: GraphRunResult): string {
  const failure = result.status === "completed" ? "none" : result.failure.code;
  return [
    `graph=${graphId}`,
    `status=${result.status}`,
    `failure=${failure}`,
    `steps=${result.steps}`,
    `replay=${result.replay.status}`,
  ].join(";");
}

function hasValidStatusFields(item: Record<string, unknown>): boolean {
  const errorCode = item.errorCode;
  if (item.status === "ok") return errorCode === undefined && "payload" in item;
  if (item.status === "invalid_output") return errorCode === undefined || errorCode === "invalid_json";
  if (item.status === "timeout") return errorCode === undefined || errorCode === "timeout";
  return errorCode === undefined || errorCode === "provider_error" || errorCode === "refusal";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fixturePayloadWithinLimits(value: unknown, depth = 0, fieldName?: string): boolean {
  if (depth > MAX_NESTING_DEPTH) return false;
  if (typeof value === "string") {
    return value.length <= (fieldName === "candidateFeedback" ? MAX_CANDIDATE_FEEDBACK_LENGTH : MAX_TEXT_LENGTH);
  }
  if (Array.isArray(value)) {
    return value.length <= MAX_COLLECTION_ITEMS
      && value.every((item) => fixturePayloadWithinLimits(item, depth + 1));
  }
  if (!isRecord(value)) return true;
  const entries = Object.entries(value);
  return entries.length <= MAX_OBJECT_KEYS
    && entries.every(([key, next]) => fixturePayloadWithinLimits(next, depth + 1, key));
}

function fixturePayloadFitsJson(value: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

export function loadRecordedModelResponseFixtures(raw: string): RecordedModelResponseFixture[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["recordings"]) || !Array.isArray(parsed.recordings)) {
    throw new Error("Recorded model response fixture file must contain a recordings array");
  }

  const fixtures: RecordedModelResponseFixture[] = [];
  for (const item of parsed.recordings) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, [
        "graphId", "runId", "status", "payload", "errorCode", "sourceRefs",
        "traceSummary", "modelId", "promptVersion", "durationMs",
      ])
      || !isStableId(item.graphId)
      || !isStableId(item.runId)
      || !isStatus(item.status)
      || !Array.isArray(item.sourceRefs)
      || item.sourceRefs.length > MAX_COLLECTION_ITEMS
      || !item.sourceRefs.every(isSourceRef)
      || new Set(item.sourceRefs).size !== item.sourceRefs.length
      || !isNonEmptyString(item.traceSummary)
      || item.traceSummary.length > MAX_TRACE_LENGTH
      || !isStableId(item.modelId)
      || !isStableId(item.promptVersion)
      || ("errorCode" in item && !isNonEmptyString(item.errorCode))
      || ("durationMs" in item
        && (typeof item.durationMs !== "number"
          || !Number.isFinite(item.durationMs)
          || !Number.isInteger(item.durationMs)
          || item.durationMs < 0))
      || !hasValidStatusFields(item)
      || ("payload" in item
        && (!fixturePayloadWithinLimits(item.payload) || !fixturePayloadFitsJson(item.payload)))) {
      throw new Error("Recorded model response fixture entry is invalid");
    }

    const errorCode = isNonEmptyString(item.errorCode) ? item.errorCode : undefined;
    const durationMs = typeof item.durationMs === "number" ? item.durationMs : undefined;
    fixtures.push({
      graphId: item.graphId,
      runId: item.runId,
      status: item.status,
      ...(item.payload === undefined ? {} : { payload: item.payload }),
      ...(errorCode === undefined ? {} : { errorCode }),
      sourceRefs: [...item.sourceRefs],
      traceSummary: item.traceSummary,
      modelId: item.modelId,
      promptVersion: item.promptVersion,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return fixtures;
}

/** Converts SDK results at the infrastructure boundary; SDK objects never escape this adapter. */
export class PiGraphModelExecutionAdapter implements ModelExecutionPort {
  readonly #executor: IsolatedGraphExecutor;
  readonly #graphs: ReadonlyMap<string, Graph>;
  readonly #modelId: string;

  constructor(options: PiGraphModelExecutionAdapterOptions) {
    if (!isStableId(options.modelId)) throw new TypeError("modelId must be a stable identifier");
    const graphs = new Map<string, Graph>();
    for (const graph of options.graphs) {
      if (!isStableId(graph.id) || graphs.has(graph.id)) {
        throw new TypeError("graphs must have unique stable identifiers");
      }
      graphs.set(graph.id, graph);
    }
    this.#executor = options.executor;
    this.#graphs = graphs;
    this.#modelId = options.modelId;
  }

  async execute(input: ModelExecutionInput, signal: AbortSignal): Promise<ModelExecutionResult> {
    if (signal.aborted) throw abortError();
    const graph = this.#graphs.get(input.graphId);
    if (!graph) return this.#providerError(input, "graph=unavailable;status=failed");

    let result: GraphRunResult;
    try {
      result = await this.#executor(graph, {
        runId: input.runId,
        profileRevision: input.profileRevision,
        promptVersion: input.promptVersion,
        safeContext: clone(input.safeContext),
        budget: clone(input.budget),
      }, signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      return this.#providerError(input, `graph=${graph.id};status=failed;failure=provider_error`);
    }

    if (signal.aborted || result.status === "cancelled") throw abortError();
    const common = {
      sourceRefs: safeSourceRefs(input.safeContext),
      traceSummary: graphTrace(graph.id, result),
      modelId: this.#modelId,
      promptVersion: input.promptVersion,
      durationMs: result.durationMs,
    };
    if (result.status === "completed") {
      return { status: "ok", payload: clone(result.output), ...common };
    }
    if (result.failure.code === "validation-exhausted") {
      return { status: "invalid_output", errorCode: "invalid_json", ...common };
    }
    if (result.failure.code === "agent-timeout") {
      return { status: "timeout", errorCode: "timeout", ...common };
    }
    return { status: "provider_error", errorCode: "provider_error", ...common };
  }

  #providerError(input: ModelExecutionInput, traceSummary: string): ModelExecutionResult {
    return {
      status: "provider_error",
      errorCode: "provider_error",
      sourceRefs: [],
      traceSummary,
      modelId: this.#modelId,
      promptVersion: input.promptVersion,
    };
  }
}

export class RecordedModelExecutionAdapter implements ModelExecutionPort {
  readonly #fixtures: readonly RecordedModelResponseFixture[];
  readonly #history: RecordedExecutionHistoryEntry[] = [];
  readonly #defaultModelId: string;

  constructor(options: RecordedModelExecutionAdapterOptions) {
    this.#fixtures = [...options.fixtures];
    this.#defaultModelId = options.defaultModelId ?? "recorded-model";
  }

  get history(): readonly RecordedExecutionHistoryEntry[] {
    return this.#history;
  }

  async execute(input: ModelExecutionInput, signal: AbortSignal): Promise<ModelExecutionResult> {
    if (signal.aborted) throw abortError();
    this.#history.push({ input: clone(input), signalAborted: signal.aborted });

    const baseRunId = this.#fixtures
      .filter((fixture) => fixture.graphId === input.graphId
        && (fixture.runId === input.runId || input.runId.startsWith(`${fixture.runId}.`)))
      .map((fixture) => fixture.runId)
      .sort((left, right) => right.length - left.length)[0];
    const matches = baseRunId === undefined
      ? []
      : this.#fixtures.filter((fixture) => fixture.graphId === input.graphId && fixture.runId === baseRunId);
    const callIndex = baseRunId === undefined
      ? 0
      : this.#history.filter((entry) => entry.input.graphId === input.graphId
        && (entry.input.runId === baseRunId || entry.input.runId.startsWith(`${baseRunId}.`))).length - 1;
    const fixture = matches[callIndex] ?? matches[matches.length - 1];

    if (!fixture) {
      return {
        status: "provider_error",
        errorCode: "provider_error",
        sourceRefs: [],
        traceSummary: `missing recorded response for ${input.runId}:${input.graphId}`,
        modelId: this.#defaultModelId,
        promptVersion: input.promptVersion,
      };
    }

    if (fixture.status === "timeout") {
      return {
        status: "timeout",
        errorCode: fixture.errorCode ?? "timeout",
        payload: fixture.payload,
        sourceRefs: fixture.sourceRefs ?? [],
        traceSummary: fixture.traceSummary ?? `timeout for ${input.runId}:${input.graphId}`,
        modelId: fixture.modelId ?? this.#defaultModelId,
        promptVersion: fixture.promptVersion ?? input.promptVersion,
        durationMs: fixture.durationMs,
      };
    }

    if (fixture.status === "provider_error" || fixture.status === "invalid_output") {
      return {
        status: fixture.status,
        errorCode: fixture.errorCode ?? (fixture.status === "provider_error" ? "provider_error" : "invalid_json"),
        payload: fixture.payload,
        sourceRefs: fixture.sourceRefs ?? [],
        traceSummary: fixture.traceSummary ?? `${fixture.status} for ${input.runId}:${input.graphId}`,
        modelId: fixture.modelId ?? this.#defaultModelId,
        promptVersion: fixture.promptVersion ?? input.promptVersion,
        durationMs: fixture.durationMs,
      };
    }

    return {
      status: "ok",
      payload: fixture.payload,
      sourceRefs: fixture.sourceRefs ?? [],
      traceSummary: fixture.traceSummary ?? `${input.runId}:${input.graphId}`,
      modelId: fixture.modelId ?? this.#defaultModelId,
      promptVersion: fixture.promptVersion ?? input.promptVersion,
      durationMs: fixture.durationMs,
    };
  }
}
