import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const proposedPath = resolve(import.meta.dirname, "proposed-files.txt");
const manifestPath = resolve(import.meta.dirname, "manifest.json");
const manifestRelative = "pi-study-helper/scripts/w5-b-d3/manifest.json";
const paths = (await readFile(proposedPath, "utf8")).trim().split(/\r?\n/u).filter(Boolean);
const entries = [];
for (const path of paths) {
  if (path === manifestRelative) continue;
  const bytes = await readFile(resolve(workspaceRoot, path));
  entries.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength });
}
const manifest = {
  schemaVersion: 1,
  contract: "W5-C1/W5-R1",
  owner: "B",
  day: "W5-D3",
  upstreamCommit: "6acc56fa03986797be54156af639a905c2e74a64",
  status: "NOT_COMMITTED_NOT_PUSHED_UPLOAD_LOCK_NOT_GRANTED",
  entryCount: entries.length,
  entries,
  selfExcluded: [manifestRelative],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ entryCount: entries.length, selfExcluded: manifest.selfExcluded }, null, 2));
