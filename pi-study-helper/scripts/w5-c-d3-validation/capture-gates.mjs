import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const outputPath = resolve(import.meta.dirname, "test-command-results.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value)
  .replaceAll("\\", "/")
  .replaceAll(packageRoot.replaceAll("\\", "/"), "<package-root>")
  .replace(/[A-Za-z]:\/[^\s"']+/gu, "<host-path>");
const commands = [
  ["c-d3-targeted", "npm.cmd", ["test", "--", "--run", "tests/w5-c-d3-node-public-inputs.test.ts", "--maxWorkers=1"]],
  ["w5-public-and-python", "npm.cmd", ["test", "--", "--run", "tests/w5-c-d1-public-run.test.ts", "tests/w5-formal-bundle-revision-binding.test.ts", "tests/python-process-evaluation.test.ts", "tests/python-process-evaluation-r2.test.ts", "tests/python-process-environment-compatibility.test.ts", "--maxWorkers=1"]],
  ["affected-adapter-http-fault-recovery", "npm.cmd", ["test", "--", "--run", "tests/activity-runtime-service.test.ts", "tests/file-activity-repository.test.ts", "tests/file-learning-session-repository.test.ts", "tests/w4-c-d3-http.test.ts", "--maxWorkers=1"]],
  ["typecheck", "npm.cmd", ["run", "typecheck"]],
  ["build-demo", "npm.cmd", ["run", "build:demo"]],
  ["build-web", "npm.cmd", ["run", "build:web"]],
  ["check-docs", "npm.cmd", ["run", "check:docs"]],
  ["smoke-extension", "npm.cmd", ["run", "smoke:extension"]],
  ["check-release", "npm.cmd", ["run", "check:release"]],
  ["git-diff-check", "git", ["diff", "--check"]],
];
const contractPath = process.env.W5_C_D3_PYTHON
  ? `${dirname(process.env.W5_C_D3_PYTHON)};${process.env.PATH ?? ""}`
  : process.env.PATH;

function run([id, executable, args]) {
  const startedAt = new Date().toISOString();
  return new Promise((done) => {
    const useCmd = process.platform === "win32" && executable.endsWith(".cmd");
    const child = spawn(useCmd ? (process.env.ComSpec ?? "cmd.exe") : executable, useCmd ? ["/d", "/s", "/c", executable, ...args] : args, {
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
    child.on("error", (error) => done({ id, command: [executable, ...args].join(" "), startedAt, endedAt: new Date().toISOString(), exitCode: null, stdoutBytes: 0, stderrBytes: Buffer.byteLength(String(error.message)), stdoutSha256: digest(""), stderrSha256: digest(String(error.message)), stdoutSummary: "", stderrSummary: String(error.message).slice(0, 500), classification: "environment_missing" }));
    child.on("close", (exitCode) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      const text = clean(out.toString("utf8"));
      const passed = text.match(/Tests\s+(\d+) passed/u);
      const failed = text.match(/(\d+) failed/u);
      done({ id, command: [executable, ...args].join(" "), startedAt, endedAt: new Date().toISOString(), exitCode, stdoutBytes: out.byteLength, stderrBytes: err.byteLength, stdoutSha256: digest(out), stderrSha256: digest(err), stdoutSummary: text.trim().slice(0, 900), stderrSummary: clean(err.toString("utf8")).trim().slice(0, 900), counts: { passed: passed ? Number(passed[1]) : null, failed: failed ? Number(failed[1]) : exitCode === 0 ? 0 : null }, classification: exitCode === 0 ? "contract-gate" : "requires-review" });
    });
  });
}

const results = [];
for (const command of commands) results.push(await run(command));
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, contract: "W5-C1/W5-R1", baselineCommit: "383690831a8b3de42dad58795e71f218678f6fbc", generatedAt: new Date().toISOString(), environment: { pyodideEnabled: false, liveModel: "LIVE_NOT_RUN", pythonNoUserSite: true }, results, status: results.every((item) => item.exitCode === 0) ? "PASS" : "BLOCKED" }, null, 2)}\n`, "utf8");
process.exitCode = results.every((item) => item.exitCode === 0) ? 0 : 1;
