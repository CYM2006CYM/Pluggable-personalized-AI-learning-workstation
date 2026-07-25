import type { LearningRuntimeErrorCode } from "../domain/v2-types.js";

export const EVALUATOR_STAGE_ORDER = [
  "prepare",
  "user_code",
  "public_tests",
  "hidden_tests",
  "summarize",
] as const;

export type EvaluatorStage = (typeof EVALUATOR_STAGE_ORDER)[number];
export type EvaluatorExecutableStage = Extract<
  EvaluatorStage,
  "user_code" | "public_tests" | "hidden_tests"
>;

export interface DatasetFixturesAsset {
  fixtures: DatasetFixtureRef[];
}

export interface DatasetFixtureRef {
  fixtureId: string;
  visibility: "public" | "private";
  fileRef: string;
  format: "csv";
  assetHash: string;
}

export interface TestCaseRef {
  testId: string;
  visibility: "public" | "hidden";
  fileRef: string;
  dimensionId: string;
  blocking: boolean;
  assetHash: string;
  fixtureRefs: string[];
}

export interface EvaluatorRequestEnvelope {
  protocolVersion: string;
  executionId: string;
  stage: EvaluatorExecutableStage;
  entryPoint: Record<string, unknown>;
  output: Record<string, unknown>;
  fixtureRefs: string[];
  deterministicSeed: number;
}

export interface EvaluatorResponseEnvelope {
  protocolVersion: string;
  runId: string;
  attemptId: string;
  stage: EvaluatorStage;
  status: "ok" | "failed" | "evaluator_error";
  errorKind?: "learner" | "evaluator";
  errorCode?: LearningRuntimeErrorCode;
  score?: number;
  dimensionResults?: Record<string, number>;
  outputSummary: string;
  environmentHash: string;
  assetBundleHash: string;
  durationMs?: number;
}

export type ProtocolValidationErrorCode = Extract<
  LearningRuntimeErrorCode,
  "test_asset_invalid" | "result_protocol_invalid"
>;

export type ProtocolValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorCode: ProtocolValidationErrorCode; message: string };

export interface EvaluationAssetContext {
  fileHashes: ReadonlyMap<string, string>;
  symlinkPaths: ReadonlySet<string>;
}

export interface EvaluationBindingInput {
  fixtureAsset: unknown;
  activityDatasetRefs: unknown;
  argumentFixtureIds?: unknown;
  publicTests: unknown;
  hiddenTests: unknown;
  assetContext: EvaluationAssetContext;
}

export interface ExecutionBoundaryContract {
  temporaryDirectory: "unique_per_run";
  cleanup: "always_on_success_failure_cancel";
  processIsolation: "separate_clean_public_hidden_processes";
  hiddenAssetsOwner: "node_parent_only";
  hiddenAssetsInUserDirectory: false;
  workingDirectory: "fixed_per_run";
  environmentVariables: "minimal_allowlist";
  shell: false;
  timeoutAction: "terminate_process_tree";
  outputHandling: "truncate_escape_stdout_stderr";
}

export interface PrototypeMeasurementQuestion {
  questionId: string;
  constraint: string;
  status: "pending_C_prototype";
  evidenceRef: null;
  ownerDecision: "pending_after_prototype_evidence";
}

export interface ExecutionBoundaryFixture {
  executionConstraints: ExecutionBoundaryContract;
  prototypeMeasurements: PrototypeMeasurementQuestion[];
}

export type FixtureRefsByStage = Readonly<Record<EvaluatorStage, readonly string[]>>;

