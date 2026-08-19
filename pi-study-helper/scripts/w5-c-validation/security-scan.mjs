import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8"))
  .split(/\r?\n/u)
  .filter(Boolean);
const files = [
  ...proposed,
  "pi-study-helper/scripts/w5-c-validation/hash-inventory.txt",
  "pi-study-helper/scripts/w5-c-validation/manifest-verification.json",
].filter((path) => !path.endsWith("/security-scan.mjs") && !path.endsWith("/security-scan.json"));
const forbidden = [
  /answer-key\.json/iu,
  /reference-solutions/iu,
  /(?:^|[^A-Za-z])private(?:[\\/])/iu,
  /(?:^|[^A-Za-z])hidden(?:[\\/])/iu,
  /(?:^|[^A-Za-z])(?:sk|rk)-[A-Za-z0-9_-]{20,}/u,
  /[A-Z]:[\\/]/u,
];
const findings = [];
for (const relative of files) {
  const content = await readFile(resolve(repositoryRoot, relative), "utf8");
  for (const pattern of forbidden) if (pattern.test(content)) findings.push({ file: relative, pattern: pattern.source });
}
const result = { schemaVersion: 1, scope: files, forbiddenPatterns: forbidden.map((pattern) => pattern.source), findings, status: findings.length === 0 ? "PASS" : "BLOCKED" };
await writeFile(resolve(import.meta.dirname, "security-scan.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (findings.length !== 0) process.exitCode = 1;
