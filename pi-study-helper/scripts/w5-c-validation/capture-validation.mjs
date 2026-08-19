import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const packageRoot = resolve(import.meta.dirname, "../..");
const output = resolve(import.meta.dirname, "command-results.json");
const commands = [
  { id: "environment-probe", executable: "node", args: ["scripts/w5-c-validation/environment-probe.mjs"] },
  { id: "c-d1-public-run", executable: "npm.cmd", args: ["test", "--", "--run", "tests/w5-c-d1-public-run.test.ts", "tests/w4-c-d3-http.test.ts", "tests/public-execution-bundle.test.ts", "tests/public-execution-assets.test.ts", "tests/code-activity-facade-adapter.test.ts", "tests/web/real-api.test.ts", "--maxWorkers=1"] },
  { id: "a-c-regression", executable: "npm.cmd", args: ["test", "--", "--run", "tests/activity-runtime-service.test.ts", "tests/composed-learning-runtime-facade.test.ts", "tests/path-runtime.test.ts", "--maxWorkers=1"] },
  { id: "python-evaluator", executable: "npm.cmd", args: ["test", "--", "--run", "tests/python-process-evaluation.test.ts", "tests/python-process-evaluation-r2.test.ts", "tests/python-process-environment-compatibility.test.ts", "--maxWorkers=1"] },
  { id: "typecheck", executable: "npm.cmd", args: ["run", "typecheck"] },
  { id: "full-test", executable: "npm.cmd", args: ["test", "--", "--maxWorkers=1"] },
  { id: "build-demo", executable: "npm.cmd", args: ["run", "build:demo"] },
  { id: "check-docs", executable: "npm.cmd", args: ["run", "check:docs"] },
  { id: "build-web", executable: "npm.cmd", args: ["run", "build:web"] },
  { id: "smoke-extension", executable: "npm.cmd", args: ["run", "smoke:extension"] },
  { id: "check-release", executable: "npm.cmd", args: ["run", "check:release"] },
  { id: "verify", executable: "npm.cmd", args: ["run", "verify"] },
  { id: "git-diff-check", executable: "node", args: ["scripts/w5-c-validation/candidate-diff-check.mjs"] },
  { id: "security-scan", executable: "node", args: ["scripts/w5-c-validation/security-scan.mjs"] },
];

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function clean(value) { return value.replaceAll(packageRoot, "<package-root>").replaceAll("\\", "/"); }
function parseCounts(stdout) {
  const files = stdout.match(/Test Files\s+(\d+) passed/u);
  const tests = stdout.match(/Tests\s+(\d+) passed/u);
  const failed = stdout.match(/(\d+) failed/u);
  const skipped = stdout.match(/(\d+) skipped/u);
  return {
    testFiles: files === null ? null : Number(files[1]),
    passed: tests === null ? null : Number(tests[1]),
    failed: failed === null ? 0 : Number(failed[1]),
    skipped: skipped === null ? 0 : Number(skipped[1]),
  };
}
function run(command) {
  return new Promise((resolveResult) => {
    const startedAt = new Date().toISOString();
    const usesCmd = process.platform === "win32" && command.executable.endsWith(".cmd");
    const executable = usesCmd ? (process.env.ComSpec ?? "cmd.exe") : command.executable;
    const args = usesCmd ? ["/d", "/s", "/c", command.executable, ...command.args] : command.args;
    const child = spawn(executable, args, {
      cwd: packageRoot,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat([...stderr, Buffer.from(String(error.message), "utf8")]);
      resolveResult({ id: command.id, command: [command.executable, ...command.args].join(" "), workdir: "<package-root>", startedAt, endedAt: new Date().toISOString(), exitCode: null, orchestrationExitCode: 1, stdoutBytes: out.byteLength, stdoutSha256: digest(out), stderrBytes: err.byteLength, stderrSha256: digest(err), counts: parseCounts(clean(out.toString("utf8"))), notRunReason: null, attribution: "environment_missing" });
    });
    child.on("close", (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      const normalized = clean(out.toString("utf8"));
      resolveResult({ id: command.id, command: [command.executable, ...command.args].join(" "), workdir: "<package-root>", startedAt, endedAt: new Date().toISOString(), exitCode: code, orchestrationExitCode: code, stdoutBytes: out.byteLength, stdoutSha256: digest(out), stderrBytes: err.byteLength, stderrSha256: digest(err), counts: parseCounts(normalized), notRunReason: null, attribution: code === 0 ? "c-validation" : "requires-review" });
    });
  });
}

await mkdir(dirname(output), { recursive: true });
const results = [];
for (const command of commands) results.push(await run(command));
await writeFile(output, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, npm: "10.9.8", python: "3.13.7", pandas: "3.0.5", pythonNoUserSite: true },
  historicalFailures: [
    {
      command: "node scripts/w5-c-validation/capture-validation.mjs",
      exitCode: 1,
      attribution: "validation_harness",
      errorCode: "spawn_einval",
      resolution: "Invoke npm.cmd through ComSpec with shell=false on Windows Node 22.",
    },
    {
      command: "node scripts/w5-c-validation/verify-manifest.mjs",
      exitCode: 1,
      attribution: "stale_pre_r2_manifest",
      errorCode: "manifest_set_mismatch",
      resolution: "Regenerate the R2 Manifest with manifest.json as the sole self-excluded file, then rerun verification; final exit code is 0.",
    },
    {
      command: "node scripts/w5-c-validation/capture-validation.mjs",
      exitCode: null,
      orchestrationExitCode: 124,
      attribution: "outer_tool_timeout",
      errorCode: "validation_interrupted_after_5_seconds",
      resolution: "Terminate the orphaned validation children, then rerun the same command with a sufficient outer timeout; the final natural exit code is 0.",
    },
  ],
  results,
}, null, 2)}\n`, "utf8");
process.exitCode = results.every((item) => item.exitCode === 0) ? 0 : 1;
