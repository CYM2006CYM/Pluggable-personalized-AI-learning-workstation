import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const appRoot = resolve(scriptDirectory, "../..");
const repoRoot = resolve(appRoot, "..");
const handoffPath = resolve(repoRoot, "新版设计文档-重写版/第四周任务/handoff-w4-b-d1.md");
const outputPath = resolve(process.argv[2] ?? "../../outputs/W4-D1-B-3-proposed-submit-manifest.json");
const roots = [
  resolve(appRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft"),
  resolve(appRoot, "scripts/w4-b-validation"),
  handoffPath,
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function files(root) {
  const result = [];
  const item = await stat(root);
  if (item.isFile()) return [root];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if (entry.isFile()) result.push(absolute);
    else throw new Error(`Unsupported proposed-submit entry: ${absolute}`);
  }
  return result;
}

const paths = (await Promise.all(roots.map(files))).flat();
const entries = await Promise.all(paths.map(async (absolute) => {
  const bytes = await readFile(absolute);
  return { path: relative(repoRoot, absolute).replaceAll("\\", "/"), sha256: sha256(bytes), byteLength: bytes.byteLength };
}));
entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
const manifest = {
  role: "B", day: "W4-D1-B-3", contract: "W4-C2/W4-R1",
  algorithm: "repository-relative POSIX path sorted by UTF-8 bytes; raw-binary SHA-256 and byteLength",
  entryCount: entries.length,
  entries,
  excludedFromProposedGit: [
    "all ZIP files and sidecars", "raw stdout/stderr logs", "B external virtual environment", "A schema/seal compiled audit runtime",
    "node_modules", ".demo-data", "repository-external audit directories", "other-role files",
  ],
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, entryCount: entries.length }, null, 2));
