import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// This author test is intentionally runnable both by Node's native test
// runner and by the repository's Vitest suite.  Using node:test unconditionally
// caused Vitest to collect the file as an empty suite, breaking V2-1/verify.
const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
import {
  checkToolBaseline,
  evaluateV28Qualification,
  parseArgs,
  runVerification,
  validateD33EnvironmentEvidence,
  validateV21BaselineRecord,
  validateV23D5BindingEvidence,
  validateV23ExecutionReport,
  validateV23FormalBinding,
} from "./v2-comprehensive-verification.mjs";
import { scanV27 } from "./v2-7-asset-isolation.mjs";

function context(overrides = {}) {
  return {
    v21BaselineRecord: null,
    v23FormalBinding: null,
    v23D5BindingEvidence: null,
    v23FormalReport: null,
    v23GoldInputFreeze: null,
    v23OwnerD33Evidence: null,
    v23CFinalReport: null,
    v27Inputs: [],
    v27CanaryFile: null,
    v28Qualification: null,
    ...overrides,
  };
}

function sha(character) {
  return character.repeat(64);
}

function actualCFormatFormalBinding() {
  return {
    status: "PASS",
    contract: "W2-C2/W2-R5",
    formalCommit: "a".repeat(40),
    checks: { "67FileHashes": "PASS", assetTree: "PASS", final60: "PASS", manifestJcs: "PASS", diagnosticSummaryJcs: "PASS" },
    counts: { manifestEntries: 67, missingFiles: 0, mismatchedFiles: 0 },
    hashes: { manifestJcsSha256: sha("1"), diagnosticSummaryJcsSha256: sha("2"), assetTreeSha256: sha("3"), final60Sha256: sha("4") },
    blockers: [],
  };
}

function actualCFormatD5BindingEvidence() {
  return {
    status: "PASS",
    contentBinding: {
      formalCommit: "a".repeat(40),
      fileResults: Array.from({ length: 67 }, (_, index) => ({ path: `assets/${String(index).padStart(2, "0")}.json`, hashMode: "normalized-text", expectedSha256: sha("a"), actualSha256: sha("a"), expectedByteLength: index, actualByteLength: index, status: "PASS" })),
      assetTreeSha256: sha("3"),
      final60Sha256: sha("4"),
    },
    d4ReportNormalizedSha256: sha("5"),
    v23: { status: "PASS" },
  };
}

function actualCFormatV23Formal() {
  return {
    status: "PASS",
    v23Status: "PASS",
    validationId: "V2-3",
    contract: "W2-C2/W2-R5",
    classifications: [],
    blockers: [],
    datasetResults: Array.from({ length: 3 }, () => ({ repeatCount: 3, status: "PASS" })),
    knownWrongResults: Array.from({ length: 4 }, () => ({ status: "PASS", fixtureRepeatRejections: 3 })),
    counts: { datasetFixtures: 3, knownWrongImplementations: 4, knownWrongFixtureRepeatChecks: 3, knownWrongTestRejections: 1 },
    hashes: { fixtures: { development: sha("6") }, references: { reference: sha("7") }, knownWrong: { knownWrong: sha("8") }, tests: { tests: sha("9") } },
  };
}

function sixCategoryCanaries(overrides = {}) {
  return Object.fromEntries([
    "diagnostic_answers",
    "private_csv",
    "hidden_tests",
    "reference_implementations",
    "api_keys",
    "host_absolute_paths",
  ].map((category) => [category, [`__${category}_CANARY__`]]).map(([category, value]) => [category, overrides[category] ?? value]));
}

async function fixture(contents, canaries = sixCategoryCanaries()) {
  const directory = await mkdtemp(join(tmpdir(), "w2-v2-comprehensive-"));
  const path = join(directory, "safe-output.json");
  const canaryPath = join(directory, "canaries.json");
  await writeFile(path, contents, "utf8");
  await writeFile(canaryPath, JSON.stringify(canaries), "utf8");
  return { directory, path, canaryPath };
}

