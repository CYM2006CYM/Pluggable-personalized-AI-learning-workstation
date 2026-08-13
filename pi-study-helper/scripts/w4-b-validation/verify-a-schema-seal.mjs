import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [runtimeRootArgument, profileRootArgument, outputPathArgument] = process.argv.slice(2);
if (!runtimeRootArgument || !profileRootArgument || !outputPathArgument) {
  throw new Error("Usage: node verify-a-schema-seal.mjs <compiled-a-runtime-root> <revision-3-root> <output-json>");
}
const runtimeRoot = resolve(runtimeRootArgument);
const profileRoot = resolve(profileRootArgument);
const outputPath = resolve(outputPathArgument);
const schema = await import(pathToFileURL(resolve(runtimeRoot, "domain/profile-v2-schema.js")).href);
const seal = await import(pathToFileURL(resolve(runtimeRoot, "domain/profile-revision-seal.js")).href);
await schema.validateProfileV2Directory(profileRoot);
const result = await seal.validateRevisionSeal(profileRoot, "pandas-cleaning");
const report = {
  status: "PASS",
  runtimeRoot,
  profileRoot,
  schemaValidation: "PASS",
  sealValidation: "PASS",
  sealEntryCount: result.entries.length,
  assetTreeSha256: result.assetTreeSha256,
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
