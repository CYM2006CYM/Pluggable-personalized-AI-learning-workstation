import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(scriptDirectory, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const evidenceRoot = resolve(process.argv[2] ?? "");

if (basename(evidenceRoot).toLowerCase() !== "w4-d4") {
  throw new Error("Evidence root must be the dedicated W4-D4 directory.");
}

const rawRoot = resolve(evidenceRoot, "raw");
mkdirSync(rawRoot, { recursive: true });
const nodeRoot = resolve(evidenceRoot, "toolchains/node-v22.23.1-win-x64");
const pythonExecutable = resolve(evidenceRoot, "toolchains/python-3.13.7/python.exe");
const inheritedPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
const commandEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
commandEnvironment.PATH = `${nodeRoot};${dirname(pythonExecutable)};${inheritedPath}`;
commandEnvironment.PYTHONNOUSERSITE = "1";
commandEnvironment.PI_PYTHON_EXECUTABLE = pythonExecutable;

const commands = [
  {
    id: "environment-contract",
    command: "node scripts/w4-e-validation/environment-probe.mjs",
    cwd: packageRoot,
  },
  { id: "test-web", command: "npm.cmd run test:web -- --maxWorkers=1", cwd: packageRoot },
  { id: "real-api-trajectories", command: "npm.cmd test -- --run tests/web/real-api.test.ts --maxWorkers=1", cwd: packageRoot },
  { id: "v4-six-point", command: "npm.cmd test -- --run tests/web/v4-six-point.test.ts --maxWorkers=1", cwd: packageRoot },
  {
    id: "v4-targeted",
    command: "npm.cmd test -- --run tests/w4-contracts.test.ts tests/quiz-runtime.test.ts tests/quiz-activity-runtime.test.ts tests/adaptive-content-service.test.ts tests/capability-task-service.test.ts tests/session-capability-evidence-provider.test.ts tests/w4-d-graph-factory.test.ts tests/w4-d-recorded-responses.test.ts tests/w4-d-formal-ad-binding.test.ts tests/w4-c-d3-http.test.ts tests/web/real-api.test.ts tests/web/v4-six-point.test.ts tests/web/v4-recorded-response-audit.test.ts --maxWorkers=1",
    cwd: packageRoot,
  },
  { id: "full-test", command: "npm.cmd test -- --run --maxWorkers=1", cwd: packageRoot },
  { id: "typecheck", command: "npm.cmd run typecheck", cwd: packageRoot },
  { id: "check-docs", command: "npm.cmd run check:docs", cwd: packageRoot },
  { id: "build-web", command: "npm.cmd run build:web", cwd: packageRoot },
  { id: "smoke-extension", command: "npm.cmd run smoke:extension", cwd: packageRoot },
  { id: "verify", command: "npm.cmd run verify", cwd: packageRoot },
  { id: "git-diff-check", command: "git diff --check", cwd: repositoryRoot },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function counts(stdout) {
  const files = stdout.match(/Test Files\s+(?:(\d+) failed \|\s*)?(\d+) passed/iu);
  const tests = stdout.match(/Tests\s+(?:(\d+) failed \|\s*)?(\d+) passed(?:\s*\|\s*(\d+) skipped)?/iu);
  const links = stdout.match(/Validated (\d+) Markdown links?/iu);
  return {
    testFilesFailed: files?.[1] === undefined ? 0 : Number(files[1]),
    testFilesPassed: files?.[2] === undefined ? null : Number(files[2]),
    testsFailed: tests?.[1] === undefined ? 0 : Number(tests[1]),
    testsPassed: tests?.[2] === undefined ? null : Number(tests[2]),
    testsSkipped: tests?.[3] === undefined ? 0 : Number(tests[3]),
    markdownLinksValidated: links?.[1] === undefined ? null : Number(links[1]),
  };
}

const results = [];
for (const item of commands) {
  const startedAt = new Date();
  const run = spawnSync("cmd.exe", ["/d", "/s", "/c", item.command], {
    cwd: item.cwd,
    encoding: "utf8",
    windowsHide: true,
    env: commandEnvironment,
    maxBuffer: 64 * 1024 * 1024,
  });
  const completedAt = new Date();
  const stdout = run.stdout ?? "";
  const stderr = `${run.stderr ?? ""}${run.error === undefined ? "" : `${run.error.stack ?? run.error.message}\n`}`;
  const stdoutName = `${item.id}.stdout.log`;
  const stderrName = `${item.id}.stderr.log`;
  writeFileSync(resolve(rawRoot, stdoutName), stdout, "utf8");
  writeFileSync(resolve(rawRoot, stderrName), stderr, "utf8");
  results.push({
    id: item.id,
    command: item.command,
    workingDirectory: item.cwd,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    exitCode: run.status ?? 1,
    observedCounts: counts(`${stdout}\n${stderr}`),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    rawLogs: [`raw/${stdoutName}`, `raw/${stderrName}`],
  });
}

const output = {
  schemaVersion: "w4-d4-e-command-results-v1",
  generatedAt: new Date().toISOString(),
  baselineCommit: "a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4",
  commandCount: results.length,
  nonzeroExitCount: results.filter((item) => item.exitCode !== 0).length,
  commands: results,
};
writeFileSync(resolve(scriptDirectory, "command-results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
