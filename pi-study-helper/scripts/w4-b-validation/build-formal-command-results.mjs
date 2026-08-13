import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const externalPath = resolve(process.argv[2]);
const reproductionPath = process.argv[3] ? resolve(process.argv[3]) : undefined;
const outputPath = resolve(process.argv[4] ?? "scripts/w4-b-validation/command-results.json");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node build-formal-command-results.mjs <final-command-results.json> <python-3.14.4-reproduction.json> [output]");
}

const finalRun = JSON.parse(await readFile(externalPath, "utf8"));
const reproduction = JSON.parse(await readFile(reproductionPath, "utf8"));

function ensure(condition, message) {
  if (!condition) throw new Error(`B-R3-01 BLOCKED: ${message}`);
}

async function assertCompleteLogs(record, label) {
  ensure(record && typeof record === "object", `${label} record is missing`);
  for (const field of ["command", "cwd", "startedAt", "endedAt", "stdoutPath", "stderrPath", "stdoutSha256", "stderrSha256"]) {
    ensure(typeof record[field] === "string" && record[field].length > 0, `${label} lacks ${field}`);
  }
  ensure(typeof record.exitCode === "number", `${label} lacks exitCode`);
  await access(record.stdoutPath);
  await access(record.stderrPath);
  const [stdout, stderr] = await Promise.all([readFile(record.stdoutPath), readFile(record.stderrPath)]);
  ensure(createHash("sha256").update(stdout).digest("hex") === record.stdoutSha256, `${label} stdout SHA-256 does not match its log`);
  ensure(createHash("sha256").update(stderr).digest("hex") === record.stderrSha256, `${label} stderr SHA-256 does not match its log`);
  return stdout.toString("utf8");
}

for (const record of reproduction.records) await assertCompleteLogs(record, `Python 3.14.4 reproduction ${record.name}`);

function actualVitestStatistics(stdout, label) {
  const match = stdout.match(/Test Files\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)[\s\S]*?Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)? \((\d+)\)/u);
  ensure(match, `${label} does not contain a complete Vitest summary`);
  const [, failedFiles = "0", passedFiles, totalFiles, failed = "0", passed, skipped = "0", total] = match;
  return {
    testFiles: Number(totalFiles),
    passed: Number(passed),
    failed: Number(failed),
    skipped: Number(skipped),
    passedFiles: Number(passedFiles),
    failedFiles: Number(failedFiles),
    totalTests: Number(total),
  };
}

const records = finalRun.records;
ensure(Array.isArray(records), "final run records are missing");
const byName = new Map(records.map((record) => [record.name, record]));
const direct = byName.get("v2-6-direct-revision2-20-plus-60");
const isolated = byName.get("v2-6-isolated-revision2");
await assertCompleteLogs(direct, "V2-6 direct");
const isolatedStdout = await assertCompleteLogs(isolated, "V2-6 isolated");
ensure(direct.exitCode === 0, "V2-6 direct exit code is not zero");
ensure(isolated.exitCode === 0, "V2-6 isolated exit code is not zero");
ensure(typeof direct.revision2ProfilePath === "string" && direct.revision2ProfilePath.replaceAll("\\", "/").endsWith("fixtures/profiles/pandas-cleaning-v2-draft"), "V2-6 direct is not bound to revision 2");
ensure(typeof isolated.revision2ProfilePath === "string" && isolated.revision2ProfilePath.replaceAll("\\", "/").endsWith("fixtures/profiles/pandas-cleaning-v2-draft"), "V2-6 isolated is not bound to revision 2");
ensure(direct.v26?.status === "PASS" && direct.v26?.development?.count === 20 && direct.v26?.final?.count === 60, "V2-6 direct does not prove development 20 and final 60 cases");
ensure(typeof direct.v26.development.sha256 === "string" && typeof direct.v26.final.sha256 === "string", "V2-6 direct input hashes are missing");
isolated.testStatistics = actualVitestStatistics(isolatedStdout, "V2-6 isolated");
ensure(isolated.testStatistics?.testFiles === 1 && isolated.testStatistics?.passed === 5 && isolated.testStatistics?.failed === 0 && isolated.testStatistics?.skipped === 0, "V2-6 isolated test statistics are incomplete");

