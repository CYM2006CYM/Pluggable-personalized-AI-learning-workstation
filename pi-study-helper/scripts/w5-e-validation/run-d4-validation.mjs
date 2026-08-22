import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const outputPath = resolve(packageRoot, "scripts/w5-e-validation/d4-command-results.json");
const rawLogRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d4-validation-"));
const ansi = /\u001b\[[0-9;]*m/gu;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let previous;
try { previous = JSON.parse(await readFile(outputPath, "utf8")); } catch { previous = undefined; }

const commands = [
  { id: "a-d4-manifest", command: "node scripts/w5-a-d4/verify-manifest.mjs", cwd: packageRoot, test: false },
  { id: "manifest-portability", command: "npm.cmd test -- tests/w5-a-d4-manifest-portability.test.ts --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "generate-showcase", command: "node scripts/w5-e-validation/generate-formal-showcase-data.mjs", cwd: packageRoot, test: false },
  { id: "typecheck", command: "npm.cmd run typecheck", cwd: packageRoot, test: false },
  { id: "test-web", command: "npm.cmd run test:web -- --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "affected-regression", command: "npm.cmd test -- tests/w5-a-d4-cross-end.test.ts tests/w5-a-d4-showcase-paths.test.ts tests/shared-session.test.ts tests/shared-web-extension-entry.test.ts tests/web/real-api.test.ts tests/web/w5-d4-e-real-code-chain.test.tsx tests/w5-formal-bundle-revision-binding.test.ts tests/w4-d-fixed-fallback-integration.test.ts tests/w5-c-d3-fault-matrix.test.ts --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "full-test", command: "npm.cmd test -- --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "check-docs", command: "npm.cmd run check:docs", cwd: packageRoot, test: false },
  { id: "build-web", command: "npm.cmd run build:web", cwd: packageRoot, test: false },
  { id: "build-demo", command: "npm.cmd run build:demo", cwd: packageRoot, test: false },
  { id: "smoke-extension", command: "npm.cmd run smoke:extension", cwd: packageRoot, test: false },
  { id: "check-release", command: "npm.cmd run check:release", cwd: packageRoot, test: false },
  { id: "verify", command: "npm.cmd run verify", cwd: packageRoot, test: true },
  { id: "candidate-diff-check", command: "node scripts/w5-e-validation/d4-candidate-diff-check.mjs", cwd: packageRoot, test: false, resultFile: "scripts/w5-e-validation/d4-diff-check.json" },
  { id: "independent-validation", command: "node scripts/w5-e-validation/run-d4-independent-validation.mjs", cwd: packageRoot, test: false, resultFile: "scripts/w5-e-validation/d4-independent-validation.json" },
  { id: "browser-capture", command: "node scripts/w5-e-validation/capture-d4-browser.mjs", cwd: packageRoot, test: false, resultFile: "scripts/w5-e-validation/d4-browser-capture.json" },
  { id: "evidence-generation", command: "node scripts/w5-e-validation/generate-d4-evidence.mjs", cwd: packageRoot, test: false, resultFile: "scripts/w5-e-validation/d4-security-scan.json" },
];

function normalize(value) {
  return String(value ?? "").replace(ansi, "")
    .split(repositoryRoot).join("<REPOSITORY_ROOT>")
    .split(repositoryRoot.replaceAll("\\", "/")).join("<REPOSITORY_ROOT>")
    .replaceAll("\\", "/");
}

function parseSummaryLine(output, label) {
  const line = output.split(/\r?\n/u).filter((item) => item.match(new RegExp(`^\\s*${label}\\s+`, "u"))).at(-1);
  if (line === undefined) return undefined;
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped)/gu)) counts[match[2]] = Number(match[1]);
  const total = counts.passed + counts.failed + counts.skipped;
  return total === 0 ? undefined : { ...counts, total };
}

