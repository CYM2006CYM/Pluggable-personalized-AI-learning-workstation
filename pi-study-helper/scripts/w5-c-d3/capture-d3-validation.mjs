import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const packageRoot = resolve(import.meta.dirname, "../..");
const logsRoot = resolve(import.meta.dirname, "logs");
const evidencePaths = {
  publicPackage: resolve(import.meta.dirname, "public-package-runs.json"),
  processTree: resolve(import.meta.dirname, "process-tree-evidence.json"),
  faultMatrix: resolve(import.meta.dirname, "fault-matrix.json"),
};
const commands = [
  ["d3-real-public-package", "npm.cmd", ["test", "--", "--run", "tests/w5-c-d3-public-package.test.ts", "--maxWorkers=1"], { W5_C_D3_PUBLIC_PACKAGE_OUTPUT: evidencePaths.publicPackage }],
  ["d3-process-tree", "npm.cmd", ["test", "--", "--run", "tests/w5-c-d3-process-tree.test.ts", "--maxWorkers=1"], { W5_C_D3_PROCESS_TREE_OUTPUT: evidencePaths.processTree }],
  ["d3-fault-matrix", "npm.cmd", ["test", "--", "--run", "tests/w5-c-d3-fault-matrix.test.ts", "--maxWorkers=1"], { W5_C_D3_FAULT_MATRIX_OUTPUT: evidencePaths.faultMatrix }],
  ["public-run-regression", "npm.cmd", ["test", "--", "--run", "tests/w5-c-d1-public-run.test.ts", "tests/python-process-evaluation.test.ts", "tests/python-process-evaluation-r2.test.ts", "--maxWorkers=1"]],
  ["environment-measurement", "node", ["scripts/w5-c-d3/measure-environment.mjs"]],
  ["typecheck", "npm.cmd", ["run", "typecheck"]],
  ["build-demo", "npm.cmd", ["run", "build:demo"]],
  ["build-web", "npm.cmd", ["run", "build:web"]],
  ["check-docs", "npm.cmd", ["run", "check:docs"]],
  ["smoke-extension", "npm.cmd", ["run", "smoke:extension"]],
  ["check-release", "npm.cmd", ["run", "check:release"]],
  ["full-test", "npm.cmd", ["test", "--", "--maxWorkers=1"]],
  ["candidate-diff-check", "node", ["scripts/w5-c-d3/candidate-diff-check.mjs"]],
  ["git-diff-check", "git", ["diff", "--check"]],
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const packageRootSlash = packageRoot.replaceAll("\\", "/");
const clean = (value) => value.replaceAll("\\", "/").replaceAll(packageRootSlash, "<package-root>");
function counts(value) {
  const files = value.match(/Test Files\s+(\d+) passed/u);
  const tests = value.match(/Tests\s+(\d+) passed/u);
  const failed = value.match(/(\d+) failed/u);
  const skipped = value.match(/(\d+) skipped/u);
  return { testFiles: files ? Number(files[1]) : null, passed: tests ? Number(tests[1]) : null, failed: failed ? Number(failed[1]) : 0, skipped: skipped ? Number(skipped[1]) : 0 };
}
function run([id, executable, args, commandEnvironment = {}]) {
  return new Promise((done) => {
    const startedAt = new Date().toISOString();
    const useCmd = process.platform === "win32" && executable.endsWith(".cmd");
    const child = spawn(useCmd ? (process.env.ComSpec ?? "cmd.exe") : executable, useCmd ? ["/d", "/s", "/c", executable, ...args] : args, { cwd: packageRoot, shell: false, windowsHide: true, env: { ...process.env, ...commandEnvironment, PYTHONNOUSERSITE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const finish = (exitCode, orchestrationExitCode = exitCode) => {
      const out = Buffer.from(clean(Buffer.concat(stdout).toString("utf8")), "utf8");
      const err = Buffer.from(clean(Buffer.concat(stderr).toString("utf8")), "utf8");
      const record = { id, command: [executable, ...args].join(" "), workdir: "<package-root>", startedAt, endedAt: new Date().toISOString(), exitCode, orchestrationExitCode, stdoutBytes: out.byteLength, stdoutSha256: digest(out), stderrBytes: err.byteLength, stderrSha256: digest(err), counts: counts(out.toString("utf8")), status: exitCode === 0 ? "PASS" : "FAIL" };
      return Promise.all([writeFile(resolve(logsRoot, `${id}.stdout.log`), out), writeFile(resolve(logsRoot, `${id}.stderr.log`), err)]).then(() => record);
    };
    child.on("error", (error) => finish(null, 1).then((record) => done({ ...record, errorCode: "spawn_error", errorMessage: String(error.message) })));
    child.on("close", (code) => finish(code).then(done));
  });
}
await mkdir(logsRoot, { recursive: true });
const results = [];
for (const command of commands) results.push(await run(command));
const measured = JSON.parse(await readFile(resolve(import.meta.dirname, "environment-measurement.json"), "utf8"));
const historicalFailures = [
  { command: "npm.cmd test -- --run tests/w5-c-d3-node-measurement.test.ts --maxWorkers=1", exitCode: 1, attribution: "dependency_installation_missing", errorCode: "vitest_not_found", resolution: "R1 history retained; superseded by tests/w5-c-d3-public-package.test.ts and omitted from the R3 candidate" },
  { command: "npm.cmd run typecheck", exitCode: 1, attribution: "test_implementation", errorCode: "d3_test_type_narrowing", resolution: "R1 test-only type widening; later rerun passed" },
  { command: "evaluator timeout fixture", exitCode: 0, attribution: "fault_fixture", errorCode: "runner_crash", resolution: "R1 history retained as runner_crash, never relabeled evaluator_timeout" },
  { command: "node scripts/w5-c-d3/capture-d3-validation.mjs", exitCode: 1, orchestrationExitCode: 124, attribution: "external_process_timeout", errorCode: "smoke_extension_get_state_timeout", resolution: "R1 history retained; isolated and complete reruns later exited naturally" },
  { command: "R2 public-package author test", exitCode: 1, attribution: "test_implementation", errorCode: "public_package_assertion_or_draft_version_conflict", resolution: "R2 history retained; corrected real HTTP package test rerun passed" },
  { command: "R2 final extracted validation capture", exitCode: 1, attribution: "candidate_packaging", errorCode: "missing_w5_c_d3_node_measurement_test", resolution: "Removed the stale command and regenerated R3 evidence from the exact proposed set" },
  { command: "R2 full test in alternate checkout", exitCode: 1, attribution: "checkout_line_ending_mismatch", errorCode: "raw_binary_seal_sha256_mismatch", resolution: "Not attributed to B; exact R3 candidate rerun in the owner contract environment passed" },
];
await writeFile(resolve(import.meta.dirname, "command-results.json"), `${JSON.stringify({ schemaVersion: 2, candidate: "W5-D3-C-R3", generatedAt: new Date().toISOString(), environment: { node: measured.values.nodeVersion, npm: measured.values.npmVersion, python: measured.values.pythonVersion, pandas: measured.values.pandasVersion, platform: measured.values.platform, arch: measured.values.arch, actualWindowsBuild: measured.values.actualWindowsBuild, pythonNoUserSite: true }, historicalFailures, results }, null, 2)}\n`, "utf8");
process.exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0;
