import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestEntry {
  path: string;
  hashMode: "utf8-lf-v1";
  sha256: string;
  byteLength: number;
}

const appRoot = resolve(import.meta.dirname, "..");
const verifierPath = resolve(appRoot, "scripts/w5-a-d4/verify-manifest.mjs");

describe("W5-D4 A Manifest worktree portability", () => {
  it("verifies the same candidate after every UTF-8 file is checked out as CRLF", async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), "w5-a-d4-crlf-manifest-"));
    try {
      const lf = "第一行\nsecond line\n";
      const entry: ManifestEntry = {
        path: "sample.txt",
        hashMode: "utf8-lf-v1",
        sha256: createHash("sha256").update(lf, "utf8").digest("hex"),
        byteLength: Buffer.byteLength(lf, "utf8"),
      };
      const manifest = {
        schemaVersion: 3,
        entryCount: 1,
        entries: [entry],
        selfExcluded: ["pi-study-helper/scripts/w5-a-d4/manifest.json"],
      };
      expect(manifest.schemaVersion).toBe(3);
      expect(new Set(manifest.entries.map((entry) => entry.hashMode))).toEqual(new Set(["utf8-lf-v1"]));
      await writeFile(resolve(temporary, entry.path), lf.replace(/\n/gu, "\r\n"), "utf8");
      const syntheticManifest = resolve(temporary, "manifest.json");
      await writeFile(syntheticManifest, JSON.stringify(manifest), "utf8");
      const stdout = execFileSync(process.execPath, [verifierPath, temporary, syntheticManifest], {
        cwd: appRoot,
        encoding: "utf8",
      });
      expect(JSON.parse(stdout)).toMatchObject({ status: "PASS", entryCount: manifest.entries.length });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
