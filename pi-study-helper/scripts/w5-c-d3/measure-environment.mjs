import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const lockPath = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft/environments/environment-lock.json");
const processEvidencePath = resolve(import.meta.dirname, "process-tree-evidence.json");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const summarize = (bytes, replacement) => replacement ?? bytes.toString("utf8").trim().slice(0, 240);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function execute(id, command, executable, args, options = {}) {
  return new Promise((done) => {
    const startedAt = new Date().toISOString();
    const child = spawn(executable, args, { cwd: packageRoot, shell: false, windowsHide: true, env: { ...process.env, PYTHONNOUSERSITE: "1" } });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => stderr.push(Buffer.from(error.message, "utf8")));
    child.on("close", (exitCode) => {
      const out = Buffer.concat(stdout); const err = Buffer.concat(stderr);
      done({ id, command, startedAt, endedAt: new Date().toISOString(), exitCode, stdout: { bytes: out.byteLength, sha256: digest(out), summary: summarize(out, options.stdoutSummary) }, stderr: { bytes: err.byteLength, sha256: digest(err), summary: summarize(err) } });
    });
  });
}
function observed(id, command, bytes, result, basis) {
  const startedAt = new Date().toISOString();
  return { id, command, startedAt, endedAt: new Date().toISOString(), exitCode: 0, stdout: { bytes: bytes.byteLength, sha256: digest(bytes), summary: "structured local file read" }, stderr: { bytes: 0, sha256: digest(Buffer.alloc(0)), summary: "" }, result, basis };
}

