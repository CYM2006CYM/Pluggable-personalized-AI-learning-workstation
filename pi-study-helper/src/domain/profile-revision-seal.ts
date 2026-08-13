import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { assertPathInside } from "../infrastructure/safe-files.js";

export const REVISION_SEAL_PATH = "quality/revision-seal.json";
export const RAW_REVISION_HASH_MODE = "raw-binary" as const;
export const PROFILE_REVISION_HASH_MODE = "utf8-json-keys-sorted-arrays-preserved-no-whitespace-v1" as const;

import type { RevisionSeal, RevisionSealEntry } from "../contracts/domain.js";
export type { RevisionSeal, RevisionSealEntry } from "../contracts/domain.js";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en")).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("Revision seal JSON contains an unsupported value");
}

function utf8PathCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function revisionFiles(root: string): Promise<Array<{ absolute: string; path: string }>> {
  const files: Array<{ absolute: string; path: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = assertPathInside(root, resolve(directory, entry.name));
      if (entry.isSymbolicLink()) throw new Error(`Revision seal does not allow symbolic links: ${entry.name}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const path = relative(root, absolute).replaceAll("\\", "/");
        if (path !== REVISION_SEAL_PATH) files.push({ absolute, path });
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => utf8PathCompare(left.path, right.path));
}

export async function calculateRevisionSeal(directory: string): Promise<Pick<RevisionSeal, "entries" | "assetTreeSha256">> {
  const root = resolve(directory);
  const entries: RevisionSealEntry[] = [];
  for (const file of await revisionFiles(root)) {
    const raw = await readFile(file.absolute);
    const payload = file.path === "profile.json"
      ? Buffer.from(canonicalJson({ ...(JSON.parse(raw.toString("utf8")) as Record<string, unknown>), status: "draft" }), "utf8")
      : raw;
    entries.push({
      path: file.path,
      hashMode: file.path === "profile.json" ? PROFILE_REVISION_HASH_MODE : RAW_REVISION_HASH_MODE,
      sha256: digest(payload),
      byteLength: payload.byteLength,
    });
  }
  const stream = Buffer.concat(entries.map((entry) => Buffer.from(`${entry.path}\0${entry.hashMode}\0${entry.sha256}\0${entry.byteLength}\n`, "utf8")));
  return { entries, assetTreeSha256: digest(stream) };
}

export async function validateRevisionSeal(directory: string, subjectId: string): Promise<RevisionSeal> {
  const sealPath = assertPathInside(directory, resolve(directory, REVISION_SEAL_PATH));
  const entry = await lstat(sealPath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Revision 3 seal must be a regular file");
  let value: unknown;
  try { value = JSON.parse(await readFile(sealPath, "utf8")); } catch { throw new Error("Revision 3 seal is not valid JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Revision 3 seal must be an object");
  const seal = value as Partial<RevisionSeal>;
  if (seal.schemaVersion !== 1 || seal.subjectId !== subjectId || seal.revision !== 3
      || !Array.isArray(seal.entries) || !/^[a-f0-9]{64}$/u.test(seal.assetTreeSha256 ?? "")) {
    throw new Error("Revision 3 seal identity is invalid");
  }
  const actual = await calculateRevisionSeal(directory);
  if (JSON.stringify(seal.entries) !== JSON.stringify(actual.entries) || seal.assetTreeSha256 !== actual.assetTreeSha256) {
    throw new Error("Revision 3 seal does not match the Profile asset tree");
  }
  return seal as RevisionSeal;
}
