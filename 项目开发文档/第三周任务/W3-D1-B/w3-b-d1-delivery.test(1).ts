import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const profileRoot = resolve(import.meta.dirname, "..", "fixtures/profiles/pandas-cleaning-v2-draft");
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

describe("B W3 D1 sealed delivery", () => {
  it("closes only the two profile-fixed TaskBundles required for W3", async () => {
    const manifest = JSON.parse(await readFile(resolve(profileRoot, "assessments/private/task-bundles.json"), "utf8"));
    expect(manifest.status).toBe("w3-sealed-pending-owner-qualification");
    expect(manifest.bundles.map((bundle: any) => bundle.activity.activityId)).toEqual([
      "act-inspect-dataframe", "act-practical",
    ]);
    for (const bundle of manifest.bundles) {
      expect(bundle.source).toBe("profile_fixed");
      expect(bundle.activity.allowedSources).toEqual(["profile_fixed"]);
      expect(bundle.contract).toBeDefined();
      expect(bundle.publicTests.length).toBeGreaterThan(0);
      expect(bundle.hiddenTests.length).toBeGreaterThan(0);
      expect(bundle.activity.referenceSolutionRef).toMatch(/^solution-/u);
      expect(bundle.activity.knownWrongSolutionRefs.length).toBeGreaterThan(0);
      expect(bundle.rubric.dimensions.length).toBeGreaterThan(0);
      expect(bundle.environmentRef).toBe("env-python-pandas-candidate");
      expect(bundle.assetBundleHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("seals exactly 40 valid B annotations to the unchanged frozen input", async () => {
    const annotationPath = resolve(repoRoot, "evaluation/golden/annotations/b-final-021-060.jsonl");
    const inputPath = resolve(repoRoot, "evaluation/personas/final-60.jsonl");
    const seal = JSON.parse(await readFile(resolve(repoRoot, "evaluation/golden/annotations/b-final-021-060.seal.json"), "utf8"));
    const rows = (await readFile(annotationPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    expect(rows).toHaveLength(40);
    expect(rows.map((row: any) => row.caseId)).toEqual(Array.from({ length: 40 }, (_, index) => `final-${String(index + 21).padStart(3, "0")}`));
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "annotatorRole", "caseId", "forbiddenActions", "nodeConstraints", "notes", "requiredRemediationKnowledgePointIds",
      ]);
      expect(row.annotatorRole).toBe("B");
      expect(row.nodeConstraints.length).toBe(7);
      expect(row.nodeConstraints.every((node: any) => node.required !== node.skippable)).toBe(true);
    }
    expect(seal.w3StartCommit).toBe("f190326a4a906b46e4001484ffa30a7839b82ed2");
    expect(seal.input.sha256).toBe(sha256(await readFile(inputPath)));
    expect(seal.annotation.sha256).toBe(sha256(await readFile(annotationPath)));
    expect(seal.qualificationStatus).toBe("PENDING_OWNER_DUAL_SEAL_CHECK");
    expect(seal.taskBundleAssetTree.entries.length).toBeGreaterThan(10);
    expect(seal.taskBundleAssetTree.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