function parseStatistics(output) {
  const testFiles = parseSummaryLine(output, "Test Files");
  const tests = parseSummaryLine(output, "Tests");
  return testFiles === undefined || tests === undefined ? { applicability: "MISSING" } : { applicability: "APPLICABLE", testFiles, tests };
}

function statisticsValid(statistics, exitCode) {
  if (statistics.applicability !== "APPLICABLE") return false;
  for (const group of [statistics.testFiles, statistics.tests]) {
    if (group.total !== group.passed + group.failed + group.skipped) return false;
  }
  return exitCode === 0 ? statistics.testFiles.failed === 0 && statistics.tests.failed === 0 : statistics.testFiles.failed > 0 || statistics.tests.failed > 0;
}

function version(command, cwd = packageRoot) {
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`environment_probe_failed:${command}`);
  return String(result.stdout).trim();
}

const pythonExecutable = process.env.PI_PYTHON_EXECUTABLE;
if (pythonExecutable === undefined) throw new Error("PI_PYTHON_EXECUTABLE_REQUIRED");
const inheritedPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
process.env.Path = `${dirname(pythonExecutable)};${inheritedPath}`;
const environment = {
  node: version("node --version"),
  npm: version("npm.cmd --version"),
  pythonExecutable: "<CONTRACT_PYTHON_EXECUTABLE>",
  python: version(`"${pythonExecutable}" --version`),
  pandas: version(`"${pythonExecutable}" -c "import pandas; print(pandas.__version__)"`),
  pythonNoUserSite: process.env.PYTHONNOUSERSITE ?? "UNSET",
};
const environmentPass = environment.node === "v22.23.1" && environment.npm === "10.9.8" && environment.python === "Python 3.13.7" && environment.pandas === "3.0.5" && environment.pythonNoUserSite === "1";
process.env.W5_E_D4_EVIDENCE_DIR = resolve(packageRoot, "scripts/w5-e-validation");

