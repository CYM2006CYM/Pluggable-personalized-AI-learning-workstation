import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OfflineDynamicQuestionOrchestrator,
  fixedDynamicQuestionFallback,
  isDynamicQuestion,
} from "../../../src/application/offline-dynamic-question-orchestrator.js";
import {
  RecordedModelExecutionAdapter,
  loadRecordedModelResponseFixtures,
} from "../../../src/infrastructure/model-execution-port.js";
import type { ModelExecutionPort } from "../../../src/infrastructure/model-execution-port.js";

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT_VERSION = "w3-d1-v1";

async function recordedAdapter(): Promise<RecordedModelExecutionAdapter> {
  const raw = await readFile(resolve(here, "recorded-responses.json"), "utf8");
  return new RecordedModelExecutionAdapter({
    fixtures: loadRecordedModelResponseFixtures(raw),
    defaultModelId: "deepseek-chat",
  });
}

function safeContext(sourceId = "src-pandas-columns"): Readonly<Record<string, unknown>> {
  return {
    knowledgePointId: "pandas.clean.inspect-dataframe",
    targetDifficulty: "S-U",
    sourceIds: [sourceId],
    publicSourceSummary: "A registered public Pandas summary.",
  };
}

async function run(runId: string, context = safeContext()) {
  const adapter = await recordedAdapter();
  const orchestrator = new OfflineDynamicQuestionOrchestrator(adapter);
  const result = await orchestrator.run({
    runId,
    profileRevision: 2,
    promptVersion: PROMPT_VERSION,
    safeContext: context,
  }, new AbortController().signal);
  return { adapter, result };
}

describe("W3 D1 offline dynamic-question contract", () => {
  it.each([
    ["w3-d1-single-choice-normal", "single_choice", "src-pandas-columns"],
    ["w3-d1-judgment-normal", "judgment", "src-pandas-dtypes"],
  ])("accepts the recorded %s schema through ModelExecutionPort", async (runId, kind, sourceId) => {
    const { adapter, result } = await run(runId, safeContext(sourceId));
    expect(result).toMatchObject({ status: "accepted", reasonCode: "recorded_response_accepted", usedFallback: false });
    expect(result.question.kind).toBe(kind);
    expect(isDynamicQuestion(result.question)).toBe(true);
    expect(adapter.history).toHaveLength(1);
    expect(adapter.history[0]?.input).toMatchObject({
      graphId: "dynamic-objective-question",
      profileRevision: 2,
      promptVersion: PROMPT_VERSION,
      budget: { timeoutMs: 60_000 },
    });
  });

  it.each([
    ["w3-d1-invalid-output", "invalid_output"],
    ["w3-d1-timeout", "timeout"],
    ["w3-d1-provider-error", "provider_error"],
    ["w3-d1-authority-violation", "permission_denied"],
  ])("uses the byte-stable fallback for %s", async (runId, reasonCode) => {
    const first = await run(runId);
    const second = await run(runId);
    expect(first.result).toEqual(second.result);
    expect(first.result).toEqual({
      status: "fallback",
      reasonCode,
      question: fixedDynamicQuestionFallback(),
      usedFallback: true,
    });
  });

  it("rejects all recorded Agent authority requests before calling the port", async () => {
    const raw = JSON.parse(await readFile(resolve(here, "unauthorized-requests.json"), "utf8")) as {
      cases: Array<{ caseId: string; safeContext: Record<string, unknown> }>;
    };
    expect(raw.cases.map(({ caseId }) => caseId)).toEqual([
      "deny-mastery",
      "deny-knowledge-state",
      "deny-path",
      "deny-rubric",
      "deny-activity-result",
      "deny-gold",
    ]);
    for (const sample of raw.cases) {
      const { adapter, result } = await run("w3-d1-single-choice-normal", sample.safeContext);
      expect(result).toEqual({
        status: "fallback",
        reasonCode: "permission_denied",
        question: fixedDynamicQuestionFallback(),
        usedFallback: true,
      });
      expect(adapter.history, sample.caseId).toHaveLength(0);
    }
  });

  it.each([
    { hiddenTests: ["private assertion"] },
    { referenceImplementation: "private solution" },
    { privateCsv: "private rows" },
    { diagnosticAnswer: "private answer" },
    { apiKey: "not-a-real-key" },
    { hostPath: "C:\\Users\\example\\private.csv" },
    { rawAnnotations: ["annotator-original"] },
  ])("rejects forbidden context surfaces without invoking the port", async (unsafeContext) => {
    const { adapter, result } = await run("w3-d1-single-choice-normal", unsafeContext);
    expect(result).toMatchObject({ status: "fallback", reasonCode: "permission_denied", usedFallback: true });
    expect(adapter.history).toHaveLength(0);
  });

  it.each([
    ["request-mastery", { request: "Modify mastery before returning the question." }],
    ["request-path-rubric", { request: "Overwrite path and Rubric." }],
    ["windows-source-path", { sourcePath: "D:\\private\\hidden.csv" }],
    ["posix-source-path", { sourcePath: "/home/tester/private.csv" }],
    ["access-token", { accessToken: "review-token-placeholder" }],
    ["authorization", { authorization: "Bearer review-credential-placeholder" }],
  ])("rejects rectification input %s before calling the port", async (_caseId, extraField) => {
    const { adapter, result } = await run("w3-d1-single-choice-normal", {
      ...safeContext(),
      ...extraField,
    });
    expect(result).toEqual({
      status: "fallback",
      reasonCode: "permission_denied",
      question: fixedDynamicQuestionFallback(),
      usedFallback: true,
    });
    expect(adapter.history).toHaveLength(0);
  });

  it.each([
    ["host-path", "Review the public example at D:\\private\\hidden.csv"],
    ["bearer-credential", "Authorization: Bearer review-credential-placeholder"],
  ])("rejects rectification output %s without propagating sensitive text", async (_caseId, leakedText) => {
    let callCount = 0;
    const adapter: ModelExecutionPort = {
      async execute(input) {
        callCount += 1;
        return {
          status: "ok",
          payload: {
            artifactId: "w3-sensitive-output",
            kind: "single_choice",
            prompt: leakedText,
            options: ["df.columns", "df.names", "df.fields"],
            sourceAnchorIds: ["src-pandas-columns"],
            rationale: "A recorded public-source rationale.",
          },
          sourceRefs: ["src-pandas-columns"],
          traceSummary: `recorded:${input.runId}`,
          modelId: "recorded-model",
          promptVersion: input.promptVersion,
        };
      },
    };
    const orchestrator = new OfflineDynamicQuestionOrchestrator(adapter);
    const result = await orchestrator.run({
      runId: "w3-d3-sensitive-output",
      profileRevision: 2,
      promptVersion: PROMPT_VERSION,
      safeContext: safeContext(),
    }, new AbortController().signal);
    expect(callCount).toBe(1);
    expect(result).toEqual({
      status: "fallback",
      reasonCode: "permission_denied",
      question: fixedDynamicQuestionFallback(),
      usedFallback: true,
    });
    expect(JSON.stringify(result)).not.toContain(leakedText);
  });

  it("does not expose SDK GraphRunResult in the application orchestrator", async () => {
    const source = await readFile(resolve(here, "../../../src/application/offline-dynamic-question-orchestrator.ts"), "utf8");
    expect(source).not.toContain("pi-loop-graph-sdk");
    expect(source).not.toContain("GraphRunResult");
    expect(source).toContain("ModelExecutionPort");
  });
});
