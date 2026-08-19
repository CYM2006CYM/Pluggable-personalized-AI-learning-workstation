import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "../..");
const profileRoot = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function run(executable, args) {
  const startedAt = new Date().toISOString();
  try {
    const { stdout, stderr } = await execute(executable, args, {
      cwd: packageRoot,
      windowsHide: true,
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
      encoding: "buffer",
    });
    return { startedAt, endedAt: new Date().toISOString(), exitCode: 0, stdoutBytes: stdout.byteLength, stdoutSha256: hash(stdout), stderrBytes: stderr.byteLength, stderrSha256: hash(stderr), stdout: stdout.toString("utf8").trim() };
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.from(String(error.stdout ?? ""));
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr : Buffer.from(String(error.stderr ?? error.message));
    return { startedAt, endedAt: new Date().toISOString(), exitCode: typeof error.code === "number" ? error.code : 1, stdoutBytes: stdout.byteLength, stdoutSha256: hash(stdout), stderrBytes: stderr.byteLength, stderrSha256: hash(stderr), stdout: stdout.toString("utf8").trim() };
  }
}

const python = await run("python", ["-c", [
  "import json, platform, site, sys",
  "import pandas as pd",
  "frame = pd.DataFrame({'value': [1, None, 3]})",
  "cleaned = frame.dropna()",
  "print(json.dumps({'python': platform.python_version(), 'pandas': pd.__version__, 'platform': sys.platform, 'machine': platform.machine().lower(), 'userSiteEnabled': site.ENABLE_USER_SITE, 'minimalPandasRows': len(cleaned)}))",
].join("; ")]);
const parsedPython = python.exitCode === 0 ? JSON.parse(python.stdout) : null;

let pyodide;
try {
  const module = await import("pyodide");
  pyodide = { available: true, version: typeof module.version === "string" ? module.version : null, loadMode: "local_package" };
} catch (error) {
  pyodide = { available: false, version: null, loadMode: "unavailable", errorCode: error?.code === "ERR_MODULE_NOT_FOUND" ? "module_not_found" : "load_failed" };
}

const publicTestRoot = resolve(profileRoot, "assessments/public/tests");
const publicTests = [];
for (const name of (await readdir(publicTestRoot)).sort()) {
  const bytes = await readFile(resolve(publicTestRoot, name));
  publicTests.push({ name, bytes: bytes.byteLength, sha256: hash(bytes) });
}
const datasetPath = resolve(profileRoot, "datasets/public/orders-learning.csv");
const datasetBytes = await readFile(datasetPath);
const lock = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8"));
const evidence = {
  schemaVersion: 1,
  status: pyodide.available ? "PYODIDE_CANDIDATE_PRESENT_UNDECIDED" : "PYODIDE_CANDIDATE_UNAVAILABLE",
  measuredAt: new Date().toISOString(),
  contract: "W5-C1/W5-R1",
  node: { version: process.version, platform: process.platform, arch: process.arch },
  nativePython: parsedPython,
  pythonCommandEvidence: { ...python, stdout: undefined },
  pyodide,
  nativePythonAllowedLibrariesObserved: parsedPython === null ? [] : [{ name: "pandas", version: parsedPython.pandas }],
  publicAssets: {
    dataset: { name: "orders-learning.csv", bytes: datasetBytes.byteLength, sha256: hash(datasetBytes) },
    tests: publicTests,
    totalTestBytes: publicTests.reduce((sum, item) => sum + item.bytes, 0),
  },
  nativePythonSanityCheck: { status: parsedPython?.minimalPandasRows === 2 ? "PASS" : "BLOCKED", expectedRows: 2, actualRows: parsedPython?.minimalPandasRows ?? null },
  pyodideMinimalPandasTask: {
    status: "NOT_RUN",
    reason: pyodide.available ? "PYODIDE_RUNTIME_NOT_EXECUTED_DURING_D1_SERVER_PROBE" : "PYODIDE_CANDIDATE_UNAVAILABLE",
  },
  formalNodeLockReference: { environmentId: lock.environmentId, environmentHash: lock.environmentHash, status: lock.status },
  capabilityClaims: { processTreeTermination: "inherited_node_evidence_only", networkIsolation: false, reliableMemoryLimit: false },
  decisions: { pyodideEnabled: null, ownerDecisionRequired: true, environmentLockModifiedByC: false },
};
await writeFile(resolve(import.meta.dirname, "environment-prototype.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
if (python.exitCode !== 0 || evidence.nativePythonSanityCheck.status !== "PASS") process.exitCode = 1;
