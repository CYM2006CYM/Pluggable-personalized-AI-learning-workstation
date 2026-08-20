import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const outputPath = resolve(packageRoot, "scripts/w5-e-validation/d2-command-results.json");
const rawLogRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d2-r2-validation-"));
const ansi = /\u001b\[[0-9;]*m/gu;
const forbidden = /hiddenTest|referenceSolution|rubricRef|apiKey|systemPrompt|privateCsv|(?:sk|rk)-[A-Za-z0-9_-]{20,}/giu;
let previous;
try { previous = JSON.parse(await readFile(outputPath, "utf8")); } catch { previous = undefined; }
if (process.argv.includes("--redact-existing")) {
  if (previous === undefined) throw new Error("existing_command_results_required");
  const redactExecutable = (value) => {
    if (Array.isArray(value)) return value.map(redactExecutable);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "pythonExecutable" && typeof item === "string" && item !== "UNSET" ? "<CONTRACT_PYTHON_EXECUTABLE>" : redactExecutable(item)]));
    return value;
  };
  await writeFile(outputPath, `${JSON.stringify(redactExecutable(previous), null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, status: "REDACTED_HOST_EXECUTABLE_PATHS", versionFactsPreserved: true }, null, 2)}\n`);
  process.exit(0);
}

const commands = [
  { id: "typecheck", command: "npm.cmd run typecheck", cwd: packageRoot, test: false },
  { id: "test-web", command: "npm.cmd run test:web -- --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "affected-regression", command: "npm.cmd test -- --run tests/w5-c-d1-public-run.test.ts tests/shared-session.test.ts tests/shared-web-extension-entry.test.ts --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "full-test", command: "npm.cmd test -- --maxWorkers=1", cwd: packageRoot, test: true },
  { id: "check-docs", command: "npm.cmd run check:docs", cwd: packageRoot, test: false },
  { id: "build-web", command: "npm.cmd run build:web", cwd: packageRoot, test: false },
  { id: "build-demo", command: "npm.cmd run build:demo", cwd: packageRoot, test: false },
  { id: "smoke-extension", command: "npm.cmd run smoke:extension", cwd: packageRoot, test: false },
  { id: "check-release", command: "npm.cmd run check:release", cwd: packageRoot, test: false },
  { id: "verify", command: "npm.cmd run verify", cwd: packageRoot, test: true },
  { id: "git-diff-check", command: "git diff --check", cwd: repositoryRoot, test: false },
  { id: "runtime-evidence-tests", command: "node scripts/w5-e-validation/run-d2-runtime-tests.mjs", cwd: packageRoot, test: true, resultFile: "scripts/w5-e-validation/d2-runtime-test-results.json" },
  { id: "browser-capture", command: "node scripts/w5-e-validation/capture-d2-r2-browser.mjs", cwd: packageRoot, test: false, resultFile: "scripts/w5-e-validation/d2-browser-capture.json" },
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
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
  return testFiles === undefined || tests === undefined
    ? { applicability: "MISSING" }
    : { applicability: "APPLICABLE", testFiles, tests };
}

function consistentStatistics(statistics, exitCode) {
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
  python: version(`\"${pythonExecutable}\" --version`),
  pandas: version(`\"${pythonExecutable}\" -c \"import pandas; print(pandas.__version__)\"`),
  pythonNoUserSite: process.env.PYTHONNOUSERSITE ?? "UNSET",
};

