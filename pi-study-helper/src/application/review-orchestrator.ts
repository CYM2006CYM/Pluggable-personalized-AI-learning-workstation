import { createHash } from "node:crypto";
import type { ActivitySafeView } from "./learning-runtime-facade.js";
import type {
  ModelExecutionPort,
  ModelExecutionResult,
  ModelExecutionStatus,
} from "../infrastructure/model-execution-port.js";
import {
  createStudyReviewGraphs,
  type DefenderInput,
  type DefenderOutput,
  type GeneratorInput,
  type GeneratorOutput,
  type HunterInput,
  type HunterOutput,
  type JudgeInput,
  type JudgeOutput,
  type ReviewGraphId,
  type ReviewRoleDefinition,
  type ReviewSafeContext,
} from "../graphs/v2-learning-graphs.js";
import {
  defenderOutputIsClosed,
  defenderRoute,
  highRiskHunterOutput,
  judgeOutputIsClosed,
} from "./review-decision-policy.js";

export const REVIEW_ORCHESTRATOR_SCOPE = "compatibility-audit-only" as const;

export interface ReviewOrchestratorInput {
  requestId: string;
  attemptId: string;
  runId: string;
  profileRevision: number;
  modelId: string;
  promptVersion: string;
  activity: Pick<
    ActivitySafeView,
    "activityId" | "activityVersion" | "kind" | "title" | "primaryKnowledgePointId" | "supportingKnowledgePointIds"
  >;
  currentResult: { safeFeedback: string };
}

export interface ReviewSafeSourceProjection {
  sourceIds: string[];
  sourceSummary: string;
}

export interface ReviewSafeSourceProvider {
  getProjection(input: {
    profileRevision: number;
    activityId: string;
  }): Promise<ReviewSafeSourceProjection>;
}

export interface ReviewOrchestratorOptions {
  modelExecutionPort: ModelExecutionPort;
  sourceProvider: ReviewSafeSourceProvider;
  checkpointStore?: ReviewCheckpointStore;
  maxAttemptsPerRole?: number;
  timeoutMs?: number;
  maxTokens?: number;
  now?: () => Date;
}

export interface ReviewStageCheckpoint<Output = unknown> {
  graphId: ReviewGraphId;
  attempts: number;
  status: "ok";
  runId: string;
  modelRunId: string;
  profileRevision: number;
  inputSummaryHash: string;
  modelId: string;
  promptVersion: string;
  sourceRefs: string[];
  traceSummary: string;
  durationMs?: number;
  completedAt: string;
  output: Output;
}

export interface ReviewAttemptRecord {
  graphId: ReviewGraphId;
  attempt: number;
  modelRunId: string;
  status: ModelExecutionStatus | "cancelled";
  errorCode?: string;
  modelId: string;
  promptVersion: string;
  durationMs?: number;
  traceSummary: string;
  completedAt: string;
}

export interface ReviewRunCheckpoint {
  runId: string;
  requestId: string;
  attemptId: string;
  profileRevision: number;
  inputSummaryHash: string;
  inputBindingHash: string;
  modelId: string;
  promptVersion: string;
  redactions: string[];
  createdAt: string;
  stageAttempts: Partial<Record<ReviewGraphId, ReviewAttemptRecord[]>>;
  generator?: ReviewStageCheckpoint<GeneratorOutput>;
  hunter?: ReviewStageCheckpoint<HunterOutput>;
  defender?: ReviewStageCheckpoint<DefenderOutput>;
  judge?: ReviewStageCheckpoint<JudgeOutput>;
  finalStatus?: ReviewOrchestratorResult["status"];
  finalSafeFeedback?: string;
  finalSummary?: string;
  finalBlockedIssueIds?: string[];
  finalErrorCode?: string;
  finalFailedGraphId?: ReviewGraphId;
  finalCause?: "judge" | "technical_fallback" | "technical_failed";
  usedFallback?: boolean;
  finalizedAt?: string;
}

export interface ReviewCheckpointStore {
  load(runId: string): Promise<ReviewRunCheckpoint | undefined>;
  save(checkpoint: ReviewRunCheckpoint): Promise<void>;
}

export interface ReviewOrchestratorResult {
  status: "accepted" | "fallback" | "failed";
  finalSafeFeedback: string;
  summary: string;
  blockedIssueIds: string[];
  usedFallback: boolean;
  errorCode?: string;
}

interface SafeContextBuildResult {
  context: ReviewSafeContext;
  safeContextSummary: string;
  redactions: string[];
  inputBindingHash: string;
  inputSummaryHash: string;
}

type RoleExecutionResult<Output> =
  | { output: Output; checkpoint: ReviewStageCheckpoint<Output> }
  | { failure: string; errorCode: string };

type ReviewStageResult<Output> =
  | { output: Output }
  | { failure: string; errorCode: string };

type StageCheckpointErrorCode = "version_conflict" | "invalid_json" | "source_conflict" | "provider_error";

interface StageCheckpointIssue {
  errorCode: StageCheckpointErrorCode;
  reason: string;
}

