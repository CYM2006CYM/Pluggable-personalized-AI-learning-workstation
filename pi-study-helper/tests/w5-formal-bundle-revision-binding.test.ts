import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PythonProcessCodeEvaluationAdapter } from "../src/infrastructure/python-process-evaluation-adapter.js";

/**
 * W5-D3-CODE-GRADING-001 regression guard.
 *
 * The formal task bundle digest covers `activity.profileRevision`, so copying a
 * bundle into a new revision without recomputing `assetBundleHash` silently
 * breaks every formal code submission with `test_asset_invalid`. Revision 2 kept
 * passing because the evaluator tests bind to the revision 2 fixture directory,
 * so the defect stayed invisible until a real revision 3 submission was driven
 * end to end. These assertions fail if any approved revision drifts again.
 */

const REVISIONS = [
  { revision: 2, root: resolve("fixtures/profiles/pandas-cleaning-v2-draft") },
  { revision: 3, root: resolve("fixtures/profiles/pandas-cleaning-revision-3-draft") },
] as const;

const REVISION_3_FORMAL_ACTIVITIES = [
  ["act-load-csv", "solution-read-csv.py"],
  ["act-inspect-dataframe", "solution-structure.py"],
  ["act-missing", "solution-missing.py"],
  ["act-duplicates", "solution-duplicates.py"],
  ["act-types", "solution-types.py"],
  ["act-practical", "solution-practical.py"],
] as const;

function findPython(): string {
  const command = process.platform === "win32" ? "where.exe" : "which";
  return execFileSync(command, ["python"], { encoding: "utf8" }).split(/\r?\n/u).find(Boolean) ?? "python";
}

