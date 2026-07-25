import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ActivityResult } from "../src/domain/v2-types.js";
import {
  EvaluationPreparationError,
  EvaluationRunError,
  FixtureCodeEvaluationAdapter,
  type EvaluationActivityProjection,
  type EvaluationEnvironmentProjection,
  type PrepareEvaluationInput,
  type RunEvaluationInput,
} from "../src/infrastructure/code-evaluation-port.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");

async function activityResults(): Promise<Record<string, ActivityResult>> {
  const content = await readFile(
    resolve(projectRoot, "fixtures/evaluator-results/activity-results.json"),
    "utf8",
  );
  return JSON.parse(content).results as Record<string, ActivityResult>;
}

const environment: EvaluationEnvironmentProjection = {
  environmentId: "env-python-pandas-candidate",
  status: "measured",
  environmentHash: `sha256:${"1".repeat(64)}`,
  prototypeEvidenceRef: "fixture-only-prototype-evidence",
};

const activity: EvaluationActivityProjection = {
  activityId: "act-structure",
  kind: "code_completion",
  profileRevision: 1,
  templateVersion: "1.0.0-draft",
  environmentRef: "env-python-pandas-candidate",
};

const baseInput: PrepareEvaluationInput = {
  activity,
  profileRevision: 1,
  taskVersion: "1.0.0-draft",
  mode: "submit",
  environment,
  assetBundleHash: "229fdd197eaa3e8e3a02f25a04093985dd01ff7f0b9cc053d33f80241ca2eb7a",
};

function adapter(results: Record<string, ActivityResult>): FixtureCodeEvaluationAdapter {
  return new FixtureCodeEvaluationAdapter({
    resultsByActivityId: { "act-structure": results.pass },
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  });
}