const initial = {
  phase: "initial_environment_mismatch",
  classification: "HISTORICAL_FACT_RETAINED_OWNER_EVIDENCE_EXCEPTION_APPROVED",
  ownerDecision: "50-W4-D1-B历史证据例外裁决与最终整改执行单.md §3.2: OWNER_EVIDENCE_EXCEPTION_APPROVED",
  recordedAt: "2026-08-13T14:01:11.4955342+08:00",
  environment: { node: "NOT_AVAILABLE", python: "3.14.4", pandas: "3.0.5" },
  limitation: "Original first-run stdout/stderr, timestamps and hashes are NOT_AVAILABLE because first evidence retention was incomplete. They are not reconstructed; the approved exception retains this fact together with a separately labelled reproduction and final contract-environment verification.",
  records: [
    { name: "full-test", command: "npm test -- --maxWorkers=1", cwd: "pi-study-helper", startedAt: null, endedAt: null, exitCode: 1, testStatistics: { testFiles: null, passed: 670, failed: 20, skipped: 1 }, stdoutSha256: null, stderrSha256: null, result: "ENVIRONMENT_MISMATCH" },
    { name: "verify", command: "npm run verify", cwd: "pi-study-helper", startedAt: null, endedAt: null, exitCode: 1, testStatistics: { testFiles: null, passed: 670, failed: 20, skipped: 1 }, stdoutSha256: null, stderrSha256: null, result: "ENVIRONMENT_MISMATCH" },
  ],
};
const historicalReproduction = {
  phase: "python_3_14_4_environment_reproduction",
  classification: "REPRODUCTION_ONLY_NOT_HISTORICAL_ORIGINAL",
  purpose: reproduction.purpose,
  environment: reproduction.environment,
  records: reproduction.records,
  conclusion: "This later reproduction has logs, timestamps and hashes, reproduces the retained environment mismatch, and is not represented as the historical original.",
};
const fullTest = byName.get("full-test");
const verify = byName.get("verify");
const fullTestStdout = await assertCompleteLogs(fullTest, "aggregate full test");
const verifyStdout = await assertCompleteLogs(verify, "verify");
fullTest.testStatistics = actualVitestStatistics(fullTestStdout, "aggregate full test");
verify.testStatistics = actualVitestStatistics(verifyStdout, "verify");
const fullTestPassed = fullTest.exitCode === 0 && fullTest.testStatistics?.testFiles === 70 && fullTest.testStatistics?.passed === 690 && fullTest.testStatistics?.failed === 0 && fullTest.testStatistics?.skipped === 1;
const fullTestWrapperTimedOut = fullTest.exitCode === 1 && fullTest.testStatistics?.testFiles === 70 && fullTest.testStatistics?.passed === 689 && fullTest.testStatistics?.failed === 1 && fullTest.testStatistics?.skipped === 1;
ensure(fullTestPassed || fullTestWrapperTimedOut, "aggregate test result is neither a complete pass nor the recorded V2-6 wrapper timeout form");
const verifyPassed = verify.exitCode === 0 && verify.testStatistics?.testFiles === 70 && verify.testStatistics?.passed === 690 && verify.testStatistics?.failed === 0 && verify.testStatistics?.skipped === 1;
const verifyWrapperTimedOut = verify.exitCode === 1 && verify.testStatistics?.testFiles === 70 && verify.testStatistics?.passed === 689 && verify.testStatistics?.failed === 1 && verify.testStatistics?.skipped === 1;
ensure(verifyPassed || verifyWrapperTimedOut, "verify result is neither a complete pass nor the recorded V2-6 wrapper timeout form");

const final = {
  phase: "final_contract_environment_reverification",
  classification: fullTestPassed ? "PASS" : "COMPLETE_WITH_RETAINED_V2_6_OUTER_WRAPPER_TIMEOUT",
  environment: finalRun.environment,
  records,
  aggregateFullTest: fullTest,
  v26DirectRevision2: direct,
  v26IsolatedRevision2: isolated,
  verify,
  conclusion: fullTestPassed
    ? (verifyPassed
      ? "Aggregate npm test, recorded revision 2 direct 20+60, recorded isolated V2-6, and verify all exit 0."
      : "Aggregate npm test exits 0. Verify retains a non-zero frozen V2-6 outer 30-second wrapper timeout; recorded revision 2 direct 20+60 and isolated V2-6 checks both exit 0.")
    : "Aggregate npm test retains a non-zero frozen V2-6 outer 30-second wrapper timeout. Recorded revision 2 direct 20+60 and isolated V2-6 checks both exit 0; verify is recorded separately and is not used to rewrite the aggregate result.",
};
const result = {
  role: "B", day: "W4-D1-B-3", contract: "W4-C2/W4-R1",
  evidenceRule: "Historical failure, later reproduction, and final contract-environment records are distinct. Any V2-6 PASS wording is derived only from complete revision-2 direct and isolated records below.",
  phases: [initial, historicalReproduction, final],
  finalConclusion: {
    node: "v22.23.1", python: "3.13.7", pandas: "3.0.5",
    aggregateFullTest: { exitCode: fullTest.exitCode, testStatistics: fullTest.testStatistics, classification: fullTestPassed ? "PASS" : "NON_ZERO_V2_6_OUTER_WRAPPER_TIMEOUT" },
    v26DirectRevision2: { exitCode: direct.exitCode, development: direct.v26.development, final: direct.v26.final },
    v26IsolatedRevision2: { exitCode: isolated.exitCode, testStatistics: isolated.testStatistics },
    verify: { exitCode: verify.exitCode, testStatistics: verify.testStatistics, classification: verifyPassed ? "PASS" : "NON_ZERO_V2_6_OUTER_WRAPPER_TIMEOUT" },
  },
  B_R2_01: { status: "OWNER_EVIDENCE_EXCEPTION_APPROVED", decision: initial.ownerDecision },
  B_R3_01: { status: "CLOSED_BY_COMPLETE_DIRECT_AND_ISOLATED_RECORDS" },
  deliveryState: "NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED",
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, status: "PASS", finalConclusion: result.finalConclusion }, null, 2));
