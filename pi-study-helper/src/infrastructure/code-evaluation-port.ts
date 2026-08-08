import { createHash } from "node:crypto";
import type { ActivityResult, LearningRuntimeErrorCode } from "../domain/v2-types.js";

export type EvaluationMode = "preview" | "submit";

export interface EvaluationActivityProjection {
  activityId: string;
  kind: "code_completion" | "coding_practical" | "debug";
  profileRevision: number;
  templateVersion: string;
  environmentRef: string;
}

export interface EvaluationEnvironmentProjection {
  environmentId: string;
  status: "measured" | "measured_node_submit" | "draft_pending_C_prototype";
  environmentHash: string | null;
  prototypeEvidenceRef: string;
}

export interface PrepareEvaluationInput {
  activity: EvaluationActivityProjection;
  profileRevision: number;
  taskVersion: string;
  mode: EvaluationMode;
  environment: EvaluationEnvironmentProjection;
  assetBundleHash: string;
}

export interface PreparedEvaluation {
  preparedId: string;
  mode: EvaluationMode;
  activityId: string;
  profileRevision: number;
  environmentHash: string;
  assetBundleHash: string;
  expiresAt: string;
}

export interface RunEvaluationInput {
  requestId: string;
  attemptId: string;
  prepared: PreparedEvaluation;
  code: string;
}

export interface CodeEvaluationPort {
  prepare(input: PrepareEvaluationInput): Promise<PreparedEvaluation>;
  run(input: RunEvaluationInput, signal: AbortSignal): Promise<ActivityResult>;
}

type PreparationErrorCode = Extract<
  LearningRuntimeErrorCode,
  | "profile_revision_conflict"
  | "activity_version_conflict"
  | "environment_mismatch"
  | "submission_contract_error"
  | "test_asset_invalid"
>;

type RunErrorCode = Extract<LearningRuntimeErrorCode, "idempotency_conflict">;

export class EvaluationPreparationError extends Error {
  readonly errorCode: PreparationErrorCode;

  constructor(errorCode: PreparationErrorCode, message: string) {
    super(message);
    this.name = "EvaluationPreparationError";
    this.errorCode = errorCode;
  }
}

export class EvaluationRunError extends Error {
  readonly errorCode: RunErrorCode;

  constructor(errorCode: RunErrorCode, message: string) {
    super(message);
    this.name = "EvaluationRunError";
    this.errorCode = errorCode;
  }
}

export interface FixtureCodeEvaluationAdapterOptions {
  resultsByActivityId: Readonly<Record<string, ActivityResult>>;
  evaluatorVersion?: string;
  now?: () => Date;
  preparedTtlMs?: number;
}

interface PrivatePreparedState {
  prepared: PreparedEvaluation;
  result: ActivityResult;
}

interface IdempotentRunRecord {
  requestId: string;
  attemptId: string;
  requestFingerprint: string;
  result: ActivityResult;
}

const ASSET_BUNDLE_HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/u;
const ENVIRONMENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PREPARED_ID_PATTERN = /^prepared-[a-f0-9]{64}$/u;
const SAFE_UNAVAILABLE_HASH = "unavailable";
const PREPARED_KEYS = [
  "activityId",
  "assetBundleHash",
  "environmentHash",
  "expiresAt",
  "mode",
  "preparedId",
  "profileRevision",
] as const;
const ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  "code_completion",
  "coding_practical",
  "debug",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPreparedEvaluation(value: unknown): value is PreparedEvaluation {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...PREPARED_KEYS].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && isNonEmptyString(value.preparedId)
    && PREPARED_ID_PATTERN.test(value.preparedId)
    && (value.mode === "preview" || value.mode === "submit")
    && isNonEmptyString(value.activityId)
    && isPositiveInteger(value.profileRevision)
    && isNonEmptyString(value.environmentHash)
    && ENVIRONMENT_HASH_PATTERN.test(value.environmentHash)
    && isNonEmptyString(value.assetBundleHash)
    && ASSET_BUNDLE_HASH_PATTERN.test(value.assetBundleHash)
    && isNonEmptyString(value.expiresAt)
    && Number.isFinite(Date.parse(value.expiresAt));
}

function cloneResult(result: ActivityResult): ActivityResult {
  return {
    ...result,
    ...(result.dimensionResults
      ? { dimensionResults: { ...result.dimensionResults } }
      : {}),
  };
}