const FORBIDDEN_CONTEXT_KEY_PATTERN = /(hidden|reference|rubric|answer|solution|secret|apiKey|hostPath|absolutePath|learnerSubmission|提交|答案|代码)/iu;
const HOST_PATH_PATTERN = /(?:\\\\|[A-Za-z]:[\\/]|\/)(?:(?!\s+(?:and|plus|or|then)\s+|[;,)\]"']|$)[^\r\n])+/giu;
const HOST_PATH_DETECT_PATTERN = /(?:\\\\|[A-Za-z]:[\\/]|\/)(?:(?!\s+(?:and|plus|or|then)\s+|[;,)\]"']|$)[^\r\n])+/iu;
const FORBIDDEN_OUTPUT_PATTERN = /(hidden\s*(?:tests?|assertions?)|reference\s*(?:solution|implementation)|full\s*rubric|(?:api|access)\s*key|private\s*key|learnerSubmission|hostPath|secret|隐藏\s*(?:测试|断言)|参考\s*(?:答案|实现)|完整\s*Rubric|(?:API|访问)?密钥|私钥|原始\s*(?:提交|答案|代码))/iu;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const INPUT_BINDING_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FIXED_ERROR_CODES = new Set(["invalid_json", "timeout", "refusal", "provider_error", "source_conflict", "version_conflict", "cancelled"]);
const TEXT_LIMIT = 800;
const MAX_ROLE_ATTEMPTS = 5;
const MAX_COLLECTION_ITEMS = 64;
const MAX_OBJECT_KEYS = 32;
const MAX_NESTING_DEPTH = 8;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const INVALID_INPUT_FEEDBACK = "review input is invalid";
const ACTIVITY_KINDS = new Set(["mcq", "code_completion", "coding_practical", "explain", "debug"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("Review execution was cancelled");
  error.name = "AbortError";
  return error;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sha256(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(stableValue(value));
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function redactVisibleText(value: string, redactions: Set<string>): string {
  if (value.length > TEXT_LIMIT) redactions.add("truncatedText");
  let next = value.replace(HOST_PATH_PATTERN, () => {
    redactions.add("hostPath");
    return "[REDACTED_PATH]";
  });
  next = next.replace(/\s+/gu, " ").trim();
  if (next.length > TEXT_LIMIT) {
    redactions.add("truncatedText");
    next = `${next.slice(0, TEXT_LIMIT)}...`;
  }
  return next;
}

interface SanitizedValue {
  value: unknown;
  unsafe: boolean;
}

function sanitizeOutputValue(value: unknown, redactions: Set<string>, depth = 0): SanitizedValue {
  if (depth > MAX_NESTING_DEPTH) return { value: undefined, unsafe: true };
  if (typeof value === "string") {
    return {
      value: redactVisibleText(value, redactions),
      unsafe: value.length > TEXT_LIMIT || FORBIDDEN_OUTPUT_PATTERN.test(value),
    };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) return { value: undefined, unsafe: true };
    let unsafe = false;
    const sanitized = value.map((item) => {
      const result = sanitizeOutputValue(item, redactions, depth + 1);
      unsafe ||= result.unsafe;
      return result.value;
    });
    return { value: sanitized, unsafe };
  }
  if (!isRecord(value)) return { value, unsafe: false };
  if (Object.keys(value).length > MAX_OBJECT_KEYS) return { value: undefined, unsafe: true };

  let unsafe = false;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nextValue] of Object.entries(value)) {
    if (FORBIDDEN_CONTEXT_KEY_PATTERN.test(key)) unsafe = true;
    const result = sanitizeOutputValue(nextValue, redactions, depth + 1);
    unsafe ||= result.unsafe;
    sanitized[key] = result.value;
  }
  return { value: sanitized, unsafe };
}

function sanitizeTraceSummary(value: unknown, redactions: Set<string>): string {
  const trace = typeof value === "string" ? value : "model trace unavailable";
  if (FORBIDDEN_OUTPUT_PATTERN.test(trace)) {
    redactions.add("sensitiveTrace");
    return "[REDACTED_TRACE]";
  }
  return redactVisibleText(trace, redactions);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID_PATTERN.test(value);
}

function hasOnlyKeys(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isSafeText(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= TEXT_LIMIT
    && !FORBIDDEN_OUTPUT_PATTERN.test(value)
    && !HOST_PATH_DETECT_PATTERN.test(value);
}

function isModelExecutionResult(value: unknown): value is ModelExecutionResult {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "status",
      "payload",
      "errorCode",
      "sourceRefs",
      "traceSummary",
      "modelId",
      "promptVersion",
      "durationMs",
    ])
    || (value.status !== "ok"
      && value.status !== "invalid_output"
      && value.status !== "timeout"
      && value.status !== "provider_error")
    || !Array.isArray(value.sourceRefs)
    || value.sourceRefs.length > MAX_COLLECTION_ITEMS
    || !value.sourceRefs.every(isStableId)
    || new Set(value.sourceRefs).size !== value.sourceRefs.length
    || !isStableId(value.modelId)
    || !isStableId(value.promptVersion)
    || typeof value.traceSummary !== "string"
    || value.traceSummary.length > TEXT_LIMIT * 8
    || (value.durationMs !== undefined
      && (typeof value.durationMs !== "number"
        || !Number.isFinite(value.durationMs)
        || !Number.isInteger(value.durationMs)
        || value.durationMs < 0))
    || (value.errorCode !== undefined && typeof value.errorCode !== "string")) {
    return false;
  }
  if (value.status === "ok") return value.errorCode === undefined && "payload" in value;
  if (value.status === "invalid_output") return value.errorCode === undefined || value.errorCode === "invalid_json";
  if (value.status === "timeout") return value.errorCode === undefined || value.errorCode === "timeout";
  return value.errorCode === undefined || value.errorCode === "provider_error" || value.errorCode === "refusal";
}

