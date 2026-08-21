import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8"))
  .split(/\r?\n/u).filter(Boolean)
  .filter((path) => !path.endsWith("/security-scan.json") && !path.endsWith("/manifest.json"));
async function auditFiles(directory, relativeDirectory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await auditFiles(resolve(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}
const logFiles = await auditFiles(resolve(import.meta.dirname, "logs"), "pi-study-helper/scripts/w5-c-d3/logs");
const deliveryReport = "pi-study-helper/scripts/w5-c-d3/delivery-report.md";
const scanEntries = [
  ...proposed.map((path) => ({ path, scope: "GIT_PROPOSED" })),
  ...logFiles.map((path) => ({ path, scope: "AUDIT_LOG" })),
  { path: deliveryReport, scope: "DELIVERY_REPORT" },
];
const findings = [];
const patterns = [
  { id: "host_absolute_path", pattern: /[A-Za-z]:[\\/](?:Users|Temp|AppData)[\\/]/gu },
  { id: "credential_assignment", pattern: /(?:OPENAI_API_KEY|apiKey|token|secret)\s*[:=]\s*["'][^"']{8,}["']/giu },
  { id: "private_asset_path", pattern: /(?:fixtures[\\/]profiles[^\n"]*(?:hidden-tests|reference-solutions|private\.csv))/giu },
];
for (const entry of scanEntries) {
  const text = await readFile(resolve(repositoryRoot, entry.path), "utf8");
  for (const rule of patterns) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) findings.push({ path: entry.path, scope: entry.scope, rule: rule.id });
  }
}
const result = { schemaVersion: 2, generatedAt: new Date().toISOString(), scopes: { gitProposed: proposed.length, auditLogs: logFiles.length, deliveryReports: 1 }, scannedFiles: scanEntries.length, findingCount: findings.length, findings, status: findings.length === 0 ? "PASS" : "BLOCKED" };
await writeFile(resolve(import.meta.dirname, "security-scan.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (findings.length > 0) process.exitCode = 1;
