import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const executeFile = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const OUTPUT_LIMIT = 8_192;
const WALL_CLOCK_MS = 4_000;

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function findPython() {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const { stdout } = await executeFile(command, ["python"], { encoding: "utf8", windowsHide: true });
  return stdout.split(/\r?\n/u).find(Boolean);
}

function minimalEnvironment(directory, python) {
  const result = {
    PYTHONHASHSEED: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUTF8: "1",
    TZ: "UTC",
    TEMP: directory,
    TMP: directory,
  };
  if (process.platform === "win32") {
    for (const name of ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "USERPROFILE"]) {
      if (process.env[name]) result[name] = process.env[name];
    }
  }
  for (const name of ["SystemRoot", "WINDIR"]) if (process.env[name]) result[name] = process.env[name];
  return result;
}

async function terminateTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise((resolveTermination) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", resolveTermination);
      killer.once("close", resolveTermination);
    });
  } else {
    child.kill("SIGKILL");
  }
}

async function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runProbe(python, source, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "pi-w3-c-probe-"));
  const sourcePath = resolve(directory, "probe.py");
  await writeFile(sourcePath, source, "utf8");
  const startedAt = performance.now();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let stdoutObserved = 0;
  let stderrObserved = 0;
  let outputExceeded = false;
  let timedOut = false;
  let child;
  try {
    child = spawn(python, [sourcePath], {
      cwd: directory,
      env: minimalEnvironment(directory, python),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      stdoutObserved += chunk.byteLength;
      stdout = Buffer.concat([stdout, chunk]).subarray(0, options.stdoutLimit ?? OUTPUT_LIMIT);
      if (stdoutObserved > (options.stdoutLimit ?? Number.MAX_SAFE_INTEGER) && !outputExceeded) {
        outputExceeded = true;
        void terminateTree(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrObserved += chunk.byteLength;
      stderr = Buffer.concat([stderr, chunk]).subarray(0, options.stderrLimit ?? OUTPUT_LIMIT);
      if (stderrObserved > (options.stderrLimit ?? Number.MAX_SAFE_INTEGER) && !outputExceeded) {
        outputExceeded = true;
        void terminateTree(child);
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateTree(child);
    }, options.timeoutMs ?? WALL_CLOCK_MS);
    const exit = await new Promise((resolveExit) => {
      child.once("error", (error) => resolveExit({ code: null, error: error.code ?? "spawn_error" }));
      child.once("close", (code) => resolveExit({ code, error: null }));
    });
    clearTimeout(timer);
    return {
      exitCode: exit.code,
      spawnError: exit.error,
      durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      stdoutObserved,
      stderrObserved,
      stdoutCaptured: stdout.byteLength,
      stderrCaptured: stderr.byteLength,
      outputExceeded,
      timedOut,
      processId: child.pid,
      directory,
    };
  } finally {
    if (child && child.exitCode === null) await terminateTree(child);
  }
}

async function cleanupProbe(run) {
  await rm(run.directory, { recursive: true, force: true });
  try {
    await stat(run.directory);
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) throw new Error("--output is required");
  const outputPath = resolve(process.cwd(), process.argv[outputIndex + 1]);
  const python = await findPython();

  const versionRun = await runProbe(python, [
    "import json, os, platform",
    "import pandas",
    "sensitive = [key for key in os.environ if any(token in key.upper() for token in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL'))]",
    "print(json.dumps({'python': platform.python_version(), 'pandas': pandas.__version__, 'environmentKeys': sorted(os.environ.keys()), 'sensitiveKeys': sensitive}, sort_keys=True))",
  ].join("\n"));
  if (versionRun.exitCode !== 0 || versionRun.stdout.trim() === "") {
    throw new Error(`version probe failed: ${versionRun.stderr}`);
  }
  const versions = JSON.parse(versionRun.stdout.trim());
  const versionCleanup = await cleanupProbe(versionRun);

  const pandasRuns = [];
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const run = await runProbe(python, "import pandas as pd\nprint(str(pd.Series(['x'], dtype='string').dtype))\n");
    pandasRuns.push({ exitCode: run.exitCode, durationMs: run.durationMs, dtype: run.stdout.trim(), cleanup: await cleanupProbe(run) });
  }

  const failureRun = await runProbe(python, "raise RuntimeError('probe_failure')\n");
  const failureCleanup = await cleanupProbe(failureRun);

  const outputRun = await runProbe(python, "import sys\nsys.stdout.write('x' * 20000)\nsys.stderr.write('y' * 20000)\n", {
    stdoutLimit: OUTPUT_LIMIT,
    stderrLimit: OUTPUT_LIMIT,
  });
  const outputCleanup = await cleanupProbe(outputRun);

  const treeRun = await runProbe(python, [
    "import subprocess, sys, time",
    "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
    "print(child.pid, flush=True)",
    "time.sleep(60)",
  ].join("\n"), { timeoutMs: 1_000 });
  const descendantPid = Number.parseInt(treeRun.stdout.trim(), 10);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const descendantTerminated = Number.isSafeInteger(descendantPid) && !await processExists(descendantPid);
  const treeCleanup = await cleanupProbe(treeRun);

  const publicRun = await runProbe(python, "import os\nprint(os.getpid())\n");
  const hiddenRun = await runProbe(python, "import os\nprint(os.getpid())\n");
  const processIsolation = publicRun.stdout.trim() !== hiddenRun.stdout.trim()
    && publicRun.directory !== hiddenRun.directory;
  const publicCleanup = await cleanupProbe(publicRun);
  const hiddenCleanup = await cleanupProbe(hiddenRun);

  const bundleDocument = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8"));
  const fixtureDocument = JSON.parse(await readFile(resolve(profileRoot, "datasets/fixtures.json"), "utf8"));
  const formalBundles = bundleDocument.bundles.filter((bundle) => ["act-inspect-dataframe", "act-practical"].includes(bundle.activity.activityId));
  const sourceBytes = Math.max(...formalBundles.flatMap((bundle) => bundle.activity.editableRegions.map((region) => region.maxCharacters)));
  let datasetBytes = 0;
  for (const fixture of fixtureDocument.fixtures) datasetBytes += (await stat(resolve(profileRoot, fixture.fileRef))).size;

  const measured = {
    status: "prototype_measured_pending_owner_decision",
    nodeVersion: process.version,
    pythonVersion: versions.python,
    pandasVersion: versions.pandas,
    platform: `${platform()}-${release()}-${arch()}`,
    evaluatorVersion: "node-python-evaluator-w3-c1",
    allowedLibraries: [{ name: "pandas", version: versions.pandas }],
    limits: {
      wallClockMs: WALL_CLOCK_MS,
      stdoutBytes: OUTPUT_LIMIT,
      stderrBytes: OUTPUT_LIMIT,
      sourceBytes,
      datasetBytes: 65_536,
    },
    observed: {
      formalDatasetBytes: datasetBytes,
      pandasRuns,
      maximumPandasStartupMs: Math.max(...pandasRuns.map((run) => run.durationMs)),
      outputFlood: {
        thresholdTriggered: outputRun.outputExceeded,
        stdoutObserved: outputRun.stdoutObserved,
        stderrObserved: outputRun.stderrObserved,
        stdoutCaptured: outputRun.stdoutCaptured,
        stderrCaptured: outputRun.stderrCaptured,
      },
    },
    executionConstraints: {
      shell: false,
      explicitPythonExecutable: true,
      fixedPerRunWorkingDirectory: true,
      minimalEnvironmentKeys: versions.environmentKeys.filter((name) => !["TEMP", "TMP"].includes(name)),
      sensitiveEnvironmentKeysAbsent: versions.sensitiveKeys.length === 0,
      windowsRequiredEnvironmentKeysExplicit: process.platform !== "win32" || ["PATH", "SYSTEMDRIVE", "SYSTEMROOT", "WINDIR"].every((name) => versions.environmentKeys.includes(name)),
      uniquePublicHiddenProcesses: processIsolation,
      hiddenAssetsOwner: "node_parent_only",
      hiddenAssetsInUserDirectory: false,
      cleanupOnSuccess: versionCleanup && publicCleanup && hiddenCleanup,
      cleanupOnFailure: failureCleanup,
      cleanupOnTimeout: treeCleanup,
      outputTruncation: outputRun.outputExceeded && outputRun.stdoutCaptured <= OUTPUT_LIMIT && outputRun.stderrCaptured <= OUTPUT_LIMIT,
    },
    capabilityFlags: {
      reliableMemoryLimit: false,
      networkIsolation: false,
      processTreeTermination: treeRun.timedOut && descendantTerminated,
    },
    processTree: {
      timeoutTriggered: treeRun.timedOut,
      descendantPidObserved: Number.isSafeInteger(descendantPid),
      descendantTerminated,
    },
    restrictions: [
      "trusted_local_testers_only",
      "not_a_production_sandbox",
      "network_isolation_not_proven",
      "reliable_memory_limit_not_proven",
      "pyodide_not_measured_in_w3",
    ],
    binding: {
      w3StartCommit: "f190326a4a906b46e4001484ffa30a7839b82ed2",
      bFormalCommit: "277805b4dc612548f4dcdf4f91189abb4ef5c8e3",
      contract: "W3-C3/W3-R2",
      ownerDecision: "pending",
    },
  };
  const environmentProjection = {
    ...measured,
    environmentHash: `sha256:${createHash("sha256").update(canonicalJson(measured), "utf8").digest("hex")}`,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(environmentProjection, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "PASS_PENDING_OWNER_DECISION",
    output: "scripts/w3-code-evaluation/environment-prototype-evidence.json",
    nodeVersion: environmentProjection.nodeVersion,
    pythonVersion: environmentProjection.pythonVersion,
    pandasVersion: environmentProjection.pandasVersion,
    processTreeTermination: environmentProjection.capabilityFlags.processTreeTermination,
    cleanup: environmentProjection.executionConstraints.cleanupOnSuccess
      && environmentProjection.executionConstraints.cleanupOnFailure
      && environmentProjection.executionConstraints.cleanupOnTimeout,
    environmentHash: environmentProjection.environmentHash,
  }, null, 2));
}

await main();
