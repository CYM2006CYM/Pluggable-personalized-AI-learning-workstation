import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveContentService } from "../src/application/adaptive-content-service.js";
import { selectDeterministicCard, selectDeterministicQuizContent } from "../src/application/deterministic-content-policy.js";
import { projectLearningCardForSession } from "../src/application/rich-lesson-selection.js";
import { ProfileFamilyQuizActivityAssetResolver } from "../src/application/quiz-activity-runtime.js";
import type { LearningCardAsset } from "../src/contracts/index.js";
import { calculateRevisionSeal, validateRevisionSeal } from "../src/domain/profile-revision-seal.js";
import type { ModelExecutionPort } from "../src/infrastructure/model-execution-port.js";
import { ProfileAdaptiveContentSourceProvider } from "../src/infrastructure/profile-adaptive-source-provider.js";
import { FileProfileUserRuntimeStore, InMemoryW4PrivateRuntimeStore } from "../src/infrastructure/w4-private-runtime-store.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const profileRoot = resolve("fixtures/profiles/pandas-cleaning-revision-3-draft");

describe("W4 D formal upstream integration", () => {
  it("independently recalculates A's revision seal entry count and B's formal tree hash", async () => {
    const calculated = await calculateRevisionSeal(profileRoot);
    expect(calculated.entries).toHaveLength(84);
    expect(calculated.assetTreeSha256).toBe("f0c009169a090de8ec9beb5afcf6aaa971f8aac847e235c96c36720f6de8d45c");
    await expect(validateRevisionSeal(profileRoot, "pandas-cleaning")).resolves.toMatchObject({
      revision: 3,
      assetTreeSha256: "f0c009169a090de8ec9beb5afcf6aaa971f8aac847e235c96c36720f6de8d45c",
    });
  });

  it("reads only public B source projections and lets A select B fixed content when every model call fails", async () => {
    const provider = new ProfileAdaptiveContentSourceProvider({ resolveProfileRoot: () => profileRoot });
    const context = await provider.forQuiz({ profileRevision: 3, activityId: "act-read-csv" });
    expect(context.publicSourceSummary).toContain("pandas.read_csv API reference");
    expect(JSON.stringify(context)).not.toMatch(/correctAnswer|private\/|reference-solutions|rubric/iu);

    const unavailablePort: ModelExecutionPort = {
      execute: vi.fn(async () => ({ status: "provider_error" as const, errorCode: "provider_error", sourceRefs: [],
        traceSummary: "recorded provider failure", modelId: "deepseek-chat", promptVersion: "w4-d2-v1" })),
    };
    const service = new AdaptiveContentService({ modelExecutionPort: unavailablePort, sourceProvider: provider,
      privateStore: new InMemoryW4PrivateRuntimeStore(), modelId: "deepseek-chat", promptVersion: "w4-d2-v1" });
    await expect(service.prepareQuiz({ profileRevision: 3, activityId: "act-read-csv", retryNumber: 0, excludedQuestionIds: [] }))
      .resolves.toEqual({ status: "unavailable" });

    const dataRoot = await mkdtemp(resolve(tmpdir(), "w4-d-fallback-")); roots.push(dataRoot);
    const repository = new ProfileFamilyRepository({ dataRoot, fixturesRoot: resolve("fixtures/profiles") });
    await repository.activateRevision3Draft("pandas-cleaning");
    const assets = await new ProfileFamilyQuizActivityAssetResolver(repository).loadAssets("pandas-cleaning", 3, "act-read-csv");
    const selected = selectDeterministicQuizContent({ dynamic: [], supplemental: assets.supplementalQuestions,
      fixed: assets.fixedQuestions, excludedQuestionIds: [], allowedSourceAnchorIds: assets.knowledgePoint.sourceAnchorIds });
    expect(selected).toMatchObject({ source: "fixed" });
    expect(selected.questions).toHaveLength(4);

    const cards = JSON.parse(await readFile(resolve(profileRoot, "cards/learning-cards.json"), "utf8")) as { cards: LearningCardAsset[] };
    const fixedAsset = cards.cards.find((item) => item?.knowledgePointId === "pandas.clean.read-csv");
    const fixedCard = fixedAsset === undefined ? undefined : projectLearningCardForSession({ fixed: fixedAsset, preference: "step_by_step" });
    expect(selectDeterministicCard({ dynamic: undefined, fixed: fixedCard, knowledgePointId: "pandas.clean.read-csv",
      contentEstimatedMinutes: 8, allowedSourceAnchorIds: ["src-pandas-read-csv"] })).toMatchObject({ source: "fixed" });
  });

  it("places runtime-private checkpoint data only below the Profile family _user directory", async () => {
    const family = await mkdtemp(resolve(tmpdir(), "w4-d-private-store-")); roots.push(family);
    const store = new FileProfileUserRuntimeStore(family);
    await store.write("adaptive-checkpoint", "card:3:same", { artifactKind: "card", private: true });
    await expect(store.read("adaptive-checkpoint", "card:3:same")).resolves.toEqual({ artifactKind: "card", private: true });
    const expectedRoot = resolve(family, "_user", "w4-d", "adaptive-checkpoint");
    expect(expectedRoot.startsWith(resolve(family, "_user"))).toBe(true);
    const written = await readdir(family, { recursive: true });
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((entry) => entry === "_user" || entry.startsWith(`_user${process.platform === "win32" ? "\\" : "/"}`))).toBe(true);
    expect(JSON.stringify(store)).not.toContain("card:3:same");
  });
});
