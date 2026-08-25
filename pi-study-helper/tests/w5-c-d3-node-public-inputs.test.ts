import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectPublicExecutionBundle } from "../src/application/public-execution-bundle.js";
import { PythonProcessCodeEvaluationAdapter } from "../src/infrastructure/python-process-evaluation-adapter.js";

const packageRoot = resolve(import.meta.dirname, "..");
const profileRoot = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const outputPath = resolve(process.env.W5_C_D3_NODE_OUTPUT ?? resolve(packageRoot, "scripts/w5-c-d3-validation/node-public-results.json"));
const environmentLock = JSON.parse(await readFile(resolve(profileRoot, "environments/environment-lock.json"), "utf8")) as {
  environmentHash: string;
  environmentId: string;
};
const bundleDocument = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8")) as {
  bundles: Array<Record<string, any>>;
};
const fixtureDocument = JSON.parse(await readFile(resolve(profileRoot, "datasets/fixtures.json"), "utf8")) as {
  fixtures: Array<{ fixtureId: string; fileRef: string; assetHash: string; visibility: "public" | "private" }>;
};

const activityIds = [
  "act-inspect-dataframe",
  "act-missing",
  "act-duplicates",
  "act-types",
  "act-practical",
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function findPython(): string {
  return process.env.W5_C_D3_PYTHON
    ?? process.env.PI_PYTHON_EXECUTABLE
    ?? "python";
}

function safeResult(value: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/[A-Za-z]:[\\/]/u);
  expect(text).not.toMatch(/(?:hidden|reference-solutions|private|Rubric|answer-key|token|secret)/iu);
  return value;
}

async function buildPublicBundle(bundle: Record<string, any>, variant: number) {
  const activity = bundle.activity;
  const submissionCode = variant % 2 === 1
    ? activity.starterCode
    : `${activity.starterCode}\n\n# W5-D3 deterministic public invalid-input variant\ndef w5_d3_invalid_syntax(:\n`;
  const publicDatasetFiles = [];
  for (const fixtureId of activity.datasetRefs) {
    const fixture = fixtureDocument.fixtures.find((item) => item.fixtureId === fixtureId);
    if (!fixture) throw new Error(`missing public fixture: ${fixtureId}`);
    if (fixture.visibility !== "public") continue;
    const content = await readFile(resolve(profileRoot, fixture.fileRef), "utf8");
    publicDatasetFiles.push({
      name: fixture.fileRef.split("/").pop() ?? `${fixtureId}.csv`,
      content,
      hash: `sha256:${sha256(content)}`,
    });
  }
  expect(publicDatasetFiles).toHaveLength(1);
  const publicTestSources = [];
  for (const test of bundle.publicTests) {
    publicTestSources.push(await readFile(resolve(profileRoot, test.fileRef), "utf8"));
  }
  const publicBundle = projectPublicExecutionBundle({
    run: {
      runId: `w5-d3-${activity.activityId}-${variant}`,
      sessionId: `w5-d3-session-${variant}`,
      activityId: activity.activityId,
      createdAt: `2026-08-21T${String(variant).padStart(2, "0")}:00:00.000Z`,
    },
    profileRevision: 3,
    environmentId: environmentLock.environmentId,
    starterCode: submissionCode,
    publicDatasetFiles,
    publicTestSources,
  });
  return { publicBundle, submissionCode };
}

