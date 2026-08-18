import { describe, expect, it } from "vitest";
import { ProfileFamilyCodeActivityAssetResolver } from "../src/application/code-activity-facade-adapter.js";
import { sha256Text } from "../src/application/public-execution-bundle.js";
import type { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const publicData = "x\n1\n";
const privateData = "hidden\n42\n";
const publicTest = "def test_public():\n    assert True\n";

function fixture(overrides: {
  publicTestPath?: string;
  publicTestVisibility?: string;
  publicTestHash?: string;
  publicTestFixtureRefs?: readonly string[];
  publicFixturePath?: string;
  publicFixtureHash?: string;
  publicTestIds?: readonly string[];
} = {}) {
  const activity = {
    activityId: "code",
    profileRevision: 3,
    kind: "code_completion",
    title: "Code",
    prompt: "Complete it",
    primaryKnowledgePointId: "kp",
    supportingKnowledgePointIds: [],
    starterCode: "print('starter')",
    templateVersion: "3.0.0",
    environmentRef: "env",
    datasetRefs: ["dataset-public", "dataset-private"],
    publicTestRefs: overrides.publicTestIds ?? ["test-public"],
  };
  const publicTestPath = overrides.publicTestPath ?? "assessments/public/tests/test-public.py";
  const publicFixturePath = overrides.publicFixturePath ?? "datasets/public/data.csv";
  const files = new Map<string, string>([
    ["activities/activities.json", JSON.stringify({ activities: [activity] })],
    ["assessments/private/task-bundles.json", JSON.stringify({ bundles: [{
      bundleId: "bundle-code",
      source: "profile_fixed",
      activity,
      publicTests: [{
        testId: "test-public",
        visibility: overrides.publicTestVisibility ?? "public",
        fileRef: publicTestPath,
        fixtureRefs: overrides.publicTestFixtureRefs ?? ["dataset-public"],
        assetHash: overrides.publicTestHash ?? sha256Text(publicTest),
      }],
      hiddenTests: [{ fileRef: "assessments/private/tests/test-hidden.py" }],
      rubric: { passThreshold: 1 },
      referenceSolutionRef: "reference-solutions/solution.py",
      environmentRef: "env",
      assetBundleHash: "a".repeat(64),
    }] })],
    ["datasets/fixtures.json", JSON.stringify({ fixtures: [
      { fixtureId: "dataset-public", visibility: "public", fileRef: publicFixturePath, assetHash: overrides.publicFixtureHash ?? sha256Text(publicData) },
      { fixtureId: "dataset-private", visibility: "private", fileRef: "datasets/private/hidden.csv", assetHash: sha256Text(privateData) },
    ] })],
    ["environments/environment-lock.json", JSON.stringify({ environmentId: "env", status: "measured_node_submit", environmentHash: `sha256:${"b".repeat(64)}`, prototypeEvidenceRef: "evidence" })],
    ["knowledge/knowledge.json", JSON.stringify({ knowledgePoints: [{ id: "kp", requiresCodeEvidence: true }] })],
    [publicFixturePath, publicData],
    [publicTestPath, publicTest],
  ]);
  const reads: string[] = [];
  const profiles = {
    async loadProfileV2Revision() {
      return {
        paths: {
          activities: "activities/activities.json",
          assessments: "assessments",
          datasets: "datasets",
          environments: "environments/environment-lock.json",
          knowledge: "knowledge/knowledge.json",
        },
      };
    },
    async readProfileV2RevisionFile(_subjectId: string, _revision: number, path: string) {
      reads.push(path);
      const value = files.get(path);
      if (value === undefined) throw new Error(`unexpected read: ${path}`);
      return value;
    },
  } as unknown as ProfileFamilyRepository;
  return { resolver: new ProfileFamilyCodeActivityAssetResolver(profiles), reads };
}

describe("W5 A public execution asset projection", () => {
  it("projects only verified public datasets and tests from a private TaskBundle", async () => {
    const { resolver, reads } = fixture();
    const assets = await resolver.load("subject", 3, "code");
    expect(assets.publicDatasetFiles).toEqual([{ name: "data.csv", content: publicData, hash: sha256Text(publicData) }]);
    expect(assets.publicTestSources).toEqual([publicTest]);
    expect(reads).not.toContain("datasets/private/hidden.csv");
    expect(reads).not.toContain("assessments/private/tests/test-hidden.py");
    expect(JSON.stringify({ datasets: assets.publicDatasetFiles, tests: assets.publicTestSources }))
      .not.toMatch(/hiddenTests?|referenceSolution|rubric|datasets\/private/iu);
  });

  it.each([
    ["private test path", { publicTestPath: "assessments/private/tests/test-public.py" }],
    ["Windows host path", { publicTestPath: "C:\\private\\test-public.py" }],
    ["private test visibility", { publicTestVisibility: "hidden" }],
    ["private fixture reference", { publicTestFixtureRefs: ["dataset-private"] }],
    ["test content hash mismatch", { publicTestHash: `sha256:${"0".repeat(64)}` }],
    ["dataset content hash mismatch", { publicFixtureHash: `sha256:${"0".repeat(64)}` }],
    ["test declaration mismatch", { publicTestIds: ["other-test"] }],
  ] as const)("rejects %s without projecting private assets", async (_label, override) => {
    const { resolver } = fixture(override);
    await expect(resolver.load("subject", 3, "code")).rejects.toMatchObject({ errorCode: "test_asset_invalid" });
  });
});
