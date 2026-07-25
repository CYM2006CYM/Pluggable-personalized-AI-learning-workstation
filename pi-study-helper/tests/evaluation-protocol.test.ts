import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVALUATOR_STAGE_ORDER,
  validateDatasetFixturesAsset,
  validateEvaluationBindings,
  validateExecutionBoundaryFixture,
  validateEvaluatorRequestEnvelope,
  validateEvaluatorResponseEnvelope,
  validateStageSequence,
} from "../src/infrastructure/evaluation-protocol.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const evaluatorFixtureRoot = resolve(projectRoot, "fixtures/evaluator-results");

async function json(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function profileJson(relativePath: string): Promise<any> {
  return json(resolve(profileRoot, relativePath));
}

async function evaluatorJson(fileName: string): Promise<any> {
  return json(resolve(evaluatorFixtureRoot, fileName));
}

async function assetHashes(fixtures: any[], tests: any[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const item of [...fixtures, ...tests]) {
    const content = await readFile(resolve(profileRoot, item.fileRef));
    result.set(item.fileRef, `sha256:${createHash("sha256").update(content).digest("hex")}`);
  }
  return result;
}

describe("W1-C5 evaluation protocol", () => {
  it("accepts B's five task bundles and maps stage fixture authorization", async () => {
    const fixtureAsset = await profileJson("datasets/fixtures.json");
    const bundleAsset = await profileJson("assessments/private/task-bundles.json");
    const allTests = bundleAsset.bundles.flatMap((bundle: any) => [
      ...bundle.publicTests,
      ...bundle.hiddenTests,
    ]);
    const fileHashes = await assetHashes(fixtureAsset.fixtures, allTests);

    expect(bundleAsset.bundles).toHaveLength(5);
    expect(fixtureAsset.fixtures).toHaveLength(3);
    for (const bundle of bundleAsset.bundles) {
      const result = validateEvaluationBindings({
        fixtureAsset,
        activityDatasetRefs: bundle.activity.datasetRefs,
        argumentFixtureIds: bundle.contract.entryPoint.argumentFixtureIds,
        publicTests: bundle.publicTests,
        hiddenTests: bundle.hiddenTests,
        assetContext: { fileHashes, symlinkPaths: new Set<string>() },
      });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) continue;
      expect(result.value.prepare).toEqual([]);
      expect(result.value.user_code).toEqual([]);
      expect(result.value.summarize).toEqual([]);
      expect(result.value.public_tests).toEqual(["dataset-public-orders"]);
      if (bundle.activity.activityId === "act-practical") {
        expect(result.value.hidden_tests).toEqual([
          "dataset-private-variant-01",
          "dataset-private-variant-02",
        ]);
      } else {
        expect(result.value.hidden_tests).toEqual(["dataset-public-orders"]);
      }
    }
  });

  it("rejects malformed, unsafe, mismatched, and leaking asset bindings", async () => {
    const fixtureAsset = await profileJson("datasets/fixtures.json");
    const bundleAsset = await profileJson("assessments/private/task-bundles.json");
    const bundle = bundleAsset.bundles[0];
    const allTests = [...bundle.publicTests, ...bundle.hiddenTests];
    const fileHashes = await assetHashes(fixtureAsset.fixtures, allTests);
    const base = {
      fixtureAsset,
      activityDatasetRefs: bundle.activity.datasetRefs,
      argumentFixtureIds: bundle.contract.entryPoint.argumentFixtureIds,
      publicTests: bundle.publicTests,
      hiddenTests: bundle.hiddenTests,
      assetContext: { fileHashes, symlinkPaths: new Set<string>() },
    };

    expect(validateEvaluationBindings({
      fixtureAsset,
      activityDatasetRefs: bundle.activity.datasetRefs,
      argumentFixtureIds: bundle.contract.entryPoint.argumentFixtureIds,
      publicTests: bundle.publicTests,
      hiddenTests: bundle.hiddenTests,
    } as unknown as Parameters<typeof validateEvaluationBindings>[0]))
      .toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      assetContext: { fileHashes },
    } as unknown as Parameters<typeof validateEvaluationBindings>[0]))
      .toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      assetContext: { symlinkPaths: new Set<string>() },
    } as unknown as Parameters<typeof validateEvaluationBindings>[0]))
      .toMatchObject({ ok: false, errorCode: "test_asset_invalid" });

    expect(validateDatasetFixturesAsset({ fixtures: [{ ...fixtureAsset.fixtures[0], extra: true }] }))
      .toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      activityDatasetRefs: ["dataset-public-orders", "dataset-public-orders"],
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      publicTests: [{ ...bundle.publicTests[0], fixtureRefs: ["dataset-private-variant-01"] }],
      activityDatasetRefs: ["dataset-public-orders", "dataset-private-variant-01"],
      argumentFixtureIds: ["dataset-public-orders", "dataset-private-variant-01"],
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      hiddenTests: [{ ...bundle.hiddenTests[0], fixtureRefs: ["missing-fixture"] }],
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      assetContext: {
        fileHashes: new Map(fileHashes).set(bundle.publicTests[0].fileRef, `sha256:${"0".repeat(64)}`),
        symlinkPaths: new Set<string>(),
      },
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    const missingFileHashes = new Map(fileHashes);
    missingFileHashes.delete(bundle.publicTests[0].fileRef);
    expect(validateEvaluationBindings({
      ...base,
      assetContext: { fileHashes: missingFileHashes, symlinkPaths: new Set<string>() },
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      assetContext: {
        fileHashes,
        symlinkPaths: new Set([bundle.publicTests[0].fileRef]),
      },
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
    expect(validateEvaluationBindings({
      ...base,
      publicTests: [{ ...bundle.publicTests[0], fileRef: "../private/test.py" }],
    })).toMatchObject({ ok: false, errorCode: "test_asset_invalid" });
  });

  it("enforces the complete five-stage order", async () => {
    const fixture = await evaluatorJson("stage-sequences.json");
    expect(EVALUATOR_STAGE_ORDER).toEqual([
      "prepare",
      "user_code",
      "public_tests",
      "hidden_tests",
      "summarize",
    ]);
    for (const sequence of fixture.valid) {
      expect(validateStageSequence(sequence)).toMatchObject({ ok: true });
    }
    for (const item of fixture.invalid) {
      expect(validateStageSequence(item.stages)).toMatchObject({
        ok: false,
        errorCode: "result_protocol_invalid",
      });
    }
  });

  it("validates request envelopes against parent-generated fixture authorization", async () => {
    const fixture = await evaluatorJson("evaluator-requests.json");
    for (const item of fixture.valid) {
      expect(validateEvaluatorRequestEnvelope(item.envelope, item.expectedFixtureRefs))
        .toMatchObject({ ok: true });
    }
    for (const item of fixture.invalid) {
      expect(validateEvaluatorRequestEnvelope(item.envelope, item.expectedFixtureRefs))
        .toMatchObject({ ok: false, errorCode: item.expectedErrorCode });
    }
  });

  it("validates the single W1-C5 response envelope and error attribution", async () => {
    const fixture = await evaluatorJson("evaluator-responses.json");
    for (const item of fixture.valid) {
      expect(validateEvaluatorResponseEnvelope(item.envelope)).toMatchObject({ ok: true });
    }
    for (const item of fixture.invalid) {
      expect(validateEvaluatorResponseEnvelope(item.envelope))
        .toMatchObject({ ok: false, errorCode: item.expectedErrorCode });
    }
    const parsedStdout = JSON.parse(fixture.untrustedStdout);
    expect(validateEvaluatorResponseEnvelope(parsedStdout)).toMatchObject({
      ok: false,
      errorCode: "result_protocol_invalid",
    });
    expect(validateEvaluatorResponseEnvelope({
      ...fixture.valid[0].envelope,
      outputSummary: "Evaluator log: C:\\Users\\runner\\AppData\\Local\\Temp\\result.json",
    })).toMatchObject({
      ok: false,
      errorCode: "result_protocol_invalid",
    });
  });

  it("fixes runner constraints while keeping every environment measurement pending", async () => {
    const fixture = await evaluatorJson("environment-lock-unmeasured.json");
    expect(validateExecutionBoundaryFixture(fixture)).toMatchObject({ ok: true });
    expect(fixture.prototypeMeasurements).toHaveLength(10);
    expect(fixture.prototypeMeasurements.every((item: any) => item.status === "pending_C_prototype"
      && item.evidenceRef === null)).toBe(true);
    expect(Object.values(fixture.limits).every((value) => value === null)).toBe(true);

    for (const mutate of [
      (value: any) => { delete value.executionConstraints.cleanup; },
      (value: any) => { value.executionConstraints.unknown = true; },
      (value: any) => { value.executionConstraints.shell = true; },
      (value: any) => { value.executionConstraints.processIsolation = "shared_process"; },
      (value: any) => { value.executionConstraints.hiddenAssetsInUserDirectory = true; },
      (value: any) => { value.executionConstraints.cleanup = "success_only"; },
      (value: any) => { value.prototypeMeasurements.pop(); },
      (value: any) => { value.nodeVersion = "22.23.1"; },
    ]) {
      const invalid = JSON.parse(JSON.stringify(fixture));
      mutate(invalid);
      expect(validateExecutionBoundaryFixture(invalid)).toMatchObject({
        ok: false,
        errorCode: "test_asset_invalid",
      });
    }
  });

  it("keeps learner and evaluator error classes distinct", async () => {
    const matrix = await evaluatorJson("error-matrix.json");
    expect(matrix.learner).toContain("timeout");
    expect(matrix.learner).toContain("runtime_error");
    expect(matrix.evaluator).toContain("evaluator_timeout");
    expect(matrix.evaluator).toContain("runner_crash");
    expect(matrix.learner.filter((code: string) => matrix.evaluator.includes(code))).toEqual([]);
    expect(matrix.nonEquivalentPairs).toContainEqual(["timeout", "evaluator_timeout"]);
    expect(matrix.nonEquivalentPairs).toContainEqual(["runtime_error", "runner_crash"]);
    expect(matrix.evaluatorErrorCreatesNegativeEvidence).toBe(false);
    expect(matrix.preEvaluationRequest).toEqual(["idempotency_conflict"]);
    expect(matrix.idempotencyConflictCreatesEvidence).toBe(false);
    expect(matrix.idempotencyConflictAllowedInEvaluatorEnvelope).toBe(false);
  });

  it("keeps evaluator fixtures free of host paths and executable hidden assertions", async () => {
    const files = await readdir(evaluatorFixtureRoot);
    expect(files).toHaveLength(10);
    for (const file of files) {
      const content = await readFile(resolve(evaluatorFixtureRoot, file), "utf8");
      expect(content).not.toMatch(/[A-Za-z]:[\\/]|AppData|BEGIN (?:RSA|OPENSSH) PRIVATE KEY/u);
      expect(content).not.toMatch(/\bassert\s+|def\s+clean_/u);
    }
  });
});