const results = [];
for (const specification of commands) {
  const startedAtUtc = new Date().toISOString();
  const execution = spawnSync(specification.command, { cwd: specification.cwd, shell: true, encoding: "utf8", timeout: 1_200_000, maxBuffer: 64 * 1024 * 1024 });
  const endedAtUtc = new Date().toISOString();
  const stdout = normalize(execution.stdout);
  const stderr = normalize(execution.stderr);
  await writeFile(resolve(rawLogRoot, `${specification.id}.stdout.log`), stdout, "utf8");
  await writeFile(resolve(rawLogRoot, `${specification.id}.stderr.log`), stderr, "utf8");
  const exitCode = execution.status ?? 1;
  const statistics = specification.test ? parseStatistics(`${stdout}\n${stderr}`) : { applicability: "NOT_APPLICABLE", testFiles: "NOT_APPLICABLE", tests: "NOT_APPLICABLE" };
  let resultEvidence;
  if (specification.resultFile !== undefined) {
    try { resultEvidence = JSON.parse(await readFile(resolve(packageRoot, specification.resultFile), "utf8")); } catch { resultEvidence = undefined; }
  }
  const evidenceConsistent = !specification.test || statisticsValid(statistics, exitCode);
  results.push({
    id: specification.id,
    command: specification.command,
    cwd: specification.cwd === packageRoot ? "pi-study-helper" : ".",
    startedAtUtc,
    endedAtUtc,
    exitCode,
    status: exitCode === 0 && evidenceConsistent && (resultEvidence === undefined || resultEvidence.status === "PASS") ? "PASS" : execution.error?.code === "ETIMEDOUT" ? "TIMEOUT" : "FAIL",
    stdout: { bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
    stderr: { bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
    statistics,
    evidenceConsistent,
    resultEvidence: specification.resultFile === undefined ? "NOT_APPLICABLE" : { path: specification.resultFile, sha256: resultEvidence === undefined ? "MISSING" : sha256(await readFile(resolve(packageRoot, specification.resultFile)),), status: resultEvidence?.status ?? "MISSING" },
  });
}

const developmentFailures = [
  { command: "node scripts/w5-e-validation/capture-d4-browser.mjs", status: "FAIL", phase: "SCRIPT_PARSE", error: "Unexpected reserved word: await in synchronous map callback", outputHash: "NOT_CAPTURED", resolution: "Use Promise.all with an async callback." },
  { command: "node scripts/w5-e-validation/capture-d4-browser.mjs", status: "FAIL", phase: "CDP_PROJECTION", error: "SyntaxError: Unexpected token ')'", outputHash: "NOT_CAPTURED", resolution: "Remove the extra closing parenthesis in the async projection expression." },
  { command: "node scripts/w5-e-validation/generate-d4-evidence.mjs", status: "FAIL", phase: "BUNDLE_SCAN", error: "ENOENT: repository-root/dist-web", outputHash: "NOT_CAPTURED", resolution: "Resolve Vite output below pi-study-helper/dist-web." },
  { command: "node scripts/w5-e-validation/generate-d4-evidence.mjs", status: "FAIL", phase: "HOST_PATH_SCAN", error: "Vite /@fs resource URLs contained the local workspace path", outputHash: "NOT_CAPTURED", resolution: "Move the formal demo and browser evidence to the built vite preview surface; do not normalize URLs before scanning." },
  { command: "npm.cmd test -- tests/web/w5-d4-e-real-code-chain.test.tsx", status: "FAIL", phase: "TEST_DISCOVERY", error: "Node built-ins were externalized after the Vite serve mode changed the Vitest environment", outputHash: "NOT_CAPTURED", resolution: "Keep Vitest on its test mode and move the formal demo to vite preview." },
  { command: "npm.cmd test -- tests/web/w5-d4-e-real-code-chain.test.tsx", status: "FAIL", phase: "REAL_CODE_SUBMIT", error: "draft_version_conflict after editing code in ActivityPage", outputHash: "NOT_CAPTURED", resolution: "Persist changed code through saveActivityDraft before formal submission." },
  { command: "node scripts/w5-e-validation/capture-d4-browser.mjs", status: "FAIL", phase: "RECTIFICATION_SCRIPT", error: "normalizedRequests is not defined", outputHash: "NOT_CAPTURED", resolution: "Use the unmodified capturedRequests collection throughout." },
  { command: "node scripts/w5-e-validation/capture-d4-browser.mjs", status: "FAIL", phase: "REAL_URL_SCAN", error: "The formal Vite development client exposed /@fs host paths", outputHash: "NOT_CAPTURED", resolution: "Use the same built vite preview surface as npm run demo." },
  { command: "node scripts/w5-e-validation/capture-d4-browser.mjs", status: "FAIL", phase: "PREVIEW_API", error: "vite.listen is not a function", outputHash: "NOT_CAPTURED", resolution: "Vite preview starts before returning; close it through httpServer.close()." },
];
const priorRuns = previous === undefined ? [] : [...(previous.priorRuns ?? []), { generatedAtUtc: previous.generatedAtUtc, overallStatus: previous.overallStatus, environment: previous.environment, commands: previous.commands }];
const overallStatus = environmentPass && results.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
const document = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  contract: "W5-C1/W5-R1",
  baseHead: "aaf588202b3ae92ed72c63994b912d78977516bb",
  state: "NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED",
  generatedAtUtc: new Date().toISOString(),
  environment,
  environmentPass,
  developmentFailures,
  priorRuns,
  commands: results,
  rawLogs: { status: "AUDIT_ONLY_NOT_PACKAGED", directory: "<SYSTEM_TEMP>/w5-e-d4-validation-*" },
  overallStatus,
};
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ overallStatus, environment, commands: results.map((item) => ({ id: item.id, status: item.status, statistics: item.statistics })) }, null, 2)}\n`);
process.exitCode = overallStatus === "PASS" ? 0 : 1;
