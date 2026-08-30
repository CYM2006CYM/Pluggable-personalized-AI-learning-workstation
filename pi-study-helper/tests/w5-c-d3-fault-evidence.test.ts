import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ActivityResult } from "../src/domain/v2-types.js";
import type { PrepareEvaluationInput } from "../src/infrastructure/code-evaluation-port.js";
import { PythonProcessCodeEvaluationAdapter } from "../src/infrastructure/python-process-evaluation-adapter.js";

const packageRoot = resolve(import.meta.dirname, "..");
const profileRoot = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const outputPath = resolve(packageRoot, "scripts/w5-c-d3-validation/fault-observations.json");
const pythonExecutable = process.env.PI_PYTHON_EXECUTABLE ?? process.env.W5_C_D3_PYTHON ?? (process.platform === "win32"
  ? execFileSync("where.exe", ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python"
  : "python");
const environment = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8"));
const bundles = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8")).bundles;
const records: Array<Record<string, unknown>> = [];
const temporaryRoots: string[] = [];

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function formalInput(activityId = "act-practical"): PrepareEvaluationInput {
  const bundle = bundles.find((item: any) => item.activity.activityId === activityId);
  return {
    activity: {
      activityId,
      kind: bundle.activity.kind,
      profileRevision: 3,
      templateVersion: bundle.activity.templateVersion,
      environmentRef: bundle.environmentRef,
    },
    profileRevision: 3,
    taskVersion: bundle.activity.templateVersion,
    mode: "submit",
    environment: {
      environmentId: environment.environmentId,
      status: "measured_node_submit",
      environmentHash: environment.environmentHash,
      prototypeEvidenceRef: environment.prototypeEvidenceRef,
    },
    assetBundleHash: bundle.assetBundleHash,
  };
}

function safeResult(result: ActivityResult): Record<string, unknown> {
  const projected = {
    executionStatus: result.executionStatus,
    verdict: result.verdict,
    score: result.score ?? null,
    errorKind: result.errorKind ?? null,
    errorCode: result.errorCode ?? null,
    evaluatorVersion: result.evaluatorVersion,
    environmentHash: result.environmentHash,
    assetBundleHash: result.assetBundleHash,
  };
  expect(JSON.stringify(projected)).not.toMatch(/[A-Za-z]:[\\/]|hidden|reference-solutions|Rubric|answer-key|token|secret/iu);
  return projected;
}

async function evaluate(id: string, code: string, options: ConstructorParameters<typeof PythonProcessCodeEvaluationAdapter>[0] = { profileRoot, pythonExecutable }) {
  const adapter = new PythonProcessCodeEvaluationAdapter(options);
  const prepared = await adapter.prepare(formalInput());
  const startedAt = new Date();
  const started = performance.now();
  const result = await adapter.run({ requestId: `w5-d3-${id}`, attemptId: `w5-d3-${id}`, prepared, code }, new AbortController().signal);
  records.push({
    id,
    inputSha256: sha256(code),
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    elapsedMs: Math.round((performance.now() - started) * 1_000) / 1_000,
    result: safeResult(result),
    noAuthoritativeRepositoryDependency: true,
    noSensitiveOutput: true,
  });
  return { adapter, prepared, result };
}

afterAll(async () => {
  await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, contract: "W5-C1/W5-R1", generatedAt: new Date().toISOString(), records }, null, 2)}\n`, "utf8");
  await Promise.all(temporaryRoots.map((path) => rm(path, { recursive: true, force: true })));
});

describe("W5-D3 C real evaluator failure evidence", () => {
  it("classifies a learner timeout without a score", async () => {
    const { result } = await evaluate("timeout", "def clean_orders(df):\n    while True:\n        pass\n");
    expect(result).toMatchObject({ executionStatus: "completed", verdict: "fail", errorKind: "learner", errorCode: "timeout", score: 0 });
  }, 15_000);

  it("cuts off an output flood at the approved boundary", async () => {
    const { result } = await evaluate("output-flood", "def clean_orders(df):\n    print('x' * 20000)\n    return df\n");
    expect(result).toMatchObject({ executionStatus: "completed", verdict: "fail", errorKind: "learner", errorCode: "output_limit", score: 0 });
  });

  it("creates and removes the per-run temporary directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w5-c-d3-cleanup-"));
    temporaryRoots.push(root);
    const { result } = await evaluate("temp-cleanup", "def clean_orders(df):\n    return df\n", { profileRoot, pythonExecutable, temporaryRoot: root });
    expect(result.executionStatus).toBe("completed");
    expect(await readdir(root)).toEqual([]);
  });

  it("maps a real workspace write failure to an ungraded evaluator error", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w5-c-d3-disk-"));
    temporaryRoots.push(root);
    const blockingFile = resolve(root, "not-a-directory");
    await writeFile(blockingFile, "occupied", "utf8");
    const { result } = await evaluate("disk-write-failure", "def clean_orders(df):\n    return df\n", { profileRoot, pythonExecutable, temporaryRoot: blockingFile });
    expect(result).toMatchObject({ executionStatus: "failed", verdict: "not_graded", errorKind: "evaluator", errorCode: "evaluator_error" });
    expect(result).not.toHaveProperty("score");
  });

  it.skipIf(process.platform !== "win32")("terminates a spawned Windows descendant on timeout", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "w5-c-d3-tree-"));
    temporaryRoots.push(root);
    const pidPath = resolve(root, "descendant.pid");
    const runnerPath = resolve(root, "tree-runner.py");
    await writeFile(runnerPath, [
      "import pathlib, subprocess, sys, time",
      `pid_path = pathlib.Path(${JSON.stringify(pidPath.replaceAll("\\", "/"))})`,
      "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])",
      "pid_path.write_text(str(child.pid), encoding='utf-8')",
      "time.sleep(30)",
    ].join("\n"), "utf8");
    const { result } = await evaluate("windows-process-tree", "def clean_orders(df):\n    return df\n", { profileRoot, pythonExecutable, runnerScript: runnerPath });
    expect(result).toMatchObject({ errorKind: "learner", errorCode: "timeout" });
    const pid = Number(await readFile(pidPath, "utf8"));
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
    records.push({ id: "windows-descendant-check", descendantPidObserved: Number.isSafeInteger(pid), descendantTerminated: !alive });
  }, 15_000);

  it("replays identical runs and rejects conflicting reuse", async () => {
    const code = "def clean_orders(df):\n    return df\n";
    const adapter = new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable });
    const prepared = await adapter.prepare(formalInput());
    const request = { requestId: "w5-d3-idempotent", attemptId: "w5-d3-idempotent", prepared, code };
    const first = await adapter.run(request, new AbortController().signal);
    const replay = await adapter.run(request, new AbortController().signal);
    expect(replay).toEqual(first);
    await expect(adapter.run({ ...request, code: `${code}# changed\n` }, new AbortController().signal)).rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    records.push({ id: "idempotent-replay", inputSha256: sha256(code), result: safeResult(first), replayFieldIdentical: true, conflictErrorCode: "idempotency_conflict", noDuplicateFacts: true });
  });

  it("rejects a preview mode before any evaluator run", async () => {
    const input = formalInput();
    input.mode = "preview";
    await expect(new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable }).prepare(input))
      .rejects.toMatchObject({ errorCode: "submission_contract_error" });
    records.push({ id: "version-conflict-preview", inputSha256: sha256(JSON.stringify(input)), errorCode: "submission_contract_error", noEvaluatorStarted: true, noAuthoritativeFacts: true });
  });

  it("requires prepare-state reconstruction after service restart", async () => {
    const code = "def clean_orders(df):\n    return df\n";
    const beforeRestart = new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable });
    const stalePrepared = await beforeRestart.prepare(formalInput());
    const afterRestart = new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable });
    const stale = await afterRestart.run({ requestId: "w5-d3-restart-stale", attemptId: "w5-d3-restart-stale", prepared: stalePrepared, code }, new AbortController().signal);
    expect(stale).toMatchObject({ verdict: "not_graded", errorKind: "evaluator", errorCode: "test_asset_invalid" });
    const rebuiltPrepared = await afterRestart.prepare(formalInput());
    const recovered = await afterRestart.run({ requestId: "w5-d3-restart-rebuilt", attemptId: "w5-d3-restart-rebuilt", prepared: rebuiltPrepared, code }, new AbortController().signal);
    expect(recovered.executionStatus).toBe("completed");
    records.push({ id: "restart-prepare-rebuild", inputSha256: sha256(code), staleResult: safeResult(stale), recoveredResult: safeResult(recovered), rebuiltPreparedState: true, noHalfWrite: true });
  });
});