test("normal V2-7 subcommand succeeds and does not expose the host input path", async () => {
  const item = await fixture('{"status":"safe"}');
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "fixtures/safe-output.json", surface: "safe_dto" }],
      v27CanaryFile: item.canaryPath,
    }), { execute: true });
    assert.equal(result.status, "PASS");
    assert.equal(result.commandResults[0].exitCode, 0);
    assert.equal(JSON.stringify(result).includes(item.path), false);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("a safe DTO may declare hidden_tests as forbidden without being misclassified as a leak", async () => {
  const item = await fixture('{"forbiddenCategories":["hidden_tests"]}');
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "safe-dto/contract-declaration.json", surface: "safe_dto" }],
      v27CanaryFile: item.canaryPath,
    }), { execute: true });
    assert.equal(result.status, "PASS");
    assert.equal(result.commandResults[0].exitCode, 0);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("a real hidden-test path and a unique canary remain BLOCKED with input attribution", async () => {
  const hiddenPath = await fixture('{"testPath":"hidden_tests/test-private.py"}');
  const canaryHit = await fixture('{"marker":"__hidden_tests_CANARY__"}');
  try {
    const pathResult = await scanV27({
      inputs: [{ path: hiddenPath.path, outputLocation: "d-recording/hidden-test-path.json", surface: "d_recording" }],
      canaryFile: hiddenPath.canaryPath,
    });
    assert.equal(pathResult.status, "BLOCKED");
    assert.equal(pathResult.inputResults[0].outputLocation, "d-recording/hidden-test-path.json");
    assert.ok(pathResult.inputResults[0].counts.hidden_tests > 0);

    const canaryResult = await scanV27({
      inputs: [{ path: canaryHit.path, outputLocation: "verification-report/canary.json", surface: "verification_report" }],
      canaryFile: canaryHit.canaryPath,
    });
    assert.equal(canaryResult.status, "BLOCKED");
    assert.equal(canaryResult.inputResults[0].outputLocation, "verification-report/canary.json");
    assert.ok(canaryResult.inputResults[0].counts.hidden_tests > 0);
  } finally {
    await rm(hiddenPath.directory, { recursive: true, force: true });
    await rm(canaryHit.directory, { recursive: true, force: true });
  }
});