/** Same canonical form the evaluator adapter uses: sorted keys, preserved arrays, no whitespace. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("unsupported canonical JSON value");
  return encoded;
}

async function bundleDigests(root: string): Promise<Map<string, { selfReported: string; recomputed: string; profileRevision: number }>> {
  const bundleDocument = JSON.parse(await readFile(resolve(root, "assessments/private/task-bundles.json"), "utf8")) as {
    bundles: Array<Record<string, unknown>>;
  };
  const fixtureDocument = JSON.parse(await readFile(resolve(root, "datasets/fixtures.json"), "utf8")) as {
    fixtures: Array<{ fixtureId: string }>;
  };
  const digests = new Map<string, { selfReported: string; recomputed: string; profileRevision: number }>();
  for (const bundle of bundleDocument.bundles) {
    const activity = bundle.activity as { activityId: string; datasetRefs: string[]; profileRevision: number };
    const { assetBundleHash, ...withoutHash } = bundle;
    const resolvedFixtures = fixtureDocument.fixtures.filter((fixture) => activity.datasetRefs.includes(fixture.fixtureId));
    digests.set(activity.activityId, {
      selfReported: String(assetBundleHash),
      recomputed: createHash("sha256").update(canonicalize({ ...withoutHash, resolvedFixtures }), "utf8").digest("hex"),
      profileRevision: activity.profileRevision,
    });
  }
  return digests;
}

describe("W5 formal task bundle revision binding", () => {
  for (const { revision, root } of REVISIONS) {
    it(`keeps every revision ${revision} bundle digest self-consistent`, async () => {
      const digests = await bundleDigests(root);
      expect(digests.size).toBeGreaterThan(0);
      for (const [activityId, digest] of digests) {
        expect(digest.profileRevision, `${activityId} declares the wrong revision`).toBe(revision);
        expect(digest.selfReported, `${activityId} assetBundleHash was not recomputed for revision ${revision}`)
          .toBe(digest.recomputed);
      }
    });
  }

  it("rejects a bundle whose assetBundleHash was copied from another revision", async () => {
    const revision2 = await bundleDigests(REVISIONS[0].root);
    const revision3 = await bundleDigests(REVISIONS[1].root);
    // The defect was exactly this: identical bundle bodies except profileRevision,
    // so the digests must differ across revisions.
    for (const activityId of ["act-inspect-dataframe", "act-practical"]) {
      expect(revision2.get(activityId)?.recomputed).not.toBe(revision3.get(activityId)?.recomputed);
    }
  });

  it("runs every formal revision 3 activity three times with the approved Python environment", async () => {
    const root = REVISIONS[1].root;
    const environment = JSON.parse(await readFile(resolve(root, "environments/environment-lock.json"), "utf8")) as {
      environmentHash: string;
    };
    const digests = await bundleDigests(root);
    const bundleDocument = JSON.parse(await readFile(resolve(root, "assessments/private/task-bundles.json"), "utf8")) as {
      bundles: Array<Record<string, unknown>>;
    };

    const adapter = new PythonProcessCodeEvaluationAdapter({
      profileRoot: root,
      pythonExecutable: findPython(),
    });

    for (const [activityId, solutionName] of REVISION_3_FORMAL_ACTIVITIES) {
      const bundle = bundleDocument.bundles.find((item) => (item.activity as { activityId: string }).activityId === activityId);
      expect(bundle, `${activityId} bundle is missing`).toBeDefined();
      const activity = bundle!.activity as { kind: string; templateVersion: string; profileRevision: number };
      const code = await readFile(resolve(root, "reference-solutions", solutionName), "utf8");
      const results = [];
      for (let repeat = 1; repeat <= 3; repeat += 1) {
        const prepared = await adapter.prepare({
          activity: {
            activityId,
            kind: activity.kind,
            profileRevision: activity.profileRevision,
            templateVersion: activity.templateVersion,
            environmentRef: String(bundle!.environmentRef),
          },
          profileRevision: activity.profileRevision,
          taskVersion: activity.templateVersion,
          mode: "submit",
          environment: {
            environmentId: String(bundle!.environmentRef),
            status: "measured_node_submit",
            environmentHash: environment.environmentHash,
            prototypeEvidenceRef: "scripts/w3-code-evaluation/environment-prototype-evidence.json",
          },
          assetBundleHash: digests.get(activityId)!.selfReported,
        } as never);
        results.push(await adapter.run({
          requestId: `w5-revision-3-${activityId}-${repeat}`,
          attemptId: `w5-revision-3-${activityId}-${repeat}`,
          prepared,
          code,
        }, new AbortController().signal));
      }
      expect(results[0]).toMatchObject({ executionStatus: "completed", verdict: "pass", score: 1 });
      expect(results[0]!.testPoints).toEqual([
        { pointNumber: 1, scope: "public", status: "passed" },
        { pointNumber: 2, scope: "sealed", status: "passed" },
        { pointNumber: 3, scope: "sealed", status: "passed" },
        { pointNumber: 4, scope: "sealed", status: "passed" },
        { pointNumber: 5, scope: "sealed", status: "passed" },
      ]);
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(JSON.stringify(results)).not.toMatch(/private|hidden|reference-solutions|[A-Za-z]:[\\/]|AppData/u);
    }
  }, 120_000);

  it("keeps revision 2 formal evaluation restricted to its two frozen activities", async () => {
    const root = REVISIONS[0].root;
    const environment = JSON.parse(await readFile(resolve(root, "environments/environment-lock.json"), "utf8")) as {
      environmentHash: string;
    };
    const digests = await bundleDigests(root);
    const bundleDocument = JSON.parse(await readFile(resolve(root, "assessments/private/task-bundles.json"), "utf8")) as {
      bundles: Array<Record<string, unknown>>;
    };
    const adapter = new PythonProcessCodeEvaluationAdapter({ profileRoot: root, pythonExecutable: findPython() });

    for (const activityId of ["act-missing", "act-duplicates", "act-types"]) {
      const bundle = bundleDocument.bundles.find((item) => (item.activity as { activityId: string }).activityId === activityId)!;
      const activity = bundle.activity as { kind: string; templateVersion: string; profileRevision: number };
      await expect(adapter.prepare({
        activity: {
          activityId,
          kind: activity.kind,
          profileRevision: activity.profileRevision,
          templateVersion: activity.templateVersion,
          environmentRef: String(bundle.environmentRef),
        },
        profileRevision: activity.profileRevision,
        taskVersion: activity.templateVersion,
        mode: "submit",
        environment: {
          environmentId: String(bundle.environmentRef),
          status: "measured_node_submit",
          environmentHash: environment.environmentHash,
          prototypeEvidenceRef: "scripts/w3-code-evaluation/environment-prototype-evidence.json",
        },
        assetBundleHash: digests.get(activityId)!.selfReported,
      } as never)).rejects.toMatchObject({ errorCode: "profile_revision_conflict" });
    }
  }, 30_000);
});