function cancellationResult(
  prepared: PreparedEvaluation,
  evaluatorVersion: string,
): ActivityResult {
  return {
    executionStatus: "cancelled",
    verdict: "not_graded",
    safeFeedback: "Evaluation cancelled; the draft remains available.",
    evaluatorVersion,
    environmentHash: prepared.environmentHash,
    assetBundleHash: prepared.assetBundleHash,
  };
}

function invalidPreparedResult(
  prepared: PreparedEvaluation | undefined,
  evaluatorVersion: string,
): ActivityResult {
  return {
    executionStatus: "failed",
    verdict: "not_graded",
    errorKind: "evaluator",
    errorCode: "test_asset_invalid",
    safeFeedback: "Prepared evaluation state is unavailable; the draft remains available.",
    evaluatorVersion,
    environmentHash: prepared?.environmentHash ?? SAFE_UNAVAILABLE_HASH,
    assetBundleHash: prepared?.assetBundleHash ?? SAFE_UNAVAILABLE_HASH,
  };
}

export class FixtureCodeEvaluationAdapter implements CodeEvaluationPort {
  readonly #resultsByActivityId: Readonly<Record<string, ActivityResult>>;
  readonly #evaluatorVersion: string;
  readonly #now: () => Date;
  readonly #preparedTtlMs: number;
  readonly #privateStates = new Map<string, PrivatePreparedState>();
  readonly #runsByRequestId = new Map<string, IdempotentRunRecord>();
  readonly #runsByAttemptId = new Map<string, IdempotentRunRecord>();

  constructor(options: FixtureCodeEvaluationAdapterOptions) {
    this.#resultsByActivityId = options.resultsByActivityId;
    this.#evaluatorVersion = options.evaluatorVersion ?? "fixture-evaluator-w1-c1";
    this.#now = options.now ?? (() => new Date());
    this.#preparedTtlMs = options.preparedTtlMs ?? 5 * 60_000;
  }