test("failing V2-7 child command propagates its non-zero exit code", async () => {
  const item = await fixture('{"correctAnswer":"must-block"}');
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "fixtures/blocked-output.json", surface: "verification_report" }],
      v27CanaryFile: item.canaryPath,
    }), { execute: true });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.commandResults[0].exitCode, 1);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("nested private CSV and nested reference implementation paths block V2-7", async () => {
  const item = await fixture('{"csv":"private/datasets/orders.csv","reference":"reference-solutions/nested/solution.py"}');
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "fixtures/blocked-nested-output.json", surface: "d_recording" }],
      v27CanaryFile: item.canaryPath,
    }), { execute: true });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.commandResults[0].exitCode, 1);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("V2-7 blocks when the mandatory canary file is absent", async () => {
  const item = await fixture('{"status":"safe"}');
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "fixtures/safe.json", surface: "safe_dto" }],
    }), { execute: true });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.some((reason) => reason.includes("mandatory six-category")));
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("V2-7 blocks when any required canary category is empty", async () => {
  const item = await fixture('{"status":"safe"}', sixCategoryCanaries({ api_keys: [] }));
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "fixtures/safe.json", surface: "safe_dto" }],
      v27CanaryFile: item.canaryPath,
    }), { execute: true });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.some((reason) => reason.includes("api_keys")));
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("V2-7 blocks a non-contract input surface", async () => {
  const item = await fixture('{"status":"safe"}');
  try {
    const result = await runVerification("V2-7", context({
      v27Inputs: [{ path: item.path, location: "fixtures/safe.json", surface: "source_tree" }],
      v27CanaryFile: item.canaryPath,
    }), { execute: true });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.some((reason) => reason.includes("non-contract surface")));
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

// The V2-6 executable intentionally invokes an isolated Vitest check.  It can
// exceed Vitest's default five-second unit-test timeout on a cold dependency
// cache, so keep the assertion while giving the subprocess a bounded budget.
test("V2-6 succeeds through the comprehensive runner with repository-relative inputs", { timeout: 20_000 }, async () => {
  const result = await runVerification("V2-6", context(), { execute: true });
  assert.equal(result.status, "PASS");
  assert.equal(result.commandResults[0].exitCode, 0);
  assert.equal(JSON.stringify(result).includes("\\\\"), false);
});

test("unmet V2-1 prerequisite becomes BLOCKED rather than deferred", async () => {
  const result = await runVerification("V2-1", context(), { execute: false });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.reasons.some((reason) => reason.includes("baseline record")));
});

test("V2-8 qualification can only become PENDING_OWNER_ADJUDICATION, never PASS", () => {
  const result = evaluateV28Qualification({
    status: "PASS",
    checks: {
      coverageAndSchema: true,
      freezeBindingAndDeadline: true,
      fileHashUnchanged: true,
      independence: true,
    },
  });
  assert.equal(result.status, "PENDING_OWNER_ADJUDICATION");
  assert.notEqual(result.status, "PASS");
});

test("unknown parameters are rejected", () => {
  assert.throws(() => parseArgs(["--unknown-parameter"]), /unknown parameter/u);
});

test("empty or incomplete D1 baseline records are rejected", () => {
  assert.ok(validateV21BaselineRecord("").length > 0);
  assert.ok(validateV21BaselineRecord("W2_START_COMMIT = f343a6c1c630f362f4686e6f6b0f50c6577d5562").length > 0);
});

test("D1 baseline records that name every command but report FAIL are rejected", () => {
  const record = [
    "W2_START_COMMIT = f343a6c1c630f362f4686e6f6b0f50c6577d5562",
    "D1_HEAD = f343a6c1c630f362f4686e6f6b0f50c6577d5562",
    "8785c6e is an ancestor of W2_START_COMMIT",
    "typecheck: FAIL",
    "test: FAIL (0 tests)",
    "smoke: FAIL",
    "verify: FAIL",
  ].join("\n");
  assert.ok(validateV21BaselineRecord(record).some((reason) => reason.includes("FAIL")));
});

test("the existing official Chinese Markdown D1 report is accepted", { skip: !process.env.W2_D1_BASELINE_RECORD }, async () => {
  const text = await readFile(process.env.W2_D1_BASELINE_RECORD, "utf8");
  assert.deepEqual(validateV21BaselineRecord(text), []);
});

test("simple V2-3 PASS JSON is rejected without C formal binding facts", () => {
  assert.ok(validateV23FormalBinding({ status: "PASS" }).length > 0);
});

test("V2-3 rejects the retired candidate.entries shorthand", () => {
  const result = validateV23FormalBinding({
    status: "PASS",
    candidate: {
      entries: [],
    },
  });
  assert.ok(result.some((reason) => reason.includes("candidate shorthand")));
});

test("candidate execution evidence is not misrepresented as v23-formal evidence", () => {
  assert.ok(validateV23ExecutionReport({
    status: "candidate_evidence_only",
    overallExitCode: 0,
    summary: { repeatCount: 3 },
  }).length > 0);
});

test("D5 candidate shorthand is rejected before it can substitute for C evidence", () => {
  assert.ok(validateV23D5BindingEvidence({
    status: "PASS",
    candidate: { entries: [] },
    fileResults: [],
    contentBinding: {},
    v23: {},
  }).some((reason) => reason.includes("candidate shorthand")));
});

test("the C-documented formal-binding, contentBinding, and v23-formal field layout is accepted", () => {
  assert.deepEqual(validateV23FormalBinding(actualCFormatFormalBinding()), []);
  const historicalBinding = actualCFormatFormalBinding();
  historicalBinding.hashes.diagnosticKnowledgeStateSummarySha256 = historicalBinding.hashes.diagnosticSummaryJcsSha256;
  delete historicalBinding.hashes.diagnosticSummaryJcsSha256;
  assert.deepEqual(validateV23FormalBinding(historicalBinding), []);
  historicalBinding.hashes.diagnosticSummaryJcsSha256 = sha("f");
  assert.ok(validateV23FormalBinding(historicalBinding).some((reason) => reason.includes("diagnostic-summary hash spellings conflict")));
  assert.deepEqual(validateV23D5BindingEvidence(actualCFormatD5BindingEvidence()), []);
  assert.deepEqual(validateV23ExecutionReport(actualCFormatV23Formal()), []);
});

test("D5 C evidence rejects non-PASS or divergent expected/actual file records", () => {
  const evidence = actualCFormatD5BindingEvidence();
  evidence.contentBinding.fileResults[0].actualSha256 = sha("b");
  assert.ok(validateV23D5BindingEvidence(evidence).some((reason) => reason.includes("invalid fileResults entry")));
  evidence.contentBinding.fileResults[0].actualSha256 = sha("a");
  evidence.contentBinding.fileResults[0].status = "BLOCKED";
  assert.ok(validateV23D5BindingEvidence(evidence).some((reason) => reason.includes("invalid fileResults entry")));
});

test("C evidence-schema failure is BLOCKED without an environment_mismatch classification", async () => {
  const result = await runVerification("V2-3", context({
    v23FormalBinding: "missing-formal-binding.json",
    v23D5BindingEvidence: "missing-d5-binding-evidence.json",
    v23FormalReport: "missing-v23-formal.json",
    v23GoldInputFreeze: "missing-freeze.json",
    v23OwnerD33Evidence: "missing-owner-d33.json",
    v23CFinalReport: "missing-c-final.md",
  }), { execute: true });
  assert.equal(result.status, "BLOCKED");
  assert.equal(Object.hasOwn(result, "classification"), false);
});

test("missing or deleted D33 evidence blocks V2-3 as environment_mismatch", async () => {
  const result = await runVerification("V2-3", context(), { execute: true });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.classification, "environment_mismatch");
  assert.ok(result.reasons.some((reason) => reason.includes("v2-3-formal-binding")));
});

