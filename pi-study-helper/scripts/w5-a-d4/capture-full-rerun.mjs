import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const appRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(appRoot, "..");
const pythonExecutable = process.env.W5_A_D4_PYTHON;
if (pythonExecutable === undefined) throw new Error("W5_A_D4_PYTHON is required");
const digest = (value) => createHash("sha256").update(value).digest("hex");

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

const startedAt = new Date().toISOString();
const command = await new Promise((done) => {
  const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1"], {
    cwd: appRoot,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: `${dirname(pythonExecutable)};${dirname(process.execPath)};${process.env.PATH ?? ""}`,
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
      id: "full-test-portability-final",
      command: "vitest run --maxWorkers=1",
      workingDirectory: "pi-study-helper",
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode,
      stdout: { bytes: out.byteLength, sha256: digest(out), summary: summary(out) },
      stderr: { bytes: err.byteLength, sha256: digest(err), summary: summary(err) },
    });
  });
});

const outputPath = resolve(import.meta.dirname, "command-results.json");
const previous = JSON.parse(await readFile(outputPath, "utf8"));
previous.commands.push(command);
if (!previous.historicalFailures.some((item) => item.source === "owner-remediation-full-r1")) previous.historicalFailures.push({
  source: "owner-remediation-full-r1",
  status: "FLAKY_EVALUATOR_TIMEOUT",
  result: "103/104 files passed; 844 passed / 1 failed / 1 skipped",
  detail: "One third repeat in the revision 3 formal evaluation consistency test exceeded wallClockMs=4000; the preceding targeted 15 formal runs passed.",
});
if (!previous.historicalFailures.some((item) => item.source === "owner-manifest-portability-r1")) previous.historicalFailures.push({
  source: "owner-manifest-portability-r1",
  status: "STALE_MANIFEST_BEFORE_RERUN",
  result: "104/105 files passed; 845 passed / 1 failed / 1 skipped",
  detail: "The new CRLF portability test correctly rejected capture-full-rerun.mjs because that script changed after the previous Manifest generation. The Manifest is regenerated before the final full rerun.",
});
previous.capturedAt = new Date().toISOString();
previous.status = command.exitCode === 0
  && previous.commands.filter((item) => !item.id.startsWith("full-test")).every((item) => item.exitCode === 0)
  ? "PASS"
  : "FAIL";
previous.currentConclusion = {
  finalPortabilityFullRerunExitCode: command.exitCode,
  historicalFailuresRetained: true,
  requiredCommandIds: [
    "typecheck-main", "typecheck-tests", "typecheck-web", "targeted-cross-role",
    "full-test-rerun", "full-test-portability-final", "check-docs", "build-web", "smoke-extension", "check-release"
  ]
};
await writeFile(outputPath, `${JSON.stringify(previous, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: previous.status, rerunExitCode: command.exitCode }, null, 2));
if (previous.status !== "PASS") process.exitCode = 1;
