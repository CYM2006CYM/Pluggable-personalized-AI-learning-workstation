import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const logRoot = process.env.W4_C_LOG_ROOT ?? resolve(packageRoot, "../C-W4-D3-R3-command-logs");
const outputPath = resolve(import.meta.dirname, "command-results.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");

const commands = [
  { id: "build-demo", command: "npm.cmd run build:demo", issues: ["C-R3-02", "C-R3-04"], attribution: "c_validation" },
  { id: "c-http", command: "npm.cmd test -- --run tests/w4-c-d3-http.test.ts --maxWorkers=1", issues: ["C-R3-01", "C-R3-02", "C-R3-03", "C-R3-04"], attribution: "c_validation" },
  { id: "affected", command: "npm.cmd test -- --run tests/profile-revision-3-activation.test.ts tests/pandas-cleaning-revision-3-diagnostic.test.ts tests/w4-d-recorded-responses.test.ts tests/w4-d-formal-ad-binding.test.ts tests/w4-d-fixed-fallback-integration.test.ts tests/w4-d-live-model-execution-port.test.ts tests/app-bootstrap-facade.test.ts tests/path-runtime.test.ts tests/quiz-activity-runtime.test.ts --maxWorkers=1", issues: ["C-R3-03", "C-R3-04"], attribution: "cross_role_regression" },
  { id: "typecheck", command: "npm.cmd run typecheck", issues: ["C-R3-01", "C-R3-03"], attribution: "c_validation" },
  { id: "check-docs", command: "npm.cmd run check:docs", issues: ["C-R3-04"], attribution: "documentation_gate" },
  { id: "build-web", command: "npm.cmd run build:web", issues: ["C-R3-04"], attribution: "affected_build_gate" },
  { id: "full-test", command: "npm.cmd test -- --maxWorkers=1", issues: ["C-R3-04"], attribution: "full_contract_regression" },
  { id: "verify", command: "npm.cmd run verify", issues: ["C-R3-04"], attribution: "full_contract_gate" },
  { id: "diff-check", command: "git -C .. diff --check", issues: ["C-R3-04"], attribution: "scope_gate" },
  { id: "runtime-smoke", command: "node .\\scripts\\w4-c-validation\\runtime-smoke.mjs", issues: ["C-R3-02", "C-R3-04"], attribution: "fixed_port_environment_gate" },
];

function testCounts(output) {
  const testsLine = output.split(/\r?\n/u).find((line) => /^\s*Tests\s+/u.test(line));
  const filesLine = output.split(/\r?\n/u).find((line) => /^\s*Test Files\s+/u.test(line));
  const count = (label, line) => Number(line?.match(new RegExp(`(\\d+) ${label}`, "u"))?.[1] ?? 0);
  return {
    testFiles: count("passed", filesLine) + count("failed", filesLine),
    passed: count("passed", testsLine),
    failed: count("failed", testsLine),
    skipped: count("skipped", testsLine),
  };
}

async function run(entry) {
  const startedUtc = new Date().toISOString();
  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", entry.command], { cwd: packageRoot, windowsHide: true, env: { ...process.env, PYTHONNOUSERSITE: "1" }, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("sh", ["-lc", entry.command], { cwd: packageRoot, env: { ...process.env, PYTHONNOUSERSITE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolveExit) => child.once("close", (code) => resolveExit(code ?? 1)));
  const endedUtc = new Date().toISOString();
  await writeFile(resolve(logRoot, `${entry.id}.stdout.txt`), stdout, "utf8");
  await writeFile(resolve(logRoot, `${entry.id}.stderr.txt`), stderr, "utf8");
  return {
    id: entry.id,
    command: entry.command,
    workingDirectory: "pi-study-helper",
    environment: { PYTHONNOUSERSITE: "1" },
    startedUtc,
    endedUtc,
    naturalExitCode: exitCode,
    outerExitCode: exitCode,
    ...testCounts(`${stdout}\n${stderr}`),
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: digest(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: digest(stderr),
    notRunReason: null,
    issueIds: entry.issues,
    attribution: exitCode === 0 ? entry.attribution : entry.attribution,
  };
}

await mkdir(logRoot, { recursive: true });
const document = {
  schemaVersion: 1,
  contract: "W4-C2/W4-R1",
  head: "c50e2c1aea19a7cf77aacbaa654f9f298b6c0dbe",
  historicalRuns: [
    { command: "npm.cmd test -- --run tests/w4-c-d3-http.test.ts --maxWorkers=1", result: "13/14", failure: "chapter background_only skipped saveDiagnosticDraft and received idempotency_conflict", captureStatus: "interactive_output_not_retained" },
    { command: "npm.cmd test -- --run tests/w4-c-d3-http.test.ts --maxWorkers=1", result: "13/14", failure: "chapter path requested 240 minutes while the prerequisite closure required 275", captureStatus: "interactive_output_not_retained" },
    { command: "npm.cmd test -- --run tests/w4-c-d3-http.test.ts --maxWorkers=1", result: "13/14", failure: "test incorrectly required a learning card for the legal helper single-question node", captureStatus: "interactive_output_not_retained" },
    { command: "node scripts/w4-c-validation/runtime-smoke.mjs", result: "FAILED", failure: "initial Windows npm.cmd direct spawn returned EINVAL; harness changed to explicit cmd.exe invocation", captureStatus: "interactive_output_not_retained" },
  ],
  commands: [],
};
for (const entry of commands) {
  document.commands.push(await run(entry));
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
