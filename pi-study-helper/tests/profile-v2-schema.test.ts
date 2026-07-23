import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseProfileManifestV2,
  validateProfileV2Directory,
} from "../src/domain/profile-v2-schema.js";
import { validateCanonicalProfileDirectory } from "../src/domain/profile-schema.js";

const FIXTURES = resolve(process.cwd(), "tests", "fixtures", "profile-v2");
const VALID_FIXTURE = resolve(FIXTURES, "structurally-valid-reading");
const ASSET_PATHS = {
  manifest: "profile.json",
  goals: "goals/learning-goals.json",
  knowledge: "knowledge/knowledge-points.json",
  activities: "activities/learning-activities.json",
} as const;

type AssetName = keyof typeof ASSET_PATHS;
type JsonRecord = Record<string, unknown>;

async function readManifest(name: string): Promise<string> {
  return readFile(resolve(FIXTURES, name, "profile.json"), "utf8");
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
}

function recordArray(value: JsonRecord, key: string): JsonRecord[] {
  const items = value[key];
  if (!Array.isArray(items)) throw new Error(`Fixture field ${key} must be an array`);
  return items as JsonRecord[];
}

describe("W1-C3 Profile v2 structural and closure schema", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function cloneValidFixture(): Promise<string> {
    const temporary = await mkdtemp(resolve(tmpdir(), "pi-profile-v2-w1-c3-"));
    temporaryRoots.push(temporary);
    const directory = resolve(temporary, "profile");
    await cp(VALID_FIXTURE, directory, { recursive: true });
    return directory;
  }

  async function writeJsonAsset(directory: string, asset: AssetName, value: unknown): Promise<void> {
    await writeFile(resolve(directory, ASSET_PATHS[asset]), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  async function mutateJsonAsset(
    directory: string,
    asset: AssetName,
    mutate: (value: JsonRecord) => void,
  ): Promise<void> {
    const path = resolve(directory, ASSET_PATHS[asset]);
    const value = await readJson(path);
    mutate(value);
    await writeJsonAsset(directory, asset, value);
  }

  async function applyStaticOverride(directory: string, fixtureName: string, asset: AssetName): Promise<void> {
    const raw = await readFile(resolve(FIXTURES, fixtureName, "override.json"), "utf8");
    await writeFile(resolve(directory, ASSET_PATHS[asset]), raw, "utf8");
  }

  async function expectInvalidProfile(directory: string, message?: string): Promise<void> {
    let caught: unknown;
    try {
      await validateProfileV2Directory(directory, "draft");
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: "ProfileValidationError",
      errorCode: "invalid_profile",
    });
    if (message !== undefined) {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain(message);
    }
  }

  function commonActivity(activityId: string, kind: string): JsonRecord {
    return {
      activityId,
      profileRevision: 1,
      kind,
      allowedSources: ["profile_fixed"],
      primaryKnowledgePointId: "kp-core",
      supportingKnowledgePointIds: [],
      goalIds: ["goal-core"],
      title: `Activity ${activityId}`,
      prompt: "Complete the activity.",
      difficulty: "S-U",
      estimatedMinutes: 5,
      sourceAnchorIds: [],
      templateVersion: "fixture-1",
      leakagePolicyId: "fixture-safe",
      allowedScaffolds: ["none", "hint"],
    };
  }

  function codeActivity(activityId: string, kind: string): JsonRecord {
    return {
      ...commonActivity(activityId, kind),
      runtimePolicyId: "python-fixture",
      starterCode: "def answer():\n    pass",
      editableRegions: [{
        regionId: "region-main",
        startMarker: "def answer():",
        endMarker: "pass",
        required: true,
        maxCharacters: 200,
      }],
      entryPoint: "answer",
      outputContract: "Return a value.",
      datasetRefs: [],
      publicTestRefs: [],
      hiddenTestRefs: [],
      rubricRef: "rubric-fixture",
      referenceSolutionRef: "solution-fixture",
      knownWrongSolutionRefs: [],
      environmentRef: "environment-fixture",
      allowedLibraries: [],
    };
  }

  it("accepts the complete W1-C3 fixture and the two explicitly one-way relationships", async () => {
    const manifest = await validateProfileV2Directory(VALID_FIXTURE, "draft");
    const goals = recordArray(await readJson(resolve(VALID_FIXTURE, ASSET_PATHS.goals)), "goals");
    const points = recordArray(await readJson(resolve(VALID_FIXTURE, ASSET_PATHS.knowledge)), "knowledgePoints");
    const activities = recordArray(await readJson(resolve(VALID_FIXTURE, ASSET_PATHS.activities)), "activities");

    expect(manifest).toMatchObject({ schemaVersion: 2, status: "draft", revisionOf: null });
    expect(manifest.paths.activities).toBe("activities/learning-activities.json");
    expect(manifest["x-fixture-purpose"]).toContain("W1-C3");
    expect(manifest).not.toHaveProperty("slot");
    expect(points[0]?.relatedKnowledgePointIds).toEqual(["kp-support"]);
    expect(points[1]?.relatedKnowledgePointIds).toEqual([]);
    expect(goals[0]?.requiredActivityIds).toEqual(["activity-explain"]);
    expect(activities[0]?.goalIds).toEqual(["goal-transfer"]);
    expect(activities[0]?.supportingKnowledgePointIds).toEqual([]);
  });

  it("allows related-point cycles and a distinct supporting point without turning either into scoring evidence", async () => {
    const directory = await cloneValidFixture();
    await mutateJsonAsset(directory, "knowledge", (asset) => {
      recordArray(asset, "knowledgePoints")[1]!.relatedKnowledgePointIds = ["kp-core"];
    });
    await mutateJsonAsset(directory, "activities", (asset) => {
      recordArray(asset, "activities")[0]!.supportingKnowledgePointIds = ["kp-support"];
    });

    await expect(validateProfileV2Directory(directory, "draft")).resolves.toMatchObject({ schemaVersion: 2 });
  });

  it("rejects slot and other unknown manifest core fields as invalid_profile", async () => {
    for (const [fixture, expected] of [
      ["invalid-slot", "profile.slot is an unknown core field"],
      ["invalid-unknown-field", "profile.legacyMode is an unknown core field"],
    ] as const) {
      let caught: unknown;
      try {
        parseProfileManifestV2(await readManifest(fixture));
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ errorCode: "invalid_profile" });
      expect((caught as Error).message).toContain(expected);
    }
  });

  it("rejects path traversal before reading assets", async () => {
    const invalidPath = await readManifest("invalid-unsafe-path");
    expect(() => parseProfileManifestV2(invalidPath))
      .toThrow("profile.paths.subject must be a safe relative path");
  });

  it("enforces code and practice conditional asset paths and runtimes", async () => {
    const invalidCodeAssets = await readManifest("invalid-missing-code-assets");
    expect(() => parseProfileManifestV2(invalidCodeAssets))
      .toThrow("profile.paths.activities is required when code or practice modality is declared");
    expect(() => parseProfileManifestV2(invalidCodeAssets))
      .toThrow("profile.capabilities.runtimes must not be empty for code or practice modality");
  });

  it("rejects declared assets that are missing", async () => {
    const directory = await cloneValidFixture();
    await rm(resolve(directory, "subject.md"));
    await expectInvalidProfile(directory, "profile.paths.subject is missing, unreadable, or outside the Profile root");
  });

  it("rejects symbolic-link traversal in a declared asset path", async () => {
    const directory = await cloneValidFixture();
    const external = resolve(directory, "..", "external-chapters");
    await rm(resolve(directory, "chapters"), { recursive: true });
    await mkdir(external);
    await symlink(external, resolve(directory, "chapters"), process.platform === "win32" ? "junction" : "dir");
    await expectInvalidProfile(directory, "profile.paths.chapters must not traverse a symbolic link");
  });

  it("rejects bare arrays, wrong containers, and a second core container", async () => {
    const bareGoals = await cloneValidFixture();
    await applyStaticOverride(bareGoals, "invalid-w1-c3-goals-container", "goals");
    await expectInvalidProfile(bareGoals, "goals asset must contain an object");

    const wrongKnowledge = await cloneValidFixture();
    await writeJsonAsset(wrongKnowledge, "knowledge", { items: [] });
    await expectInvalidProfile(wrongKnowledge, "knowledge asset.items is an unknown core field");

    const secondActivityContainer = await cloneValidFixture();
    const activities = await readJson(resolve(secondActivityContainer, ASSET_PATHS.activities));
    activities.items = [];
    await writeJsonAsset(secondActivityContainer, "activities", activities);
    await expectInvalidProfile(secondActivityContainer, "activities asset.items is an unknown core field");
  });

  it("requires non-empty goal and knowledge-point arrays", async () => {
    const emptyGoals = await cloneValidFixture();
    await writeJsonAsset(emptyGoals, "goals", { goals: [] });
    await expectInvalidProfile(emptyGoals, "goals asset.goals must be a non-empty array");

    const emptyKnowledge = await cloneValidFixture();
    await writeJsonAsset(emptyKnowledge, "knowledge", { knowledgePoints: [] });
    await expectInvalidProfile(emptyKnowledge, "knowledge asset.knowledgePoints must be a non-empty array");
  });

  it("rejects duplicate goal, knowledge-point, and activity IDs", async () => {
    const duplicateGoal = await cloneValidFixture();
    await mutateJsonAsset(duplicateGoal, "goals", (asset) => {
      const goals = recordArray(asset, "goals");
      goals.push({ ...goals[0] });
    });
    await expectInvalidProfile(duplicateGoal, "goals asset contains duplicate ID goal-core");

    const duplicateKnowledge = await cloneValidFixture();
    await applyStaticOverride(duplicateKnowledge, "invalid-w1-c3-duplicate-knowledge-id", "knowledge");
    await expectInvalidProfile(duplicateKnowledge, "knowledge asset contains duplicate ID kp-core");

    const duplicateActivity = await cloneValidFixture();
    await mutateJsonAsset(duplicateActivity, "activities", (asset) => {
      const activities = recordArray(asset, "activities");
      activities.push({ ...activities[0] });
    });
    await expectInvalidProfile(duplicateActivity, "activities asset contains duplicate ID activity-explain");
  });

  it("rejects empty or non-ASCII IDs, type errors, and unknown entry fields", async () => {
    const cases: Array<{
      asset: AssetName;
      mutate: (entry: JsonRecord) => void;
      expected: string;
    }> = [
      { asset: "goals", mutate: (entry) => { entry.goalId = ""; }, expected: "goalId must be a stable ASCII identifier" },
      { asset: "knowledge", mutate: (entry) => { entry.id = "知识点"; }, expected: "id must be a stable ASCII identifier" },
      { asset: "activities", mutate: (entry) => { entry.activityId = "_activity"; }, expected: "activityId must be a stable ASCII identifier" },
      { asset: "knowledge", mutate: (entry) => { entry.importance = "high"; }, expected: "importance must be a finite number" },
      { asset: "activities", mutate: (entry) => { entry.legacyMode = true; }, expected: "legacyMode is an unknown core field" },
    ];

    for (const testCase of cases) {
      const directory = await cloneValidFixture();
      await mutateJsonAsset(directory, testCase.asset, (asset) => {
        const key = testCase.asset === "goals" ? "goals" : testCase.asset === "knowledge" ? "knowledgePoints" : "activities";
        testCase.mutate(recordArray(asset, key)[0] as JsonRecord);
      });
      await expectInvalidProfile(directory, testCase.expected);
    }
  });

  it("accepts all five complete activity shapes and rejects an incomplete subtype", async () => {
    const directory = await cloneValidFixture();
    const activities: JsonRecord[] = [
      {
        ...commonActivity("activity-mcq", "mcq"),
        subtype: "single_choice",
        options: ["A", "B"],
        evaluatorRef: "answer-fixture",
      },
      {
        ...commonActivity("activity-explain", "explain"),
        responseContract: "Provide one paragraph.",
      },
      codeActivity("activity-completion", "code_completion"),
      {
        ...codeActivity("activity-practical", "coding_practical"),
        businessAcceptanceCriteria: ["Return the required value."],
      },
      {
        ...codeActivity("activity-debug", "debug"),
        defectCategory: "logic",
      },
    ];
    await writeJsonAsset(directory, "activities", { activities });
    await mutateJsonAsset(directory, "goals", (asset) => {
      const goals = recordArray(asset, "goals");
      goals[0]!.requiredActivityIds = activities.map((activity) => activity.activityId);
      goals[1]!.finalActivityId = "activity-debug";
    });
    await mutateJsonAsset(directory, "knowledge", (asset) => {
      recordArray(asset, "knowledgePoints")[0]!.activityIds = activities.map((activity) => activity.activityId);
    });

    await expect(validateProfileV2Directory(directory, "draft")).resolves.toMatchObject({ schemaVersion: 2 });

    const incomplete = await cloneValidFixture();
    await applyStaticOverride(incomplete, "invalid-w1-c3-activity-shape", "activities");
    await expectInvalidProfile(incomplete, "responseContract must be a non-empty string");
  });

  it("rejects every frozen duplicate-reference array", async () => {
    const cases = [
      { asset: "goals" as const, index: 0, field: "targetKnowledgePointIds", value: "kp-core" },
      { asset: "goals" as const, index: 0, field: "requiredActivityIds", value: "activity-explain" },
      { asset: "knowledge" as const, index: 1, field: "prerequisiteIds", value: "kp-core" },
      { asset: "knowledge" as const, index: 0, field: "relatedKnowledgePointIds", value: "kp-support" },
      { asset: "knowledge" as const, index: 0, field: "activityIds", value: "activity-explain" },
      { asset: "activities" as const, index: 0, field: "supportingKnowledgePointIds", value: "kp-support" },
    ];

    for (const testCase of cases) {
      const directory = await cloneValidFixture();
      await mutateJsonAsset(directory, testCase.asset, (asset) => {
        const key = testCase.asset === "goals" ? "goals" : testCase.asset === "knowledge" ? "knowledgePoints" : "activities";
        recordArray(asset, key)[testCase.index]![testCase.field] = [testCase.value, testCase.value];
      });
      await expectInvalidProfile(directory, `.${testCase.field} contains duplicate reference ${testCase.value}`);
    }

    const duplicateActivityGoal = await cloneValidFixture();
    await applyStaticOverride(duplicateActivityGoal, "invalid-w1-c3-duplicate-reference", "activities");
    await expectInvalidProfile(duplicateActivityGoal, ".goalIds contains duplicate reference goal-transfer");
  });

  it("rejects every frozen dangling goal reference", async () => {
    const danglingTarget = await cloneValidFixture();
    await applyStaticOverride(danglingTarget, "invalid-w1-c3-dangling-goal", "goals");
    await expectInvalidProfile(danglingTarget, "targetKnowledgePointIds references missing ID kp-missing");

    for (const [field, expected] of [
      ["requiredActivityIds", "requiredActivityIds references missing ID activity-missing"],
      ["finalActivityId", "finalActivityId references missing ID activity-missing"],
    ] as const) {
      const directory = await cloneValidFixture();
      await mutateJsonAsset(directory, "goals", (asset) => {
        recordArray(asset, "goals")[0]![field] = field === "requiredActivityIds" ? ["activity-missing"] : "activity-missing";
      });
      await expectInvalidProfile(directory, expected);
    }
  });

  it("rejects every frozen dangling knowledge-point reference", async () => {
    for (const [field, missingId] of [
      ["prerequisiteIds", "kp-missing"],
      ["relatedKnowledgePointIds", "kp-missing"],
      ["activityIds", "activity-missing"],
    ] as const) {
      const directory = await cloneValidFixture();
      await mutateJsonAsset(directory, "knowledge", (asset) => {
        recordArray(asset, "knowledgePoints")[0]![field] = [missingId];
      });
      await expectInvalidProfile(directory, `${field} references missing ID ${missingId}`);
    }
  });

  it("rejects every frozen dangling activity reference", async () => {
    for (const [field, value] of [
      ["primaryKnowledgePointId", "kp-missing"],
      ["supportingKnowledgePointIds", ["kp-missing"]],
      ["goalIds", ["goal-missing"]],
    ] as const) {
      const directory = await cloneValidFixture();
      await mutateJsonAsset(directory, "activities", (asset) => {
        recordArray(asset, "activities")[0]![field] = value;
      });
      await expectInvalidProfile(directory, `references missing ID ${Array.isArray(value) ? value[0] : value}`);
    }
  });

  it("rejects primary/supporting conflicts independently of dangling-reference checks", async () => {
    const directory = await cloneValidFixture();
    await applyStaticOverride(directory, "invalid-w1-c3-primary-support-conflict", "activities");
    await expectInvalidProfile(directory, "supportingKnowledgePointIds must not contain its primary knowledge point");
  });

  it("rejects prerequisite self-reference, two-node cycles, and longer cycles", async () => {
    const selfReference = await cloneValidFixture();
    await applyStaticOverride(selfReference, "invalid-w1-c3-self-prerequisite", "knowledge");
    await expectInvalidProfile(selfReference, "prerequisiteIds must not reference itself");

    const twoNodeCycle = await cloneValidFixture();
    await applyStaticOverride(twoNodeCycle, "invalid-w1-c3-prerequisite-cycle", "knowledge");
    await expectInvalidProfile(twoNodeCycle, "knowledge prerequisites contain a cycle");

    const longerCycle = await cloneValidFixture();
    await mutateJsonAsset(longerCycle, "knowledge", (asset) => {
      const points = recordArray(asset, "knowledgePoints");
      points[0]!.prerequisiteIds = ["kp-third"];
      points[1]!.prerequisiteIds = ["kp-core"];
      points.push({
        id: "kp-third",
        title: "Third concept",
        chapterId: "chapter-introduction",
        sectionId: "section-third",
        prerequisiteIds: ["kp-support"],
        relatedKnowledgePointIds: [],
        sourceAnchorIds: [],
        activityIds: [],
        importance: 0.25,
      });
    });
    await expectInvalidProfile(longerCycle, "knowledge prerequisites contain a cycle");
  });

  it("allows no activities only when no scoring modality or activity reference is declared", async () => {
    const noActivities = await cloneValidFixture();
    await mutateJsonAsset(noActivities, "manifest", (manifest) => {
      delete (manifest.paths as JsonRecord).activities;
    });
    await mutateJsonAsset(noActivities, "goals", (asset) => {
      for (const goal of recordArray(asset, "goals")) {
        goal.requiredActivityIds = [];
        delete goal.finalActivityId;
      }
    });
    await mutateJsonAsset(noActivities, "knowledge", (asset) => {
      for (const point of recordArray(asset, "knowledgePoints")) point.activityIds = [];
    });
    await expect(validateProfileV2Directory(noActivities, "draft")).resolves.toMatchObject({ schemaVersion: 2 });

    const referencedWithoutPath = await cloneValidFixture();
    await mutateJsonAsset(referencedWithoutPath, "manifest", (manifest) => {
      delete (manifest.paths as JsonRecord).activities;
    });
    await expectInvalidProfile(referencedWithoutPath, "requiredActivityIds references missing ID activity-explain");
  });

  it("requires a non-empty activities array for a scoring modality", async () => {
    const directory = await cloneValidFixture();
    await mkdir(resolve(directory, "assessments"));
    await mutateJsonAsset(directory, "manifest", (manifest) => {
      const capabilities = manifest.capabilities as JsonRecord;
      const paths = manifest.paths as JsonRecord;
      capabilities.modalities = ["reading", "quiz"];
      paths.assessments = "assessments";
    });
    await writeJsonAsset(directory, "activities", { activities: [] });
    await expectInvalidProfile(directory, "activities asset.activities must be non-empty");
  });

  it("keeps the v1 demo-review parser and fixture working unchanged", async () => {
    const profile = await validateCanonicalProfileDirectory(
      resolve(process.cwd(), "fixtures", "profiles", "demo-review"),
      "demo-review",
      "active",
    );

    expect(profile).toMatchObject({ subjectId: "demo-review", status: "active", slot: "active" });
    expect(profile).not.toHaveProperty("schemaVersion");
  });
});
