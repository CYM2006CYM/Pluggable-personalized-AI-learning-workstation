import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "manifest.json"), "utf8"));
if (manifest.entryCount !== manifest.entries.length) throw new Error("manifest entryCount mismatch");
for (const entry of manifest.entries) {
  const bytes = await readFile(resolve(workspaceRoot, entry.path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.sha256 || bytes.byteLength !== entry.byteLength) throw new Error(`manifest mismatch: ${entry.path}`);
}
if (JSON.stringify(manifest.selfExcluded) !== JSON.stringify(["pi-study-helper/scripts/w5-b-d3/manifest.json"])) throw new Error("manifest self exclusion is invalid");
console.log(JSON.stringify({ status: "PASS", entryCount: manifest.entryCount, selfExcluded: manifest.selfExcluded }, null, 2));