  async prepare(input: PrepareEvaluationInput): Promise<PreparedEvaluation> {
    const rawInput: unknown = input;
    if (!isRecord(rawInput) || !isRecord(rawInput.activity)) {
      throw new EvaluationPreparationError(
        "test_asset_invalid",
        "The evaluation activity projection is invalid.",
      );
    }
    if (!isNonEmptyString(input.activity.activityId)
      || !ACTIVITY_KINDS.has(input.activity.kind)
      || !isPositiveInteger(input.activity.profileRevision)
      || !isNonEmptyString(input.activity.templateVersion)
      || !isNonEmptyString(input.activity.environmentRef)) {
      throw new EvaluationPreparationError(
        "test_asset_invalid",
        "The evaluation activity projection is invalid.",
      );
    }
    if (input.mode !== "preview" && input.mode !== "submit") {
      throw new EvaluationPreparationError(
        "submission_contract_error",
        "The evaluation mode must be preview or submit.",
      );
    }
    if (!isPositiveInteger(input.profileRevision)) {
      throw new EvaluationPreparationError(
        "profile_revision_conflict",
        "The Profile revision must be a positive integer.",
      );
    }
    if (!isNonEmptyString(input.taskVersion)) {
      throw new EvaluationPreparationError(
        "activity_version_conflict",
        "The activity task version is invalid.",
      );
    }
    if (input.profileRevision !== input.activity.profileRevision) {
      throw new EvaluationPreparationError(
        "profile_revision_conflict",
        "Activity and session Profile revisions differ.",
      );
    }
    if (input.taskVersion !== input.activity.templateVersion) {
      throw new EvaluationPreparationError(
        "activity_version_conflict",
        "Activity task version changed before preparation.",
      );
    }
    if (!isRecord(input.environment)
      || !isNonEmptyString(input.environment.environmentId)
      || input.environment.environmentId !== input.activity.environmentRef
      || input.environment.status !== "measured"
      || !isNonEmptyString(input.environment.environmentHash)
      || !ENVIRONMENT_HASH_PATTERN.test(input.environment.environmentHash)
      || !isNonEmptyString(input.environment.prototypeEvidenceRef)
      || input.environment.prototypeEvidenceRef === "pending_C_prototype") {
      throw new EvaluationPreparationError(
        "environment_mismatch",
        "The environment lock has not been measured and approved.",
      );
    }
    if (!ASSET_BUNDLE_HASH_PATTERN.test(input.assetBundleHash)) {
      throw new EvaluationPreparationError(
        "test_asset_invalid",
        "The task asset bundle hash is invalid.",
      );
    }
    const fixtureResult = this.#resultsByActivityId[input.activity.activityId];
    if (!fixtureResult) {
      throw new EvaluationPreparationError(
        "test_asset_invalid",
        "No deterministic fixture result exists for this activity.",
      );
    }

    const digestInput = [
      input.activity.activityId,
      input.profileRevision,
      input.taskVersion,
      input.mode,
      input.environment.environmentHash,
      input.assetBundleHash,
    ].join("\n");
    const preparedId = `prepared-${createHash("sha256").update(digestInput, "utf8").digest("hex")}`;
    const preparedAt = this.#now();
    const prepared: PreparedEvaluation = {
      preparedId,
      mode: input.mode,
      activityId: input.activity.activityId,
      profileRevision: input.profileRevision,
      environmentHash: input.environment.environmentHash,
      assetBundleHash: input.assetBundleHash,
      expiresAt: new Date(preparedAt.getTime() + this.#preparedTtlMs).toISOString(),
    };
    this.#privateStates.set(preparedId, { prepared, result: cloneResult(fixtureResult) });
    return { ...prepared };
  }

  async run(input: RunEvaluationInput, signal: AbortSignal): Promise<ActivityResult> {
    await Promise.resolve();
    const rawInput: unknown = input;
    if (!isRecord(rawInput) || !isPreparedEvaluation(rawInput.prepared)) {
      const rawPrepared = isRecord(rawInput) ? rawInput.prepared : undefined;
      const preparedId = isRecord(rawPrepared) && isNonEmptyString(rawPrepared.preparedId)
        ? rawPrepared.preparedId
        : undefined;
      const malformedState = preparedId === undefined
        ? undefined
        : this.#privateStates.get(preparedId);
      if (malformedState) this.#privateStates.delete(malformedState.prepared.preparedId);
      return invalidPreparedResult(malformedState?.prepared, this.#evaluatorVersion);
    }
    const prepared = rawInput.prepared;
    const state = this.#privateStates.get(prepared.preparedId);
    if (!state
      || state.prepared.preparedId !== prepared.preparedId
      || state.prepared.mode !== prepared.mode
      || state.prepared.activityId !== prepared.activityId
      || state.prepared.profileRevision !== prepared.profileRevision
      || state.prepared.environmentHash !== prepared.environmentHash
      || state.prepared.assetBundleHash !== prepared.assetBundleHash
      || state.prepared.expiresAt !== prepared.expiresAt) {
      if (state) this.#privateStates.delete(state.prepared.preparedId);
      return invalidPreparedResult(state?.prepared, this.#evaluatorVersion);
    }
    if (this.#now().getTime() >= Date.parse(state.prepared.expiresAt)) {
      this.#privateStates.delete(state.prepared.preparedId);
      return invalidPreparedResult(state.prepared, this.#evaluatorVersion);
    }
    if (signal.aborted) {
      return cancellationResult(state.prepared, this.#evaluatorVersion);
    }
    if (!isNonEmptyString(input.requestId)
      || !isNonEmptyString(input.attemptId)
      || typeof input.code !== "string") {
      return {
        executionStatus: "failed",
        verdict: "fail",
        errorKind: "learner",
        errorCode: "submission_contract_error",
        safeFeedback: "Submission identifiers and code must satisfy the activity contract.",
        evaluatorVersion: this.#evaluatorVersion,
        environmentHash: state.prepared.environmentHash,
        assetBundleHash: state.prepared.assetBundleHash,
      };
    }

    const requestFingerprint = createHash("sha256")
      .update([state.prepared.preparedId, input.code].join("\n"), "utf8")
      .digest("hex");
    const requestRecord = this.#runsByRequestId.get(input.requestId);
    const attemptRecord = this.#runsByAttemptId.get(input.attemptId);
    if ((requestRecord
        && (requestRecord.attemptId !== input.attemptId
          || requestRecord.requestFingerprint !== requestFingerprint))
      || (attemptRecord && attemptRecord.requestFingerprint !== requestFingerprint)) {
      throw new EvaluationRunError(
        "idempotency_conflict",
        "The requestId or attemptId was already used for a different evaluation request.",
      );
    }

    const existingRecord = requestRecord ?? attemptRecord;
    if (existingRecord) {
      this.#runsByRequestId.set(input.requestId, existingRecord);
      return cloneResult(existingRecord.result);
    }

    const record: IdempotentRunRecord = {
      requestId: input.requestId,
      attemptId: input.attemptId,
      requestFingerprint,
      result: cloneResult(state.result),
    };
    this.#runsByRequestId.set(input.requestId, record);
    this.#runsByAttemptId.set(input.attemptId, record);
    return cloneResult(record.result);
  }
}
