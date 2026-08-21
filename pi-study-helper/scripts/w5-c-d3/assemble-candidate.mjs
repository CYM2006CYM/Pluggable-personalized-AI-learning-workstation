import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const stage = process.argv[2] ? resolve(process.argv[2]) : resolve(repositoryRoot, "../W5-D3-C-candidate-stage");
const execute = promisify(execFile);
for (const script of ["security-scan.mjs", "generate-manifest.mjs", "verify-manifest.mjs"]) {
  await execute(process.execPath, [resolve(import.meta.dirname, script)], { cwd: repositoryRoot, windowsHide: true });
}
const proposed = (await (await import("node:fs/promises")).readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8")).split(/\r?\n/u).filter(Boolean);
const auditOnly = [
  "pi-study-helper/scripts/w5-c-d3/delivery-report.md",
  "pi-study-helper/scripts/w5-c-d3/hash-inventory.txt",
  "pi-study-helper/scripts/w5-c-d3/manifest-verification.json",
  "pi-study-helper/scripts/w5-c-d3/logs/",
];
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const path of proposed) {
  const source = resolve(repositoryRoot, path);
  const target = resolve(stage, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}
for (const path of auditOnly) {
  const source = resolve(repositoryRoot, path);
  const target = resolve(stage, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}
await execute(process.execPath, [resolve(stage, "pi-study-helper/scripts/w5-c-d3/verify-manifest.mjs")], { cwd: stage, windowsHide: true });
console.log(JSON.stringify({ stage: "<candidate-stage>", sequence: ["security-scan", "generate-manifest", "verify-manifest", "assemble", "restaged-verify"], gitProposedCount: proposed.length, auditOnlyCount: auditOnly.length, excluded: [".git", "node_modules", ".demo-data", ".demo-build", "dist-web", "old-zips"] }));
