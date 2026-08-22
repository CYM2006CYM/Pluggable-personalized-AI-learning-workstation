import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";

const appRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(appRoot, "..");
const pythonExecutable = process.env.W5_A_D4_PYTHON;
if (pythonExecutable === undefined) throw new Error("W5_A_D4_PYTHON is required");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const baseEnvironment = {
  ...process.env,
  PATH: `${dirname(pythonExecutable)};${dirname(process.execPath)};${process.env.PATH ?? ""}`,
  PI_PYTHON_EXECUTABLE: pythonExecutable,
  W5_C_D3_PYTHON: pythonExecutable,
  PYTHONNOUSERSITE: "1",
};

function redact(value) {
  return value
    .replaceAll(workspaceRoot.replaceAll("\\", "/"), "<WORKSPACE>")
    .replaceAll(workspaceRoot, "<WORKSPACE>")
    .replaceAll((process.env.USERPROFILE ?? "<USERPROFILE>").replaceAll("\\", "/"), "<USERPROFILE>")
    .replaceAll(process.env.USERPROFILE ?? "<USERPROFILE>", "<USERPROFILE>");
}

function summary(bytes) {
  const text = redact(bytes.toString("utf8")).trim();
  return text.length <= 1800 ? text : `${text.slice(0, 900)}\n...<TRUNCATED>...\n${text.slice(-900)}`;
}

function run(id, command, executable, args, extraEnvironment = {}) {
  return new Promise((done) => {
    const startedAt = new Date().toISOString();
    const child = spawn(executable, args, {
      cwd: appRoot,
      shell: false,
      windowsHide: true,
      env: { ...baseEnvironment, ...extraEnvironment },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => stderr.push(Buffer.from(error.message, "utf8")));
    child.on("close", (exitCode) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      done({
        id,
        command,
        workingDirectory: "pi-study-helper",
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode,
        stdout: { bytes: out.byteLength, sha256: digest(out), summary: summary(out) },
        stderr: { bytes: err.byteLength, sha256: digest(err), summary: summary(err) },
      });
    });
  });
}

const node = process.execPath;
const commands = [];
for (const [id, args] of [
  ["typecheck-main", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["typecheck-tests", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"]],
  ["typecheck-web", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.web.json"]],
]) commands.push(await run(id, `node ${args.join(" ")}`, node, args));

const targeted = [
  "tests/w5-a-d4-cross-end.test.ts",
  "tests/w5-a-d4-showcase-paths.test.ts",
  "tests/shared-session.test.ts",
  "tests/shared-web-extension-entry.test.ts",
  "tests/web/real-api.test.ts",
  "tests/w5-formal-bundle-revision-binding.test.ts",
];
commands.push(await run(
  "targeted-cross-role",
  "vitest run <6 A/cross-role files> --maxWorkers=1",
  node,
  ["node_modules/vitest/vitest.mjs", "run", ...targeted, "--maxWorkers=1", "--reporter=verbose"],
  { W5_A_D4_EVIDENCE_DIR: import.meta.dirname },
));
commands.push(await run("full-test", "vitest run --maxWorkers=1", node, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1"]));
commands.push(await run("check-docs", "node scripts/check-doc-links.mjs", node, ["scripts/check-doc-links.mjs"]));
commands.push(await run("build-web", "vite build", node, ["node_modules/vite/bin/vite.js", "build"]));
commands.push(await run("smoke-extension", "node scripts/smoke-extension.mjs", node, ["scripts/smoke-extension.mjs"]));
commands.push(await run("check-release", "node scripts/check-release.mjs", node, ["scripts/check-release.mjs"]));

const failed = commands.filter((item) => item.exitCode !== 0);
const result = {
  schemaVersion: 2,
  candidate: "W5-D4-A-R2-OWNER-RECTIFIED",
  baseHead: "a0d5a37116a6c67f009ca19e313501d9eed96f78",
  capturedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    npm: "10.9.8",
    python: "3.13.7",
    pandas: "3.0.5",
    pythonExecutable: "<CONTRACT_PYTHON_EXECUTABLE>",
    pythonNoUserSite: "1",
  },
  contractEnvironmentMatch: process.version === "v22.23.1",
  status: failed.length === 0 ? "PASS" : "FAIL",
  commands,
  historicalFailures: [
    {
      source: "A-R1",
      status: "NON_CONTRACT_ENVIRONMENT",
      result: "95/102 files passed; 806 passed / 30 failed / 1 skipped",
      environment: "Node 24.18.0 / npm 11.16.0 / Python 3.11.9 / Pandas unavailable",
    },
    {
      source: "owner-remediation-r1",
      status: "COMMAND_ERROR_NOT_A_TEST_RESULT",
      result: "npm wrapper did not expose project tsc on PATH",
    },
  ],
};
await writeFile(resolve(import.meta.dirname, "command-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: result.status, failed: failed.map((item) => item.id), output: "scripts/w5-a-d4/command-results.json" }, null, 2));
if (failed.length > 0) process.exitCode = 1;
