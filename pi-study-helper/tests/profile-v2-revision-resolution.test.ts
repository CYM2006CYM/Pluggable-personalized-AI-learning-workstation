import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileFamilyPathResolver } from "../src/application/path-learning-facade.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const roots: string[] = [];
const fixtures = resolve(import.meta.dirname, "..", "fixtures", "profiles");

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Profile v2 revision resolution", () => {
  it("rejects draft for formal sessions, then resolves the archived bound revision", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "pi-study-helper-profile-v2-revision-"));
    roots.push(root);
    const draft = resolve(root, "profile_families", "pandas-cleaning", "draft");
    await mkdir(resolve(root, "profile_families", "pandas-cleaning", "archived"), { recursive: true });
    await cp(resolve(fixtures, "pandas-cleaning-v2-draft"), draft, { recursive: true });
    const repository = new ProfileFamilyRepository({ dataRoot: root, fixturesRoot: fixtures });
    const resolver = new ProfileFamilyPathResolver(repository);
    await expect(resolver.load("pandas-cleaning", 2)).rejects.toThrow("not available");
    const active = resolve(root, "profile_families", "pandas-cleaning", "active");
    await cp(resolve(fixtures, "pandas-cleaning-v2-draft"), active, { recursive: true });
    const activeManifest = JSON.parse(await readFile(resolve(active, "profile.json"), "utf8")) as Record<string, unknown>;
    activeManifest.status = "active";
    await writeFile(resolve(active, "profile.json"), `${JSON.stringify(activeManifest)}\n`, "utf8");
    expect((await resolver.load("pandas-cleaning", 2)).profileRevision).toBe(2);
    await rm(active, { recursive: true, force: true });
    await rename(draft, resolve(root, "profile_families", "pandas-cleaning", "archived", "revision-2"));
    const archivedManifestPath = resolve(root, "profile_families", "pandas-cleaning", "archived", "revision-2", "profile.json");
    const archivedManifest = JSON.parse(await readFile(archivedManifestPath, "utf8")) as Record<string, unknown>;
    archivedManifest.status = "archived";
    await writeFile(archivedManifestPath, `${JSON.stringify(archivedManifest)}\n`, "utf8");
    const historical = await resolver.load("pandas-cleaning", 2);
    expect(historical.goals[0]?.goalId).toBe("goal-clean-orders");
    await expect(resolver.load("pandas-cleaning", 99)).rejects.toThrow("not available");
  });
});
