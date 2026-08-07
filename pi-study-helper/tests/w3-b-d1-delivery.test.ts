import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..", "..");
const profileRoot = resolve(import.meta.dirname, "..", "fixtures/profiles/pandas-cleaning-v2-draft");
const annotationsRoot = resolve(repoRoot, "evaluation/golden/annotations");
const normalizedExtensions = new Set([".json", ".jsonl", ".md", ".py"]);

async function json(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function hash(path: string): Promise<{ sha256: string; byteLength: number; hashMode: string }> {
  const raw = await readFile(path);
  const extension = path.slice(path.lastIndexOf("."));
  const payload = normalizedExtensions.has(extension)
    ? Buffer.from(raw.toString("binary").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "binary")
    : raw;
  return {
    sha256: createHash("sha256").update(payload).digest("hex"),
    byteLength: payload.length,
    hashMode: normalizedExtensions.has(extension) ? "normalized-text" : "raw-binary",
  };
}

async function runPython(args: string[], cwd = profileRoot): Promise<string> {
  const result = await execFile("python", args, {
    cwd,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  return result.stdout;
}

describe("B W3-D1 delivery regression", () => {
  it("keeps all five inherited Bundles and identifies exactly two W3 targets", async () => {
    const activityAsset = await json(resolve(profileRoot, "activities/learning-activities.json"));
    const bundleAsset = await json(resolve(profileRoot, "assessments/private/task-bundles.json"));
    const expectedAll = [
      "act-inspect-dataframe", "act-missing", "act-duplicates", "act-types", "act-practical",
    ];
    const expectedW3 = ["act-inspect-dataframe", "act-practical"];
    expect(bundleAsset.bundles.map((bundle: any) => bundle.activity.activityId)).toEqual(expectedAll);
    expect(bundleAsset.bundles.filter((bundle: any) => expectedW3.includes(bundle.activity.activityId)))
      .toHaveLength(2);
    const activities = new Map(activityAsset.activities.map((activity: any) => [activity.activityId, activity]));
    for (const bundle of bundleAsset.bundles) {
      expect(bundle.activity).toEqual(activities.get(bundle.activity.activityId));
    }
  });

  it("keeps the two W3 Bundle rubrics as exact external single sources of truth", async () => {
    const bundles = (await json(resolve(profileRoot, "assessments/private/task-bundles.json"))).bundles;
    for (const activityId of ["act-inspect-dataframe", "act-practical"]) {
      const bundle = bundles.find((item: any) => item.activity.activityId === activityId);
      const external = await json(resolve(profileRoot, `rubrics/${bundle.activity.rubricRef}.json`));
      expect(bundle.rubric).toEqual(external);
      if (activityId === "act-inspect-dataframe") {
        expect(external.dimensions.find((dimension: any) => dimension.dimensionId === "structure").label).toBe("列结构");
        expect(bundle.rubric.dimensions.find((dimension: any) => dimension.dimensionId === "structure").label).toBe("列结构");
      }
    }
  });

  it("maps practical runtime and static checks once, without unused or duplicate IDs", async () => {
    const bundles = (await json(resolve(profileRoot, "assessments/private/task-bundles.json"))).bundles;
    const practical = bundles.find((bundle: any) => bundle.activity.activityId === "act-practical");
    const tests = [...practical.publicTests, ...practical.hiddenTests];
    const ids = tests.map((test: any) => test.testId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(practical.hiddenTests.find((test: any) => test.testId === "test-practical-hidden-02"))
      .toMatchObject({ dimensionId: "invariants", blocking: true });
    expect(practical.hiddenTests.find((test: any) => test.testId === "test-practical-engineering-static"))
      .toMatchObject({ fileRef: "assessments/private/tests/test-practical-engineering-static.py", dimensionId: "engineering", blocking: false });
    expect(practical.rubric.dimensionTestMap).toEqual({
      invariants: ["test-practical-public", "test-practical-hidden-01", "test-practical-hidden-02"],
      structure: ["test-practical-hidden-structure"],
      missing: ["test-practical-hidden-missing"],
      duplicates: ["test-practical-hidden-duplicates"],
      types: ["test-practical-hidden-types"],
      engineering: ["test-practical-engineering-static"],
    });
    const mapped = Object.values(practical.rubric.dimensionTestMap).flat() as string[];
    expect(new Set(mapped)).toEqual(new Set(ids));
    expect(practical.rubric.dimensions.some((dimension: any) => dimension.scoringMethod === "manual_review")).toBe(false);
    const engineering = practical.rubric.dimensions.find((dimension: any) => dimension.dimensionId === "engineering");
    expect(engineering.staticCheckRef).toBe("assessments/private/tests/test-practical-engineering-static.py");
    expect(engineering.staticCheckRules.join(" ")).not.toMatch(/DataFrame.*不变|input.*mutat/iu);
  });

  it("keeps frozen input, annotation hash, and archived original seal immutable", async () => {
    const seal = await json(resolve(annotationsRoot, "b-final-021-060.seal.candidate.json"));
    expect((await hash(resolve(repoRoot, "evaluation/golden/annotations/b-final-021-060.jsonl"))).sha256)
      .toBe("eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf");
    expect((await hash(resolve(repoRoot, "evaluation/personas/final-60.jsonl"))).sha256)
      .toBe("b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c");
    expect(seal.annotation.sha256).toBe("eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf");
    expect(seal.supersedes.originalSealPath).toBe("evaluation/golden/annotations/original/audit-only/b-final-021-060.seal.json");
    expect(seal.qualificationStatus).toBe("PENDING_OWNER_DUAL_SEAL_CHECK");
  });

  it("delivers the B annotation as a proposed, hashed ZIP entry", async () => {
    const manifest = await json(resolve(annotationsRoot, "w3-d1-b-candidate-manifest.json"));
    const annotation = "evaluation/golden/annotations/b-final-021-060.jsonl";
    expect(manifest.packageEntries).toContain(annotation);
    expect(manifest.proposedCommitPaths).toContain(annotation);
    expect(manifest.frozenInputsReadOnly).not.toContain(annotation);
    expect(manifest.auditOnly).not.toContain(annotation);
    expect(manifest.fileEntries.find((entry: any) => entry.path === annotation)).toMatchObject({
      category: "proposedCommit",
      sha256: "eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf",
    });
    const candidateZip = resolve(repoRoot, "w3-d1-b-rectified-candidate.zip").replace(/\\/g, "\\\\");
    const output = await runPython(["-c", `import zipfile; z=zipfile.ZipFile(r'${candidateZip}'); assert 'evaluation/golden/annotations/b-final-021-060.jsonl' in z.namelist()`]);
    expect(output).toBe("");
  });

  it("accepts legal code and deterministically rejects static-check counterexamples", async () => {
    const output = await runPython(["quality/verify-w3-b-static-check.py"]);
    expect(output).toContain("STATIC AUTHOR CHECK PASSED");
  });

  it("proves every reference, starter, and known-wrong implementation through the candidate harness", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "w3-b-evidence-"));
    try {
      const outputPath = resolve(directory, "evidence.json");
      await runPython(["quality/run-candidate-evidence.py", "--output", outputPath]);
      const evidence = await json(outputPath);
      expect(evidence.overallExitCode).toBe(0);
      expect(evidence.summary).toMatchObject({
        baselinePassed: true,
        allBaselineRepeatsStable: true,
        allStartersRejected: true,
        allKnownWrongRejectedPerFixture: true,
      });
      expect(new Set(evidence.results.map((result: any) => result.bundleId))).toEqual(new Set([
        "bundle-act-inspect-dataframe-v2", "bundle-act-missing-v2", "bundle-act-duplicates-v2",
        "bundle-act-types-v2", "bundle-act-practical-v2",
      ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps all registered tests closed to actual files and activities", async () => {
    const publicTests = (await json(resolve(profileRoot, "assessments/public/test-cases.json"))).tests;
    const privateTests = (await json(resolve(profileRoot, "assessments/private/test-cases.json"))).tests;
    const registry = new Map<string, any>();
    for (const test of [...publicTests, ...privateTests]) {
      expect(registry.has(test.testId)).toBe(false);
      registry.set(test.testId, test);
      const actual = await hash(resolve(profileRoot, test.fileRef));
      expect(`sha256:${actual.sha256}`).toBe(test.assetHash);
    }
    const bundles = (await json(resolve(profileRoot, "assessments/private/task-bundles.json"))).bundles;
    for (const bundle of bundles) {
      for (const testId of [...bundle.activity.publicTestRefs, ...bundle.activity.hiddenTestRefs]) {
        expect(registry.has(testId)).toBe(true);
      }
    }
  });
});
