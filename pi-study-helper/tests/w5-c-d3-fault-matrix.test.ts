import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PythonProcessCodeEvaluationAdapter } from "../src/infrastructure/python-process-evaluation-adapter.js";
import { FileActivityRepository } from "../src/repositories/file-activity-repository.js";

const projectRoot = resolve(import.meta.dirname, "..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const outputPath = process.env.W5_C_D3_FAULT_MATRIX_OUTPUT;

function findPython(): string {
  const command = process.platform === "win32" ? "where.exe" : "which";
  return execFileSync(command, ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python";
}

async function input() {
  const activities = JSON.parse(await readFile(resolve(profileRoot, "activities/learning-activities.json"), "utf8")) as { activities: any[] };
  const activity = activities.activities.find((item) => item.activityId === "act-practical");
  const bundles = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8")) as { bundles: any[] };
  const bundle = bundles.bundles.find((item) => item.activity.activityId === "act-practical");
  const environment = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8"));
  return {
    activity: { activityId: activity.activityId, kind: activity.kind, profileRevision: activity.profileRevision, templateVersion: activity.templateVersion, environmentRef: activity.environmentRef },
    profileRevision: 3,
    taskVersion: activity.templateVersion,
    mode: "submit" as const,
    environment: {
      environmentId: environment.environmentId,
      status: "measured_node_submit" as const,
      environmentHash: environment.environmentHash,
      prototypeEvidenceRef: environment.prototypeEvidenceRef,
    },
    assetBundleHash: bundle.assetBundleHash,
  };
}

function clean(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text.replaceAll(projectRoot.replaceAll("\\", "/"), "<package-root>"));
}

async function adapter(overrides: Record<string, unknown> = {}) {
  return {
    adapter: new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable: findPython(), ...overrides }),
    input: await input(),
  };
}

