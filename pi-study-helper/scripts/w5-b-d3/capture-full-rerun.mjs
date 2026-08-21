import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const appRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(appRoot, "..");
const outputPath = resolve(import.meta.dirname, "command-results.json");
const npmDirectory = dirname(process.execPath);
const npmCommand = resolve(npmDirectory, "npm.cmd");
const programFiles = process.env.ProgramFiles;
if (programFiles === undefined) throw new Error("ProgramFiles is required");
const npmNodeModules = resolve(programFiles, "nodejs/node_modules/npm/node_modules");
const pythonExecutable = process.env.W5_B_D3_PYTHON;
if (pythonExecutable === undefined) throw new Error("W5_B_D3_PYTHON is required");
const digest = (value) => createHash("sha256").update(value).digest("hex");

function redact(value) {
  return value
    .replaceAll(workspaceRoot.replaceAll("\\", "/"), "<WORKSPACE>")
    .replaceAll(workspaceRoot, "<WORKSPACE>")
    .replaceAll((process.env.USERPROFILE ?? "<NO_USERPROFILE>").replaceAll("\\", "/"), "<USERPROFILE>")
    .replaceAll(process.env.USERPROFILE ?? "<NO_USERPROFILE>", "<USERPROFILE>");
}

function summary(bytes) {
  const text = redact(bytes.toString("utf8")).trim();
  if (text.length <= 1600) return text;
  return `${text.slice(0, 800)}\n...<TRUNCATED>...\n${text.slice(-800)}`;
}

const startedAt = new Date().toISOString();
const command = await new Promise((done) => {
  const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", npmCommand, "run", "verify"], {
    cwd: appRoot,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${dirname(pythonExecutable)};${npmDirectory};${process.env.PATH ?? ""}`,
      NODE_PATH: npmNodeModules,
      PI_PYTHON_EXECUTABLE: pythonExecutable,
      W5_C_D3_PYTHON: pythonExecutable,
      PYTHONNOUSERSITE: "1",
    },
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
      id: "full-verify-contract-python-rerun",
      command: "npm.cmd run verify",
      workingDirectory: "pi-study-helper",
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode,
      environment: { nodeVersion: process.version, npmVersion: "10.9.8", pythonVersion: "3.13.7", pandasVersion: "3.0.5", pythonExecutable: "<CONTRACT_PYTHON_EXECUTABLE>", pythonNoUserSite: true },
      stdout: { bytes: out.byteLength, sha256: digest(out), summary: summary(out) },
      stderr: { bytes: err.byteLength, sha256: digest(err), summary: summary(err) },
    });
  });
});

const previous = JSON.parse(await readFile(outputPath, "utf8"));
previous.commands.push(command);
previous.historicalFailures.push({
  id: "capture-r3-broken-python-runtime",
  classification: "ENVIRONMENT_MISMATCH",
  command: "npm.cmd run verify",
  result: "40_TEST_FAILURES_NOT_ATTRIBUTED_TO_B_ASSETS",
  reason: "The first discovered Python 3.13.7 virtual environment had lost its standard-library encoding sources and could not initialize reliably. The rerun uses a separate existing contract Python 3.13.7/Pandas 3.0.5 runtime.",
});
const requiredPasses = ["b-contract-verifier", "b-targeted", "typecheck", "check-docs", "build-web", "smoke-extension", "check-release"];
const requiredPassed = requiredPasses.every((id) => previous.commands.some((item) => item.id === id && item.exitCode === 0));
previous.generatedAt = new Date().toISOString();
previous.status = requiredPassed && command.exitCode === 0 ? "PASS" : "FAIL";
previous.currentConclusion = {
  requiredCommandIds: [...requiredPasses, command.id],
  historicalFailedCommandsRetained: true,
  finalRerunExitCode: command.exitCode,
};
await writeFile(outputPath, `${JSON.stringify(previous, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: previous.status, rerunExitCode: command.exitCode, output: "scripts/w5-b-d3/command-results.json" }, null, 2));
if (previous.status !== "PASS") process.exitCode = 1;
