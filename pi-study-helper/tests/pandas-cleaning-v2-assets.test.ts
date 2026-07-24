import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateProfileV2Directory } from "../src/domain/profile-v2-schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/profiles/pandas-cleaning-v2-draft");

async function json(relativePath: string): Promise<any> {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function exists(relativePath: string): Promise<boolean> {
  try {
    await stat(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const fixtureKeys = ["assetHash", "fileRef", "fixtureId", "format", "visibility"];
const testCaseKeys = ["assetHash", "blocking", "dimensionId", "fileRef", "fixtureRefs", "testId", "visibility"];
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

async function findSymlinkOrEscape(fileRefs: string[]): Promise<Set<string>> {
  const unsafe = new Set<string>();
  const canonicalRoot = await realpath(root);
  for (const fileRef of fileRefs) {
    if (typeof fileRef !== "string" || fileRef.includes("\\")) {
      unsafe.add(fileRef);
      continue;
    }
    let current = root;
    try {
      for (const part of fileRef.split("/")) {
        current = resolve(current, part);
        if ((await lstat(current)).isSymbolicLink()) unsafe.add(fileRef);
      }
      const canonicalTarget = await realpath(current);
      const fromRoot = relative(canonicalRoot, canonicalTarget);
      if (fromRoot === ".." || fromRoot.startsWith(`..\\`) || fromRoot.startsWith("../") || isAbsolute(fromRoot)) unsafe.add(fileRef);
    } catch {
      // Missing files are reported deterministically by bindingErrors().
    }
  }
  return unsafe;
}

function bindingErrors(fixturesAsset: any, test: any, activity: any, argumentFixtureIds: string[], knownFiles: Set<string>, actualHashes: Map<string, string>, symlinkPaths = new Set<string>()): string[] {
  const errors: string[] = [];
  if (Object.keys(fixturesAsset).sort().join(",") !== "fixtures") errors.push("fixture_top_level_fields");
  const fixtures = Array.isArray(fixturesAsset.fixtures) ? fixturesAsset.fixtures : [];
  const fixtureIds = fixtures.map((item: any) => item.fixtureId);
  if (new Set(fixtureIds).size !== fixtureIds.length) errors.push("duplicate_fixture_id");
  const byId = new Map(fixtures.map((item: any) => [item.fixtureId, item]));
  if (new Set(activity.datasetRefs).size !== activity.datasetRefs.length) errors.push("duplicate_activity_dataset_ref");
  for (const fixture of fixtures) {
    const fixtureFileRef = typeof fixture.fileRef === "string" ? fixture.fileRef : "";
    if (Object.keys(fixture).sort().join(",") !== fixtureKeys.join(",")) errors.push("fixture_fields");
    if (fixture.visibility !== "public" && fixture.visibility !== "private") errors.push("fixture_visibility");
    if (fixture.format !== "csv") errors.push("fixture_format");
    if (!sha256Pattern.test(fixture.assetHash)) errors.push("fixture_hash_format");
    if (!fixtureFileRef || fixtureFileRef.includes("\\") || /^(?:[A-Za-z]:[\\/]|\/)/u.test(fixtureFileRef) || fixtureFileRef.split("/").some((part: string) => part === "" || part === "." || part === "..")) errors.push("fixture_path");
    if (fixture.visibility === "public" && !fixtureFileRef.startsWith("datasets/public/")) errors.push("fixture_visibility_path");
    if (fixture.visibility === "private" && !fixtureFileRef.startsWith("datasets/private/")) errors.push("fixture_visibility_path");
    if (!knownFiles.has(fixtureFileRef)) errors.push("fixture_missing_file");
    if (actualHashes.get(fixtureFileRef) !== fixture.assetHash) errors.push("fixture_hash_mismatch");
    if (symlinkPaths.has(fixtureFileRef)) errors.push("fixture_symlink_traversal");
  }
  if (Object.keys(test).sort().join(",") !== testCaseKeys.join(",")) errors.push("test_fields");
  if (!Array.isArray(test.fixtureRefs)) errors.push("fixture_refs_required");
  const refs = Array.isArray(test.fixtureRefs) ? test.fixtureRefs : [];
  if (new Set(refs).size !== refs.length) errors.push("duplicate_fixture_ref");
  if (!sha256Pattern.test(test.assetHash)) errors.push("test_hash_format");
  const testFileRef = typeof test.fileRef === "string" ? test.fileRef : "";
  const testParts = testFileRef.split("/");
  if (test.visibility !== "public" && test.visibility !== "hidden") errors.push("test_visibility");
  if (!testFileRef || testFileRef.includes("\\") || /^(?:[A-Za-z]:[\\/]|\/)/u.test(testFileRef) || testParts.some((part: string) => part === "" || part === "." || part === "..")) errors.push("test_path");
  if (test.visibility === "public" && !testFileRef.startsWith("assessments/public/tests/")) errors.push("test_visibility_path");
  if (test.visibility === "hidden" && !testFileRef.startsWith("assessments/private/tests/")) errors.push("test_visibility_path");
  if (!knownFiles.has(testFileRef)) errors.push("test_missing_file");
  if (actualHashes.get(testFileRef) !== test.assetHash) errors.push("test_hash_mismatch");
  if (symlinkPaths.has(testFileRef)) errors.push("test_symlink_traversal");
  for (const id of refs) {
    const fixture: any = byId.get(id);
    if (!fixture) errors.push("dangling_fixture_ref");
    if (!activity.datasetRefs.includes(id)) errors.push("activity_undeclared_fixture");
    if (!argumentFixtureIds.includes(id)) errors.push("argument_fixture_not_allowed");
    if (test.visibility === "public" && fixture?.visibility !== "public") errors.push("public_test_private_fixture");
  }
  return errors;
}

async function collectPublicCandidateFiles(directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (
        relative === "reference-solutions"
        || relative === "rubrics"
        || relative === "datasets/private"
        || relative.includes("/private")
      ) continue;
      files.push(...await collectPublicCandidateFiles(absolute));
    } else if (!entry.name.endsWith(".pyc")) {
      files.push(relative);
    }
  }
  return files.sort();
}

describe("B W1 day-3 pandas-cleaning draft assets", () => {
  it("is accepted by A's frozen Profile v2 schema and remains draft", async () => {
    const manifest = await validateProfileV2Directory(root, "draft");
    const quality = await json("quality/quality-report.json");
    const environment = await json("environments/environment-lock.json");
    expect(manifest.subjectId).toBe("pandas-cleaning");
    expect(manifest.status).toBe("draft");
    expect(manifest["x-candidateApproval"]).toBe("pending_owner_decision");
    expect(manifest.capabilities.modalities).toEqual(["reading", "quiz", "code", "practice"]);
    expect(quality.activeEligible).toBe(false);
    expect(Object.values(quality.gates).every((value) => String(value).startsWith("pending"))).toBe(true);
    expect(environment.schemaVersion).toBe(1);
    expect(environment.status).toBe("draft_pending_C_prototype");
    expect(environment.pythonVersion).toBeNull();
    expect(environment.nodeVersion).toBeNull();
    expect(environment.pandasVersion).toBeNull();
    expect(environment.allowedLibraries).toEqual([{ name: "pandas", version: null }]);
    expect(environment.capabilityFlags).toEqual({
      reliableMemoryLimit: false, networkIsolation: false, processTreeTermination: false,
    });
    expect(environment.environmentHash).toBe("pending_C_prototype");
  });

  it("contains three chapters, six sections, six knowledge points, and five fixed code activities", async () => {
    const knowledge = await json("knowledge/knowledge-points.json");
    const activities = await json("activities/learning-activities.json");
    const chapterFiles = [
      "chapters/01-foundations/01-structure.md",
      "chapters/01-foundations/02-missing.md",
      "chapters/02-normalization/01-duplicates.md",
      "chapters/02-normalization/02-types.md",
      "chapters/03-validation/01-invariants.md",
      "chapters/03-validation/02-engineering.md",
    ];
    expect(await Promise.all(chapterFiles.map(exists))).toEqual(Array(6).fill(true));
    expect(knowledge.knowledgePoints).toHaveLength(6);
    expect(activities.activities).toHaveLength(5);
    expect(activities.activities.map((item: any) => item.kind)).toEqual([
      "code_completion", "code_completion", "code_completion", "code_completion", "coding_practical",
    ]);
    expect(activities.activities.every((item: any) => item.allowedSources.length === 1 && item.allowedSources[0] === "profile_fixed")).toBe(true);
  });

  it("keeps diagnostic and fallback answers physically private", async () => {
    const diagnostic = await json("assessments/diagnostic/questions.json");
    const answerKey = await json("assessments/diagnostic/private/answer-key.json");
    const fallback = await json("assessments/quiz-fallback/questions.json");
    expect(diagnostic.questions).toHaveLength(10);
    expect(answerKey.visibility).toBe("private");
    expect(JSON.stringify(diagnostic)).not.toContain("correctOptionIndex");
    expect(JSON.stringify(fallback)).not.toContain("correctOptionIndex");
    expect(await exists("assessments/diagnostic/questions.json")).toBe(true);
    expect(await exists("assessments/diagnostic/private/answer-key.json")).toBe(true);
    expect(await exists("assessments/quiz-fallback/questions.json")).toBe(true);
    expect(await exists("assessments/quiz-fallback/private/answer-key.json")).toBe(true);
    expect(resolve(root, "assessments/diagnostic/questions.json")).not.toBe(
      resolve(root, "assessments/diagnostic/private/answer-key.json"),
    );
  });

  it("provides the frozen public and private CSV sizes and seven-column order", async () => {
    const expectedHeader = "order_id,customer_id,amount,city,order_date,status,note";
    const publicCsv = (await readFile(resolve(root, "datasets/public/orders-learning.csv"), "utf8")).trim().split(/\r?\n/u);
    const privateOne = (await readFile(resolve(root, "datasets/private/orders-variant-01.csv"), "utf8")).trim().split(/\r?\n/u);
    const privateTwo = (await readFile(resolve(root, "datasets/private/orders-variant-02.csv"), "utf8")).trim().split(/\r?\n/u);
    expect(publicCsv[0]).toBe(expectedHeader);
    expect(privateOne[0]).toBe(expectedHeader);
    expect(privateTwo[0]).toBe(expectedHeader);
    expect(publicCsv).toHaveLength(31);
    expect(privateOne).toHaveLength(21);
    expect(privateTwo).toHaveLength(21);
  });

  it("enforces the exact W1-C5 fixture registry and seven-field TestCaseRef contract", async () => {
    const fixturesAsset = await json("datasets/fixtures.json");
    const activities = (await json("activities/learning-activities.json")).activities;
    const publicTests = (await json("assessments/public/test-cases.json")).tests;
    const hiddenTests = (await json("assessments/private/test-cases.json")).tests;
    const bundles = (await json("assessments/private/task-bundles.json")).bundles;
    const knownFiles = new Set<string>();
    const actualHashes = new Map<string, string>();
    expect(Object.keys(fixturesAsset)).toEqual(["fixtures"]);
    expect(fixturesAsset.fixtures).toHaveLength(3);
    for (const fixture of fixturesAsset.fixtures) {
      expect(Object.keys(fixture).sort()).toEqual(fixtureKeys);
      const content = await readFile(resolve(root, fixture.fileRef));
      knownFiles.add(fixture.fileRef);
      actualHashes.set(fixture.fileRef, `sha256:${createHash("sha256").update(content).digest("hex")}`);
    }
    for (const test of [...publicTests, ...hiddenTests]) {
      const content = await readFile(resolve(root, test.fileRef));
      knownFiles.add(test.fileRef);
      actualHashes.set(test.fileRef, `sha256:${createHash("sha256").update(content).digest("hex")}`);
    }
    const actualSymlinkOrEscapePaths = await findSymlinkOrEscape([...knownFiles]);
    expect(actualSymlinkOrEscapePaths).toEqual(new Set());
    for (const test of [...publicTests, ...hiddenTests]) {
      expect(Object.keys(test).sort()).toEqual(testCaseKeys);
      const activity = activities.find((item: any) => item.publicTestRefs.includes(test.testId) || item.hiddenTestRefs.includes(test.testId));
      const bundle = bundles.find((item: any) => item.activity.activityId === activity.activityId);
      expect(bindingErrors(fixturesAsset, test, activity, bundle.contract.entryPoint.argumentFixtureIds, knownFiles, actualHashes, actualSymlinkOrEscapePaths)).toEqual([]);
    }

    const baseFixture = fixturesAsset.fixtures[0];
    const baseTest = publicTests[0];
    const baseActivity = activities[0];
    const args = bundles[0].contract.entryPoint.argumentFixtureIds;
    const errorsFor = (fixturePatch: any, testPatch: any, activityPatch: any = {}) => bindingErrors(
      { fixtures: [{ ...baseFixture, ...fixturePatch }] },
      { ...baseTest, ...testPatch },
      { ...baseActivity, ...activityPatch }, args, knownFiles, actualHashes,
    );
    expect(errorsFor({}, { fixtureRefs: [] })).toEqual([]);
    expect(bindingErrors({ fixtures: [{ ...baseFixture }, { ...baseFixture }] }, baseTest, baseActivity, args, knownFiles, actualHashes)).toContain("duplicate_fixture_id");
    expect(errorsFor({ extra: true }, {})).toContain("fixture_fields");
    for (const field of fixtureKeys) {
      const missingFixtureField = { ...baseFixture }; delete missingFixtureField[field];
      expect(bindingErrors({ fixtures: [missingFixtureField] }, baseTest, baseActivity, args, knownFiles, actualHashes)).toContain("fixture_fields");
    }
    expect(errorsFor({ visibility: "hidden" }, {})).toContain("fixture_visibility");
    expect(errorsFor({}, { extra: true })).toContain("test_fields");
    for (const field of testCaseKeys) {
      const missingTestField = { ...baseTest }; delete missingTestField[field];
      expect(bindingErrors({ fixtures: [baseFixture] }, missingTestField, baseActivity, args, knownFiles, actualHashes)).toContain("test_fields");
    }
    expect(errorsFor({}, { fixtureRefs: [baseFixture.fixtureId, baseFixture.fixtureId] })).toContain("duplicate_fixture_ref");
    expect(errorsFor({}, { fixtureRefs: ["missing-fixture"] })).toContain("dangling_fixture_ref");
    expect(errorsFor({}, {}, { datasetRefs: [] })).toContain("activity_undeclared_fixture");
    expect(errorsFor({}, {}, { datasetRefs: [baseFixture.fixtureId, baseFixture.fixtureId] })).toContain("duplicate_activity_dataset_ref");
    expect(bindingErrors({ fixtures: [baseFixture] }, baseTest, baseActivity, [], knownFiles, actualHashes)).toContain("argument_fixture_not_allowed");
    expect(errorsFor({ visibility: "private", fileRef: "datasets/private/orders-learning.csv" }, {})).toContain("public_test_private_fixture");
    expect(errorsFor({ fileRef: "../orders.csv" }, {})).toContain("fixture_path");
    expect(errorsFor({ fileRef: "..\\orders.csv" }, {})).toContain("fixture_path");
    expect(errorsFor({ fileRef: "datasets\\..\\private\\orders.csv" }, {})).toContain("fixture_path");
    expect(errorsFor({ visibility: "private" }, {})).toContain("fixture_visibility_path");
    expect(errorsFor({ format: "json" }, {})).toContain("fixture_format");
    expect(errorsFor({ fileRef: "datasets/public/missing.csv" }, {})).toContain("fixture_missing_file");
    expect(errorsFor({ assetHash: "sha256:" + "0".repeat(64) }, {})).toContain("fixture_hash_mismatch");
    expect(errorsFor({}, { assetHash: "0".repeat(64) })).toContain("test_hash_format");
    expect(errorsFor({}, { fileRef: "C:/tests/test.py" })).toContain("test_path");
    expect(errorsFor({}, { fileRef: "../test.py" })).toContain("test_path");
    expect(errorsFor({}, { fileRef: "..\\test.py" })).toContain("test_path");
    expect(errorsFor({}, { fileRef: "assessments\\..\\private\\test.py" })).toContain("test_path");
    expect(errorsFor({}, { fileRef: "assessments/public/./tests/test.py" })).toContain("test_path");
    expect(errorsFor({}, { fileRef: "assessments/private/tests/test.py" })).toContain("test_visibility_path");
    expect(errorsFor({}, { visibility: "private" })).toContain("test_visibility");
    expect(errorsFor({}, { fileRef: "assessments/public/tests/missing.py" })).toContain("test_missing_file");
    expect(errorsFor({}, { assetHash: "sha256:" + "0".repeat(64) })).toContain("test_hash_mismatch");
    const symlinkRef = "assessments/public/tests/symlink.py";
    const symlinkFiles = new Set([...knownFiles, symlinkRef]);
    const symlinkHashes = new Map(actualHashes).set(symlinkRef, baseTest.assetHash);
    expect(bindingErrors({ fixtures: [baseFixture] }, { ...baseTest, fileRef: symlinkRef }, baseActivity, args, symlinkFiles, symlinkHashes, new Set([symlinkRef]))).toContain("test_symlink_traversal");
    const fixtureSymlinkRef = "datasets/public/symlink.csv";
    const fixtureSymlink = { ...baseFixture, fileRef: fixtureSymlinkRef };
    const fixtureSymlinkFiles = new Set([...knownFiles, fixtureSymlinkRef]);
    const fixtureSymlinkHashes = new Map(actualHashes).set(fixtureSymlinkRef, baseFixture.assetHash);
    expect(bindingErrors({ fixtures: [fixtureSymlink] }, { ...baseTest, fixtureRefs: [fixtureSymlink.fixtureId] }, { ...baseActivity, datasetRefs: [fixtureSymlink.fixtureId] }, [fixtureSymlink.fixtureId], fixtureSymlinkFiles, fixtureSymlinkHashes, new Set([fixtureSymlinkRef]))).toContain("fixture_symlink_traversal");
  });

  it("keeps source records candidate-only and complete enough for owner review", async () => {
    const registry = await json("sources/source-registry.json");
    expect(registry.status).toBe("draft");
    expect(registry.approval).toBe("pending_owner_decision");
    expect(registry.sources.length).toBeGreaterThanOrEqual(9);
    for (const source of registry.sources) {
      expect(source).toMatchObject({
        sourceId: expect.any(String), kind: "official", title: expect.any(String),
        versionOrAccessDate: expect.any(String), locator: expect.any(String), license: expect.any(String),
        excerptScope: expect.any(String), summaryHash: expect.any(String), knowledgePointIds: expect.any(Array),
      });
      expect(source.summaryHash).toBe("pending-build-hash");
    }
  });

  it("provides five rubrics and preserves the practical 10/20/15/25/20/10 contract", async () => {
    const rubricIds = ["structure", "missing", "duplicates", "types", "practical"];
    expect(await Promise.all(rubricIds.map((id) => exists(`rubrics/rubric-${id}.json`)))).toEqual(Array(5).fill(true));
    const practical = await json("rubrics/rubric-practical.json");
    expect(practical.passThreshold).toBe(0.8);
    expect(practical.dimensions.map((item: any) => item.weight)).toEqual([0.10, 0.20, 0.15, 0.25, 0.20, 0.10]);
    expect(practical.dimensions.reduce((sum: number, item: any) => sum + item.weight, 0)).toBeCloseTo(1, 10);
  });

  it("resolves each activity's public/private tests, rubric, reference, wrong solution, and environment", async () => {
    const activities = (await json("activities/learning-activities.json")).activities;
    const publicTests = (await json("assessments/public/test-cases.json")).tests;
    const privateTests = (await json("assessments/private/test-cases.json")).tests;
    const publicIds = new Set(publicTests.map((item: any) => item.testId));
    const privateIds = new Set(privateTests.map((item: any) => item.testId));
    for (const item of [...publicTests, ...privateTests]) {
      expect(Object.keys(item).sort()).toEqual(testCaseKeys);
      expect(item.assetHash).toMatch(sha256Pattern);
      expect(item.fileRef.includes("..")).toBe(false);
      const content = await readFile(resolve(root, item.fileRef));
      expect(`sha256:${createHash("sha256").update(content).digest("hex")}`).toBe(item.assetHash);
    }
    const bundles = (await json("assessments/private/task-bundles.json")).bundles;
    const bundleManifest = await json("assessments/private/task-bundles.json");
    expect(bundles).toHaveLength(5);
    expect(new Set(bundles.map((item: any) => item.activity.activityId))).toEqual(new Set(activities.map((item: any) => item.activityId)));
    expect(bundleManifest).not.toHaveProperty("datasetRegistry");
    const fixtures = (await json("datasets/fixtures.json")).fixtures;
    for (const bundle of bundles) {
      expect(bundle.source).toBe("profile_fixed");
      expect(bundle.activity).toMatchObject({ activityId: expect.any(String) });
      expect(bundle.contract).toMatchObject({
        entryPoint: { kind: "function", name: expect.any(String), argumentFixtureIds: expect.any(Array) },
        inputDescription: expect.any(String), output: { kind: "dataframe", comparisonRef: expect.any(String), includeIndex: false },
        outputDescription: expect.any(String), invariants: expect.any(Array), prohibitedBehaviors: expect.any(Array),
      });
      expect(bundle.publicTests).toEqual(expect.any(Array));
      expect(bundle.hiddenTests).toEqual(expect.any(Array));
      expect(bundle.rubric).toMatchObject({ rubricId: expect.any(String), dimensions: expect.any(Array) });
      expect(bundle.environmentRef).toBe("env-python-pandas-candidate");
      const resolvedFixtures = fixtures.filter((item: any) => bundle.activity.datasetRefs.includes(item.fixtureId));
      const { assetBundleHash, ...withoutHash } = bundle;
      const actual = createHash("sha256").update(canonicalJson({ ...withoutHash, resolvedFixtures }), "utf8").digest("hex");
      expect(actual).toBe(assetBundleHash);
    }
    for (const activity of activities) {
      expect(activity.publicTestRefs.every((id: string) => publicIds.has(id))).toBe(true);
      expect(activity.hiddenTestRefs.every((id: string) => privateIds.has(id))).toBe(true);
      expect(await exists(`rubrics/${activity.rubricRef}.json`)).toBe(true);
      expect(await exists(`reference-solutions/${activity.referenceSolutionRef}.py`)).toBe(true);
      for (const wrongRef of activity.knownWrongSolutionRefs) {
        expect(await exists(`assessments/private/known-wrong/${wrongRef}.py`)).toBe(true);
      }
      expect(activity.environmentRef).toBe("env-python-pandas-candidate");
    }
    const evidence = await json("quality/c-execution-evidence.json");
    expect(evidence.harnessVersion).toBe("b-candidate-evidence-v2");
    expect(evidence.command).toContain("run-candidate-evidence.py");
    expect(evidence.overallExitCode).toBe(0);
    expect(evidence.summary).toEqual({
      referencePassed: true,
      allStartersRejected: true,
      allKnownWrongRejectedByAtLeastOneTest: true,
    });
    expect(evidence.results.length).toBeGreaterThan(5);
    expect(evidence.results.every((item: any) =>
      typeof item.bundleId === "string" &&
      typeof item.implementation === "string" &&
      typeof item.testId === "string" &&
      typeof item.fixtureId === "string" &&
      Number.isInteger(item.exitCode)
    )).toBe(true);
  });

  it("scans the complete non-private candidate surface for leakage", async () => {
    const publicPaths = await collectPublicCandidateFiles();
    expect(publicPaths).toContain("profile.json");
    expect(publicPaths).toContain("activities/learning-activities.json");
    expect(publicPaths).toContain("datasets/public/orders-learning.csv");
    expect(publicPaths).toContain("sources/source-registry.json");
    expect(publicPaths).toContain("quality/quality-report.json");
    expect(publicPaths).toContain("environments/environment-lock.json");
    const publicText = (await Promise.all(publicPaths.map((path) => readFile(resolve(root, path), "utf8")))).join("\n");
    for (const forbidden of [
      "correctOptionIndex", "private-case-", "passThreshold", "safeFeedbackCodes",
      "CITY_MAP =", "VALID_STATUS =", "BEGIN PRIVATE KEY", "BEGIN OPENSSH PRIVATE KEY",
      "C:\\Users\\", "/home/",
    ]) {
      expect(publicText).not.toContain(forbidden);
    }
    expect(publicText).not.toMatch(/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']+/iu);
    expect(publicPaths.some((path) => path.includes("/private/"))).toBe(false);
    expect(publicPaths.some((path) => path.startsWith("reference-solutions/"))).toBe(false);
    expect(publicPaths.some((path) => path.startsWith("rubrics/"))).toBe(false);
    expect(publicPaths.some((path) => path.startsWith("datasets/private/"))).toBe(false);
    expect(await exists("assessments/public/test-cases.json")).toBe(true);
    expect(await exists("assessments/private/test-cases.json")).toBe(true);
    expect(await exists("reference-solutions/solution-practical.py")).toBe(true);
    expect(await exists("rubrics/rubric-practical.json")).toBe(true);
  });
});
