import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const profileRoot = resolve(projectRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const fixtureIds = [
  "dataset-public-orders",
  "dataset-private-variant-01",
  "dataset-private-variant-02",
  "dataset-private-variant-03-large",
  "dataset-private-variant-04-edge",
];
const activityIds = [
  "act-load-csv",
  "act-inspect-dataframe",
  "act-missing",
  "act-duplicates",
  "act-types",
  "act-practical",
];

async function json(relative: string): Promise<any> {
  return JSON.parse(await readFile(resolve(profileRoot, relative), "utf8"));
}

async function hash(relative: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(resolve(profileRoot, relative))).digest("hex")}`;
}

function findPython(): string {
  if (process.env.PI_PYTHON_EXECUTABLE) return process.env.PI_PYTHON_EXECUTABLE;
  const command = process.platform === "win32" ? "where.exe" : "which";
  return execFileSync(command, ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python";
}

describe("W6 stage 4 code fixture coverage", () => {
  it("binds five reproducible input/output cases to every code activity", async () => {
    const manifest = await json("assessments/private/code-fixture-cases.json");
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      profileRevision: 3,
      generatorVersion: "w6-stage4-code-fixtures-v1",
      visibility: "private",
    });
    expect(manifest.cases).toHaveLength(30);
    expect(new Set(manifest.cases.map((item: any) => item.caseId)).size).toBe(30);

    for (const activityId of activityIds) {
      const cases = manifest.cases.filter((item: any) => item.activityId === activityId);
      expect(cases.map((item: any) => item.fixtureId)).toEqual(fixtureIds);
      expect(new Set(cases.map((item: any) => item.inputSha256)).size).toBe(5);
      expect(new Set(cases.map((item: any) => item.expectedOutputSha256)).size).toBe(5);
      for (const item of cases) {
        expect(item).toMatchObject({ activityId, profileRevision: 3, generatedAt: expect.any(String) });
        expect(item.expectedOutputRef).toMatch(/^datasets\/private\/expected\//u);
        expect(item.inputSha256).toBe(await hash(item.inputRef));
        expect(item.expectedOutputSha256).toBe(await hash(item.expectedOutputRef));
        expect(item.inputRowCount).toBeGreaterThan(0);
        expect(item.outputRowCount).toBeGreaterThanOrEqual(0);
      }
    }

    expect((await readFile(resolve(profileRoot, "datasets/public/orders-learning.csv"), "utf8"))
      .split(/\r?\n/u).filter(Boolean)).toHaveLength(31);
    expect(await hash("datasets/public/orders-learning.csv"))
      .toBe("sha256:99b2923bfde4a6a824ed69bb410dc9c9f5d10f69e30b9bc5692ae986c6ab09f9");
    expect((await readFile(resolve(profileRoot, "datasets/private/orders-variant-03-large.csv"), "utf8"))
      .split(/\r?\n/u).filter(Boolean).length).toBeGreaterThanOrEqual(201);
    expect((await readFile(resolve(profileRoot, "datasets/private/orders-variant-04-edge.csv"), "utf8"))
      .split(/\r?\n/u).filter(Boolean).length).toBeGreaterThanOrEqual(51);
  });

  it("authorizes all five fixtures server-side without exposing private outputs as public tests", async () => {
    const activities = (await json("activities/learning-activities.json")).activities;
    const bundles = (await json("assessments/private/task-bundles.json")).bundles;
    const privateTests = (await json("assessments/private/test-cases.json")).tests;
    for (const activityId of activityIds) {
      const activity = activities.find((item: any) => item.activityId === activityId);
      const bundle = bundles.find((item: any) => item.activity.activityId === activityId);
      expect(activity.datasetRefs).toEqual(fixtureIds);
      expect(bundle.contract.entryPoint.argumentFixtureIds).toEqual(fixtureIds);
      expect(bundle.activity).toEqual(activity);
      expect(bundle.publicTests.every((item: any) => item.fixtureRefs.every((id: string) => id === fixtureIds[0]))).toBe(true);
      expect(bundle.hiddenTests.every((item: any) => item.visibility === "hidden")).toBe(true);
    }
    for (const testId of [
      "test-read-csv-hidden",
      "test-structure-hidden",
      "test-missing-hidden",
      "test-duplicates-hidden",
      "test-types-hidden",
      "test-practical-hidden-01",
    ]) {
      expect(privateTests.find((item: any) => item.testId === testId)?.fixtureRefs).toEqual(fixtureIds.slice(1));
    }
    expect(JSON.stringify(activities)).not.toMatch(/expectedOutputRef|expectedOutputSha256|datasets\/private\/expected/iu);
  });

  it("reproduces all outputs and rejects known-wrong solutions on both new fixtures", () => {
    const output = execFileSync(findPython(), [
      resolve(projectRoot, "scripts/w6-stage4/generate-code-fixtures.py"),
      "--check",
    ], { cwd: projectRoot, encoding: "utf8" });
    expect(JSON.parse(output)).toMatchObject({
      mode: "check",
      fixtureCount: 5,
      activityCount: 6,
      caseCount: 30,
      referencePasses: 30,
      knownWrongRejections: 12,
    });
  }, 30_000);
});
