import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const source = resolve(process.cwd(), "fixtures", "profiles", "pandas-cleaning-v2-draft");
const roots: string[] = [];

type ActivationStage = "candidate_validated" | "active_manifest_written" | "archive_manifest_written" | "archive_prepared" | "old_archived" | "active_published";

async function setup(stage?: ActivationStage) {
  const root = await mkdtemp(resolve(tmpdir(), "w3-d3-v2-")); roots.push(root);
  const fixtures = resolve(root, "fixtures");
  await cp(source, resolve(fixtures, "pandas-cleaning-v2-draft"), { recursive: true });
  let injected = stage;
  const repository = new ProfileFamilyRepository({
    dataRoot: root,
    fixturesRoot: fixtures,
    now: () => new Date("2026-08-09T03:00:00.000Z"),
    beforeV2ActivationStage: async (current) => {
      if (current === injected) {
        injected = undefined;
        throw new Error(`fault:${current}`);
      }
    },
  });
  return { root, fixtures, repository };
}

async function createOldActive(repository: ProfileFamilyRepository): Promise<void> {
  const family = repository.familyDirectory("pandas-cleaning");
  const active = resolve(family, "active");
  await cp(source, active, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(active, "profile.json"), "utf8"));
  manifest.status = "active"; manifest.version = "0.1.0"; manifest.revision = 1; manifest.revisionOf = null;
  await writeFile(resolve(active, "profile.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const activities = JSON.parse(await readFile(resolve(active, "activities", "learning-activities.json"), "utf8"));
  for (const activity of activities.activities) activity.profileRevision = 1;
  await writeFile(resolve(active, "activities", "learning-activities.json"), `${JSON.stringify(activities, null, 2)}\n`, "utf8");
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("W3-D3 Profile v2 activation transaction", () => {
  it("validates draft r2, archives old active, and publishes a single active revision", async () => {
    const { repository } = await setup();
    await createOldActive(repository);
    const active = await repository.activateV2Draft("pandas-cleaning");
    const family = repository.familyDirectory("pandas-cleaning");
    const archives = await readdir(resolve(family, "archived"));
    expect(active).toMatchObject({ subjectId: "pandas-cleaning", status: "active", revision: 2, revisionOf: 1 });
    expect(archives).toHaveLength(1);
    expect(JSON.parse(await readFile(resolve(family, "archived", archives[0]!, "profile.json"), "utf8"))).toMatchObject({ status: "archived", revision: 1 });
    expect(await repository.loadProfileV2Revision("pandas-cleaning", 1)).toMatchObject({ status: "archived" });
    expect(await repository.loadProfileV2Revision("pandas-cleaning", 2)).toMatchObject({ status: "active" });
  });

  it("rejects an invalid candidate without publishing anything", async () => {
    const { fixtures, repository } = await setup();
    await writeFile(resolve(fixtures, "pandas-cleaning-v2-draft", "profile.json"), "{}", "utf8");
    await expect(repository.activateV2Draft("pandas-cleaning")).rejects.toThrow();
    await expect(repository.loadActiveProfileV2("pandas-cleaning")).rejects.toThrow();
  });

  it("rejects a changed D3 formal environment binding before moving the old active", async () => {
    const { fixtures, repository } = await setup();
    await createOldActive(repository);
    const lockPath = resolve(fixtures, "pandas-cleaning-v2-draft", "environments", "environment-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.environmentHash = "sha256:" + "0".repeat(64);
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await expect(repository.activateV2Draft("pandas-cleaning")).rejects.toThrow("D3 environment-lock.json SHA-256 binding mismatch");
    expect(await repository.loadActiveProfileV2("pandas-cleaning")).toMatchObject({ revision: 1, status: "active" });
  });

  for (const stage of ["active_manifest_written", "archive_manifest_written", "archive_prepared", "old_archived", "active_published"] as const) {
    it(`rolls back the old active when ${stage} faults`, async () => {
      const { repository } = await setup(stage);
      await createOldActive(repository);
      await expect(repository.activateV2Draft("pandas-cleaning")).rejects.toThrow(`fault:${stage}`);
      expect(await repository.loadActiveProfileV2("pandas-cleaning")).toMatchObject({ revision: 1, status: "active" });
      await expect(repository.profileV2RevisionDirectory("pandas-cleaning", 2)).rejects.toThrow();
    });
  }

  it("retries from an interrupted publication and converges to one archived r1 plus active r2", async () => {
    const { repository } = await setup("active_published");
    await createOldActive(repository);
    await expect(repository.activateV2Draft("pandas-cleaning")).rejects.toThrow("fault:active_published");
    const active = await repository.activateV2Draft("pandas-cleaning");
    const archives = await readdir(resolve(repository.familyDirectory("pandas-cleaning"), "archived"));
    expect(active).toMatchObject({ revision: 2, status: "active" });
    expect(archives).toHaveLength(1);
    expect(await repository.loadProfileV2Revision("pandas-cleaning", 1)).toMatchObject({ status: "archived" });
  });

  it("formal revision resolution never consults the draft fixture", async () => {
    const { repository } = await setup();
    await repository.activateV2Draft("pandas-cleaning");
    expect(await repository.profileV2RevisionDirectory("pandas-cleaning", 2)).toContain("active");
    await expect(repository.profileV2RevisionDirectory("pandas-cleaning", 99)).rejects.toThrow();
  });
});
