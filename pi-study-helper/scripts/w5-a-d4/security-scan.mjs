import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8"))
  .trim().split(/\r?\n/u).filter(Boolean);
const outputPath = resolve(import.meta.dirname, "security-scan.json");
const rules = [
  { id: "host-absolute-path", pattern: /[A-Za-z]:[\\/](?:Users|Program Files|Windows)[\\/]/gu },
  { id: "openai-api-key", pattern: /sk-[A-Za-z0-9_-]{20,}/gu },
  { id: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/gu },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu },
  { id: "bearer-secret", pattern: /Bearer\s+[A-Za-z0-9._~-]{24,}/gu },
];
const forbiddenPaths = [
  /assessments\/(?:private|hidden)\//iu,
  /reference-solutions\//iu,
  /node_modules\//iu,
  /\.demo-(?:data|build)\//iu,
  /\.(?:zip|sha256)$/iu,
];
const findings = [];
let scannedFiles = 0;
for (const path of proposed) {
  if (path === "pi-study-helper/scripts/w5-a-d4/security-scan.json") continue;
  if (forbiddenPaths.some((pattern) => pattern.test(path))) findings.push({ path, ruleId: "forbidden-candidate-path" });
  const text = await readFile(resolve(workspaceRoot, path), "utf8");
  scannedFiles += 1;
  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) findings.push({ path, ruleId: rule.id, line: text.slice(0, match.index).split(/\r?\n/u).length });
  }
}
const result = { schemaVersion: 2, status: findings.length === 0 ? "PASS" : "FAIL", scannedFiles, ruleIds: rules.map((rule) => rule.id), findings };
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (findings.length > 0) process.exitCode = 1;
