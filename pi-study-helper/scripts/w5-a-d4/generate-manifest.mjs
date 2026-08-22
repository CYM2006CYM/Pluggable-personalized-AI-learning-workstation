import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const manifestPath = resolve(import.meta.dirname, "manifest.json");
const manifestRelative = "pi-study-helper/scripts/w5-a-d4/manifest.json";
const paths = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8"))
  .trim().split(/\r?\n/u).filter(Boolean);
const normalizeText = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
const entries = [];
for (const path of paths) {
  if (path === manifestRelative) continue;
  const bytes = normalizeText(await readFile(resolve(workspaceRoot, path)));
  entries.push({ path, hashMode: "utf8-lf-v1", sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength });
}
const manifest = {
  schemaVersion: 3,
  contract: "W5-C1/W5-R1",
  owner: "A",
  day: "W5-D4",
  baseHead: "a0d5a37116a6c67f009ca19e313501d9eed96f78",
  status: "NOT_COMMITTED_NOT_PUSHED_UPLOAD_LOCK_NOT_GRANTED",
  entryCount: entries.length,
  entries,
  selfExcluded: [manifestRelative],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ entryCount: entries.length, selfExcluded: manifest.selfExcluded }, null, 2));
