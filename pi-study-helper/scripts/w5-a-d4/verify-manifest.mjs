import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const defaultWorkspaceRoot = resolve(import.meta.dirname, "../../..");
const workspaceRoot = resolve(process.argv[2] ?? defaultWorkspaceRoot);
const manifestPath = process.argv[3] === undefined
  ? resolve(workspaceRoot, "pi-study-helper/scripts/w5-a-d4/manifest.json")
  : resolve(process.argv[3]);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.entryCount !== manifest.entries.length) throw new Error("manifest entryCount mismatch");
for (const entry of manifest.entries) {
  if (entry.hashMode !== "utf8-lf-v1") throw new Error(`unsupported manifest hash mode: ${entry.path}`);
  const raw = await readFile(resolve(workspaceRoot, entry.path));
  const bytes = Buffer.from(raw.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256 || bytes.byteLength !== entry.byteLength) {
    throw new Error(`manifest mismatch: ${entry.path}`);
  }
}
if (JSON.stringify(manifest.selfExcluded) !== JSON.stringify(["pi-study-helper/scripts/w5-a-d4/manifest.json"])) throw new Error("manifest self exclusion is invalid");
console.log(JSON.stringify({ status: "PASS", entryCount: manifest.entryCount, selfExcluded: manifest.selfExcluded }, null, 2));
