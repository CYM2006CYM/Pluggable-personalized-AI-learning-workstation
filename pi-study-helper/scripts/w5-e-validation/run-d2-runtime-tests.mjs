import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outputPath = resolve(packageRoot, "scripts/w5-e-validation/d2-runtime-test-results.json");
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d2-runtime-tests-"));
const reporterPath = resolve(temporaryRoot, "vitest.json");
const commandPrefix = "npm.cmd exec vitest -- run tests/web/w5-d2-e-runtime-evidence.test.tsx --maxWorkers=1 --reporter=json --outputFile=";
const executionCommand = `${commandPrefix}${reporterPath}`;
const recordedCommand = `${commandPrefix}<TEMP_RUNTIME_REPORT>/vitest.json`;
const startedAtUtc = new Date().toISOString();
const execution = spawnSync(executionCommand, { cwd: packageRoot, shell: true, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
const endedAtUtc = new Date().toISOString();
const stdout = String(execution.stdout ?? "");
const stderr = String(execution.stderr ?? "");
let report;
try { report = JSON.parse(await readFile(reporterPath, "utf8")); } catch { report = undefined; }
const assertions = report?.testResults?.flatMap((file) => file.assertionResults.map((assertion) => ({
  fullName: assertion.fullName,
  status: assertion.status,
  evidenceFile: "tests/web/w5-d2-e-runtime-evidence.test.tsx",
}))) ?? [];
const statistics = report === undefined ? undefined : {
  applicability: "APPLICABLE",
  testFiles: {
    passed: report.testResults.filter((file) => file.status === "passed").length,
    failed: report.testResults.filter((file) => file.status === "failed").length,
    skipped: report.testResults.filter((file) => file.status === "pending").length,
    total: report.testResults.length,
  },
  tests: {
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
    total: report.numTotalTests,
  },
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const result = {
  schemaVersion: 1,
  command: recordedCommand,
  cwd: "pi-study-helper",
  startedAtUtc,
  endedAtUtc,
  exitCode: execution.status ?? 1,
  stdout: { bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
  stderr: { bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
  statistics: statistics ?? { applicability: "MISSING" },
  assertions,
  status: execution.status === 0 && report?.success === true && assertions.length === 3 && assertions.every((assertion) => assertion.status === "passed") ? "PASS" : "FAIL",
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: result.status, statistics: result.statistics, assertions: assertions.length }, null, 2)}\n`);
process.exitCode = result.status === "PASS" ? 0 : 1;