const FIXTURE_KEYS = ["assetHash", "fileRef", "fixtureId", "format", "visibility"] as const;
const TEST_CASE_KEYS = [
  "assetHash",
  "blocking",
  "dimensionId",
  "fileRef",
  "fixtureRefs",
  "testId",
  "visibility",
] as const;
const REQUEST_KEYS = [
  "deterministicSeed",
  "entryPoint",
  "executionId",
  "fixtureRefs",
  "output",
  "protocolVersion",
  "stage",
] as const;
const RESPONSE_KEYS = [
  "assetBundleHash",
  "attemptId",
  "dimensionResults",
  "durationMs",
  "environmentHash",
  "errorCode",
  "errorKind",
  "outputSummary",
  "protocolVersion",
  "runId",
  "score",
  "stage",
  "status",
] as const;
const ENVIRONMENT_LOCK_KEYS = [
  "allowedLibraries",
  "capabilityFlags",
  "createdAt",
  "environmentHash",
  "environmentId",
  "evaluatorVersion",
  "executionConstraints",
  "limits",
  "nodeVersion",
  "pandasVersion",
  "platform",
  "prototypeEvidenceRef",
  "prototypeMeasurements",
  "pyodideVersion",
  "pythonVersion",
  "schemaVersion",
  "status",
  "validationStatus",
] as const;
const EXECUTION_CONSTRAINT_KEYS = [
  "cleanup",
  "environmentVariables",
  "hiddenAssetsInUserDirectory",
  "hiddenAssetsOwner",
  "outputHandling",
  "processIsolation",
  "shell",
  "temporaryDirectory",
  "timeoutAction",
  "workingDirectory",
] as const;
const PROTOTYPE_MEASUREMENT_KEYS = [
  "constraint",
  "evidenceRef",
  "ownerDecision",
  "questionId",
  "status",
] as const;
const REQUIRED_PROTOTYPE_QUESTION_IDS = [
  "temporary-directory-cleanup",
  "public-hidden-process-isolation",
  "hidden-asset-ownership",
  "shell-working-directory",
  "minimal-environment",
  "process-tree-timeout",
  "output-truncation-escaping",
  "runtime-versions-dtype",
  "resource-limits",
  "network-memory-capabilities",
] as const;

const LEARNER_EVALUATION_ERROR_CODES: ReadonlySet<string> = new Set<LearningRuntimeErrorCode>([
  "syntax_error",
  "runtime_error",
  "test_failed",
  "timeout",
  "output_limit",
  "disallowed_import",
  "submission_contract_error",
]);

