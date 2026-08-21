import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8")).split(/\r?\n/u).filter(Boolean);
const selfExcluded = ["pi-study-helper/scripts/w5-c-d3/manifest.json"];
const files = [];
for (const path of proposed) {
  if (selfExcluded.includes(path)) continue;
  const bytes = await readFile(resolve(repositoryRoot, path));
  files.push({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(resolve(import.meta.dirname, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, contract: "W5-C1/W5-R1", candidateHead: "383690831a8b3de42dad58795e71f218678f6fbc", selfExcluded, files }, null, 2)}\n`, "utf8");
await writeFile(resolve(import.meta.dirname, "hash-inventory.txt"), `AUDIT_ONLY / NOT_FOR_GIT\n${files.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`).join("\n")}\n`, "utf8");
