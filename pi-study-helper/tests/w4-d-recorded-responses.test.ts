import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdaptiveContentService } from "../src/application/adaptive-content-service.js";
import { CapabilityTaskService } from "../src/application/capability-task-service.js";
import { loadRecordedModelResponseFixtures, RecordedModelExecutionAdapter } from "../src/infrastructure/model-execution-port.js";
import { ProfileAdaptiveContentSourceProvider } from "../src/infrastructure/profile-adaptive-source-provider.js";
import { InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";

const recordingsPath = resolve("fixtures/model-responses/w4/recorded-responses.json");
const profileRoot = resolve("fixtures/profiles/pandas-cleaning-revision-3-draft");

describe("W4 D recorded response set", () => {
  it("loads through the formal ModelExecutionPort fixture boundary and covers six required classes", async () => {
    const raw = await readFile(recordingsPath, "utf8");
    const fixtures = loadRecordedModelResponseFixtures(raw);
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    expect(fixtures.some((item) => item.status === "ok")).toBe(true);
    expect(fixtures.some((item) => item.status === "invalid_output")).toBe(true);
    expect(fixtures.some((item) => item.status === "timeout")).toBe(true);
    expect(fixtures.some((item) => item.status === "provider_error")).toBe(true);
    expect(fixtures.some((item) => item.runId.includes("high-risk"))).toBe(true);
    expect(fixtures.some((item) => item.runId.includes("authority-rejected"))).toBe(true);
    expect(raw).not.toMatch(/Authorization\s*:\s*Bearer|OPENAI_API_KEY\s*[:=]\s*[^"\]]|[A-Za-z]:\\|\\\\[^"\s]+\\|\/(?:home|Users)\//u);
    expect(raw).not.toContain("w4-read-csv-f1");
    expect(raw).not.toContain("demo-recommended");
    expect(raw).not.toContain("demo-evidence-1");
  });

  it("keeps the historical one-question candidate frozen and rejects it under the strengthened quiz contract", async () => {
    const fixtures = loadRecordedModelResponseFixtures(await readFile(recordingsPath, "utf8"));
    const adapter = new RecordedModelExecutionAdapter({ fixtures, defaultModelId: "deepseek-chat" });
    const provider = new ProfileAdaptiveContentSourceProvider({ resolveProfileRoot: () => profileRoot });
    const service = new AdaptiveContentService({ modelExecutionPort: adapter, sourceProvider: provider,
      privateStore: new InMemoryW4PrivateRuntimeStore(), modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    await expect(service.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });
    await expect(service.prepareCard({ profileRevision: 3, knowledgePointId: "pandas.clean.read-csv", excludedArtifactIds: ["card-w4-read-csv"] }))
      .resolves.toMatchObject({ status: "accepted", card: { cardId: "dynamic-card-read-csv" } });
    expect(adapter.history.map((item) => item.input.graphId)).toEqual(["generator", "generator", "generator", "hunter", "judge"]);
  });

  it("replays the six required no-key trajectory classes through ModelExecutionPort", async () => {
    const fixtures = loadRecordedModelResponseFixtures(await readFile(recordingsPath, "utf8"));
    const adapter = new RecordedModelExecutionAdapter({ fixtures, defaultModelId: "deepseek-chat" });
    const cases = [
      ["generator", "w4-521146de2e8627972b4da81c.generator", "ok"],
      ["generator", "w4-invalid-schema.generator", "invalid_output"],
      ["generator", "w4-timeout.generator", "timeout"],
      ["generator", "w4-provider-error.generator", "provider_error"],
      ["judge", "w4-high-risk.judge", "ok"],
      ["generator", "w4-authority-rejected.generator", "ok"],
    ] as const;
    for (const [graphId, runId, status] of cases) {
      const result = await adapter.execute({ graphId, runId, profileRevision: 3, promptVersion: "w4-d2-v1",
        safeContext: { sourceIds: ["src-pandas-read-csv"] }, budget: { timeoutMs: 60_000 } }, new AbortController().signal);
      expect(result.status).toBe(status);
    }
    expect(adapter.history).toHaveLength(cases.length);
  });

  it("replays an asynchronous partial capability snapshot and leaves unobserved dimensions unverified", async () => {
    const fixtures = loadRecordedModelResponseFixtures(await readFile(recordingsPath, "utf8"));
    const adapter = new RecordedModelExecutionAdapter({ fixtures, defaultModelId: "deepseek-chat" });
    const capability = new CapabilityTaskService({ modelExecutionPort: adapter,
      evidenceProvider: { load: async () => [{ evidenceId: "formal-evidence-1", observableDimensionIds: ["syntax_api"], safeSummary: "Bound deterministic activity evidence." }] },
      privateStore: new InMemoryW4PrivateRuntimeStore(), modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    await capability.enqueue({ trigger: "diagnostic_completed", sessionId: "session-3da523ed0736ba9ce580f8b9", profileRevision: 3,
      evidenceVersion: 1, evidenceIds: ["formal-evidence-1"] });
    await capability.waitForIdle();
    const snapshot = await capability.getSnapshot("session-3da523ed0736ba9ce580f8b9");
    expect(snapshot).toMatchObject({ status: "partial" });
    expect(snapshot?.dimensions).toHaveLength(5);
    expect(snapshot?.dimensions[0]).toMatchObject({ id: "syntax_api", state: "verified" });
    expect(snapshot?.dimensions.slice(1).every((dimension) => dimension.state === "unverified")).toBe(true);
  });
});
