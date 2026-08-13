import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "fixtures/profiles/pandas-cleaning-revision-3-draft");
const sealPath = resolve(root, "quality/revision-seal.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort((a, b) => a.localeCompare(b, "en")).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("Unsupported JSON value");
};
async function allFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link is forbidden: ${absolute}`);
    if (entry.isDirectory()) files.push(...await allFiles(absolute));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}
const entries = [];
for (const absolute of await allFiles(root)) {
  const path = relative(root, absolute).replaceAll("\\", "/");
  if (path === "quality/revision-seal.json") continue;
  const raw = await readFile(absolute);
  const payload = path === "profile.json" ? Buffer.from(canonicalJson({ ...JSON.parse(raw.toString("utf8")), status: "draft" }), "utf8") : raw;
  entries.push({ path, hashMode: path === "profile.json" ? "utf8-json-keys-sorted-arrays-preserved-no-whitespace-v1" : "raw-binary", sha256: sha256(payload), byteLength: payload.byteLength });
}
entries.sort((a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8")));
const assetTreeSha256 = sha256(Buffer.concat(entries.map((entry) => Buffer.from(`${entry.path}\0${entry.hashMode}\0${entry.sha256}\0${entry.byteLength}\n`, "utf8"))));
const manifest = JSON.parse(await readFile(resolve(root, "profile.json"), "utf8"));
const seal = { schemaVersion: 1, subjectId: manifest.subjectId, revision: manifest.revision, entries, assetTreeSha256 };
await writeFile(sealPath, `${JSON.stringify(seal, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ sealPath, entryCount: entries.length, assetTreeSha256 }, null, 2));
