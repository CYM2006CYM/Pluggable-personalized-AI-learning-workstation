import { cp, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const stage = process.argv[2] === undefined ? resolve(repositoryRoot, "../C-W5-D1-candidate-0fd1f45") : resolve(process.argv[2]);
await mkdir(stage, { recursive: false });
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8")).split(/\r?\n/u).filter(Boolean);
const auditOnly = [
  "pi-study-helper/scripts/w5-c-validation/hash-inventory.txt",
  "pi-study-helper/scripts/w5-c-validation/manifest-verification.json",
];
const paths = [...proposed, ...auditOnly];
for (const path of paths) {
  const source = resolve(repositoryRoot, path);
  const destination = resolve(stage, path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: false, errorOnExist: true });
}
process.stdout.write(`assembled ${proposed.length} Git-proposed paths and ${auditOnly.length} AUDIT_ONLY / NOT_FOR_GIT paths at <candidate-stage>\n`);
