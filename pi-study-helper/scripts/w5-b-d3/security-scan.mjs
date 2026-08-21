import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const proposedPath = resolve(import.meta.dirname, "proposed-files.txt");
const outputPath = resolve(import.meta.dirname, "security-scan.json");
const paths = (await readFile(proposedPath, "utf8")).trim().split(/\r?\n/u).filter(Boolean);
const rules = [
  { id: "host-absolute-path", pattern: /[A-Za-z]:[\\/](?:Users|Program Files|Windows)[\\/]/gu },
  { id: "openai-api-key", pattern: /sk-[A-Za-z0-9_-]{20,}/gu },
  { id: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/gu },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu },
  { id: "bearer-secret", pattern: /Bearer\s+[A-Za-z0-9._~-]{24,}/gu },
];
const findings = [];
let scannedFiles = 0;
for (const path of paths) {
  if (path === "pi-study-helper/scripts/w5-b-d3/security-scan.json") continue;
  const absolute = resolve(workspaceRoot, path);
  const text = await readFile(absolute, "utf8");
  scannedFiles += 1;
  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({ path, ruleId: rule.id, line: text.slice(0, match.index).split(/\r?\n/u).length });
    }
  }
}
const result = {
  schemaVersion: 1,
  status: findings.length === 0 ? "PASS" : "FAIL",
  scannedFiles,
  ruleIds: rules.map((rule) => rule.id),
  findings,
  boundary: "Scans B's formal candidate only; conceptual references to hidden tests or Rubric are allowed, secret values and host paths are not.",
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (findings.length > 0) process.exitCode = 1;
