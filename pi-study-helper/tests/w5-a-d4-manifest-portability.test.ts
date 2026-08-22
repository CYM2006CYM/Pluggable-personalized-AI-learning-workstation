import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestEntry {
  path: string;
  hashMode: "utf8-lf-v1";
}

const appRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(appRoot, "..");
const manifestPath = resolve(appRoot, "scripts/w5-a-d4/manifest.json");
const verifierPath = resolve(appRoot, "scripts/w5-a-d4/verify-manifest.mjs");

describe("W5-D4 A Manifest worktree portability", () => {
  it("verifies the same candidate after every UTF-8 file is checked out as CRLF", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "w5-a-d4-crlf-manifest-"));
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        schemaVersion: number;
        entries: ManifestEntry[];
        selfExcluded: string[];
      };
      expect(manifest.schemaVersion).toBe(3);
      expect(new Set(manifest.entries.map((entry) => entry.hashMode))).toEqual(new Set(["utf8-lf-v1"]));

      for (const entry of manifest.entries) {
        const source = resolve(workspaceRoot, entry.path);
        const target = resolve(temporary, entry.path);
        await mkdir(dirname(target), { recursive: true });
        await cp(source, target, { recursive: false, force: true });
        const lf = (await readFile(target, "utf8")).replace(/\r\n?/gu, "\n");
        await writeFile(target, lf.replace(/\n/gu, "\r\n"), "utf8");
      }
      const copiedManifest = resolve(temporary, "pi-study-helper/scripts/w5-a-d4/manifest.json");
      await mkdir(dirname(copiedManifest), { recursive: true });
      await cp(manifestPath, copiedManifest, { force: true });
      const stdout = execFileSync(process.execPath, [verifierPath, temporary, copiedManifest], {
        cwd: appRoot,
        encoding: "utf8",
      });
      expect(JSON.parse(stdout)).toMatchObject({ status: "PASS", entryCount: manifest.entries.length });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
