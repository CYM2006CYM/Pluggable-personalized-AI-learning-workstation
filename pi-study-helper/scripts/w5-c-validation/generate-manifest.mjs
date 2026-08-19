import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const proposedPath = resolve(import.meta.dirname, "proposed-files.txt");
const paths = (await readFile(proposedPath, "utf8")).split(/\r?\n/u).filter(Boolean);
const selfExcluded = new Set(["pi-study-helper/scripts/w5-c-validation/manifest.json"]);
const files = [];
for (const path of paths) {
  if (selfExcluded.has(path)) continue;
  const bytes = await readFile(resolve(repositoryRoot, path));
  files.push({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const manifest = {
  schemaVersion: 1,
  contract: "W5-C1/W5-R1",
  candidateHead: "0fd1f45386682a3859d8d9f6b37904b47ae98c33",
  selfExcluded: [...selfExcluded],
  files,
};
await writeFile(resolve(import.meta.dirname, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(resolve(import.meta.dirname, "hash-inventory.txt"), `AUDIT_ONLY / NOT_FOR_GIT\n${files.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`).join("\n")}\n`, "utf8");