describe("W5-D3 C Node public input evidence", () => {
  it("runs ten real public execution bundle inputs three times each", async () => {
    const adapter = new PythonProcessCodeEvaluationAdapter({ profileRoot, pythonExecutable: findPython() });
    const groups: Array<Record<string, unknown>> = [];
    for (let index = 0; index < activityIds.length; index += 1) {
      const activityId = activityIds[index];
      const bundle = bundleDocument.bundles.find((item) => item.activity?.activityId === activityId);
      expect(bundle, `missing bundle ${activityId}`).toBeDefined();
      for (const variant of [1, 2]) {
        const { publicBundle, submissionCode } = await buildPublicBundle(bundle!, variant + index * 2);
        const activity = bundle!.activity;
        const inputSha256 = `sha256:${sha256(JSON.stringify({ publicBundle, codeSha256: publicBundle.starterCodeHash }))}`;
        const runs: Array<Record<string, unknown>> = [];
        for (let repeat = 1; repeat <= 3; repeat += 1) {
          const prepared = await adapter.prepare({
            activity: {
              activityId,
              kind: activity.kind,
              profileRevision: 3,
              templateVersion: activity.templateVersion,
              environmentRef: environmentLock.environmentId,
            },
            profileRevision: 3,
            taskVersion: activity.templateVersion,
            mode: "submit",
            environment: {
              environmentId: environmentLock.environmentId,
              status: "measured_node_submit",
              environmentHash: environmentLock.environmentHash,
              prototypeEvidenceRef: "scripts/w3-code-evaluation/environment-prototype-evidence.json",
            },
            assetBundleHash: bundle!.assetBundleHash,
          } as never);
          const startedAt = performance.now();
          const result = await adapter.run({
            requestId: `w5-d3-${activityId}-${variant}-${repeat}`,
            attemptId: `w5-d3-${activityId}-${variant}-${repeat}`,
            prepared,
            code: submissionCode,
          }, new AbortController().signal);
          const elapsedMs = Math.round((performance.now() - startedAt) * 1_000) / 1_000;
          runs.push(safeResult({
            repeat,
            elapsedMs,
            executionStatus: result.executionStatus,
            verdict: result.verdict,
            score: result.score ?? null,
            errorKind: result.errorKind ?? null,
            errorCode: result.errorCode ?? null,
            evaluatorVersion: result.evaluatorVersion,
            environmentHash: result.environmentHash,
            assetBundleHash: result.assetBundleHash,
          }));
        }
        groups.push({
          stableInputId: `public-${activityId}-${variant}`,
          inputSource: "revision-3-public-execution-bundle",
          inputContentSummary: {
            activityId,
            profileRevision: 3,
            runId: publicBundle.runId,
            publicBundleHash: publicBundle.bundleHash,
            publicDatasetFiles: publicBundle.publicDatasetFiles.map((file) => ({ name: file.name, bytes: file.content.length, sha256: file.hash })),
            publicTestSourcesSha256: publicBundle.publicTestSources.map((source) => `sha256:${sha256(source)}`),
            submission: variant === 1 ? "public starterCode" : "public starterCode with deterministic syntax-error suffix",
            submissionSha256: publicBundle.starterCodeHash,
          },
          inputSha256,
          activityId,
          profileRevision: 3,
          nodeRuns: runs,
          nodeFieldsIdentical: runs.every((run) => {
            const { repeat: _repeat, elapsedMs: _elapsedMs, ...fields } = run;
            const { repeat: _firstRepeat, elapsedMs: _firstElapsedMs, ...firstFields } = runs[0]!;
            return JSON.stringify(fields) === JSON.stringify(firstFields);
          }),
          pyodide: { status: "NOT_RUN", errorCode: "PYODIDE_CANDIDATE_UNAVAILABLE" },
          adapterVersion: "node-python-evaluator-w3-c1",
          evaluatorVersion: "node-python-evaluator-w3-c1",
          outputSensitiveFields: [],
        });
      }
    }
    expect(groups).toHaveLength(10);
    expect(new Set(groups.map((group) => group.inputSha256)).size).toBe(10);
    await writeFile(outputPath, `${JSON.stringify({
      schemaVersion: 1,
      contract: "W5-C1/W5-R1",
      baselineCommit: "383690831a8b3de42dad58795e71f218678f6fbc",
      decisionId: "W5-D64-PYODIDE-1",
      pyodideDecision: "PYODIDE_DISABLED_WITH_NODE_FALLBACK",
      pyodideEnabled: false,
      liveModel: "LIVE_NOT_RUN",
      groups,
    }, null, 2)}\n`, "utf8");
  }, 300_000);
});