const results = [];
for (const specification of commands) {
  const startedAtUtc = new Date().toISOString();
  const execution = spawnSync(specification.command, { cwd: specification.cwd, shell: true, encoding: "utf8", timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
  const endedAtUtc = new Date().toISOString();
  const stdout = normalize(execution.stdout);
  const stderr = normalize(execution.stderr);
  await writeFile(resolve(rawLogRoot, `${specification.id}.stdout.log`), stdout, "utf8");
  await writeFile(resolve(rawLogRoot, `${specification.id}.stderr.log`), stderr, "utf8");
  const exitCode = execution.status ?? 1;
  let statistics = specification.test ? parseStatistics(`${stdout}\n${stderr}`) : { applicability: "NOT_APPLICABLE", testFiles: "NOT_APPLICABLE", tests: "NOT_APPLICABLE" };
  let resultEvidence;
  if (specification.resultFile !== undefined) {
    try {
      resultEvidence = JSON.parse(await readFile(resolve(packageRoot, specification.resultFile), "utf8"));
      if (specification.test) statistics = resultEvidence.statistics;
    } catch { resultEvidence = undefined; }
  }
  const matches = [...`${stdout}\n${stderr}`.matchAll(forbidden)].map((match) => match[0]);
  const evidenceConsistent = !specification.test || consistentStatistics(statistics, exitCode);
  results.push({
    id: specification.id,
    command: specification.command,
    cwd: specification.cwd === packageRoot ? "pi-study-helper" : ".",
    startedAtUtc,
    endedAtUtc,
    exitCode,
    status: exitCode === 0 && evidenceConsistent ? "PASS" : execution.error?.code === "ETIMEDOUT" ? "TIMEOUT" : "FAIL",
    stdout: { bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
    stderr: { bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
    statistics,
    resultEvidence: specification.resultFile === undefined ? "NOT_APPLICABLE" : {
      path: specification.resultFile,
      sha256: resultEvidence === undefined ? "MISSING" : sha256(await readFile(resolve(packageRoot, specification.resultFile))),
      status: resultEvidence?.status ?? "MISSING",
    },
    evidenceConsistent,
    logSafetyFindings: [...new Set(matches)],
  });
}

async function hydrateHistoricalRun(run) {
  if (!Array.isArray(run?.commands)) return run;
  const testIds = new Set(["test-web", "affected-regression", "full-test", "verify", "runtime-evidence-tests"]);
  let directories = [];
  try { directories = (await readdir(tmpdir(), { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith("w5-e-d2")).map((entry) => resolve(tmpdir(), entry.name)); } catch { directories = []; }
  const commands = [];
  for (const item of run.commands) {
    if (!testIds.has(item.id)) {
      commands.push({ ...item, statistics: item.statistics ?? { applicability: "NOT_APPLICABLE", testFiles: "NOT_APPLICABLE", tests: "NOT_APPLICABLE" } });
      continue;
    }
    if (item.statistics?.applicability === "APPLICABLE") { commands.push(item); continue; }
    let statistics;
    for (const directory of directories) {
      try {
        const stdout = normalize(await readFile(resolve(directory, `${item.id}.stdout.log`), "utf8"));
        const stderr = normalize(await readFile(resolve(directory, `${item.id}.stderr.log`), "utf8"));
        if (sha256(stdout) === item.stdout?.sha256 && sha256(stderr) === item.stderr?.sha256) {
          statistics = parseStatistics(`${stdout}\n${stderr}`);
          break;
        }
      } catch { /* This run did not create the requested log. */ }
    }
    commands.push({ ...item, statistics: statistics ?? { applicability: "HISTORICAL_LOG_UNAVAILABLE" } });
  }
  const environment = run.environment === undefined ? undefined : { ...run.environment, ...(typeof run.environment.pythonExecutable === "string" && run.environment.pythonExecutable !== "UNSET" ? { pythonExecutable: "<CONTRACT_PYTHON_EXECUTABLE>" } : {}) };
  return { ...run, environment, commands };
}

const retainedHistory = previous === undefined ? [] : [
  ...await Promise.all((Array.isArray(previous.priorRuns) ? previous.priorRuns : []).map(hydrateHistoricalRun)),
  {
    generatedAtUtc: previous.generatedAtUtc,
    overallStatus: previous.overallStatus,
    environment: previous.environment,
    commands: (await hydrateHistoricalRun(previous)).commands,
    retentionNote: "Pre-R2 evidence retained byte-for-byte as historical command metadata; R2 statistics are authoritative only in currentRun.",
  },
];
const document = {
  schemaVersion: 2,
  candidate: "W5-D2-E-R2",
  baseHead: "127a71cce4a8423327fb5ce75d31294252b92a0b",
  state: "NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED",
  generatedAtUtc: new Date().toISOString(),
  environment,
  rawLogs: "AUDIT_ONLY_TEMPORARY_NOT_IN_ZIP_OR_GIT",
  outputNormalization: "ANSI removed; repository path replaced by <REPOSITORY_ROOT>; separators normalized before byte count and SHA-256.",
  commands: results,
  history: previous?.history ?? [],
  priorRuns: retainedHistory,
  overallStatus: results.every((item) => item.status === "PASS" && item.logSafetyFindings.length === 0) ? "PASS" : "FAIL",
};
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, rawLogs: document.rawLogs, overallStatus: document.overallStatus, commands: results.length }, null, 2)}\n`);
process.exitCode = document.overallStatus === "PASS" ? 0 : 1;
