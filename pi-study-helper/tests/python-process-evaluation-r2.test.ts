import { execFile, execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  summarizeRubric,
  validateRubricDefinition,
  type RubricTestBinding,
} from "../src/infrastructure/activity-rubric.js";
import type { PrepareEvaluationInput } from "../src/infrastructure/code-evaluation-port.js";
import {
  PythonProcessCodeEvaluationAdapter,
  type MeasuredNodeEnvironment,
} from "../src/infrastructure/python-process-evaluation-adapter.js";

const execFileAsync = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const runnerScript = resolve(projectRoot, "scripts/python-evaluator.py");
const pythonExecutable = process.platform === "win32"
  ? execFileSync("where.exe", ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python"
  : execFileSync("which", ["python"], { encoding: "utf8" }).trim();
const environment = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8")) as MeasuredNodeEnvironment;

async function formalInput(activityId: string): Promise<PrepareEvaluationInput> {
  const document = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8"));
  const bundle = document.bundles.find((item: any) => item.activity.activityId === activityId);
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
      prototypeEvidenceRef: environment.prototypeEvidenceRef,
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

async function copiedProfile(mutator: (root: string) => Promise<void>): Promise<{ root: string; temporary: string }> {
  const temporary = await mkdtemp(join(tmpdir(), "pi-w3-r2-profile-"));
  const root = resolve(temporary, "profile");
  await cp(profileRoot, root, { recursive: true });
  await mutator(root);
  return { root, temporary };
}

async function expectPreparationAssetFailure(mutator: (root: string) => Promise<void>): Promise<void> {
  const { root, temporary } = await copiedProfile(mutator);
  try {
    await expect(adapter({ profileRoot: root }).prepare(await formalInput("act-practical")))
      .rejects.toMatchObject({ errorCode: "test_asset_invalid" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function runHarness(testSource: string): Promise<any> {
  const temporary = await mkdtemp(join(tmpdir(), "pi-w3-r2-harness-"));
  try {
    const submission = resolve(temporary, "submission.py");
    const testFile = resolve(temporary, "test.py");
    const fixture = resolve(temporary, "fixture.csv");
    const result = resolve(temporary, "result.json");
    const state = resolve(temporary, "state.json");
    const manifest = resolve(temporary, "tests.json");
    await writeFile(submission, "def clean_orders(df):\n    return df\n", "utf8");
    await writeFile(testFile, testSource, "utf8");
    await writeFile(fixture, "value\n1\n", "utf8");
    await writeFile(manifest, JSON.stringify([{
      testId: "r2-test",
      dimensionId: "r2",
      blocking: true,
      filePath: testFile,
      fixturePaths: [fixture],
    }]), "utf8");
    await execFileAsync(pythonExecutable, [
      runnerScript, "--stage", "public_tests", "--submission", submission,
      "--entry-point", "clean_orders", "--result", result, "--state", state,
      "--allowed-library", "pandas", "--test-manifest", manifest,
    ], { windowsHide: true });
    return JSON.parse(await readFile(result, "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

describe("W3 C R2 harness and asset gates", () => {
  it("keeps healthy assertion misses as learner test_failed", async () => {
    const result = await runHarness("def run_case(candidate, df):\n    assert False\n");
    expect(result).toEqual({
      status: "ok",
      tests: [{ testId: "r2-test", dimensionId: "r2", blocking: true, passed: false }],
    });
  });

  it("maps a test RuntimeError to evaluator test_asset_invalid", async () => {
    const result = await runHarness("def run_case(candidate, df):\n    raise RuntimeError('broken test')\n");
    expect(result).toEqual({ status: "failed", category: "evaluator", errorCode: "test_asset_invalid" });
  });

  it("maps a non-assertion test exception to evaluator test_asset_invalid", async () => {
    const result = await runHarness("def run_case(candidate, df):\n    raise TypeError('broken test')\n");
    expect(result).toEqual({ status: "failed", category: "evaluator", errorCode: "test_asset_invalid" });
  });

  it("rejects changed content, extra/missing/duplicate libraries and damaged bundles", async () => {
    await expectPreparationAssetFailure(async (root) => {
      const path = resolve(root, "assessments/private/task-bundles.json");
      const document = JSON.parse(await readFile(path, "utf8"));
      document.bundles.find((item: any) => item.activity.activityId === "act-practical").contract.entryPoint.name = "changed";
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    });
    await expectPreparationAssetFailure(async (root) => {
      const path = resolve(root, "assessments/private/task-bundles.json");
      const document = JSON.parse(await readFile(path, "utf8"));
      document.bundles.find((item: any) => item.activity.activityId === "act-practical").rubric.passThreshold = 2;
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    });
    await expectPreparationAssetFailure(async (root) => {
      const path = resolve(root, "assessments/private/task-bundles.json");
      const document = JSON.parse(await readFile(path, "utf8"));
      document.bundles = document.bundles.filter((item: any) => item.activity.activityId !== "act-practical");
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    });
    for (const libraries of [["pandas", "os"], [], ["pandas", "pandas"]]) {
      await expectPreparationAssetFailure(async (root) => {
        const path = resolve(root, "assessments/private/task-bundles.json");
        const document = JSON.parse(await readFile(path, "utf8"));
        document.bundles.find((item: any) => item.activity.activityId === "act-practical").activity.allowedLibraries = libraries;
        await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      });
    }
  }, 30_000);

  it("rejects malformed Rubric structures and never emits an out-of-range score", () => {
    const tests: RubricTestBinding[] = [
      { testId: "one", dimensionId: "one", blocking: true },
      { testId: "two", dimensionId: "two", blocking: false },
    ];
    const base = {
      passThreshold: 0.8,
      dimensions: [
        { dimensionId: "one", weight: 0.5, blocking: true, safeFeedbackCodes: [] },
        { dimensionId: "two", weight: 0.5, blocking: false, safeFeedbackCodes: [] },
      ],
      dimensionTestMap: { one: ["one"], two: ["two"] },
    };
    expect(validateRubricDefinition({ ...base, passThreshold: 2 }, tests)).toBe(false);
    expect(validateRubricDefinition({ ...base, dimensions: [{ ...base.dimensions[0], weight: 2 }, base.dimensions[1]] }, tests)).toBe(false);
    expect(validateRubricDefinition({ ...base, dimensions: [base.dimensions[0], base.dimensions[0]] }, tests)).toBe(false);
    expect(validateRubricDefinition({ ...base, dimensionTestMap: { one: ["one"], two: ["missing"] } }, tests)).toBe(false);
    expect(validateRubricDefinition({ ...base, dimensionTestMap: { one: ["one"] } }, tests)).toBe(false);
    expect(() => summarizeRubric({
      rubric: { ...base, dimensions: [{ ...base.dimensions[0], weight: 2 }, base.dimensions[1]] },
      tests: tests.map((test) => ({ ...test, passed: true })),
      evaluatorVersion: "node-python-evaluator-w3-c1",
      environmentHash: environment.environmentHash,
      assetBundleHash: "sha256:" + "1".repeat(64),
    })).toThrow(TypeError);
  });

  it("rejects unknown or mismatched harness error protocols", async () => {
    for (const payload of [
      { status: "failed", category: "evaluator", errorCode: "unknown" },
      { status: "failed", category: "learner", errorCode: "test_asset_invalid" },
      { status: "failed", category: "evaluator" },
      { status: "ok", tests: [], extra: true },
    ]) {
      const temporary = await mkdtemp(join(tmpdir(), "pi-w3-r2-protocol-"));
      try {
        const invalidRunner = resolve(temporary, "runner.py");
        await writeFile(invalidRunner, [
          "import json, sys",
          "result = sys.argv[sys.argv.index('--result') + 1]",
          `json.dump(json.loads(${JSON.stringify(JSON.stringify(payload))}), open(result, 'w', encoding='utf-8'))`,
        ].join("\n"), "utf8");
        const evaluation = adapter({ runnerScript: invalidRunner });
        const prepared = await evaluation.prepare(await formalInput("act-practical"));
        const result = await evaluation.run({
          requestId: `r2-protocol-${Math.random()}`,
          attemptId: `r2-protocol-${Math.random()}`,
          prepared,
          code: "def clean_orders(df):\n    return df\n",
        }, new AbortController().signal);
        expect(result).toMatchObject({ verdict: "not_graded", errorKind: "evaluator", errorCode: "result_protocol_invalid" });
        expect(result).not.toHaveProperty("score");
        expect(result).not.toHaveProperty("dimensionResults");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  });

  it("classifies a real harness timeout separately from learner timeout", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pi-w3-r2-timeout-"));
    try {
      const timeoutRunner = resolve(temporary, "runner.py");
      await writeFile(timeoutRunner, [
        "import json, sys, time",
        "stage = sys.argv[sys.argv.index('--stage') + 1]",
        "result = sys.argv[sys.argv.index('--result') + 1]",
        "state = sys.argv[sys.argv.index('--state') + 1]",
        "if stage == 'user_code': json.dump({'status':'ok','tests':[]}, open(result, 'w', encoding='utf-8'))",
        "else: json.dump({'phase':'harness_running'}, open(state, 'w', encoding='utf-8')); time.sleep(30)",
      ].join("\n"), "utf8");
      const evaluation = adapter({ runnerScript: timeoutRunner });
      const prepared = await evaluation.prepare(await formalInput("act-practical"));
      const result = await evaluation.run({
        requestId: "r2-harness-timeout",
        attemptId: "r2-harness-timeout",
        prepared,
        code: "def clean_orders(df):\n    return df\n",
      }, new AbortController().signal);
      expect(result).toMatchObject({ verdict: "not_graded", errorKind: "evaluator", errorCode: "evaluator_timeout" });
      expect(result).not.toHaveProperty("score");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  it("mechanically blocks a pending D2 evidence binding", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "pi-w3-r2-self-check-"));
    try {
      const source = JSON.parse(await readFile(resolve(projectRoot, "scripts/w3-code-evaluation/environment-prototype-rerun-d2.json"), "utf8"));
      source.status = "prototype_measured_pending_owner_decision";
      source.binding.ownerDecision = "pending";
      const evidencePath = resolve(temporary, "pending.json");
      const outputPath = resolve(temporary, "self-check.json");
      await writeFile(evidencePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
      await expect(execFileAsync(process.execPath, [
        resolve(projectRoot, "scripts/w3-code-evaluation/self-check.mjs"),
        "--d2-evidence", evidencePath,
        "--output", outputPath,
      ], { windowsHide: true })).rejects.toMatchObject({ code: 1 });
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({ status: "BLOCKED" });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