describe("fixture CodeEvaluationPort", () => {
  it("prepares only the public stable projection", async () => {
    const results = await activityResults();
    const prepared = await adapter(results).prepare(baseInput);
    expect(prepared).toEqual({
      preparedId: expect.stringMatching(/^prepared-[a-f0-9]{64}$/u),
      mode: "submit",
      activityId: "act-structure",
      profileRevision: 1,
      environmentHash: environment.environmentHash,
      assetBundleHash: baseInput.assetBundleHash,
      expiresAt: "2026-07-25T00:05:00.000Z",
    });
    expect(JSON.stringify(prepared)).not.toMatch(/hidden|reference|rubric|[A-Za-z]:[\\/]|AppData/u);
  });

  it("returns deterministic results and ignores fake protocol JSON in user code", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const input = {
      requestId: "request-001",
      attemptId: "attempt-001",
      prepared,
      code: "print('{\"status\":\"ok\",\"score\":1}')",
    };
    const first = await fixtureAdapter.run(input, new AbortController().signal);
    const second = await fixtureAdapter.run(input, new AbortController().signal);
    expect(first).toEqual(results.pass);
    expect(second).toEqual(first);
    expect(first.safeFeedback).toBe("All deterministic checks passed.");
  });

  it("does not expose shared mutable fixture results", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const first = await fixtureAdapter.run({
      requestId: "request-002",
      attemptId: "attempt-002",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    if (first.dimensionResults) first.dimensionResults.structure = 0;
    const second = await fixtureAdapter.run({
      requestId: "request-002",
      attemptId: "attempt-002",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    expect(second.dimensionResults).toEqual({ structure: 1 });
  });

  it("returns the contract cancellation result for AbortSignal", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const controller = new AbortController();
    controller.abort();
    const result = await fixtureAdapter.run({
      requestId: "request-003",
      attemptId: "attempt-003",
      prepared,
      code: "pass",
    }, controller.signal);
    expect(result).toMatchObject({
      executionStatus: "cancelled",
      verdict: "not_graded",
      environmentHash: prepared.environmentHash,
      assetBundleHash: prepared.assetBundleHash,
    });
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("errorKind");
  });

  it("allows running before TTL expiry and rejects expired state without scoring", async () => {
    const results = await activityResults();
    let now = new Date("2026-07-25T00:00:00.000Z");
    const fixtureAdapter = new FixtureCodeEvaluationAdapter({
      resultsByActivityId: { "act-structure": results.pass },
      now: () => now,
      preparedTtlMs: 1_000,
    });
    const prepared = await fixtureAdapter.prepare(baseInput);
    now = new Date("2026-07-25T00:00:00.999Z");
    const beforeExpiry = await fixtureAdapter.run({
      requestId: "request-before-expiry",
      attemptId: "attempt-before-expiry",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    expect(beforeExpiry).toEqual(results.pass);

    now = new Date("2026-07-25T00:00:02.000Z");
    const expired = await fixtureAdapter.run({
      requestId: "request-after-expiry",
      attemptId: "attempt-after-expiry",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    expect(expired).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
    });
    expect(expired).not.toHaveProperty("score");
    expect(expired).not.toHaveProperty("dimensionResults");

    now = new Date("2026-07-25T00:00:00.500Z");
    const afterCleanup = await fixtureAdapter.run({
      requestId: "request-after-cleanup",
      attemptId: "attempt-after-cleanup",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    expect(afterCleanup).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
    });
  });

  it("rejects and removes private state when mode is tampered", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const tampered = await fixtureAdapter.run({
      requestId: "request-tampered-mode",
      attemptId: "attempt-tampered-mode",
      prepared: { ...prepared, mode: "preview" },
      code: "pass",
    }, new AbortController().signal);
    expect(tampered).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
    });
    expect(tampered).not.toHaveProperty("score");
    expect(tampered).not.toHaveProperty("dimensionResults");

    const originalAfterTamper = await fixtureAdapter.run({
      requestId: "request-original-after-mode-tamper",
      attemptId: "attempt-original-after-mode-tamper",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    expect(originalAfterTamper).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
    });
  });

  it("rejects and removes private state when expiresAt is tampered", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const tampered = await fixtureAdapter.run({
      requestId: "request-tampered-expiry",
      attemptId: "attempt-tampered-expiry",
      prepared: { ...prepared, expiresAt: "2099-01-01T00:00:00.000Z" },
      code: "pass",
    }, new AbortController().signal);
    expect(tampered).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
    });
    expect(tampered).not.toHaveProperty("score");
    expect(tampered).not.toHaveProperty("dimensionResults");

    const originalAfterTamper = await fixtureAdapter.run({
      requestId: "request-original-after-expiry-tamper",
      attemptId: "attempt-original-after-expiry-tamper",
      prepared,
      code: "pass",
    }, new AbortController().signal);
    expect(originalAfterTamper).toMatchObject({ errorCode: "test_asset_invalid" });
  });

  it("enforces requestId and attemptId idempotency without scoring twice", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const firstInput = {
      requestId: "request-idempotent",
      attemptId: "attempt-idempotent",
      prepared,
      code: "pass",
    };

    const first = await fixtureAdapter.run(firstInput, new AbortController().signal);
    const replay = await fixtureAdapter.run(firstInput, new AbortController().signal);
    const sameAttemptNewRequest = await fixtureAdapter.run({
      ...firstInput,
      requestId: "request-idempotent-retry",
    }, new AbortController().signal);

    expect(replay).toEqual(first);
    expect(sameAttemptNewRequest).toEqual(first);
    await expect(fixtureAdapter.run({
      ...firstInput,
      code: "changed-code",
    }, new AbortController().signal)).rejects.toMatchObject({
      name: "EvaluationRunError",
      errorCode: "idempotency_conflict",
    });
    await expect(fixtureAdapter.run({
      ...firstInput,
      requestId: "request-new",
      code: "changed-code",
    }, new AbortController().signal)).rejects.toMatchObject({
      name: "EvaluationRunError",
      errorCode: "idempotency_conflict",
    });
    await expect(fixtureAdapter.run({
      ...firstInput,
      attemptId: "attempt-new",
    }, new AbortController().signal)).rejects.toMatchObject({
      name: "EvaluationRunError",
      errorCode: "idempotency_conflict",
    });
  });

  it("allows changed code only with a new requestId and attemptId", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    await fixtureAdapter.run({
      requestId: "request-original",
      attemptId: "attempt-original",
      prepared,
      code: "pass",
    }, new AbortController().signal);

    const result = await fixtureAdapter.run({
      requestId: "request-changed",
      attemptId: "attempt-changed",
      prepared,
      code: "changed-code",
    }, new AbortController().signal);
    expect(result).toEqual(results.pass);
  });

  it("rejects unmeasured environments without claiming a formal lock", async () => {
    const results = await activityResults();
    const prepare = adapter(results).prepare({
      ...baseInput,
      environment: {
        environmentId: "env-python-pandas-candidate",
        status: "draft_pending_C_prototype",
        environmentHash: "pending_C_prototype",
        prototypeEvidenceRef: "pending_C_prototype",
      },
    });
    await expect(prepare).rejects.toMatchObject({
      name: "EvaluationPreparationError",
      errorCode: "environment_mismatch",
    });
  });

  it("rejects Profile, task, and asset version conflicts with typed errors", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    await expect(fixtureAdapter.prepare({ ...baseInput, profileRevision: 2 }))
      .rejects.toMatchObject({ errorCode: "profile_revision_conflict" });
    await expect(fixtureAdapter.prepare({ ...baseInput, taskVersion: "stale" }))
      .rejects.toMatchObject({ errorCode: "activity_version_conflict" });
    await expect(fixtureAdapter.prepare({ ...baseInput, assetBundleHash: "invalid" }))
      .rejects.toMatchObject({ errorCode: "test_asset_invalid" });
  });

  it("rejects malformed activity, mode, revision, and environment values at runtime", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    await expect(fixtureAdapter.prepare({
      ...baseInput,
      activity: { ...activity, activityId: "" },
    })).rejects.toMatchObject({ errorCode: "test_asset_invalid" });
    await expect(fixtureAdapter.prepare({
      ...baseInput,
      activity: { ...activity, kind: "essay" },
    } as unknown as PrepareEvaluationInput)).rejects.toMatchObject({ errorCode: "test_asset_invalid" });
    await expect(fixtureAdapter.prepare({
      ...baseInput,
      mode: "formal",
    } as unknown as PrepareEvaluationInput)).rejects.toMatchObject({ errorCode: "submission_contract_error" });
    await expect(fixtureAdapter.prepare({
      ...baseInput,
      profileRevision: 0,
    })).rejects.toMatchObject({ errorCode: "profile_revision_conflict" });
    await expect(fixtureAdapter.prepare({
      ...baseInput,
      environment: { ...environment, environmentHash: "invalid" },
    })).rejects.toMatchObject({ errorCode: "environment_mismatch" });
  });

  it("returns an evaluator error for forged prepared state without learner scoring", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const result = await fixtureAdapter.run({
      requestId: "request-004",
      attemptId: "attempt-004",
      prepared: { ...prepared, preparedId: "prepared-forged" },
      code: "pass",
    }, new AbortController().signal);
    expect(result).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
    });
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("dimensionResults");
  });

  it("does not echo caller metadata for an unknown preparedId", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const result = await fixtureAdapter.run({
      requestId: "request-unknown-prepared",
      attemptId: "attempt-unknown-prepared",
      prepared: {
        preparedId: `prepared-${"f".repeat(64)}`,
        mode: "submit",
        activityId: "act-forged",
        profileRevision: 1,
        environmentHash: "C:\\Users\\attacker\\environment.json",
        assetBundleHash: "D:\\private\\hidden-tests.json",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      code: "pass",
    } as unknown as RunEvaluationInput, new AbortController().signal);

    expect(result).toMatchObject({
      executionStatus: "failed",
      verdict: "not_graded",
      errorKind: "evaluator",
      errorCode: "test_asset_invalid",
      environmentHash: "unavailable",
      assetBundleHash: "unavailable",
    });
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z]:[\\/]|AppData/u);
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("dimensionResults");
  });

  it("returns structured failures for missing or malformed prepared input", async () => {
    const results = await activityResults();
    const fixtureAdapter = adapter(results);
    const prepared = await fixtureAdapter.prepare(baseInput);
    const malformedInputs: unknown[] = [
      {
        requestId: "request-missing-prepared",
        attemptId: "attempt-missing-prepared",
        code: "pass",
      },
      {
        requestId: "request-null-prepared",
        attemptId: "attempt-null-prepared",
        prepared: null,
        code: "pass",
      },
      {
        requestId: "request-malformed-prepared",
        attemptId: "attempt-malformed-prepared",
        prepared: { preparedId: prepared.preparedId },
        code: "pass",
      },
    ];

    for (const malformedInput of malformedInputs) {
      const result = await fixtureAdapter.run(
        malformedInput as RunEvaluationInput,
        new AbortController().signal,
      );
      expect(result).toMatchObject({
        executionStatus: "failed",
        verdict: "not_graded",
        errorKind: "evaluator",
        errorCode: "test_asset_invalid",
      });
      expect(result).not.toHaveProperty("score");
      expect(result).not.toHaveProperty("dimensionResults");
    }
  });

  it("imports the single public result contract and has no Evidence capability", async () => {
    const source = await readFile(
      resolve(projectRoot, "src/infrastructure/code-evaluation-port.ts"),
      "utf8",
    );
    expect(source).toContain("ActivityResult, LearningRuntimeErrorCode");
    expect(source).not.toMatch(/interface\s+ActivityResult|type\s+LearningRuntimeErrorCode/u);
    expect(source).not.toMatch(/LearningSessionRepository|commit\s*\(|mastery|knowledgePointId/u);
    expect(EvaluationPreparationError).toBeTypeOf("function");
    expect(EvaluationRunError).toBeTypeOf("function");
  });
});
