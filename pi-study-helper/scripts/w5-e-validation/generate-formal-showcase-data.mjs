import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const pathResultsPath = resolve(packageRoot, "scripts/w5-a-d4/showcase-path-results.json");
const differencesPath = resolve(packageRoot, "scripts/w5-a-d4/showcase-differences.json");
const outputPath = resolve(packageRoot, "src/web/showcase/formal-showcase-data.json");
const normalizeLf = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const [pathBytes, differenceBytes] = await Promise.all([
  readFile(pathResultsPath).then(normalizeLf),
  readFile(differencesPath).then(normalizeLf),
]);
const pathResults = JSON.parse(pathBytes.toString("utf8"));
const differences = JSON.parse(differenceBytes.toString("utf8"));
if (pathResults.status !== "PASS" || differences.status !== "PASS") throw new Error("A-D4 formal showcase inputs are not PASS");

const output = {
  schemaVersion: 1,
  generatedFrom: {
    pathResults: { path: "scripts/w5-a-d4/showcase-path-results.json", sha256: sha256(pathBytes), byteLength: pathBytes.byteLength },
    differences: { path: "scripts/w5-a-d4/showcase-differences.json", sha256: sha256(differenceBytes), byteLength: differenceBytes.byteLength },
  },
  pathResults,
  differences,
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", output: "src/web/showcase/formal-showcase-data.json", sources: output.generatedFrom }, null, 2));
