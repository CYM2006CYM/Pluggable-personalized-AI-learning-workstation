import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PrepareEvaluationInput } from "../src/infrastructure/code-evaluation-port.js";
import {
  PythonProcessCodeEvaluationAdapter,
  type MeasuredNodeEnvironment,
} from "../src/infrastructure/python-process-evaluation-adapter.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const runnerScript = resolve(projectRoot, "scripts/python-evaluator.py");

function findPython(): string {
  if (process.env.PI_PYTHON_EXECUTABLE) return process.env.PI_PYTHON_EXECUTABLE;
  const command = process.platform === "win32" ? "where.exe" : "which";
  return execFileSync(command, ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python";
}

const pythonExecutable = findPython();
const environment = JSON.parse(await readFile(
  resolve(profileRoot, "environments/environment-lock.json"),
  "utf8",
)) as MeasuredNodeEnvironment;

async function bundles(): Promise<any[]> {
  return JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8")).bundles;
}

async function input(activityId: string): Promise<PrepareEvaluationInput> {
  const bundle = (await bundles()).find((item) => item.activity.activityId === activityId);
  return {
    activity: {
      activityId,
      kind: bundle.activity.kind,
      profileRevision: bundle.activity.profileRevision,
      templateVersion: bundle.activity.templateVersion,
      environmentRef: bundle.environmentRef,
    },
    profileRevision: bundle.activity.profileRevision,
    taskVersion: bundle.activity.templateVersion,
    mode: "submit",
    environment: {
      environmentId: bundle.environmentRef,
      status: "measured_node_submit",
      environmentHash: environment.environmentHash,
      prototypeEvidenceRef: "scripts/w3-code-evaluation/environment-prototype-evidence.json",
    },
    assetBundleHash: bundle.assetBundleHash,
  };
}

function adapter(overrides: Partial<ConstructorParameters<typeof PythonProcessCodeEvaluationAdapter>[0]> = {}) {
  return new PythonProcessCodeEvaluationAdapter({
    profileRoot,
    pythonExecutable,
    runnerScript,
    ...overrides,
  });
}

async function evaluate(activityId: string, code: string, suffix: string) {
  const evaluation = adapter();
  const prepared = await evaluation.prepare(await input(activityId));
  return evaluation.run({
    requestId: `request-${suffix}`,
    attemptId: `attempt-${suffix}`,
    prepared,
    code,
  }, new AbortController().signal);
}

describe("W3 C Node/Python formal evaluation adapter", () => {
  it("runs both formal TaskBundles three times with field-identical public results", async () => {
    for (const [activityId, solutionName] of [
      ["act-inspect-dataframe", "solution-structure.py"],
      ["act-practical", "solution-practical.py"],
    ] as const) {
      const code = await readFile(resolve(profileRoot, "reference-solutions", solutionName), "utf8");
      const results = [];
      for (let repeat = 1; repeat <= 3; repeat += 1) {
        results.push(await evaluate(activityId, code, `${activityId}-${repeat}`));
      }
      expect(results[0]).toMatchObject({ executionStatus: "completed", verdict: "pass", score: 1 });
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(JSON.stringify(results)).not.toMatch(/private|hidden|reference-solutions|[A-Za-z]:[\\/]|AppData/u);
    }
  }, 45_000);

  it.each([
    ["syntax_error", "def clean_orders(:\n    pass\n"],
    ["runtime_error", "def clean_orders(df):\n    raise ValueError('boom')\n"],
    ["disallowed_import", "import os\ndef clean_orders(df):\n    return df\n"],
    ["timeout", "def clean_orders(df):\n    while True:\n        pass\n"],
    ["output_limit", "def clean_orders(df):\n    print('x' * 20000)\n    return df\n"],
  ])("classifies %s deterministically", async (errorCode, code) => {
    const result = await evaluate("act-practical", code, errorCode);
    expect(result).toMatchObject({ errorKind: "learner", errorCode, verdict: "fail", score: 0 });
    expect(JSON.stringify(result)).not.toMatch(/boom|private|hidden|[A-Za-z]:[\\/]|AppData/u);
  }, 15_000);

  it("classifies deterministic assertion failures without exposing hidden details", async () => {
    const code = await readFile(resolve(profileRoot, "assessments/private/known-wrong/wrong-practical.py"), "utf8");
    const result = await evaluate("act-practical", code, "test-failed");
    expect(result).toMatchObject({ verdict: "partial", errorKind: "learner", errorCode: "test_failed" });
    expect(result.score).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/private|hidden|expected|assert|[A-Za-z]:[\\/]|AppData/u);
  });

  it("classifies an oversized source as a submission contract error", async () => {
    const evaluation = adapter();
    const prepared = await evaluation.prepare(await input("act-practical"));
    const request = {
      requestId: "request-source-limit",
      attemptId: "attempt-source-limit",
      prepared,
      code: `#${"x".repeat(8_001)}`,
    };
    const result = await evaluation.run(request, new AbortController().signal);
    expect(result).toMatchObject({ verdict: "fail", errorKind: "learner", errorCode: "submission_contract_error", score: 0 });
    expect(await evaluation.run(request, new AbortController().signal)).toEqual(result);
    await expect(evaluation.run({ ...request, code: `${request.code}x` }, new AbortController().signal))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
  });

  it("rejects preview mode and mismatched formal activity or evidence bindings", async () => {
    const preview = await input("act-practical");
    preview.mode = "preview";
    await expect(adapter().prepare(preview)).rejects.toMatchObject({ errorCode: "submission_contract_error" });

    const wrongKind = await input("act-practical");
    wrongKind.activity.kind = "code_completion";
    await expect(adapter().prepare(wrongKind)).rejects.toMatchObject({ errorCode: "test_asset_invalid" });

    const wrongEvidence = await input("act-practical");
    wrongEvidence.environment.prototypeEvidenceRef = "scripts/w3-code-evaluation/other-evidence.json";
    await expect(adapter().prepare(wrongEvidence)).rejects.toMatchObject({ errorCode: "environment_mismatch" });
  });

  it("rejects unmeasured environments and damaged assets as evaluator-owned failures", async () => {
    const unmeasured = await input("act-practical");
    unmeasured.environment.status = "draft_pending_C_prototype";
    await expect(adapter().prepare(unmeasured)).rejects.toMatchObject({ errorCode: "environment_mismatch" });

    const temporary = await mkdtemp(resolve(tmpdir(), "pi-w3-damaged-profile-"));
    try {
      const environmentOnlyRoot = resolve(temporary, "environment-only-profile");
      await mkdir(resolve(environmentOnlyRoot, "environments"), { recursive: true });
      await writeFile(
        resolve(environmentOnlyRoot, "environments/environment-lock.json"),
        `${JSON.stringify({ ...environment, nodeVersion: "v0.0.0" }, null, 2)}\n`,
        "utf8",
      );
      await expect(adapter({ profileRoot: environmentOnlyRoot }).prepare(await input("act-practical")))
        .rejects.toMatchObject({ errorCode: "environment_mismatch" });

      const damagedRoot = resolve(temporary, "profile");
      const { cp, rm: remove } = await import("node:fs/promises");
      await cp(profileRoot, damagedRoot, { recursive: true });
      await remove(resolve(damagedRoot, "assessments/public/tests/test-practical-public.py"));
      await expect(adapter({ profileRoot: damagedRoot }).prepare(await input("act-practical")))
        .rejects.toMatchObject({ errorCode: "test_asset_invalid" });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("blocks a missing runtime before assets and maps protocol faults to ungraded evaluator results", async () => {
    const missingRunner = adapter({ pythonExecutable: resolve(projectRoot, "missing-python.exe") });
    await expect(missingRunner.prepare(await input("act-practical")))
      .rejects.toMatchObject({ errorCode: "environment_mismatch" });

    const directory = await mkdtemp(resolve(tmpdir(), "pi-w3-invalid-runner-"));
    try {
      const invalidRunner = resolve(directory, "invalid.py");
      await writeFile(invalidRunner, "raise SystemExit(0)\n", "utf8");
      const invalid = adapter({ runnerScript: invalidRunner });
      const invalidPrepared = await invalid.prepare(await input("act-practical"));
      const protocolFailure = await invalid.run({
        requestId: "request-protocol-failure",
        attemptId: "attempt-protocol-failure",
        prepared: invalidPrepared,
        code: "def clean_orders(df):\n    return df\n",
      }, new AbortController().signal);
      expect(protocolFailure).toMatchObject({ verdict: "not_graded", errorKind: "evaluator", errorCode: "result_protocol_invalid" });
      expect(protocolFailure).not.toHaveProperty("score");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["dependency_missing", "evaluator_timeout", "evaluator_error"] as const)(
    "maps injected %s harness faults to ungraded evaluator results",
    async (errorCode) => {
      const directory = await mkdtemp(resolve(tmpdir(), "pi-w3-evaluator-fault-"));
      try {
        const faultRunner = resolve(directory, "fault.py");
        await writeFile(faultRunner, [
          "import json, sys",
          "result = sys.argv[sys.argv.index('--result') + 1]",
          `open(result, 'w', encoding='utf-8').write(json.dumps({'status':'failed','category':'evaluator','errorCode':'${errorCode}'}))`,
        ].join("\n"), "utf8");
        const evaluation = adapter({ runnerScript: faultRunner });
        const prepared = await evaluation.prepare(await input("act-practical"));
        const result = await evaluation.run({
          requestId: `request-${errorCode}`,
          attemptId: `attempt-${errorCode}`,
          prepared,
          code: "def clean_orders(df):\n    return df\n",
        }, new AbortController().signal);
        expect(result).toMatchObject({ verdict: "not_graded", errorKind: "evaluator", errorCode });
        expect(result).not.toHaveProperty("score");
        expect(result).not.toHaveProperty("dimensionResults");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("maps a child runner crash to an ungraded evaluator result", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "pi-w3-runner-crash-"));
    try {
      const crashRunner = resolve(directory, "crash.py");
      await writeFile(crashRunner, "raise SystemExit(7)\n", "utf8");
      const evaluation = adapter({ runnerScript: crashRunner });
      const prepared = await evaluation.prepare(await input("act-practical"));
      const result = await evaluation.run({
        requestId: "request-runner-crash",
        attemptId: "attempt-runner-crash",
        prepared,
        code: "def clean_orders(df):\n    return df\n",
      }, new AbortController().signal);
      expect(result).toMatchObject({ verdict: "not_graded", errorKind: "evaluator", errorCode: "runner_crash" });
      expect(result).not.toHaveProperty("score");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("caches learner and evaluator terminal failures without starting Python again", async () => {
    for (const [name, payload, expected] of [
      [
        "learner",
        { status: "failed", category: "learner", errorCode: "syntax_error" },
        { verdict: "fail", errorKind: "learner", errorCode: "syntax_error" },
      ],
      [
        "evaluator",
        { status: "failed", category: "evaluator", errorCode: "result_protocol_invalid" },
        { verdict: "not_graded", errorKind: "evaluator", errorCode: "result_protocol_invalid" },
      ],
    ] as const) {
      const directory = await mkdtemp(resolve(tmpdir(), `pi-w3-${name}-idempotency-`));
      try {
        const countPath = resolve(directory, "count.txt").replaceAll("\\", "/");
        const faultRunner = resolve(directory, "fault.py");
        await writeFile(faultRunner, [
          "import json, pathlib, sys",
          `count_path = pathlib.Path(${JSON.stringify(countPath)})`,
          "count = int(count_path.read_text(encoding='utf-8')) if count_path.exists() else 0",
          "count_path.write_text(str(count + 1), encoding='utf-8')",
          "result = sys.argv[sys.argv.index('--result') + 1]",
          `payload = json.loads(${JSON.stringify(JSON.stringify(payload))})`,
          "pathlib.Path(result).write_text(json.dumps(payload), encoding='utf-8')",
        ].join("\n"), "utf8");
        const evaluation = adapter({ runnerScript: faultRunner });
        const prepared = await evaluation.prepare(await input("act-practical"));
        const request = {
          requestId: `request-${name}-terminal`,
          attemptId: `attempt-${name}-terminal`,
          prepared,
          code: "def clean_orders(df):\n    return df\n",
        };
        const first = await evaluation.run(request, new AbortController().signal);
        expect(first).toMatchObject(expected);
        expect(await evaluation.run(request, new AbortController().signal)).toEqual(first);
        expect(await readFile(countPath, "utf8")).toBe("1");
        await expect(evaluation.run({ ...request, code: `${request.code}# changed\n` }, new AbortController().signal))
          .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
        expect(await readFile(countPath, "utf8")).toBe("1");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("enforces request and attempt idempotency", async () => {
    const evaluation = adapter();
    const prepared = await evaluation.prepare(await input("act-inspect-dataframe"));
    const code = await readFile(resolve(profileRoot, "reference-solutions/solution-structure.py"), "utf8");
    const request = { requestId: "request-idempotent", attemptId: "attempt-idempotent", prepared, code };
    const first = await evaluation.run(request, new AbortController().signal);
    expect(await evaluation.run(request, new AbortController().signal)).toEqual(first);
    await expect(evaluation.run({ ...request, code: `${code}\n# changed` }, new AbortController().signal))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
    expect(await evaluation.run({ ...request, requestId: "request-idempotent-new" }, new AbortController().signal))
      .toEqual(first);
    await expect(evaluation.run({ ...request, attemptId: "attempt-idempotent-new" }, new AbortController().signal))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });

    const otherPrepared = await evaluation.prepare(await input("act-practical"));
    await expect(evaluation.run({ ...request, prepared: otherPrepared }, new AbortController().signal))
      .rejects.toMatchObject({ errorCode: "idempotency_conflict" });
  });

  it("keeps C implementation outside formal fact repositories", async () => {
    const files = [
      resolve(projectRoot, "src/infrastructure/python-process-evaluation-adapter.ts"),
      resolve(projectRoot, "src/infrastructure/activity-rubric.ts"),
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/from ["'][^"']*(?:attempt|evidence|knowledge-state|path-repository)/iu);
      expect(source).not.toMatch(/AttemptRepository|EvidenceRepository|KnowledgeState|PathRepository|UnitOfWork/u);
    }
  });
});
