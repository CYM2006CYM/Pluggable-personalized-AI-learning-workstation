import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PythonProcessCodeEvaluationAdapter } from "../src/infrastructure/python-process-evaluation-adapter.js";

const projectRoot = resolve(import.meta.dirname, "..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const outputPath = process.env.W5_C_D3_PROCESS_TREE_OUTPUT;

function pythonExecutable(): string {
  if (process.env.PI_PYTHON_EXECUTABLE) return process.env.PI_PYTHON_EXECUTABLE;
  return execFileSync("where.exe", ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python";
}
function processAlive(pid: number): boolean {
  try {
    const output = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    return output.includes(`"${pid}"`);
  } catch { return false; }
}
async function waitForExit(pid: number): Promise<boolean> {
  for (let index = 0; index < 30; index += 1) {
    if (!processAlive(pid)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return !processAlive(pid);
}

describe("W5 D3 C Windows process-tree capability", () => {
  it("kills a PID-observed descendant after the formal timeout", async () => {
    expect(process.platform).toBe("win32");
    const controlRoot = await mkdtemp(resolve(tmpdir(), "w5-d3-process-tree-"));
    const pidPath = resolve(controlRoot, "child.pid");
    let childPid: number | undefined;
    let evidence: Record<string, unknown> | undefined;
    try {
      const runnerPath = resolve(controlRoot, "tree-runner.py");
      await writeFile(runnerPath, [
        "import pathlib, subprocess, sys, time",
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
        "pathlib.Path(__file__).with_name('child.pid').write_text(str(child.pid), encoding='ascii')",
        "while True: time.sleep(1)",
      ].join("\n"), "utf8");
      const activities = JSON.parse(await readFile(resolve(profileRoot, "activities/learning-activities.json"), "utf8"));
      const activity = activities.activities.find((item: any) => item.activityId === "act-practical");
      const bundles = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8"));
      const bundle = bundles.bundles.find((item: any) => item.activity.activityId === "act-practical");
      const environment = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8"));
      const adapter = new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable: pythonExecutable(), runnerScript: runnerPath });
      const prepared = await adapter.prepare({ activity: { activityId: activity.activityId, kind: activity.kind, profileRevision: 3, templateVersion: activity.templateVersion, environmentRef: activity.environmentRef }, profileRevision: 3, taskVersion: activity.templateVersion, mode: "submit", environment: { environmentId: environment.environmentId, status: "measured_node_submit", environmentHash: environment.environmentHash, prototypeEvidenceRef: environment.prototypeEvidenceRef }, assetBundleHash: bundle.assetBundleHash });
      const startedAt = new Date().toISOString();
      const result = await adapter.run({ requestId: "r2-process-tree", attemptId: "r2-process-tree", prepared, code: "def clean_orders(df):\n    return df\n" }, new AbortController().signal);
      childPid = Number((await readFile(pidPath, "ascii")).trim());
      const pidObserved = Number.isSafeInteger(childPid) && childPid > 0;
      const descendantExited = pidObserved && await waitForExit(childPid);
      evidence = {
        schemaVersion: 1,
        contract: "W5-C1/W5-R1",
        startedAt,
        endedAt: new Date().toISOString(),
        platform: process.platform,
        pidObserved,
        childPid,
        terminationMethod: "taskkill.exe /pid <PARENT_PID> /T /F",
        timeoutResult: { executionStatus: result.executionStatus, verdict: result.verdict, errorKind: result.errorKind, errorCode: result.errorCode },
        descendantAliveAfterTermination: !descendantExited,
        processTreeTerminationProved: descendantExited,
        temporaryControlDirectoryRemoved: false,
      };
      expect(result).toMatchObject({ verdict: "fail", errorCode: "timeout" });
      expect(pidObserved).toBe(true);
      expect(descendantExited).toBe(true);
    } finally {
      if (childPid !== undefined && processAlive(childPid)) {
        try { execFileSync("taskkill.exe", ["/PID", String(childPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { /* best-effort cleanup */ }
      }
      await rm(controlRoot, { recursive: true, force: true });
    }
    if (evidence !== undefined && outputPath !== undefined) {
      evidence.temporaryControlDirectoryRemoved = true;
      const resolvedOutput = resolve(outputPath);
      await mkdir(dirname(resolvedOutput), { recursive: true });
      await writeFile(resolvedOutput, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
  }, 30_000);
});
