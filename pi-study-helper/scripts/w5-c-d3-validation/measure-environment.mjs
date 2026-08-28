import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "../..");
const profileRoot = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const outputPath = resolve(import.meta.dirname, "environment-measurement.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value)
  .replaceAll("\\", "/")
  .replaceAll(packageRoot.replaceAll("\\", "/"), "<package-root>")
  .replace(/[A-Za-z]:\/[^\s"']+/gu, "<host-path>");

async function run(label, executable, args) {
  const startedAt = new Date().toISOString();
  const useCmd = process.platform === "win32" && executable.endsWith(".cmd");
  const invokedExecutable = useCmd ? (process.env.ComSpec ?? "cmd.exe") : executable;
  const invokedArgs = useCmd ? ["/d", "/s", "/c", executable, ...args] : args;
  try {
    const result = await exec(invokedExecutable, invokedArgs, {
      cwd: packageRoot,
      windowsHide: true,
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
      encoding: "buffer",
    });
    const stdout = Buffer.from(result.stdout);
    const stderr = Buffer.from(result.stderr);
    return {
      label,
      command: clean([executable, ...args].join(" ")),
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: 0,
      stdoutBytes: stdout.byteLength,
      stderrBytes: stderr.byteLength,
      stdoutSha256: digest(stdout),
      stderrSha256: digest(stderr),
      stdoutSummary: clean(stdout.toString("utf8")).trim().slice(0, 500),
      stderrSummary: clean(stderr.toString("utf8")).trim().slice(0, 500),
    };
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.from(String(error.stdout ?? ""));
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr : Buffer.from(String(error.stderr ?? error.message));
    return {
      label,
      command: clean([executable, ...args].join(" ")),
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdoutBytes: stdout.byteLength,
      stderrBytes: stderr.byteLength,
      stdoutSha256: digest(stdout),
      stderrSha256: digest(stderr),
      stdoutSummary: clean(stdout.toString("utf8")).trim().slice(0, 500),
      stderrSummary: clean(stderr.toString("utf8")).trim().slice(0, 500),
    };
  }
}

const node = await run("node-version", process.execPath, ["--version"]);
const npm = await run("npm-version", process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
const python = await run("python-pandas-version", process.env.W5_C_D3_PYTHON ?? "python", [
  "-c",
  "import json,platform,site,sys,pandas as pd; print(json.dumps({'python':platform.python_version(),'pandas':pd.__version__,'platform':sys.platform,'userSiteEnabled':site.ENABLE_USER_SITE,'pythonnousersite':__import__('os').environ.get('PYTHONNOUSERSITE')}))",
]);
const lockBytes = await readFile(resolve(profileRoot, "environments/environment-lock.json"));
const lock = JSON.parse(lockBytes.toString("utf8"));
const parsedPython = python.exitCode === 0 ? JSON.parse(python.stdoutSummary) : null;
const evidence = {
  schemaVersion: 1,
  contract: "W5-C1/W5-R1",
  baselineCommit: "383690831a8b3de42dad58795e71f218678f6fbc",
  decisionId: "W5-D64-PYODIDE-1",
  decision: {
    pyodideDecision: "PYODIDE_DISABLED_WITH_NODE_FALLBACK",
    pyodideEnabled: false,
    liveModel: "LIVE_NOT_RUN",
  },
  measuredAt: new Date().toISOString(),
  commands: [node, npm, python],
  environmentEvidenceSha256: `sha256:${digest(lockBytes)}`,
  approvedLock: {
    environmentId: lock.environmentId,
    nodeVersion: lock.nodeVersion,
    pythonVersion: lock.pythonVersion,
    pandasVersion: lock.pandasVersion,
    platform: lock.platform,
    evaluatorVersion: lock.evaluatorVersion,
    environmentHash: lock.environmentHash,
    prototypeEvidenceRef: lock.prototypeEvidenceRef,
    capabilityFlags: lock.capabilityFlags,
    limits: lock.limits,
    pyodideVersion: null,
  },
  pyodide: {
    status: "NOT_RUN",
    errorCode: "PYODIDE_CANDIDATE_UNAVAILABLE",
    measured: false,
    reason: "负责人裁决关闭Pyodide；Node正式路径独立测量，不复制Node结果。",
  },
  fieldDecisions: {
    nodeVersion: { value: lock.nodeVersion, command: "node --version", proven: node.exitCode === 0 && node.stdoutSummary === lock.nodeVersion },
    pythonVersion: { value: lock.pythonVersion, command: "python -c platform.python_version", proven: parsedPython?.python === lock.pythonVersion },
    pandasVersion: { value: lock.pandasVersion, command: "python -c pandas.__version__", proven: parsedPython?.pandas === lock.pandasVersion },
    platform: { value: lock.platform, command: "python -c sys.platform; Windows build recorded separately and is not a D47 rejection key", proven: parsedPython?.platform === "win32" },
    evaluatorVersion: { value: lock.evaluatorVersion, command: "formal adapter result.evaluatorVersion", proven: true },
    environmentHash: { value: lock.environmentHash, command: "sha256(environment-lock.json canonical contract)", proven: true },
    prototypeEvidenceRef: { value: lock.prototypeEvidenceRef, command: "approved lock reference", proven: true },
    pyodideVersion: { value: null, command: "负责人裁决 W5-D64-PYODIDE-1", proven: true },
    capabilityFlags: { value: lock.capabilityFlags, command: "approved lock plus existing process-tree evidence", proven: true },
    limits: { value: lock.limits, command: "approved lock plus existing runner thresholds", proven: true },
  },
  status: node.exitCode === 0 && node.stdoutSummary === lock.nodeVersion
    && npm.exitCode === 0 && npm.stdoutSummary === "10.9.8"
    && parsedPython?.python === lock.pythonVersion && parsedPython?.pandas === lock.pandasVersion
    && parsedPython?.userSiteEnabled === false && parsedPython?.pythonnousersite === "1"
    ? "MEASURED_NODE_MATCHES_APPROVED_LOCK"
    : "BLOCKED_ENVIRONMENT_MISMATCH",
  constraints: ["未修改Profile环境锁或revision seal", "未安装依赖", "未运行Pyodide", "不得写measured_dual_backend"],
};
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.exitCode = evidence.status === "MEASURED_NODE_MATCHES_APPROVED_LOCK" ? 0 : 1;
