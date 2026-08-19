import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const validationRoot = import.meta.dirname;
const proposed = (await readFile(resolve(validationRoot, "proposed-files.txt"), "utf8")).split(/\r?\n/u).filter(Boolean);
const manifest = JSON.parse(await readFile(resolve(validationRoot, "manifest.json"), "utf8"));
const auditOnly = [
  "pi-study-helper/scripts/w5-c-validation/hash-inventory.txt",
  "pi-study-helper/scripts/w5-c-validation/manifest-verification.json",
];
const expected = [...manifest.files.map((file) => file.path), ...manifest.selfExcluded];
const setEqual = proposed.length === expected.length && proposed.every((path, index) => path === expected[index]);
const checks = [];
for (const file of manifest.files) {
  const bytes = await readFile(resolve(repositoryRoot, file.path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  checks.push({ path: file.path, expectedBytes: file.bytes, actualBytes: bytes.byteLength, expectedSha256: file.sha256, actualSha256: sha256, match: file.bytes === bytes.byteLength && file.sha256 === sha256 });
}
const pathDiff = [];
for (let index = 0; index < Math.max(proposed.length, expected.length); index += 1) {
  if (proposed[index] !== expected[index]) pathDiff.push({ index, proposed: proposed[index], expected: expected[index] });
}
const result = {
  schemaVersion: 1,
  classification: "AUDIT_ONLY / NOT_FOR_GIT",
  status: setEqual && checks.every((check) => check.match) && manifest.selfExcluded.length === 1 && manifest.selfExcluded[0] === "pi-study-helper/scripts/w5-c-validation/manifest.json" ? "PASS" : "BLOCKED",
  gitProposedFiles: proposed,
  manifestFiles: manifest.files.map((file) => file.path),
  zipAuditOnlyFiles: auditOnly,
  proposedCount: proposed.length,
  manifestCount: manifest.files.length,
  selfExcludedCount: manifest.selfExcluded.length,
  pathOrderMatch: setEqual,
  pathDiff,
  checks,
};
await writeFile(resolve(validationRoot, "manifest-verification.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (result.status !== "PASS") process.exitCode = 1;
