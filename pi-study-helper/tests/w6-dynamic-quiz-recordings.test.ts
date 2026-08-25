import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdaptiveContentService } from "../src/application/adaptive-content-service.js";
import { loadRecordedModelResponseFixtures, RecordedModelExecutionAdapter } from "../src/infrastructure/model-execution-port.js";
import { ProfileAdaptiveContentSourceProvider } from "../src/infrastructure/profile-adaptive-source-provider.js";
import { InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";

const recordingPath = resolve("fixtures/model-responses/w6/recorded-quiz-responses.json");
const profileRoot = resolve("fixtures/profiles/pandas-cleaning-revision-3-draft");
const activities = [
  "act-read-csv",
  "act-quiz-inspect-dataframe",
  "act-quiz-missing-values",
  "act-quiz-duplicate-orders",
  "act-quiz-type-format",
  "act-quiz-validate-result",
] as const;

describe("W6 dynamic quiz recorded candidates", () => {
  it("passes only the selected RichLesson正文到题目生成上下文", async () => {
    const provider = new ProfileAdaptiveContentSourceProvider({ resolveProfileRoot: () => profileRoot });
    const guided = await provider.forQuiz({ profileRevision: 3, activityId: "act-read-csv", lessonVariantId: "guided" });
    const practice = await provider.forQuiz({ profileRevision: 3, activityId: "act-read-csv", lessonVariantId: "practice" });
    expect(guided.lessonVariantId).toBe("guided");
    expect(guided.publicSourceSummary).toContain("正文模块 intuition 标题");
    expect(guided.publicSourceSummary).toContain("read_csv");
    expect(practice.publicSourceSummary).toContain("教学版本: 案例优先");
    expect(practice.publicSourceSummary).not.toContain('"variants"');
    expect(practice.publicSourceSummary).not.toMatch(/sourceDocument|sourceDocumentSha256|hidden tests|reference solution|rubric/iu);
    expect(practice.publicSourceSummary).not.toContain("deepseek");
  });

  it("rejects stale recorded questions after the authoritative lesson digest changes", async () => {
    const raw = await readFile(recordingPath, "utf8");
    const adapter = new RecordedModelExecutionAdapter({
      fixtures: loadRecordedModelResponseFixtures(raw),
      defaultModelId: "deepseek-chat",
    });
    const service = new AdaptiveContentService({
      modelExecutionPort: adapter,
      sourceProvider: new ProfileAdaptiveContentSourceProvider({ resolveProfileRoot: () => profileRoot }),
      privateStore: new InMemoryW4PrivateRuntimeStore(),
      modelId: "deepseek-chat",
      promptVersion: "w4-d2-v1",
      executionMode: "recorded_response",
    });

    for (const activityId of activities) {
      const result = await service.prepareQuiz({ profileRevision: 3, activityId, retryNumber: 0, excludedQuestionIds: [] });
      expect(result).toEqual({ status: "unavailable" });
    }

    expect(adapter.history.length).toBeGreaterThanOrEqual(activities.length);
    expect(adapter.history.every((entry) => entry.input.graphId === "generator")).toBe(true);
    expect(raw).not.toMatch(/[A-Za-z]:\\|Authorization\s*:\s*Bearer|media_locator|hidden tests|reference solution/u);
  });
});