const EVALUATOR_ERROR_CODES: ReadonlySet<string> = new Set<LearningRuntimeErrorCode>([
  "environment_mismatch",
  "evaluator_error",
  "evaluator_start_failed",
  "evaluator_timeout",
  "dependency_missing",
  "test_asset_invalid",
  "result_protocol_invalid",
  "runner_crash",
]);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HOST_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|(?:^|[\s"'(])\/[^\s"'()]+|AppData)/u;

function success<T>(value: T): ProtocolValidationResult<T> {
  return { ok: true, value };
}

function failure<T>(
  errorCode: ProtocolValidationErrorCode,
  message: string,
): ProtocolValidationResult<T> {
  return { ok: false, errorCode, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allValuesAreNull(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value)
    && hasExactKeys(value, keys)
    && keys.every((key) => value[key] === null);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function isSafeRelativePath(value: string): boolean {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  const parts = value.split("/");
  return parts.length > 0 && parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function hasRuntimeAssetContext(value: unknown): value is EvaluationAssetContext {
  return isRecord(value)
    && value.fileHashes instanceof Map
    && value.symlinkPaths instanceof Set;
}

function isStage(value: unknown): value is EvaluatorStage {
  return typeof value === "string" && (EVALUATOR_STAGE_ORDER as readonly string[]).includes(value);
}

function isExecutableStage(value: unknown): value is EvaluatorExecutableStage {
  return value === "user_code" || value === "public_tests" || value === "hidden_tests";
}

function stableUnion(items: readonly TestCaseRef[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const test of items) {
    for (const fixtureRef of test.fixtureRefs) {
      if (!seen.has(fixtureRef)) {
        seen.add(fixtureRef);
        result.push(fixtureRef);
      }
    }
  }
  return result;
}

function validateFixture(
  input: unknown,
  context: Partial<EvaluationAssetContext>,
): ProtocolValidationResult<DatasetFixtureRef> {
  if (!isRecord(input) || !hasExactKeys(input, FIXTURE_KEYS)) {
    return failure("test_asset_invalid", "Dataset fixture fields do not match W1-C5.");
  }
  if (!isNonEmptyString(input.fixtureId)) {
    return failure("test_asset_invalid", "Dataset fixture ID must be non-empty.");
  }
  if (input.visibility !== "public" && input.visibility !== "private") {
    return failure("test_asset_invalid", "Dataset fixture visibility is invalid.");
  }
  if (!isNonEmptyString(input.fileRef) || !isSafeRelativePath(input.fileRef)) {
    return failure("test_asset_invalid", "Dataset fixture path is not a safe relative path.");
  }
  const expectedPrefix = input.visibility === "public" ? "datasets/public/" : "datasets/private/";
  if (!input.fileRef.startsWith(expectedPrefix)) {
    return failure("test_asset_invalid", "Dataset fixture path does not match its visibility.");
  }
  if (input.format !== "csv" || !isNonEmptyString(input.assetHash) || !SHA256_PATTERN.test(input.assetHash)) {
    return failure("test_asset_invalid", "Dataset fixture format or hash is invalid.");
  }
  if (context.symlinkPaths?.has(input.fileRef)) {
    return failure("test_asset_invalid", "Dataset fixture resolves through a symbolic link.");
  }
  const actualHash = context.fileHashes?.get(input.fileRef);
  if (context.fileHashes && actualHash !== input.assetHash) {
    return failure("test_asset_invalid", "Dataset fixture is missing or its hash changed.");
  }
  return success(input as unknown as DatasetFixtureRef);
}

export function validateDatasetFixturesAsset(
  input: unknown,
  context: Partial<EvaluationAssetContext> = {},
): ProtocolValidationResult<DatasetFixturesAsset> {
  if (!isRecord(input) || !hasExactKeys(input, ["fixtures"]) || !Array.isArray(input.fixtures)) {
    return failure("test_asset_invalid", "Dataset fixture asset must contain only a fixtures array.");
  }
  const fixtures: DatasetFixtureRef[] = [];
  const fixtureIds = new Set<string>();
  for (const candidate of input.fixtures) {
    const validated = validateFixture(candidate, context);
    if (!validated.ok) return validated;
    if (fixtureIds.has(validated.value.fixtureId)) {
      return failure("test_asset_invalid", "Dataset fixture IDs must be unique.");
    }
    fixtureIds.add(validated.value.fixtureId);
    fixtures.push(validated.value);
  }
  return success({ fixtures });
}

function validateTestCase(
  input: unknown,
  expectedVisibility: TestCaseRef["visibility"],
  context: EvaluationAssetContext,
): ProtocolValidationResult<TestCaseRef> {
  if (!isRecord(input) || !hasExactKeys(input, TEST_CASE_KEYS)) {
    return failure("test_asset_invalid", "Test case fields do not match W1-C5.");
  }
  if (!isNonEmptyString(input.testId) || !isNonEmptyString(input.dimensionId)) {
    return failure("test_asset_invalid", "Test case identifiers must be non-empty.");
  }
  if (input.visibility !== expectedVisibility) {
    return failure("test_asset_invalid", "Test case visibility does not match its collection.");
  }
  if (!isNonEmptyString(input.fileRef) || !isSafeRelativePath(input.fileRef)) {
    return failure("test_asset_invalid", "Test case path is not a safe relative path.");
  }
  const expectedPrefix = expectedVisibility === "public"
    ? "assessments/public/tests/"
    : "assessments/private/tests/";
  if (!input.fileRef.startsWith(expectedPrefix)) {
    return failure("test_asset_invalid", "Test case path does not match its visibility.");
  }
  if (input.blocking !== true && input.blocking !== false) {
    return failure("test_asset_invalid", "Test case blocking must be boolean.");
  }
  if (!isNonEmptyString(input.assetHash) || !SHA256_PATTERN.test(input.assetHash)) {
    return failure("test_asset_invalid", "Test case hash is invalid.");
  }
  if (!isUniqueStringArray(input.fixtureRefs)) {
    return failure("test_asset_invalid", "Test fixture references must be a unique string array.");
  }
  if (context.symlinkPaths?.has(input.fileRef)) {
    return failure("test_asset_invalid", "Test case resolves through a symbolic link.");
  }
  const actualHash = context.fileHashes?.get(input.fileRef);
  if (context.fileHashes && actualHash !== input.assetHash) {
    return failure("test_asset_invalid", "Test case is missing or its hash changed.");
  }
  return success(input as unknown as TestCaseRef);
}

export function validateEvaluationBindings(
  input: EvaluationBindingInput,
): ProtocolValidationResult<FixtureRefsByStage> {
  const rawInput: unknown = input;
  if (!isRecord(rawInput) || !hasRuntimeAssetContext(rawInput.assetContext)) {
    return failure(
      "test_asset_invalid",
      "Runtime asset hashes and symbolic-link inspection context are required.",
    );
  }
  const fixtureAsset = validateDatasetFixturesAsset(input.fixtureAsset, input.assetContext);
  if (!fixtureAsset.ok) return fixtureAsset;
  if (!isUniqueStringArray(input.activityDatasetRefs)) {
    return failure("test_asset_invalid", "Activity dataset references must be unique.");
  }
  if (input.argumentFixtureIds !== undefined && !isUniqueStringArray(input.argumentFixtureIds)) {
    return failure("test_asset_invalid", "Argument fixture references must be unique.");
  }
  if (!Array.isArray(input.publicTests) || !Array.isArray(input.hiddenTests)) {
    return failure("test_asset_invalid", "Public and hidden tests must be arrays.");
  }

  const fixtureById = new Map(fixtureAsset.value.fixtures.map((fixture) => [fixture.fixtureId, fixture]));
  const allowed = new Set(input.activityDatasetRefs);
  for (const fixtureId of allowed) {
    if (!fixtureById.has(fixtureId)) {
      return failure("test_asset_invalid", "Activity references an unknown dataset fixture.");
    }
  }
  const argumentFixtures = input.argumentFixtureIds === undefined
    ? undefined
    : new Set(input.argumentFixtureIds);
  if (argumentFixtures) {
    for (const fixtureId of argumentFixtures) {
      if (!allowed.has(fixtureId)) {
        return failure("test_asset_invalid", "Function argument fixture is not allowed by the activity.");
      }
    }
  }

  const publicTests: TestCaseRef[] = [];
  const hiddenTests: TestCaseRef[] = [];
  const testIds = new Set<string>();
  for (const [candidates, visibility, output] of [
    [input.publicTests, "public", publicTests],
    [input.hiddenTests, "hidden", hiddenTests],
  ] as const) {
    for (const candidate of candidates) {
      const validated = validateTestCase(candidate, visibility, input.assetContext);
      if (!validated.ok) return validated;
      if (testIds.has(validated.value.testId)) {
        return failure("test_asset_invalid", "Test case IDs must be unique.");
      }
      testIds.add(validated.value.testId);
      for (const fixtureId of validated.value.fixtureRefs) {
        const fixture = fixtureById.get(fixtureId);
        if (!fixture || !allowed.has(fixtureId) || (argumentFixtures && !argumentFixtures.has(fixtureId))) {
          return failure("test_asset_invalid", "Test case references an unavailable dataset fixture.");
        }
        if (visibility === "public" && fixture.visibility !== "public") {
          return failure("test_asset_invalid", "Public tests cannot reference private dataset fixtures.");
        }
      }
      output.push(validated.value);
    }
  }

  return success({
    prepare: [],
    user_code: [],
    public_tests: stableUnion(publicTests),
    hidden_tests: stableUnion(hiddenTests),
    summarize: [],
  });
}

export function validateStageSequence(
  stages: readonly unknown[],
): ProtocolValidationResult<readonly EvaluatorStage[]> {
  if (stages.length !== EVALUATOR_STAGE_ORDER.length
    || stages.some((stage, index) => stage !== EVALUATOR_STAGE_ORDER[index])) {
    return failure("result_protocol_invalid", "Evaluator stages must follow the complete frozen order.");
  }
  return success(EVALUATOR_STAGE_ORDER);
}

export function validateEvaluatorRequestEnvelope(
  input: unknown,
  expectedFixtureRefs?: readonly string[],
): ProtocolValidationResult<EvaluatorRequestEnvelope> {
  if (!isRecord(input) || !hasExactKeys(input, REQUEST_KEYS)) {
    return failure("result_protocol_invalid", "Evaluator request fields are invalid.");
  }
  if (!isNonEmptyString(input.protocolVersion)
    || !isNonEmptyString(input.executionId)
    || !isExecutableStage(input.stage)
    || !isRecord(input.entryPoint)
    || !isRecord(input.output)
    || !isUniqueStringArray(input.fixtureRefs)
    || typeof input.deterministicSeed !== "number"
    || !Number.isSafeInteger(input.deterministicSeed)) {
    return failure("result_protocol_invalid", "Evaluator request values are invalid.");
  }
  if (expectedFixtureRefs
    && (input.fixtureRefs.length !== expectedFixtureRefs.length
      || input.fixtureRefs.some((value, index) => value !== expectedFixtureRefs[index]))) {
    return failure("result_protocol_invalid", "Evaluator request fixture authorization is invalid.");
  }
  return success(input as unknown as EvaluatorRequestEnvelope);
}

export function validateExecutionBoundaryFixture(
  input: unknown,
): ProtocolValidationResult<ExecutionBoundaryFixture> {
  if (!isRecord(input) || !hasExactKeys(input, ENVIRONMENT_LOCK_KEYS)) {
    return failure("test_asset_invalid", "Environment lock template fields are invalid.");
  }
  if (input.schemaVersion !== 1
    || input.status !== "draft_pending_C_prototype"
    || !isNonEmptyString(input.environmentId)
    || input.nodeVersion !== null
    || input.pythonVersion !== null
    || input.pandasVersion !== null
    || input.pyodideVersion !== null
    || input.platform !== null
    || input.evaluatorVersion !== null
    || input.createdAt !== null
    || input.prototypeEvidenceRef !== "pending_C_prototype"
    || input.environmentHash !== "pending_C_prototype"
    || input.validationStatus !== "intentionally_invalid_for_formal_submit") {
    return failure("test_asset_invalid", "Environment lock measurements must remain pending.");
  }
  if (!Array.isArray(input.allowedLibraries)
    || input.allowedLibraries.length !== 1
    || !isRecord(input.allowedLibraries[0])
    || !hasExactKeys(input.allowedLibraries[0], ["name", "version"])
    || input.allowedLibraries[0].name !== "pandas"
    || input.allowedLibraries[0].version !== null
    || !allValuesAreNull(input.limits, [
      "datasetBytes",
      "memoryBytes",
      "sourceBytes",
      "stderrBytes",
      "stdoutBytes",
      "wallClockMs",
    ])) {
    return failure("test_asset_invalid", "Environment versions and limits cannot be fabricated.");
  }
  if (!isRecord(input.capabilityFlags)
    || !hasExactKeys(input.capabilityFlags, [
      "networkIsolation",
      "processTreeTermination",
      "reliableMemoryLimit",
    ])
    || Object.values(input.capabilityFlags).some((value) => value !== false)) {
    return failure("test_asset_invalid", "Unmeasured environment capabilities must remain false.");
  }

  const constraints = input.executionConstraints;
  if (!isRecord(constraints)
    || !hasExactKeys(constraints, EXECUTION_CONSTRAINT_KEYS)
    || constraints.temporaryDirectory !== "unique_per_run"
    || constraints.cleanup !== "always_on_success_failure_cancel"
    || constraints.processIsolation !== "separate_clean_public_hidden_processes"
    || constraints.hiddenAssetsOwner !== "node_parent_only"
    || constraints.hiddenAssetsInUserDirectory !== false
    || constraints.workingDirectory !== "fixed_per_run"
    || constraints.environmentVariables !== "minimal_allowlist"
    || constraints.shell !== false
    || constraints.timeoutAction !== "terminate_process_tree"
    || constraints.outputHandling !== "truncate_escape_stdout_stderr") {
    return failure("test_asset_invalid", "Runner execution constraints are invalid.");
  }

  if (!Array.isArray(input.prototypeMeasurements)
    || input.prototypeMeasurements.length !== REQUIRED_PROTOTYPE_QUESTION_IDS.length) {
    return failure("test_asset_invalid", "Prototype measurement questions are incomplete.");
  }
  const questionIds = new Set<string>();
  for (const item of input.prototypeMeasurements) {
    if (!isRecord(item)
      || !hasExactKeys(item, PROTOTYPE_MEASUREMENT_KEYS)
      || !isNonEmptyString(item.questionId)
      || !isNonEmptyString(item.constraint)
      || item.status !== "pending_C_prototype"
      || item.evidenceRef !== null
      || item.ownerDecision !== "pending_after_prototype_evidence"
      || questionIds.has(item.questionId)) {
      return failure("test_asset_invalid", "Prototype measurement question is invalid.");
    }
    questionIds.add(item.questionId);
  }
  if (REQUIRED_PROTOTYPE_QUESTION_IDS.some((questionId) => !questionIds.has(questionId))) {
    return failure("test_asset_invalid", "Required prototype measurement question is missing.");
  }

  return success({
    executionConstraints: constraints as unknown as ExecutionBoundaryContract,
    prototypeMeasurements: input.prototypeMeasurements as PrototypeMeasurementQuestion[],
  });
}

function validDimensionResults(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.entries(value).every(([key, score]) => key.trim() !== ""
      && typeof score === "number"
      && Number.isFinite(score)
      && score >= 0
      && score <= 1);
}

export function validateEvaluatorResponseEnvelope(
  input: unknown,
): ProtocolValidationResult<EvaluatorResponseEnvelope> {
  if (!isRecord(input) || !Object.keys(input).every((key) => (RESPONSE_KEYS as readonly string[]).includes(key))) {
    return failure("result_protocol_invalid", "Evaluator response contains unknown fields.");
  }
  const required = [
    "protocolVersion",
    "runId",
    "attemptId",
    "stage",
    "status",
    "outputSummary",
    "environmentHash",
    "assetBundleHash",
  ];
  if (!required.every((key) => Object.hasOwn(input, key))) {
    return failure("result_protocol_invalid", "Evaluator response is missing required fields.");
  }
  if (!isNonEmptyString(input.protocolVersion)
    || !isNonEmptyString(input.runId)
    || !isNonEmptyString(input.attemptId)
    || !isStage(input.stage)
    || (input.status !== "ok" && input.status !== "failed" && input.status !== "evaluator_error")
    || typeof input.outputSummary !== "string"
    || !isNonEmptyString(input.environmentHash)
    || !isNonEmptyString(input.assetBundleHash)
    || HOST_PATH_PATTERN.test(input.outputSummary)
    || HOST_PATH_PATTERN.test(input.environmentHash)
    || HOST_PATH_PATTERN.test(input.assetBundleHash)) {
    return failure("result_protocol_invalid", "Evaluator response values are invalid.");
  }
  if (input.score !== undefined
    && (typeof input.score !== "number" || !Number.isFinite(input.score) || input.score < 0 || input.score > 1)) {
    return failure("result_protocol_invalid", "Evaluator score must be between zero and one.");
  }
  if (input.dimensionResults !== undefined && !validDimensionResults(input.dimensionResults)) {
    return failure("result_protocol_invalid", "Evaluator dimension scores are invalid.");
  }
  if (input.durationMs !== undefined
    && (typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 0)) {
    return failure("result_protocol_invalid", "Evaluator duration must be non-negative.");
  }
  if ((input.score !== undefined || input.dimensionResults !== undefined) && input.stage !== "summarize") {
    return failure("result_protocol_invalid", "Scores are only valid during summarize.");
  }

  if (input.status === "ok") {
    if (input.errorKind !== undefined || input.errorCode !== undefined) {
      return failure("result_protocol_invalid", "Successful responses cannot contain errors.");
    }
  } else if (input.status === "failed") {
    if (input.errorKind !== "learner"
      || !isNonEmptyString(input.errorCode)
      || !LEARNER_EVALUATION_ERROR_CODES.has(input.errorCode)) {
      return failure("result_protocol_invalid", "Learner failures require a learner evaluation error code.");
    }
  } else if (input.errorKind !== "evaluator"
    || !isNonEmptyString(input.errorCode)
    || !EVALUATOR_ERROR_CODES.has(input.errorCode)
    || input.score !== undefined
    || input.dimensionResults !== undefined) {
    return failure("result_protocol_invalid", "Evaluator errors cannot be scored or attributed to the learner.");
  }

  return success(input as unknown as EvaluatorResponseEnvelope);
}
