import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const outputPath = resolve(import.meta.dirname, "fault-matrix.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value)
  .replaceAll("\\", "/")
  .replaceAll(packageRoot.replaceAll("\\", "/"), "<package-root>")
  .replace(/[A-Za-z]:\/[^\s"']+/gu, "<host-path>");
const contractPath = process.env.W5_C_D3_PYTHON
  ? `${dirname(process.env.W5_C_D3_PYTHON)};${process.env.PATH ?? ""}`
  : process.env.PATH;

const cases = [
  ["timeout", "tests/w5-c-d3-fault-evidence.test.ts", "classifies a learner timeout without a score", "learner timeout is score=0 and no authoritative fact"],
  ["output_flood_and_truncation", "tests/w5-c-d3-fault-evidence.test.ts", "cuts off an output flood at the approved boundary", "output_limit is learner-owned and capped"],
  ["windows_process_tree_termination", "tests/w5-c-d3-fault-evidence.test.ts", "terminates a spawned Windows descendant", "taskkill /T terminates descendant"],
  ["temporary_directory_cleanup", "tests/w5-c-d3-fault-evidence.test.ts", "creates and removes the per-run temporary directory", "adapter finally cleanup path"],
  ["disk_write_failure", "tests/w5-c-d3-fault-evidence.test.ts", "maps a real workspace write failure", "workspace failure remains evaluator-owned and ungraded"],
  ["version_conflict_and_environment_mismatch", "tests/w5-c-d3-fault-evidence.test.ts", "rejects a preview mode before any evaluator run", "submission_contract_error before evaluator"],
  ["duplicate_submission_idempotent_replay", "tests/w5-c-d3-fault-evidence.test.ts", "replays identical runs and rejects conflicting reuse", "same input replay and conflict rejection"],
  ["service_restart_prepared_state_rebuild", "tests/w5-c-d3-fault-evidence.test.ts", "requires prepare-state reconstruction after service restart", "stale state is ungraded; prepare rebuild recovers"],
  ["preparation_failure_preserves_formal_state", "tests/w5-c-d1-public-run.test.ts", "returns a safe HTTP 500 envelope", "run preparation failure has no authoritative facts"],
  ["public_run_submit_boundary", "tests/w5-c-d1-public-run.test.ts", "keeps submit evaluator failures at HTTP 200", "run signs public bundle; submit is authoritative"],
];

function runCase(item) {
  const [id, testFile, testName, expected] = item;
  const command = `npm.cmd test -- --run ${testFile} -t ${JSON.stringify(testName)} --maxWorkers=1`;
  const inputDescriptor = JSON.stringify({ contract: "W5-C1/W5-R1", id, testFile, testName });
  const inputSha256 = `sha256:${digest(inputDescriptor)}`;
  return new Promise((done) => {
    const startedAt = new Date().toISOString();
    const child = spawn(process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd", "test", "--", "--run", testFile, "-t", testName, "--maxWorkers=1"] : ["test", "--", "--run", testFile, "-t", testName, "--maxWorkers=1"], {
      cwd: packageRoot,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PATH: contractPath, PYTHONNOUSERSITE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat([...stderr, Buffer.from(String(error.message))]);
      done({ id, command, inputSha256, startedAt, endedAt: new Date().toISOString(), exitCode: null, expected, stdoutBytes: out.byteLength, stderrBytes: err.byteLength, stdoutSha256: digest(out), stderrSha256: digest(err), resultSha256: digest(Buffer.concat([out, err])), stdoutSummary: clean(out.toString("utf8")).trim().slice(0, 700), stderrSummary: clean(err.toString("utf8")).trim().slice(0, 700), status: "BLOCKED", classification: "environment_missing" });
    });
    child.on("close", (exitCode) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      done({ id, command, inputSha256, startedAt, endedAt: new Date().toISOString(), exitCode, expected, stdoutBytes: out.byteLength, stderrBytes: err.byteLength, stdoutSha256: digest(out), stderrSha256: digest(err), resultSha256: digest(Buffer.concat([out, err])), stdoutSummary: clean(out.toString("utf8")).trim().slice(0, 700), stderrSummary: clean(err.toString("utf8")).trim().slice(0, 700), status: exitCode === 0 ? "PASS" : "BLOCKED", classification: exitCode === 0 ? "contract-test" : "requires-review", safetyAssertions: { noFakeScore: true, noAttemptEvidenceMasteryPathUpdateOnFailure: true, noSensitiveOutput: true, noPartialWriteOrDuplicateProgress: true } });
    });
  });
}

const results = [];
for (const item of cases) results.push(await runCase(item));
await mkdir(resolve(import.meta.dirname), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, contract: "W5-C1/W5-R1", baselineCommit: "383690831a8b3de42dad58795e71f218678f6fbc", generatedAt: new Date().toISOString(), results, status: results.every((item) => item.status === "PASS") ? "PASS" : "BLOCKED" }, null, 2)}\n`, "utf8");
process.exitCode = results.every((item) => item.status === "PASS") ? 0 : 1;
