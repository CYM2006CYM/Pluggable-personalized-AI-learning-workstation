import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const prefix = "pi-study-helper/";
const handoff = "新版设计文档-重写版/第五周任务/handoff-w5-e-d2.md";
const evidencePrefix = `${prefix}scripts/w5-e-validation/`;
const formalFiles = [
  `${prefix}src/web/app/routes.tsx`,
  `${prefix}src/web/pages/ActivityPage.tsx`,
  `${prefix}src/web/pages/DiagnosticPage.tsx`,
  `${prefix}src/web/pages/PathPage.tsx`,
  `${prefix}src/web/pages/StartPage.tsx`,
  `${prefix}src/web/pages/StudyDeepLinkPage.tsx`,
  `${prefix}src/web/preview/browser-code-runner.ts`,
  `${prefix}src/web/preview/create-browser-code-runner.ts`,
  `${prefix}src/web/preview/pyodide-preview.worker.ts`,
  `${prefix}src/web/state/activity-draft-storage.ts`,
  `${prefix}tests/web/activity-draft-storage.test.ts`,
  `${prefix}tests/web/boundary-contract.test.mjs`,
  `${prefix}tests/web/browser-code-runner.test.ts`,
  `${prefix}tests/web/fixtures/w4-api.ts`,
  `${prefix}tests/web/pages.test.tsx`,
  `${prefix}tests/web/routes.test.tsx`,
  `${prefix}tests/web/study-deep-link.test.tsx`,
  `${prefix}tests/web/w5-d2-e-runtime-evidence.test.tsx`,
  `${evidencePrefix}capture-d2-r2-browser.mjs`,
  `${evidencePrefix}generate-d2-manifest.mjs`,
  `${evidencePrefix}generate-d2-security-and-screenshots.mjs`,
  `${evidencePrefix}package-d2-r2.mjs`,
  `${evidencePrefix}run-d2-runtime-tests.mjs`,
  `${evidencePrefix}run-d2-validation.mjs`,
  `${evidencePrefix}verify-d2-r2-evidence.mjs`,
  `${evidencePrefix}d2-browser-capture.json`,
  `${evidencePrefix}d2-command-results.json`,
  `${evidencePrefix}d2-known-limitations.json`,
  `${evidencePrefix}d2-runtime-test-results.json`,
  `${evidencePrefix}d2-screenshot-index.json`,
  `${evidencePrefix}d2-security-scan.json`,
  `${evidencePrefix}d2-test-mapping.json`,
  `${evidencePrefix}d2-upstream-binding.json`,
  `${evidencePrefix}d2-audit-only-files.txt`,
  `${evidencePrefix}d2-proposed-files.txt`,
  `${evidencePrefix}d2-zip-files.txt`,
  `${evidencePrefix}d2-sha256-manifest.json`,
  handoff,
].sort();

const forbiddenFormal = /(?:w5-d1-e-|\.png$|(?:^|\/)evidence\/d2\/|node_modules|dist-web|\.demo-build)/u;
const owned = (path) => path.startsWith(`${prefix}src/web/`) || path.startsWith(`${prefix}tests/web/`) || path.startsWith(evidencePrefix) || path === handoff;
let capture;
try { capture = JSON.parse(await readFile(resolve(packageRoot, "scripts/w5-e-validation/d2-browser-capture.json"), "utf8")); } catch { capture = undefined; }
const auditOnly = (capture?.captures ?? []).map((item) => `${prefix}${item.pngFile}`).sort();
if (auditOnly.length !== 4 || auditOnly.some((path) => !path.endsWith(".png"))) throw new Error("audit_png_capture_set_invalid");
for (const path of auditOnly) await stat(resolve(repositoryRoot, path));

const zipFiles = [...formalFiles, ...auditOnly, "ZIP-MANIFEST.json"].sort();
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d2-proposed-files.txt"), `${formalFiles.join("\n")}\n`, "utf8");
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d2-audit-only-files.txt"), `${auditOnly.join("\n")}\n`, "utf8");
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d2-zip-files.txt"), `${zipFiles.join("\n")}\n`, "utf8");
for (const path of formalFiles) {
  if (!owned(path) || forbiddenFormal.test(path)) throw new Error(`formal_scope_rejected:${path}`);
  await stat(resolve(repositoryRoot, path));
}

const manifestPath = `${evidencePrefix}d2-sha256-manifest.json`;
const files = [];
for (const path of formalFiles) {
  if (path === manifestPath) continue;
  const value = await readFile(resolve(repositoryRoot, path));
  files.push({ path, bytes: value.byteLength, sha256: createHash("sha256").update(value).digest("hex") });
}
const manifest = {
  schemaVersion: 2,
  candidate: "W5-D2-E-R2",
  kind: "FORMAL_GIT_PROPOSED_SCOPE",
  baseHead: "127a71cce4a8423327fb5ce75d31294252b92a0b",
  generatedAtUtc: new Date().toISOString(),
  selfExcluded: [manifestPath],
  files,
};
await writeFile(resolve(repositoryRoot, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ formalGitFiles: formalFiles.length, auditOnlyFiles: auditOnly.length, zipFiles: zipFiles.length, manifestFiles: files.length }, null, 2)}\n`);
