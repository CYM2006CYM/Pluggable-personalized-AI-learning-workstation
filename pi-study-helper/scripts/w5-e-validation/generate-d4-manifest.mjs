import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const prefix = "pi-study-helper/";
const evidencePrefix = `${prefix}scripts/w5-e-validation/`;
const handoff = "新版设计文档-重写版/第五周任务/handoff-w5-e-d4.md";
const manifestPath = `${evidencePrefix}d4-sha256-manifest.json`;
const formalFiles = [
  `${prefix}package.json`,
  `${prefix}vite.config.ts`,
  `${prefix}src/demo/launcher.ts`,
  `${prefix}src/web/app/AppShell.tsx`,
  `${prefix}src/web/app/routes.tsx`,
  `${prefix}src/web/pages/ActivityPage.tsx`,
  `${prefix}src/web/pages/ShowcasePage.tsx`,
  `${prefix}src/web/raw-imports.d.ts`,
  `${prefix}src/web/showcase/formal-showcase-data.ts`,
  `${prefix}src/web/showcase/formal-showcase-data.json`,
  `${prefix}src/web/styles.css`,
  `${prefix}tests/web/pages.test.tsx`,
  `${prefix}tests/web/routes.test.tsx`,
  `${prefix}tests/web/w5-d2-e-runtime-evidence.test.tsx`,
  `${prefix}tests/web/w5-d4-e-showcases.test.tsx`,
  `${prefix}tests/web/w5-d4-e-real-code-chain.test.tsx`,
  `${prefix}tests/web/vite-security.test.ts`,
  `${prefix}tests/web/boundary-contract.test.mjs`,
  `${evidencePrefix}capture-d4-browser.mjs`,
  `${evidencePrefix}d4-candidate-diff-check.mjs`,
  `${evidencePrefix}d4-diff-check.json`,
  `${evidencePrefix}generate-d4-evidence.mjs`,
  `${evidencePrefix}generate-formal-showcase-data.mjs`,
  `${evidencePrefix}generate-d4-manifest.mjs`,
  `${evidencePrefix}package-d4.mjs`,
  `${evidencePrefix}run-d4-independent-validation.mjs`,
  `${evidencePrefix}run-d4-validation.mjs`,
  `${evidencePrefix}verify-d4-evidence.mjs`,
  `${evidencePrefix}d4-browser-capture.json`,
  `${evidencePrefix}d4-command-results.json`,
  `${evidencePrefix}d4-independent-validation.json`,
  `${evidencePrefix}d4-known-limitations.json`,
  `${evidencePrefix}d4-page-state-copy.json`,
  `${evidencePrefix}d4-real-code-chain.json`,
  `${evidencePrefix}d4-screenshot-index.json`,
  `${evidencePrefix}d4-security-scan.json`,
  `${evidencePrefix}d4-test-mapping.json`,
  `${evidencePrefix}d4-upstream-binding.json`,
  `${evidencePrefix}d4-audit-only-files.txt`,
  `${evidencePrefix}d4-proposed-files.txt`,
  `${evidencePrefix}d4-zip-files.txt`,
  manifestPath,
  `${evidencePrefix}w5-e-d4-validation-report.md`,
  ...[
    "showcase-high-foundation-desktop",
    "showcase-non-computer-beginner-desktop",
    "showcase-practice-oriented-desktop",
    "showcase-practice-mobile",
    "activity-closed-desktop",
    "activity-closed-mobile",
  ].map((name) => `${evidencePrefix}evidence/d4/${name}.projection.json`),
  handoff,
].sort((left, right) => left.localeCompare(right, "en"));
const auditOnly = [
  "showcase-high-foundation-desktop",
  "showcase-non-computer-beginner-desktop",
  "showcase-practice-oriented-desktop",
  "showcase-practice-mobile",
  "activity-closed-desktop",
  "activity-closed-mobile",
].map((name) => `${evidencePrefix}evidence/d4/${name}.png`).sort((left, right) => left.localeCompare(right, "en"));
const zipFiles = [...formalFiles, ...auditOnly, "ZIP-MANIFEST.json"].sort((left, right) => left.localeCompare(right, "en"));
const forbiddenFormal = /(?:w5-d1-e-|scripts\/w5-e-validation\/d2-|handoff-w5-e-d2|\.png$|node_modules|dist-web|\.demo-build|(?:^|\/)private\/|rubrics|reference-solutions|hidden)/iu;
const ownerBlockerFiles = new Set([`${prefix}package.json`, `${prefix}vite.config.ts`, `${prefix}src/demo/launcher.ts`]);
const owned = (path) => path.startsWith(`${prefix}src/web/`) || path.startsWith(`${prefix}tests/web/`) || path.startsWith(evidencePrefix) || ownerBlockerFiles.has(path) || path === handoff;
const normalizeLf = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?|\n/gu, "\n"), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

for (const path of formalFiles) {
  if (!owned(path) || forbiddenFormal.test(path)) throw new Error(`formal_scope_rejected:${path}`);
}
if (auditOnly.length !== 6 || auditOnly.some((path) => !path.endsWith(".png") || !path.includes("/evidence/d4/"))) throw new Error("audit_scope_invalid");

await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d4-proposed-files.txt"), `${formalFiles.join("\n")}\n`, "utf8");
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d4-audit-only-files.txt"), `${auditOnly.join("\n")}\n`, "utf8");
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d4-zip-files.txt"), `${zipFiles.join("\n")}\n`, "utf8");
await Promise.all(formalFiles.filter((path) => path !== manifestPath).map((path) => stat(resolve(repositoryRoot, path))));
await Promise.all(auditOnly.map((path) => stat(resolve(repositoryRoot, path))));

const files = [];
for (const path of formalFiles) {
  if (path === manifestPath) continue;
  const normalized = normalizeLf(await readFile(resolve(repositoryRoot, path)));
  files.push({ path, hashMode: "utf8-lf-v1", byteLength: normalized.byteLength, sha256: sha256(normalized) });
}
const manifest = {
  schemaVersion: 3,
  candidate: "W5-D4-E",
  kind: "FORMAL_GIT_PROPOSED_SCOPE",
  baseHead: "aaf588202b3ae92ed72c63994b912d78977516bb",
  generatedAtUtc: new Date().toISOString(),
  entryCount: formalFiles.length,
  selfExcluded: [manifestPath],
  entries: files,
};
await writeFile(resolve(repositoryRoot, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ formalGitFiles: formalFiles.length, manifestEntries: files.length, auditOnlyFiles: auditOnly.length, zipFiles: zipFiles.length }, null, 2)}\n`);