const where = await execute("python-discovery", "where.exe python", "where.exe", ["python"], { stdoutSummary: "<CONTRACT_PYTHON_EXECUTABLE> and alternate PATH entries (redacted)" });
if (where.exitCode !== 0) throw new Error("contract Python discovery failed");
const pythonRaw = await new Promise((done) => {
  const child = spawn("where.exe", ["python"], { shell: false, windowsHide: true }); let out = "";
  child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); }); child.on("close", () => done(out));
});
const pythonExecutable = String(pythonRaw).split(/\r?\n/u).find(Boolean);
if (!pythonExecutable) throw new Error("contract Python path is empty");
const nodeVersion = await execute("nodeVersion", "node --version", process.execPath, ["--version"]);
const npmVersion = await execute("npmVersion", "npm.cmd --version", process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd", "--version"]);
const pythonVersion = await execute("pythonVersion", "<CONTRACT_PYTHON_EXECUTABLE> --version", pythonExecutable, ["--version"]);
const pandasVersion = await execute("pandasVersion", "<CONTRACT_PYTHON_EXECUTABLE> -c <PANDAS_VERSION_PROBE>", pythonExecutable, ["-c", "import pandas; print(pandas.__version__)"]);
const allowedImport = await execute("allowedLibraries", "<CONTRACT_PYTHON_EXECUTABLE> -c <ALLOWED_LIBRARY_SANITY>", pythonExecutable, ["-c", "import json, pandas; print(json.dumps({'pandas': pandas.__version__, 'sanityRows': len(pandas.DataFrame({'x':[1,2]}))}, sort_keys=True))"]);
const platformProbe = await execute("runtimePlatform", "node -e <PLATFORM_PROBE>", process.execPath, ["-e", "const os=require('node:os'); console.log(JSON.stringify({platform:process.platform,arch:process.arch,windowsBuild:os.release()}))"]);

const lockBytes = await readFile(lockPath);
const lock = JSON.parse(lockBytes.toString("utf8"));
const { environmentHash: recordedEnvironmentHash, ...hashInput } = lock;
const recalculatedEnvironmentHash = `sha256:${digest(Buffer.from(canonical(hashInput), "utf8"))}`;
const processEvidenceBytes = await readFile(processEvidencePath);
const processEvidence = JSON.parse(processEvidenceBytes.toString("utf8"));
const measurements = [where, nodeVersion, npmVersion, pythonVersion, pandasVersion, allowedImport, platformProbe,
  observed("environmentLockSha256", "sha256 environments/environment-lock.json", lockBytes, digest(lockBytes), "raw lock bytes"),
  observed("environmentHash", "canonical JSON SHA-256 excluding environmentHash", lockBytes, { recorded: recordedEnvironmentHash, recalculated: recalculatedEnvironmentHash, match: recordedEnvironmentHash === recalculatedEnvironmentHash }, "same canonicalization as formal adapter"),
  observed("evaluatorVersion", "read environment-lock.json#/evaluatorVersion", lockBytes, lock.evaluatorVersion, "formal lock field"),
  observed("prototypeEvidenceRef", "read environment-lock.json#/prototypeEvidenceRef", lockBytes, lock.prototypeEvidenceRef, "formal lock field"),
  observed("limits", "read environment-lock.json#/limits", lockBytes, lock.limits, "formal lock fields; boundary tests are separate evidence"),
  observed("processTreeTermination", "read process-tree-evidence.json#/processTreeTerminationProved", processEvidenceBytes, processEvidence.processTreeTerminationProved, "PID observed and descendant absent after timeout"),
  observed("networkIsolation", "D3 capability review: no isolation proof", Buffer.from("not-proved", "utf8"), false, "unproved capability must remain false"),
  observed("reliableMemoryLimit", "D3 capability review: no reliable memory-limit proof", Buffer.from("not-proved", "utf8"), false, "unproved capability must remain false"),
];
const values = {
  nodeVersion: nodeVersion.stdout.summary,
  npmVersion: npmVersion.stdout.summary,
  pythonVersion: pythonVersion.stdout.summary.replace(/^Python\s+/u, ""),
  pandasVersion: pandasVersion.stdout.summary,
  platform: process.platform,
  arch: process.arch,
  actualWindowsBuild: release(),
  frozenPlatform: lock.platform,
  allowedLibraries: lock.allowedLibraries,
  allowedLibrariesSanity: JSON.parse(allowedImport.stdout.summary),
  evaluatorVersion: lock.evaluatorVersion,
  environmentLockSha256: digest(lockBytes),
  environmentHash: { recorded: recordedEnvironmentHash, recalculated: recalculatedEnvironmentHash },
  prototypeEvidenceRef: lock.prototypeEvidenceRef,
  pyodideVersion: null,
  capabilityFlags: { processTreeTermination: processEvidence.processTreeTerminationProved === true, networkIsolation: false, reliableMemoryLimit: false },
  limits: lock.limits,
};
const expected = { nodeVersion: "v22.23.1", npmVersion: "10.9.8", pythonVersion: "3.13.7", pandasVersion: "3.0.5", environmentLockSha256: "59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43", environmentHash: "sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76" };
const matchesContract = values.nodeVersion === expected.nodeVersion && values.npmVersion === expected.npmVersion && values.pythonVersion === expected.pythonVersion && values.pandasVersion === expected.pandasVersion && values.environmentLockSha256 === expected.environmentLockSha256 && values.environmentHash.recorded === expected.environmentHash && values.environmentHash.recalculated === expected.environmentHash && values.platform === "win32" && values.arch === "x64" && values.allowedLibrariesSanity.pandas === "3.0.5" && values.allowedLibrariesSanity.sanityRows === 2;
await writeFile(resolve(import.meta.dirname, "environment-measurement.json"), `${JSON.stringify({ schemaVersion: 1, contract: "W5-C1/W5-R1", generatedAt: new Date().toISOString(), status: matchesContract ? "PASS" : "ENVIRONMENT_MISMATCH", values, expected, measurements, notes: { windowsBuild: "record-only; frozen platform is not modified", pyodide: "NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE", measuredDualBackend: false } }, null, 2)}\n`, "utf8");
if (!matchesContract) process.exitCode = 1;