function payloadWithinLimit(value: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function safeFeedbackForInput(input: unknown): string {
  if (!isRecord(input) || !isRecord(input.currentResult) || !isSafeText(input.currentResult.safeFeedback)) {
    return INVALID_INPUT_FEEDBACK;
  }
  return input.currentResult.safeFeedback;
}

function callRunId(reviewRunId: string, graphId: ReviewGraphId, attempt: number): string {
  const prefix = reviewRunId.length <= 80
    ? reviewRunId
    : `${reviewRunId.slice(0, 40)}-${createHash("sha256").update(reviewRunId, "utf8").digest("hex").slice(0, 16)}`;
  return `${prefix}.${graphId}.${attempt}`;
}

export function buildSafeReviewContext(
  input: ReviewOrchestratorInput,
  projection: ReviewSafeSourceProjection,
): SafeContextBuildResult {
  const redactions = new Set<string>();
  if (!hasOnlyKeys(projection, ["sourceIds", "sourceSummary"])) {
    throw new Error("invalid_json: trusted source projection is invalid");
  }
  if (!isSafeText(projection.sourceSummary)
    || !isSafeText(input.currentResult.safeFeedback)
    || !isSafeText(input.activity.title)) {
    throw new Error("invalid_json: visible review text violates the safety boundary");
  }
  const sourceSummary = redactVisibleText(projection.sourceSummary, redactions);
  const safeFeedback = input.currentResult.safeFeedback;
  const sourceIds = [...projection.sourceIds];
  if (sourceIds.length === 0
    || new Set(sourceIds).size !== sourceIds.length
    || !sourceIds.every(isStableId)
    || sourceSummary.length === 0) {
    throw new Error("invalid_json: trusted source projection is invalid");
  }
  const context: ReviewSafeContext = {
    activity: {
      activityId: input.activity.activityId,
      activityVersion: input.activity.activityVersion,
      kind: input.activity.kind,
      title: redactVisibleText(input.activity.title, redactions),
      primaryKnowledgePointId: input.activity.primaryKnowledgePointId,
      supportingKnowledgePointIds: [...input.activity.supportingKnowledgePointIds],
    },
    safeFeedback,
    sourceIds,
    sourceSummary,
  };
  const inputBindingHash = sha256({
    profileRevision: input.profileRevision,
    activity: context.activity,
    safeFeedback,
  });
  const inputSummaryHash = sha256({
    requestId: input.requestId,
    attemptId: input.attemptId,
    runId: input.runId,
    profileRevision: input.profileRevision,
    promptVersion: input.promptVersion,
    inputBindingHash,
    context,
  });
  const safeContextSummary = [
    `sourceIds=${context.sourceIds.join(",")}`,
    `redactions=${[...redactions].sort().join(",")}`,
  ].join("; ");

  return {
    context,
    safeContextSummary,
    redactions: [...redactions].sort(),
    inputBindingHash,
    inputSummaryHash,
  };
}

function asPortSafeContext(value: unknown): Record<string, unknown> {
  const cloned: unknown = clone(value);
  return isRecord(cloned) ? cloned : {};
}

function resultFromCheckpoint(checkpoint: ReviewRunCheckpoint): ReviewOrchestratorResult | undefined {
  if (!checkpoint.finalStatus
    || checkpoint.finalSafeFeedback === undefined
    || checkpoint.finalSummary === undefined
    || checkpoint.finalBlockedIssueIds === undefined
    || checkpoint.usedFallback === undefined) {
    return undefined;
  }
  return {
    status: checkpoint.finalStatus,
    finalSafeFeedback: checkpoint.finalSafeFeedback,
    summary: checkpoint.finalSummary,
    blockedIssueIds: [...checkpoint.finalBlockedIssueIds],
    usedFallback: checkpoint.usedFallback,
    ...(checkpoint.finalErrorCode === undefined ? {} : { errorCode: checkpoint.finalErrorCode }),
  };
}

export class InMemoryReviewCheckpointStore implements ReviewCheckpointStore {
  readonly #store = new Map<string, ReviewRunCheckpoint>();

  async load(runId: string): Promise<ReviewRunCheckpoint | undefined> {
    const value = this.#store.get(runId);
    return value ? clone(value) : undefined;
  }

  async save(checkpoint: ReviewRunCheckpoint): Promise<void> {
    this.#store.set(checkpoint.runId, clone(checkpoint));
  }
}

/**
 * @deprecated Compatibility-only reviewer for historical W2/W3 checkpoints.
 * Product card/quiz generation, Judge-directed candidate repair, caching and
 * publication are owned exclusively by AdaptiveContentService.
 */
export class ReviewOrchestrator {
  readonly #modelExecutionPort: ModelExecutionPort;
  readonly #sourceProvider: ReviewSafeSourceProvider;
  readonly #checkpointStore: ReviewCheckpointStore;
  readonly #maxAttemptsPerRole: number;
  readonly #timeoutMs: number;
  readonly #maxTokens: number | undefined;
  readonly #now: () => Date;
  readonly #graphs = createStudyReviewGraphs();

  constructor(options: ReviewOrchestratorOptions) {
    this.#modelExecutionPort = options.modelExecutionPort;
    this.#sourceProvider = options.sourceProvider;
    this.#checkpointStore = options.checkpointStore ?? new InMemoryReviewCheckpointStore();
    const maxAttemptsPerRole = options.maxAttemptsPerRole ?? 2;
    if (!Number.isFinite(maxAttemptsPerRole)
      || !Number.isInteger(maxAttemptsPerRole)
      || maxAttemptsPerRole < 1
      || maxAttemptsPerRole > MAX_ROLE_ATTEMPTS) {
      throw new RangeError("maxAttemptsPerRole must be an integer between 1 and 5");
    }
    this.#maxAttemptsPerRole = maxAttemptsPerRole;
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a finite positive integer");
    }
    if (options.maxTokens !== undefined
      && (!Number.isFinite(options.maxTokens) || !Number.isInteger(options.maxTokens) || options.maxTokens < 1)) {
      throw new RangeError("maxTokens must be a finite positive integer when provided");
    }
    this.#timeoutMs = timeoutMs;
    this.#maxTokens = options.maxTokens;
    this.#now = options.now ?? (() => new Date());
  }

  async run(input: ReviewOrchestratorInput, signal: AbortSignal): Promise<ReviewOrchestratorResult> {
    if (signal.aborted) throw abortError();
    const fallbackSafeFeedback = safeFeedbackForInput(input);
    try {
      return await this.#runInternal(input, signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw abortError();
      return this.#checkpointFailure(fallbackSafeFeedback, "provider_error", "review execution failed safely");
    }
  }

  async #runInternal(input: ReviewOrchestratorInput, signal: AbortSignal): Promise<ReviewOrchestratorResult> {
    const fallbackSafeFeedback = safeFeedbackForInput(input);
    if (!this.#inputIsValid(input)) {
      return this.#checkpointFailure(fallbackSafeFeedback, "invalid_json", "review input violates the private D boundary");
    }
    let projection: ReviewSafeSourceProjection;
    try {
      projection = await this.#sourceProvider.getProjection({
        profileRevision: input.profileRevision,
        activityId: input.activity.activityId,
      });
    } catch {
      return this.#checkpointFailure(fallbackSafeFeedback, "source_conflict", "trusted source projection is unavailable");
    }
    let safeBuild: SafeContextBuildResult;
    try {
      safeBuild = buildSafeReviewContext(input, projection);
    } catch {
      return this.#checkpointFailure(fallbackSafeFeedback, "source_conflict", "trusted source projection is invalid");
    }
    const { context, safeContextSummary, redactions, inputBindingHash, inputSummaryHash } = safeBuild;
    const checkpoint = await this.#loadOrCreateCheckpoint(input, inputBindingHash, inputSummaryHash, redactions);
    if (!this.#checkpointMatches(checkpoint, input, inputBindingHash, inputSummaryHash)) {
      return this.#versionConflict(fallbackSafeFeedback, "checkpoint binding does not match this review input");
    }

    const checkpointIssue = this.#checkpointEnvelopeIssue(checkpoint);
    if (checkpointIssue) {
      return this.#checkpointFailure(fallbackSafeFeedback, checkpointIssue.errorCode, checkpointIssue.reason);
    }

    const stageIssue = this.#stageCheckpointIssue(checkpoint, context.sourceIds);
    if (stageIssue) {
      return this.#checkpointFailure(fallbackSafeFeedback, stageIssue.errorCode, stageIssue.reason);
    }

    const finalIssue = this.#finalCheckpointIssue(checkpoint, fallbackSafeFeedback);
    if (finalIssue) {
      return this.#checkpointFailure(fallbackSafeFeedback, finalIssue.errorCode, finalIssue.reason);
    }

    const finished = resultFromCheckpoint(checkpoint);
    if (finished) return finished;

    const generator = await this.#runGenerator(checkpoint, context, safeContextSummary, signal);
    if ("failure" in generator) {
      if (generator.errorCode === "version_conflict") {
        return this.#finalizeTechnical(checkpoint, fallbackSafeFeedback, "generator", generator.errorCode);
      }
      return this.#fallback(checkpoint, fallbackSafeFeedback, "generator", generator.failure, generator.errorCode);
    }

    const hunter = await this.#runHunter(checkpoint, context, generator.output, signal);
    if ("failure" in hunter) {
      if (hunter.errorCode === "version_conflict") {
        return this.#finalizeTechnical(checkpoint, fallbackSafeFeedback, "hunter", hunter.errorCode);
      }
      return this.#fallback(checkpoint, fallbackSafeFeedback, "hunter", hunter.failure, hunter.errorCode);
    }

    let defenderOutput: DefenderOutput | undefined;
    const route = defenderRoute(hunter.output);
    if (route.required) {
      const defenderHunter = highRiskHunterOutput(hunter.output);
      const defender = await this.#runDefender(checkpoint, context, generator.output, defenderHunter, signal);
      if ("failure" in defender) {
        if (defender.errorCode === "version_conflict") {
          return this.#finalizeTechnical(checkpoint, fallbackSafeFeedback, "defender", defender.errorCode);
        }
        return this.#fallback(checkpoint, fallbackSafeFeedback, "defender", defender.failure, defender.errorCode);
      }
      defenderOutput = defender.output;
    }

    const judge = await this.#runJudge(checkpoint, context, generator.output, hunter.output, defenderOutput, signal);
    if ("failure" in judge) {
      if (judge.errorCode === "version_conflict") {
        return this.#finalizeTechnical(checkpoint, fallbackSafeFeedback, "judge", judge.errorCode);
      }
      return this.#fallback(checkpoint, fallbackSafeFeedback, "judge", judge.failure, judge.errorCode);
    }

    const result = this.#judgeToFinal(fallbackSafeFeedback, judge.output);
    return this.#finalize(checkpoint, result, "judge");
  }

  #inputIsValid(input: ReviewOrchestratorInput): boolean {
    return hasOnlyKeys(input, [
      "requestId",
      "attemptId",
      "runId",
      "profileRevision",
      "modelId",
      "promptVersion",
      "activity",
      "currentResult",
    ])
      && hasOnlyKeys(input.activity, [
        "activityId",
        "activityVersion",
        "kind",
        "title",
        "primaryKnowledgePointId",
        "supportingKnowledgePointIds",
      ])
      && hasOnlyKeys(input.currentResult, ["safeFeedback"])
      && isStableId(input.requestId)
      && isStableId(input.attemptId)
      && isStableId(input.runId)
      && isStableId(input.modelId)
      && isStableId(input.promptVersion)
      && Number.isInteger(input.profileRevision)
      && input.profileRevision > 0
      && isStableId(input.activity.activityId)
      && Number.isInteger(input.activity.activityVersion)
      && input.activity.activityVersion > 0
      && isSafeText(input.activity.title)
      && ACTIVITY_KINDS.has(input.activity.kind)
      && isStableId(input.activity.primaryKnowledgePointId)
      && Array.isArray(input.activity.supportingKnowledgePointIds)
      && input.activity.supportingKnowledgePointIds.length <= MAX_COLLECTION_ITEMS
      && new Set(input.activity.supportingKnowledgePointIds).size === input.activity.supportingKnowledgePointIds.length
      && input.activity.supportingKnowledgePointIds.every(isStableId)
      && isSafeText(input.currentResult.safeFeedback);
  }

  async #loadOrCreateCheckpoint(
    input: ReviewOrchestratorInput,
    inputBindingHash: string,
    inputSummaryHash: string,
    redactions: string[],
  ): Promise<ReviewRunCheckpoint> {
    const loaded = await this.#checkpointStore.load(input.runId);
    if (loaded) return loaded;
    const checkpoint: ReviewRunCheckpoint = {
      runId: input.runId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      profileRevision: input.profileRevision,
      inputSummaryHash,
      inputBindingHash,
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      redactions,
      createdAt: this.#now().toISOString(),
      stageAttempts: {},
    };
    await this.#checkpointStore.save(checkpoint);
    return checkpoint;
  }

  #checkpointMatches(
    checkpoint: ReviewRunCheckpoint,
    input: ReviewOrchestratorInput,
    inputBindingHash: string,
    inputSummaryHash: string,
  ): boolean {
    return checkpoint.runId === input.runId
      && checkpoint.requestId === input.requestId
      && checkpoint.attemptId === input.attemptId
      && checkpoint.profileRevision === input.profileRevision
      && checkpoint.inputSummaryHash === inputSummaryHash
      && checkpoint.inputBindingHash === inputBindingHash
      && checkpoint.modelId === input.modelId
      && checkpoint.promptVersion === input.promptVersion;
  }

  #checkpointEnvelopeIssue(checkpoint: ReviewRunCheckpoint): StageCheckpointIssue | undefined {
    const allowedKeys = [
      "runId", "requestId", "attemptId", "profileRevision", "inputSummaryHash", "inputBindingHash",
      "modelId", "promptVersion", "redactions", "createdAt", "stageAttempts",
      "generator", "hunter", "defender", "judge",
      "finalStatus", "finalSafeFeedback", "finalSummary", "finalBlockedIssueIds", "finalErrorCode",
      "finalFailedGraphId", "finalCause", "usedFallback", "finalizedAt",
    ];
    const knownRedactions = new Set(["hostPath", "truncatedText", "sensitiveTrace"]);
    if (!hasOnlyKeys(checkpoint, allowedKeys)
      || !isStableId(checkpoint.runId)
      || !isStableId(checkpoint.requestId)
      || !isStableId(checkpoint.attemptId)
      || !Number.isInteger(checkpoint.profileRevision)
      || checkpoint.profileRevision < 1
      || !INPUT_BINDING_PATTERN.test(checkpoint.inputSummaryHash)
      || !INPUT_BINDING_PATTERN.test(checkpoint.inputBindingHash)
      || !isStableId(checkpoint.modelId)
      || !isStableId(checkpoint.promptVersion)
      || !Array.isArray(checkpoint.redactions)
      || checkpoint.redactions.length > MAX_COLLECTION_ITEMS
      || new Set(checkpoint.redactions).size !== checkpoint.redactions.length
      || checkpoint.redactions.some((value) => typeof value !== "string" || !knownRedactions.has(value))
      || !isIsoDateTime(checkpoint.createdAt)
      || !isRecord(checkpoint.stageAttempts)) {
      return { errorCode: "invalid_json", reason: "checkpoint envelope violates the audit boundary" };
    }
    return undefined;
  }

  #stageCheckpointIssue(checkpoint: ReviewRunCheckpoint, allowedSourceIds: readonly string[]): StageCheckpointIssue | undefined {
    const topologyIssue = this.#stageTopologyIssue(checkpoint);
    if (topologyIssue) return topologyIssue;
    const attemptIssue = this.#attemptHistoryIssue(checkpoint);
    if (attemptIssue) return attemptIssue;

    const stages: Array<[ReviewGraphId, ReviewStageCheckpoint | undefined]> = [
      ["generator", checkpoint.generator],
      ["hunter", checkpoint.hunter],
      ["defender", checkpoint.defender],
      ["judge", checkpoint.judge],
    ];
    const allowedSources = new Set(allowedSourceIds);
    for (const [graphId, stage] of stages) {
      if (!stage) continue;
      const stageKeys = [
        "graphId", "attempts", "status", "runId", "modelRunId", "profileRevision", "inputSummaryHash",
        "modelId", "promptVersion", "sourceRefs", "traceSummary", "durationMs", "completedAt", "output",
      ];
      const structurallyValid = hasOnlyKeys(stage, stageKeys)
        && stage.status === "ok"
        && Number.isInteger(stage.attempts)
        && stage.attempts >= 1
        && stage.attempts <= this.#maxAttemptsPerRole
        && (stage.durationMs === undefined
          || (Number.isFinite(stage.durationMs) && Number.isInteger(stage.durationMs) && stage.durationMs >= 0))
        && isIsoDateTime(stage.completedAt);
      if (!structurallyValid) {
        return {
          errorCode: "invalid_json",
          reason: `stage ${graphId} checkpoint structure violates the audit boundary`,
        };
      }
      const bindingMatches = stage.graphId === graphId
        && stage.runId === checkpoint.runId
        && stage.modelRunId === callRunId(checkpoint.runId, graphId, stage.attempts)
        && stage.profileRevision === checkpoint.profileRevision
        && stage.inputSummaryHash === checkpoint.inputSummaryHash
        && stage.modelId === checkpoint.modelId
        && stage.promptVersion === checkpoint.promptVersion;
      if (!bindingMatches) {
        return {
          errorCode: "version_conflict",
          reason: `stage ${graphId} checkpoint binding does not match the run checkpoint`,
        };
      }
      if (!Array.isArray(stage.sourceRefs)
        || stage.sourceRefs.length > MAX_COLLECTION_ITEMS
        || new Set(stage.sourceRefs).size !== stage.sourceRefs.length
        || stage.sourceRefs.some((sourceRef) => typeof sourceRef !== "string" || !allowedSources.has(sourceRef))) {
        return {
          errorCode: "source_conflict",
          reason: `stage ${graphId} checkpoint contains an unregistered source reference`,
        };
      }
      if (graphId === "generator" && this.#generatorSourcesConflict(stage.output, stage.sourceRefs, allowedSourceIds)) {
        return {
          errorCode: "source_conflict",
          reason: "stage generator checkpoint cites an unregistered source",
        };
      }
      const sanitizedOutput = sanitizeOutputValue(stage.output, new Set<string>());
      if (sanitizedOutput.unsafe
        || !payloadWithinLimit(sanitizedOutput.value)
        || JSON.stringify(sanitizedOutput.value) !== JSON.stringify(stage.output)
        || !this.#graphs[graphId].validateOutput(sanitizedOutput.value)) {
        return {
          errorCode: "invalid_json",
          reason: "stage " + graphId + " checkpoint output violates its schema or safety boundary",
        };
      }
      if (graphId !== "generator" && !this.#reviewEvidenceSourcesAllowed(graphId, stage.output, allowedSourceIds)) {
        return {
          errorCode: "source_conflict",
          reason: `stage ${graphId} checkpoint evidence cites an unregistered source`,
        };
      }
      if (typeof stage.traceSummary !== "string") {
        return {
          errorCode: "invalid_json",
          reason: "stage " + graphId + " checkpoint trace is invalid",
        };
      }
      const sanitizedTrace = sanitizeTraceSummary(stage.traceSummary, new Set<string>());
      if (FORBIDDEN_OUTPUT_PATTERN.test(stage.traceSummary) || sanitizedTrace !== stage.traceSummary) {
        return {
          errorCode: "invalid_json",
          reason: "stage " + graphId + " checkpoint trace violates the safety boundary",
        };
      }
    }
    const conditionalTopologyIssue = this.#conditionalTopologyIssue(checkpoint);
    if (conditionalTopologyIssue) return conditionalTopologyIssue;
    return this.#roleReferenceIssue(checkpoint);
  }

  #stageTopologyIssue(checkpoint: ReviewRunCheckpoint): StageCheckpointIssue | undefined {
    if (checkpoint.hunter && !checkpoint.generator) {
      return { errorCode: "invalid_json", reason: "hunter checkpoint is missing generator predecessor" };
    }
    if (checkpoint.defender && (!checkpoint.generator || !checkpoint.hunter)) {
      return { errorCode: "invalid_json", reason: "defender checkpoint is missing serial predecessors" };
    }
    if (checkpoint.judge && (!checkpoint.generator || !checkpoint.hunter)) {
      return { errorCode: "invalid_json", reason: "judge checkpoint is missing serial predecessors" };
    }
    return undefined;
  }

  #conditionalTopologyIssue(checkpoint: ReviewRunCheckpoint): StageCheckpointIssue | undefined {
    if (!checkpoint.hunter) return undefined;
    // Routing is deterministic at the application boundary: only a concrete
    // high-severity Hunter issue requires Defender.
    const requiresDefender = checkpoint.hunter.output.issues.some((issue) => issue.severity === "high");
    const hasDefenderAttempts = (checkpoint.stageAttempts.defender?.length ?? 0) > 0;
    const hasJudgeAttempts = (checkpoint.stageAttempts.judge?.length ?? 0) > 0;
    if ((checkpoint.defender || hasDefenderAttempts) && !requiresDefender) {
      return { errorCode: "invalid_json", reason: "defender checkpoint exists without a routed semantic or high-risk review" };
    }
    if ((checkpoint.judge || hasJudgeAttempts) && requiresDefender && !checkpoint.defender) {
      return { errorCode: "invalid_json", reason: "judge checkpoint is missing the required defender predecessor" };
    }
    return undefined;
  }

  #attemptHistoryIssue(checkpoint: ReviewRunCheckpoint): StageCheckpointIssue | undefined {
    if (!hasOnlyKeys(checkpoint.stageAttempts, ["generator", "hunter", "defender", "judge"])) {
      return { errorCode: "invalid_json", reason: "checkpoint stage attempt history is invalid" };
    }
    for (const graphId of ["generator", "hunter", "defender", "judge"] as const) {
      const records = checkpoint.stageAttempts[graphId] ?? [];
      if (!Array.isArray(records) || records.length > this.#maxAttemptsPerRole) {
        return { errorCode: "invalid_json", reason: `stage ${graphId} attempt history is invalid` };
      }
      if (records.length > 0
        && ((graphId === "hunter" && !checkpoint.generator)
          || (graphId === "defender" && (!checkpoint.generator || !checkpoint.hunter))
          || (graphId === "judge" && (!checkpoint.generator || !checkpoint.hunter)))) {
        return { errorCode: "invalid_json", reason: `stage ${graphId} attempt history is missing serial predecessors` };
      }
      for (const [index, candidate] of (records as unknown[]).entries()) {
        if (!isRecord(candidate)) {
          return { errorCode: "invalid_json", reason: `stage ${graphId} attempt history contains a non-object record` };
        }
        const record = candidate;
        const allowedKeys = new Set([
          "graphId", "attempt", "modelRunId", "status", "errorCode", "modelId", "promptVersion",
          "durationMs", "traceSummary", "completedAt",
        ]);
        const validStatus = record.status === "ok"
          || record.status === "invalid_output"
          || record.status === "timeout"
          || record.status === "provider_error"
          || record.status === "cancelled";
        const traceSummary = typeof record.traceSummary === "string" ? record.traceSummary : undefined;
        const safeTrace = traceSummary === undefined
          ? undefined
          : sanitizeTraceSummary(traceSummary, new Set<string>())
        const validError = (record.status === "ok"
            && (record.errorCode === undefined || record.errorCode === "source_conflict" || record.errorCode === "version_conflict"))
          || (record.status === "invalid_output" && record.errorCode === "invalid_json")
          || (record.status === "timeout" && record.errorCode === "timeout")
          || (record.status === "provider_error" && (record.errorCode === "provider_error" || record.errorCode === "refusal"))
          || (record.status === "cancelled" && record.errorCode === "cancelled");
        if (Object.keys(record).some((key) => !allowedKeys.has(key))
          || record.graphId !== graphId
          || record.attempt !== index + 1
          || record.modelRunId !== callRunId(checkpoint.runId, graphId, index + 1)
          || !validStatus
          || !validError
          || typeof record.modelId !== "string"
          || record.modelId !== checkpoint.modelId
          || typeof record.promptVersion !== "string"
          || record.promptVersion !== checkpoint.promptVersion
          || (record.errorCode !== undefined
            && (typeof record.errorCode !== "string" || !FIXED_ERROR_CODES.has(record.errorCode)))
          || (record.durationMs !== undefined
            && (typeof record.durationMs !== "number"
              || !Number.isFinite(record.durationMs)
              || !Number.isInteger(record.durationMs)
              || record.durationMs < 0))
          || !isIsoDateTime(record.completedAt)
          || safeTrace === undefined
          || (traceSummary !== undefined && FORBIDDEN_OUTPUT_PATTERN.test(traceSummary))
          || safeTrace !== traceSummary) {
          return { errorCode: "invalid_json", reason: `stage ${graphId} attempt history violates the audit boundary` };
        }
      }
      const stage = checkpoint[graphId];
      const successfulRecords = records.filter((record) => record.status === "ok" && record.errorCode === undefined);
      if (!stage && successfulRecords.length > 0) {
        return { errorCode: "invalid_json", reason: `stage ${graphId} has a successful attempt without a checkpoint` };
      }
      if (stage) {
        const last = records.at(-1);
        if (!last
          || successfulRecords.length !== 1
          || last.attempt !== stage.attempts
          || last.status !== "ok"
          || last.errorCode !== undefined) {
          return { errorCode: "invalid_json", reason: `stage ${graphId} checkpoint is not backed by a successful attempt` };
        }
      }
    }
    return undefined;
  }

  #roleReferenceIssue(checkpoint: ReviewRunCheckpoint): StageCheckpointIssue | undefined {
    const hunter = checkpoint.hunter?.output;
    if (!hunter) return undefined;
    const issueIds = hunter.issues.map((issue) => issue.issueId);
    if (new Set(issueIds).size !== issueIds.length) {
      return { errorCode: "invalid_json", reason: "Hunter issue identifiers must be unique" };
    }

    const defender = checkpoint.defender?.output;
    if (defender) {
      if (!defenderOutputIsClosed(defender, highRiskHunterOutput(hunter))) {
        return { errorCode: "invalid_json", reason: "Defender issue references do not close the routed Hunter issues" };
      }
    }

    const judge = checkpoint.judge?.output;
    if (judge) {
      if (!judgeOutputIsClosed(judge, hunter)) {
        return { errorCode: "invalid_json", reason: "Judge issue decisions or blocked references do not close the reviewed issues" };
      }
    }
    return undefined;
  }

  #finalCheckpointIssue(
    checkpoint: ReviewRunCheckpoint,
    fallbackSafeFeedback: string,
  ): StageCheckpointIssue | undefined {
    const finalValues = [
      checkpoint.finalStatus,
      checkpoint.finalSafeFeedback,
      checkpoint.finalSummary,
      checkpoint.finalBlockedIssueIds,
      checkpoint.finalErrorCode,
      checkpoint.finalFailedGraphId,
      checkpoint.finalCause,
      checkpoint.usedFallback,
      checkpoint.finalizedAt,
    ];
    if (!finalValues.some((value) => value !== undefined)) return undefined;

    if ((checkpoint.finalStatus !== "accepted"
        && checkpoint.finalStatus !== "fallback"
        && checkpoint.finalStatus !== "failed")
      || typeof checkpoint.finalSafeFeedback !== "string"
      || typeof checkpoint.finalSummary !== "string"
      || !Array.isArray(checkpoint.finalBlockedIssueIds)
      || checkpoint.finalBlockedIssueIds.length > MAX_COLLECTION_ITEMS
      || new Set(checkpoint.finalBlockedIssueIds).size !== checkpoint.finalBlockedIssueIds.length
      || !checkpoint.finalBlockedIssueIds.every(isStableId)
      || (checkpoint.finalErrorCode !== undefined && typeof checkpoint.finalErrorCode !== "string")
      || (checkpoint.finalErrorCode !== undefined && !FIXED_ERROR_CODES.has(checkpoint.finalErrorCode))
      || (checkpoint.finalFailedGraphId !== undefined
        && checkpoint.finalFailedGraphId !== "generator"
        && checkpoint.finalFailedGraphId !== "hunter"
        && checkpoint.finalFailedGraphId !== "defender"
        && checkpoint.finalFailedGraphId !== "judge")
      || (checkpoint.finalCause !== "judge"
        && checkpoint.finalCause !== "technical_fallback"
        && checkpoint.finalCause !== "technical_failed")
      || typeof checkpoint.usedFallback !== "boolean"
      || !isIsoDateTime(checkpoint.finalizedAt)) {
      return {
        errorCode: "invalid_json",
        reason: "final checkpoint result is structurally invalid",
      };
    }

    for (const [label, value] of [
      ["finalSafeFeedback", checkpoint.finalSafeFeedback],
      ["finalSummary", checkpoint.finalSummary],
    ] as const) {
      const sanitized = sanitizeTraceSummary(value, new Set<string>());
      if (FORBIDDEN_OUTPUT_PATTERN.test(value) || sanitized !== value) {
        return {
          errorCode: "invalid_json",
          reason: "final checkpoint " + label + " violates the safety boundary",
        };
      }
    }
    let expected: ReviewOrchestratorResult;
    if (checkpoint.finalCause === "judge") {
      if (!checkpoint.judge || checkpoint.finalErrorCode !== undefined || checkpoint.finalFailedGraphId !== undefined) {
        return { errorCode: "invalid_json", reason: "Judge final checkpoint metadata is inconsistent" };
      }
      expected = this.#judgeToFinal(fallbackSafeFeedback, checkpoint.judge.output);
    } else {
      if (!checkpoint.finalErrorCode || !checkpoint.finalFailedGraphId) {
        return { errorCode: "invalid_json", reason: "technical final checkpoint metadata is incomplete" };
      }
      expected = this.#technicalResult(fallbackSafeFeedback, checkpoint.finalFailedGraphId, checkpoint.finalErrorCode);
      const expectedCause = expected.status === "failed" ? "technical_failed" : "technical_fallback";
      if (checkpoint.finalCause !== expectedCause) {
        return { errorCode: "invalid_json", reason: "technical final checkpoint cause is inconsistent" };
      }
    }
    const cached = resultFromCheckpoint(checkpoint);
    if (!cached || JSON.stringify(cached) !== JSON.stringify(expected)) {
      return { errorCode: "invalid_json", reason: "final checkpoint does not match its deterministic cause" };
    }
    return undefined;
  }

  async #runGenerator(
    checkpoint: ReviewRunCheckpoint,
    context: ReviewSafeContext,
    safeContextSummary: string,
    signal: AbortSignal,
  ): Promise<ReviewStageResult<GeneratorOutput>> {
    if (checkpoint.generator) return { output: checkpoint.generator.output };
    const input: GeneratorInput = {
      context,
      allowedSourcesSummary: safeContextSummary,
    };
    const result = await this.#executeRole(this.#graphs.generator, checkpoint, input, context, signal);
    if ("failure" in result) return result;
    checkpoint.generator = result.checkpoint;
    await this.#checkpointStore.save(checkpoint);
    return { output: result.output };
  }

  async #runHunter(
    checkpoint: ReviewRunCheckpoint,
    context: ReviewSafeContext,
    generator: GeneratorOutput,
    signal: AbortSignal,
  ): Promise<ReviewStageResult<HunterOutput>> {
    if (checkpoint.hunter) return { output: checkpoint.hunter.output };
    const input: HunterInput = { context, generator };
    const result = await this.#executeRole(
      this.#graphs.hunter,
      checkpoint,
      input,
      context,
      signal,
      (output) => this.#hunterOutputIssue(output),
    );
    if ("failure" in result) return result;
    checkpoint.hunter = result.checkpoint;
    await this.#checkpointStore.save(checkpoint);
    return { output: result.output };
  }

  async #runDefender(
    checkpoint: ReviewRunCheckpoint,
    context: ReviewSafeContext,
    generator: GeneratorOutput,
    hunter: HunterOutput,
    signal: AbortSignal,
  ): Promise<ReviewStageResult<DefenderOutput>> {
    if (checkpoint.defender) return { output: checkpoint.defender.output };
    const input: DefenderInput = { context, generator, hunter };
    const result = await this.#executeRole(
      this.#graphs.defender,
      checkpoint,
      input,
      context,
      signal,
      (output) => this.#defenderOutputIssue(output, hunter),
    );
    if ("failure" in result) return result;
    checkpoint.defender = result.checkpoint;
    await this.#checkpointStore.save(checkpoint);
    return { output: result.output };
  }

  async #runJudge(
    checkpoint: ReviewRunCheckpoint,
    context: ReviewSafeContext,
    generator: GeneratorOutput,
    hunter: HunterOutput,
    defender: DefenderOutput | undefined,
    signal: AbortSignal,
  ): Promise<ReviewStageResult<JudgeOutput>> {
    if (checkpoint.judge) return { output: checkpoint.judge.output };
    const input: JudgeInput = defender ? { context, generator, hunter, defender } : { context, generator, hunter };
    const result = await this.#executeRole(
      this.#graphs.judge,
      checkpoint,
      input,
      context,
      signal,
      (output) => this.#judgeOutputIssue(output, hunter),
    );
    if ("failure" in result) return result;
    checkpoint.judge = result.checkpoint;
    await this.#checkpointStore.save(checkpoint);
    return { output: result.output };
  }

  async #executeRole<Input, Output>(
    definition: ReviewRoleDefinition<Input, Output>,
    checkpoint: ReviewRunCheckpoint,
    roleInput: Input,
    baseContext: ReviewSafeContext,
    signal: AbortSignal,
    outputIssue?: (output: Output) => StageCheckpointIssue | undefined,
  ): Promise<RoleExecutionResult<Output>> {
    if (!definition.validateInput(roleInput)) {
      const attempt = (checkpoint.stageAttempts[definition.graphId]?.length ?? 0) + 1;
      await this.#appendAttempt(checkpoint, {
        graphId: definition.graphId,
        attempt,
        modelRunId: callRunId(checkpoint.runId, definition.graphId, attempt),
        status: "invalid_output",
        errorCode: "invalid_json",
        modelId: checkpoint.modelId,
        promptVersion: checkpoint.promptVersion,
        traceSummary: `invalid ${definition.graphId} input`,
        completedAt: this.#now().toISOString(),
      });
      return { failure: `invalid_json: invalid ${definition.graphId} input`, errorCode: "invalid_json" };
    }

    const completedAttempts = checkpoint.stageAttempts[definition.graphId]?.length ?? 0;
    const previousAttempt = checkpoint.stageAttempts[definition.graphId]?.at(-1);
    let lastErrorCode = previousAttempt?.errorCode ?? "provider_error";
    let lastFailure = `${lastErrorCode}: ${definition.graphId} model attempt failed safely`;
    for (let attempt = completedAttempts + 1; attempt <= this.#maxAttemptsPerRole; attempt += 1) {
      const modelRunId = callRunId(checkpoint.runId, definition.graphId, attempt);
      if (signal.aborted) {
        throw abortError();
      }
      let rawResult: unknown;
      try {
        rawResult = await this.#modelExecutionPort.execute({
          graphId: definition.graphId,
          runId: modelRunId,
          profileRevision: checkpoint.profileRevision,
          promptVersion: checkpoint.promptVersion,
          safeContext: asPortSafeContext(roleInput),
          budget: {
            timeoutMs: this.#timeoutMs,
            ...(this.#maxTokens === undefined ? {} : { maxTokens: this.#maxTokens }),
          },
        }, signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw abortError();
        lastErrorCode = "provider_error";
        lastFailure = `provider_error: ${definition.graphId} model attempt failed safely`;
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: "provider_error",
          errorCode: "provider_error",
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          traceSummary: "model provider rejected the call safely",
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (!isModelExecutionResult(rawResult)) {
        lastErrorCode = "provider_error";
        lastFailure = `provider_error: ${definition.graphId} returned a malformed result`;
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: "provider_error",
          errorCode: "provider_error",
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          traceSummary: "malformed model result rejected safely",
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      const result = rawResult;
      const traceRedactions = new Set<string>();
      const safeTraceSummary = sanitizeTraceSummary(result.traceSummary, traceRedactions);
      checkpoint.redactions = [...new Set([...checkpoint.redactions, ...traceRedactions])].sort();
      if (signal.aborted) {
        throw abortError();
      }
      const failure = this.#executionFailure(result.status, result.errorCode);
      if (failure) {
        lastFailure = `${failure.errorCode}: ${definition.graphId} model attempt failed safely`;
        lastErrorCode = failure.errorCode;
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: result.status,
          errorCode: failure.errorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (result.promptVersion !== checkpoint.promptVersion) {
        lastFailure = "version_conflict: model promptVersion differs from checkpoint binding";
        lastErrorCode = "version_conflict";
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: result.status,
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (result.modelId !== checkpoint.modelId) {
        lastFailure = "version_conflict: modelId differs from checkpoint binding";
        lastErrorCode = "version_conflict";
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: result.status,
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (!this.#sourceRefsAllowed(result.sourceRefs, baseContext.sourceIds)) {
        lastFailure = "source_conflict: model returned unregistered source references";
        lastErrorCode = "source_conflict";
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: result.status,
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      const payloadRedactions = new Set<string>();
      const sanitizedPayload = sanitizeOutputValue(result.payload, payloadRedactions);
      checkpoint.redactions = [...new Set([...checkpoint.redactions, ...payloadRedactions])].sort();
      const safePayload = sanitizedPayload.value;
      if (definition.graphId === "generator"
        && this.#generatorSourcesConflict(safePayload, result.sourceRefs, baseContext.sourceIds)) {
        lastFailure = "source_conflict: generator citations are not covered by the model source references";
        lastErrorCode = "source_conflict";
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: result.status,
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (sanitizedPayload.unsafe
        || !payloadWithinLimit(safePayload)
        || !definition.validateOutput(safePayload)) {
        lastFailure = `invalid_json: invalid ${definition.graphId} output`;
        lastErrorCode = "invalid_json";
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: "invalid_output",
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (definition.graphId !== "generator"
        && !this.#reviewEvidenceSourcesAllowed(definition.graphId, safePayload, baseContext.sourceIds)) {
        lastFailure = `source_conflict: ${definition.graphId} evidence cites an unregistered source`;
        lastErrorCode = "source_conflict";
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: "invalid_output",
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      const referenceIssue = outputIssue?.(safePayload);
      if (referenceIssue) {
        lastFailure = `${referenceIssue.errorCode}: ${referenceIssue.reason}`;
        lastErrorCode = referenceIssue.errorCode;
        await this.#appendAttempt(checkpoint, {
          graphId: definition.graphId,
          attempt,
          modelRunId,
          status: "invalid_output",
          errorCode: lastErrorCode,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          traceSummary: safeTraceSummary,
          completedAt: this.#now().toISOString(),
        });
        continue;
      }
      await this.#appendAttempt(checkpoint, {
        graphId: definition.graphId,
        attempt,
        modelRunId,
        status: "ok",
        modelId: checkpoint.modelId,
        promptVersion: checkpoint.promptVersion,
        ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
        traceSummary: safeTraceSummary,
        completedAt: this.#now().toISOString(),
      }, false);
      return {
        output: safePayload,
        checkpoint: {
          graphId: definition.graphId,
          attempts: attempt,
          status: "ok",
          runId: checkpoint.runId,
          modelRunId,
          profileRevision: checkpoint.profileRevision,
          inputSummaryHash: checkpoint.inputSummaryHash,
          modelId: checkpoint.modelId,
          promptVersion: checkpoint.promptVersion,
          sourceRefs: [...result.sourceRefs],
          traceSummary: safeTraceSummary,
          ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
          completedAt: this.#now().toISOString(),
          output: clone(safePayload),
        },
      };
    }

    return { failure: lastFailure, errorCode: lastErrorCode };
  }

  async #appendAttempt(
    checkpoint: ReviewRunCheckpoint,
    record: ReviewAttemptRecord,
    persist = true,
  ): Promise<void> {
    const records = checkpoint.stageAttempts[record.graphId] ?? [];
    records.push(clone(record));
    checkpoint.stageAttempts[record.graphId] = records;
    if (persist) await this.#checkpointStore.save(checkpoint);
  }

  #executionFailure(status: ModelExecutionStatus, errorCode: string | undefined): { errorCode: string } | undefined {
    if (status === "ok") return undefined;
    if (status === "timeout") return { errorCode: "timeout" };
    if (status === "invalid_output") return { errorCode: "invalid_json" };
    if (errorCode === "refusal") return { errorCode: "refusal" };
    return { errorCode: "provider_error" };
  }

  #generatorSourcesConflict(
    output: unknown,
    sourceRefs: readonly string[],
    allowedSourceIds: readonly string[],
  ): boolean {
    if (!isRecord(output)
      || !Array.isArray(output.citedSourceIds)
      || !output.citedSourceIds.every((sourceId) => typeof sourceId === "string" && sourceId.length > 0)) {
      return false;
    }
    const sourceRefSet = new Set(sourceRefs);
    return !this.#sourceRefsAllowed(output.citedSourceIds, allowedSourceIds)
      || output.citedSourceIds.some((sourceId) => !sourceRefSet.has(sourceId));
  }

  #sourceRefsAllowed(sourceRefs: unknown, allowedSourceIds: readonly string[]): boolean {
    if (!Array.isArray(sourceRefs) || !sourceRefs.every((sourceRef) => typeof sourceRef === "string" && sourceRef.length > 0)) {
      return false;
    }
    if (sourceRefs.length === 0) return true;
    const allowed = new Set(allowedSourceIds);
    return sourceRefs.every((sourceRef) => allowed.has(sourceRef));
  }

  #reviewEvidenceSourcesAllowed(
    graphId: Exclude<ReviewGraphId, "generator">,
    output: unknown,
    allowedSourceIds: readonly string[],
  ): boolean {
    if (graphId === "hunter") {
      return (output as HunterOutput).issues.every((issue) => this.#sourceRefsAllowed(issue.sourceAnchorIds, allowedSourceIds)
        && issue.sourceAnchorIds.length > 0);
    }
    if (graphId === "defender") {
      return (output as DefenderOutput).issueAssessments.every((assessment) => this.#sourceRefsAllowed(assessment.sourceAnchorIds, allowedSourceIds)
        && assessment.sourceAnchorIds.length > 0);
    }
    const judge = output as JudgeOutput;
    return judge.issueDecisions.every((decision) => this.#sourceRefsAllowed(decision.sourceAnchorIds, allowedSourceIds)
      && decision.sourceAnchorIds.length > 0)
      && judge.additionalIssues.every((issue) => this.#sourceRefsAllowed(issue.sourceAnchorIds, allowedSourceIds)
        && issue.sourceAnchorIds.length > 0);
  }

  #hunterOutputIssue(output: HunterOutput): StageCheckpointIssue | undefined {
    const issueIds = output.issues.map((issue) => issue.issueId);
    return new Set(issueIds).size === issueIds.length
      ? undefined
      : { errorCode: "invalid_json", reason: "Hunter issue identifiers must be unique" };
  }

  #defenderOutputIssue(output: DefenderOutput, hunter: HunterOutput): StageCheckpointIssue | undefined {
    if (!defenderOutputIsClosed(output, hunter)) {
      return { errorCode: "invalid_json", reason: "Defender issue references do not close the routed Hunter issues" };
    }
    return undefined;
  }

  #judgeOutputIssue(output: JudgeOutput, hunter: HunterOutput): StageCheckpointIssue | undefined {
    if (!judgeOutputIsClosed(output, hunter)) {
      return { errorCode: "invalid_json", reason: "Judge issue decisions or blocked references do not close the reviewed issues" };
    }
    return undefined;
  }

  #checkpointFailure(
    fallbackSafeFeedback: string,
    errorCode: StageCheckpointErrorCode,
    reason: string,
  ): ReviewOrchestratorResult {
    return {
      status: "failed",
      finalSafeFeedback: fallbackSafeFeedback,
      summary: `${errorCode}: ${reason}`,
      blockedIssueIds: [],
      usedFallback: false,
      errorCode,
    };
  }

  #versionConflict(fallbackSafeFeedback: string, reason: string): ReviewOrchestratorResult {
    return this.#checkpointFailure(fallbackSafeFeedback, "version_conflict", reason);
  }

  #judgeToFinal(fallbackSafeFeedback: string, judge: JudgeOutput): ReviewOrchestratorResult {
    if (judge.verdict === "accepted") {
      return {
        status: "accepted",
        finalSafeFeedback: fallbackSafeFeedback,
        summary: "review accepted after deterministic validation",
        blockedIssueIds: [...judge.blockedIssueIds],
        usedFallback: false,
      };
    }
    if (judge.verdict === "revise") {
      return {
        status: "fallback",
        finalSafeFeedback: fallbackSafeFeedback,
        summary: "review fallback after judge revise",
        blockedIssueIds: [...judge.blockedIssueIds],
        usedFallback: true,
      };
    }
    return {
      status: "failed",
      finalSafeFeedback: fallbackSafeFeedback,
      summary: "review failed after judge rejection",
      blockedIssueIds: [...judge.blockedIssueIds],
      usedFallback: false,
    };
  }

  async #fallback(
    checkpoint: ReviewRunCheckpoint,
    fallbackSafeFeedback: string,
    failedGraphId: ReviewGraphId,
    _reason: string,
    errorCode: string,
  ): Promise<ReviewOrchestratorResult> {
    return this.#finalizeTechnical(checkpoint, fallbackSafeFeedback, failedGraphId, errorCode);
  }

  #technicalResult(
    fallbackSafeFeedback: string,
    failedGraphId: ReviewGraphId,
    errorCode: string,
  ): ReviewOrchestratorResult {
    const failed = errorCode === "version_conflict";
    return {
      status: failed ? "failed" : "fallback",
      finalSafeFeedback: fallbackSafeFeedback,
      summary: `${errorCode}: ${failedGraphId} review stage failed safely`,
      blockedIssueIds: [],
      usedFallback: !failed,
      errorCode,
    };
  }

  async #finalizeTechnical(
    checkpoint: ReviewRunCheckpoint,
    fallbackSafeFeedback: string,
    failedGraphId: ReviewGraphId,
    errorCode: string,
  ): Promise<ReviewOrchestratorResult> {
    const result = this.#technicalResult(fallbackSafeFeedback, failedGraphId, errorCode);
    return this.#finalize(
      checkpoint,
      result,
      result.status === "failed" ? "technical_failed" : "technical_fallback",
      failedGraphId,
    );
  }

  async #finalize(
    checkpoint: ReviewRunCheckpoint,
    result: ReviewOrchestratorResult,
    cause: NonNullable<ReviewRunCheckpoint["finalCause"]>,
    failedGraphId?: ReviewGraphId,
  ): Promise<ReviewOrchestratorResult> {
    checkpoint.finalStatus = result.status;
    checkpoint.finalSafeFeedback = result.finalSafeFeedback;
    checkpoint.finalSummary = result.summary;
    checkpoint.finalBlockedIssueIds = [...result.blockedIssueIds];
    if (result.errorCode === undefined) delete checkpoint.finalErrorCode;
    else checkpoint.finalErrorCode = result.errorCode;
    checkpoint.finalCause = cause;
    if (failedGraphId === undefined) delete checkpoint.finalFailedGraphId;
    else checkpoint.finalFailedGraphId = failedGraphId;
    checkpoint.usedFallback = result.usedFallback;
    checkpoint.finalizedAt = this.#now().toISOString();
    await this.#checkpointStore.save(checkpoint);
    return { ...result, blockedIssueIds: [...result.blockedIssueIds] };
  }
}