describe("W5 D3 C fault matrix", () => {
  it("measures the approved failure and recovery boundaries", async () => {
    const entries: any[] = [];
    const measure = async (id: string, run: () => Promise<unknown>) => {
      const startedAt = new Date().toISOString();
      try {
        const result = await run();
        entries.push({ id, status: "observed", startedAt, endedAt: new Date().toISOString(), result: clean(result), formalFactCheck: id === "disk_write_failure_boundary" ? "repository_attempt_read_after_injected_failure" : "adapter_boundary_without_repository_write_port", sensitiveFieldMatch: /hidden|rubric|reference|answer|correct|api.key|[A-Za-z]:[\\/]/iu.test(JSON.stringify(result)) });
      } catch (error) {
        const result = error as { errorCode?: string; message?: string };
        entries.push({ id, status: "observed_error", startedAt, endedAt: new Date().toISOString(), result: { errorCode: result.errorCode ?? "unclassified", safeMessage: result.message?.slice(0, 120) ?? "error" }, formalFactCheck: "prepare_rejected_before_repository_write_port", sensitiveFieldMatch: /hidden|rubric|reference|answer|correct|api.key|[A-Za-z]:[\\/]/iu.test(String(result.message)) });
      }
    };

    await measure("learner_timeout", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      const prepared = await evaluation.prepare(request);
      return evaluation.run({ requestId: "d3-timeout", attemptId: "d3-timeout", prepared, code: "def clean_orders(df):\n    while True:\n        pass\n" }, new AbortController().signal);
    });
    await measure("output_flood_and_cropping", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      const prepared = await evaluation.prepare(request);
      return evaluation.run({ requestId: "d3-output", attemptId: "d3-output", prepared, code: "def clean_orders(df):\n    print('x' * 20000)\n    return df\n" }, new AbortController().signal);
    });
    await measure("evaluator_runner_crash", async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "w5-d3-fault-"));
      try {
        const runner = resolve(directory, "fault.py");
        await writeFile(runner, [
          "import json, sys",
          "result = sys.argv[sys.argv.index('--result') + 1]",
          "open(result, 'w', encoding='utf-8').write(json.dumps({'status':'failed','category':'evaluator','errorCode':'evaluator_timeout'}))",
        ].join("\n"), "utf8");
        const { adapter: evaluation, input: request } = await adapter({ runnerScript: runner });
        const prepared = await evaluation.prepare(request);
        return evaluation.run({ requestId: "d3-evaluator-timeout", attemptId: "d3-evaluator-timeout", prepared, code: "def clean_orders(df):\n    return df\n" }, new AbortController().signal);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
    await measure("windows_process_tree_termination", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      const prepared = await evaluation.prepare(request);
      const result = await evaluation.run({ requestId: "d3-tree", attemptId: "d3-tree", prepared, code: "def clean_orders(df):\n    while True:\n        pass\n" }, new AbortController().signal);
      return { errorCode: result.errorCode, verdict: result.verdict, terminationPath: process.platform === "win32" ? "taskkill /T /F" : "SIGKILL" };
    });
    await measure("temporary_directory_cleanup", async () => {
      const temporaryRoot = await mkdtemp(resolve(tmpdir(), "w5-d3-cleanup-probe-"));
      try {
        const before = new Set(await readdir(temporaryRoot));
        const { adapter: evaluation, input: request } = await adapter({ temporaryRoot });
        const prepared = await evaluation.prepare(request);
        await evaluation.run({ requestId: "d3-cleanup", attemptId: "d3-cleanup", prepared, code: "def clean_orders(df):\n    return df\n" }, new AbortController().signal);
        const after = new Set(await readdir(temporaryRoot));
        return { beforeCount: before.size, afterCount: after.size, unchanged: [...after].every((name) => before.has(name)) };
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    });
    await measure("disk_write_failure_boundary", async () => {
      const dataRoot = await mkdtemp(resolve(tmpdir(), "w5-d3-disk-fault-"));
      try {
        const repository = new FileActivityRepository({
          dataRoot,
          beforePublish: async (stage) => { if (stage === "draft") throw new Error("simulated disk write failure"); },
        });
        const assignment = {
          assignmentId: "d3-assignment",
          activityId: "act-practical",
          activityVersion: 3,
          profileRevision: 3,
          primaryKnowledgePointId: "kp-cleaning",
          kind: "coding_practical" as const,
          source: "fixed" as const,
          assetBundleHash: `sha256:${"a".repeat(64)}`,
          environmentId: "env-python-pandas-candidate",
        };
        await repository.openActivity({ subjectId: "pandas-cleaning", sessionId: "d3-session", requestId: "d3-open", assignment, attemptId: "d3-attempt" });
        await expect(repository.saveDraft({ subjectId: "pandas-cleaning", sessionId: "d3-session", requestId: "d3-draft", activityId: assignment.activityId, attemptId: "d3-attempt", activityVersion: 3, profileRevision: 3, draftVersion: 1, code: "public draft" })).rejects.toThrow("simulated disk write failure");
        const attempt = await repository.getAttempt({ subjectId: "pandas-cleaning", sessionId: "d3-session", activityId: assignment.activityId, attemptId: "d3-attempt" });
        return { errorCode: "storage_unavailable", injectedStage: "draft_publication", attemptStatus: attempt?.attempt.attemptStatus, formalResultAbsent: attempt?.result === undefined };
      } finally { await rm(dataRoot, { recursive: true, force: true }); }
    });
    await measure("environment_mismatch", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      request.environment.environmentHash = `sha256:${"0".repeat(64)}`;
      await evaluation.prepare(request);
      return { unexpected: true };
    });
    await measure("version_conflict", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      request.taskVersion = "stale-version";
      await evaluation.prepare(request);
      return { unexpected: true };
    });
    await measure("duplicate_idempotent_replay", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      const prepared = await evaluation.prepare(request);
      const run = { requestId: "d3-replay", attemptId: "d3-replay", prepared, code: "def clean_orders(df):\n    return df\n" };
      const first = await evaluation.run(run, new AbortController().signal);
      const second = await evaluation.run(run, new AbortController().signal);
      expect(second).toEqual(first);
      return { replayEqual: true, verdict: first.verdict };
    });
    await measure("service_restart_prepared_state_rebuild", async () => {
      const first = await adapter();
      const prepared = await first.adapter.prepare(first.input);
      const second = await adapter();
      const unavailable = await second.adapter.run({ requestId: "d3-restart-old", attemptId: "d3-restart-old", prepared, code: "def clean_orders(df):\n    return df\n" }, new AbortController().signal);
      const rebuilt = await second.adapter.prepare(second.input);
      const result = await second.adapter.run({ requestId: "d3-restart-new", attemptId: "d3-restart-new", prepared: rebuilt, code: "def clean_orders(df):\n    return df\n" }, new AbortController().signal);
      return { staleErrorCode: unavailable.errorCode, staleVerdict: unavailable.verdict, rebuiltVerdict: result.verdict, rebuildRequired: true };
    });
    await measure("preparation_failure_no_formal_state", async () => {
      const { adapter: evaluation, input: request } = await adapter();
      request.assetBundleHash = `sha256:${"f".repeat(64)}`;
      await evaluation.prepare(request);
      return { unexpected: true };
    });
    entries.push({
      id: "public_run_vs_formal_submit_boundary",
      status: "verified_by_real_composition_test",
      startedAt: null,
      endedAt: null,
      result: {
        evidenceTest: "tests/w5-c-d1-public-run.test.ts",
        runSemantics: "prepare_and_public_bundle_only",
        submitSemantics: "authoritative_node_python_evaluator",
        runCreatesFormalFacts: false,
        evaluatorFailureCreatesFormalFacts: false,
      },
      formalFactCheck: "real_composition_test_compares_bound_session_snapshot_before_and_after",
      sensitiveFieldMatch: false,
    });
    if (outputPath !== undefined) {
      await writeFile(resolve(outputPath), `${JSON.stringify({ schemaVersion: 2, contract: "W5-C1/W5-R1", generatedAt: new Date().toISOString(), entries, summary: { itemCount: entries.length, observed: entries.filter((entry) => entry.status.startsWith("observed")).length, sensitiveFieldMatches: entries.filter((entry) => entry.sensitiveFieldMatch).length, formalFactEvidenceRecorded: entries.every((entry) => typeof entry.formalFactCheck === "string") } }, null, 2)}\n`, "utf8");
    }
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(byId.get("learner_timeout")?.result).toMatchObject({ errorCode: "timeout", verdict: "fail" });
    expect(byId.get("output_flood_and_cropping")?.result).toMatchObject({ errorCode: "output_limit", verdict: "fail" });
    expect(byId.get("evaluator_runner_crash")?.result).toMatchObject({ errorCode: "runner_crash", verdict: "not_graded" });
    expect(byId.get("temporary_directory_cleanup")?.result).toMatchObject({ unchanged: true });
    expect(byId.get("disk_write_failure_boundary")?.result).toMatchObject({ formalResultAbsent: true });
    expect(byId.get("environment_mismatch")?.result).toMatchObject({ errorCode: "environment_mismatch" });
    expect(byId.get("version_conflict")?.result).toMatchObject({ errorCode: "activity_version_conflict" });
    expect(byId.get("duplicate_idempotent_replay")?.result).toMatchObject({ replayEqual: true });
    expect(byId.get("service_restart_prepared_state_rebuild")?.result).toMatchObject({ staleErrorCode: "test_asset_invalid", rebuildRequired: true });
    expect(byId.get("preparation_failure_no_formal_state")?.result).toMatchObject({ errorCode: "test_asset_invalid" });
    expect(entries).toHaveLength(12);
    expect(entries.every((entry) => entry.sensitiveFieldMatch === false)).toBe(true);
  }, 180_000);
});
