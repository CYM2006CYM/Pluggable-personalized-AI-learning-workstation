import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8")).split(/\r?\n/u).filter(Boolean);
const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "manifest.json"), "utf8"));
const expected = [...manifest.files.map((file) => file.path), ...manifest.selfExcluded];
const checks = [];
for (const file of manifest.files) {
  const bytes = await readFile(resolve(repositoryRoot, file.path));
  checks.push({ path: file.path, bytesMatch: bytes.byteLength === file.bytes, sha256Match: createHash("sha256").update(bytes).digest("hex") === file.sha256 });
}
const result = { schemaVersion: 1, classification: "AUDIT_ONLY / NOT_FOR_GIT", status: JSON.stringify(proposed) === JSON.stringify(expected) && checks.every((item) => item.bytesMatch && item.sha256Match) ? "PASS" : "BLOCKED", gitProposedFiles: proposed, manifestFiles: manifest.files.map((file) => file.path), zipAuditOnlyFiles: ["pi-study-helper/scripts/w5-c-d3/hash-inventory.txt", "pi-study-helper/scripts/w5-c-d3/manifest-verification.json", "pi-study-helper/scripts/w5-c-d3/logs/"], checks };
await writeFile(resolve(import.meta.dirname, "manifest-verification.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (result.status !== "PASS") process.exitCode = 1;
