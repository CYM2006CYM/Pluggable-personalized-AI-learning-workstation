import type { ActivityResult, LearningRuntimeErrorCode } from "../domain/v2-types.js";

export interface RubricDimensionDefinition {
  dimensionId: string;
  weight: number;
  blocking: boolean;
  safeFeedbackCodes: readonly string[];
}

export interface ActivityRubricDefinition {
  passThreshold: number;
  dimensions: readonly RubricDimensionDefinition[];
  dimensionTestMap: Readonly<Record<string, readonly string[]>>;
}

export interface RubricTestBinding {
  testId: string;
  dimensionId: string;
  blocking: boolean;
}

export interface InternalTestResult extends RubricTestBinding {
  passed: boolean;
}

export interface RubricSummaryInput {
  rubric: ActivityRubricDefinition;
  tests: readonly InternalTestResult[];
  evaluatorVersion: string;
  environmentHash: string;
  assetBundleHash: string;
}

export interface LearnerFailureInput {
  errorCode: Extract<
    LearningRuntimeErrorCode,
    | "syntax_error"
    | "runtime_error"
    | "test_failed"
    | "timeout"
    | "output_limit"
    | "disallowed_import"
    | "submission_contract_error"
  >;
  evaluatorVersion: string;
  environmentHash: string;
  assetBundleHash: string;
  safeFeedback: string;
}

export interface EvaluatorFailureInput {
  errorCode: Extract<
    LearningRuntimeErrorCode,
    | "environment_mismatch"
    | "evaluator_error"
    | "evaluator_start_failed"
    | "evaluator_timeout"
    | "dependency_missing"
    | "test_asset_invalid"
    | "result_protocol_invalid"
    | "runner_crash"
  >;
  evaluatorVersion: string;
  environmentHash: string;
  assetBundleHash: string;
  safeFeedback: string;
}

function roundScore(value: number): number {
  return Number(value.toFixed(12));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function weightSumIsOne(weights: readonly number[]): boolean {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return Math.abs(sum - 1) <= Number.EPSILON * Math.max(1, weights.length);
}

export function validateRubricDefinition(
  value: unknown,
  tests: readonly RubricTestBinding[],
): value is ActivityRubricDefinition {
  if (!isRecord(value)
    || typeof value.passThreshold !== "number"
    || !Number.isFinite(value.passThreshold)
    || value.passThreshold < 0
    || value.passThreshold > 1
    || !Array.isArray(value.dimensions)
    || value.dimensions.length === 0
    || !isRecord(value.dimensionTestMap)
    || tests.length === 0) return false;

  const dimensions = value.dimensions;
  const dimensionIds = new Set<string>();
  const weights: number[] = [];
  for (const dimension of dimensions) {
    if (!isRecord(dimension)
      || typeof dimension.dimensionId !== "string"
      || dimension.dimensionId.length === 0
      || dimensionIds.has(dimension.dimensionId)
      || typeof dimension.weight !== "number"
      || !Number.isFinite(dimension.weight)
      || dimension.weight <= 0
      || dimension.weight > 1
      || typeof dimension.blocking !== "boolean"
      || !Array.isArray(dimension.safeFeedbackCodes)
      || !dimension.safeFeedbackCodes.every((code) => typeof code === "string")) return false;
    dimensionIds.add(dimension.dimensionId);
    weights.push(dimension.weight);
  }
  if (!weightSumIsOne(weights)) return false;

  const testIds = new Set<string>();
  for (const test of tests) {
    if (typeof test.testId !== "string"
      || test.testId.length === 0
      || testIds.has(test.testId)
      || typeof test.dimensionId !== "string"
      || !dimensionIds.has(test.dimensionId)
      || typeof test.blocking !== "boolean") return false;
    testIds.add(test.testId);
  }

  const mappedTests = new Set<string>();
  const mapKeys = Object.keys(value.dimensionTestMap);
  if (mapKeys.length !== dimensionIds.size || mapKeys.some((key) => !dimensionIds.has(key))) return false;
  for (const dimensionId of dimensionIds) {
    const mapped = value.dimensionTestMap[dimensionId];
    if (!Array.isArray(mapped) || mapped.length === 0) return false;
    for (const testId of mapped) {
      const test = tests.find((candidate) => candidate.testId === testId);
      if (typeof testId !== "string"
        || mappedTests.has(testId)
        || !test
        || test.dimensionId !== dimensionId) return false;
      mappedTests.add(testId);
    }
  }
  return mappedTests.size === testIds.size;
}

export function summarizeRubric(input: RubricSummaryInput): ActivityResult {
  if (!validateRubricDefinition(input.rubric, input.tests)
    || !input.tests.every((test) => typeof test.passed === "boolean")) {
    throw new TypeError("invalid rubric summary input");
  }
  const dimensionResults: Record<string, number> = {};
  let rawScore = 0;
  let blockingPassed = true;

  for (const dimension of input.rubric.dimensions) {
    const tests = input.tests.filter((test) => test.dimensionId === dimension.dimensionId);
    const dimensionScore = tests.length === 0
      ? 0
      : tests.filter((test) => test.passed).length / tests.length;
    dimensionResults[dimension.dimensionId] = roundScore(dimensionScore);
    rawScore += dimensionScore * dimension.weight;
    if (dimension.blocking && dimensionScore < 1) blockingPassed = false;
  }

  if (input.tests.some((test) => test.blocking && !test.passed)) blockingPassed = false;

  const scoreTolerance = Number.EPSILON * Math.max(1, input.rubric.dimensions.length);
  if (!Number.isFinite(rawScore) || rawScore < -scoreTolerance || rawScore > 1 + scoreTolerance) {
    throw new TypeError("rubric score is outside 0..1");
  }
  const boundedScore = Math.min(1, Math.max(0, rawScore));
  const passed = boundedScore >= input.rubric.passThreshold && blockingPassed;
  const normalizedScore = roundScore(boundedScore);
  const verdict = passed ? "pass" : normalizedScore > 0 ? "partial" : "fail";
  return {
    executionStatus: "completed",
    verdict,
    ...(passed ? {} : { errorKind: "learner" as const, errorCode: "test_failed" as const }),
    score: normalizedScore,
    dimensionResults,
    safeFeedback: passed
      ? "All deterministic checks passed."
      : "One or more deterministic checks did not pass.",
    evaluatorVersion: input.evaluatorVersion,
    environmentHash: input.environmentHash,
    assetBundleHash: input.assetBundleHash,
  };
}

export function learnerFailure(input: LearnerFailureInput): ActivityResult {
  return {
    executionStatus: "completed",
    verdict: "fail",
    errorKind: "learner",
    errorCode: input.errorCode,
    score: 0,
    safeFeedback: input.safeFeedback,
    evaluatorVersion: input.evaluatorVersion,
    environmentHash: input.environmentHash,
    assetBundleHash: input.assetBundleHash,
  };
}

export function evaluatorFailure(input: EvaluatorFailureInput): ActivityResult {
  return {
    executionStatus: "failed",
    verdict: "not_graded",
    errorKind: "evaluator",
    errorCode: input.errorCode,
    safeFeedback: input.safeFeedback,
    evaluatorVersion: input.evaluatorVersion,
    environmentHash: input.environmentHash,
    assetBundleHash: input.assetBundleHash,
  };
}