test("deleted or tampered D33 environment fields are rejected", () => {
  const base = {
    contractSupplement: "W2-V2-3-ENV-1",
    environment: { python: "3.13.14", pandas: "3.0.5", expectedPandas: "3.0.5", platform: "Windows" },
    environmentPreflight: { status: "PASS" },
    command: "python audit_v23.py",
    exitCode: 0,
    classifications: [],
    blockers: [],
  };
  assert.equal(validateD33EnvironmentEvidence(base, { requireExecutionEnvelope: true, label: "test" }).length, 0);
  assert.ok(validateD33EnvironmentEvidence({ ...base, environment: { ...base.environment, pandas: "2.3.3" } }, { requireExecutionEnvelope: true, label: "test" }).length > 0);
  assert.ok(validateD33EnvironmentEvidence({ ...base, environment: { pandas: "3.0.5" } }, { requireExecutionEnvelope: true, label: "test" }).length > 0);
  assert.ok(validateD33EnvironmentEvidence({ ...base, environmentPreflight: undefined }, { requireExecutionEnvelope: true, label: "test" }).length > 0);
});

// The six read-only artifacts are owner-controlled and intentionally absent
// from E's package.  This integration test is not registered (and therefore
// never reported as skipped) unless the owner explicitly enables it and
// supplies all six real paths.  The D6 command must set W2_REAL_V23_INPUTS=1.
if (process.env.W2_REAL_V23_INPUTS === "1") {
  test("real C and owner V2-3 evidence passes with all six supplied read-only inputs", async () => {
    const required = ["W2_C_FORMAL_BINDING", "W2_C_D5_BINDING_EVIDENCE", "W2_C_V23_FORMAL", "W2_GOLD_INPUT_FREEZE", "W2_OWNER_D33_EVIDENCE", "W2_C_FINAL_V23_REPORT"];
    for (const name of required) assert.ok(process.env[name], `missing required real-evidence input: ${name}`);
    const result = await runVerification("V2-3", context({
      v23FormalBinding: process.env.W2_C_FORMAL_BINDING,
      v23D5BindingEvidence: process.env.W2_C_D5_BINDING_EVIDENCE,
      v23FormalReport: process.env.W2_C_V23_FORMAL,
      v23GoldInputFreeze: process.env.W2_GOLD_INPUT_FREEZE,
      v23OwnerD33Evidence: process.env.W2_OWNER_D33_EVIDENCE,
      v23CFinalReport: process.env.W2_C_FINAL_V23_REPORT,
    }), { execute: true });
    assert.equal(result.status, "PASS");
  });
}

test("tool baseline detects a missing delivered file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "w2-v2-baseline-"));
  try {
    const result = await checkToolBaseline({ root: directory });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.files.some((file) => file.status === "missing"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
