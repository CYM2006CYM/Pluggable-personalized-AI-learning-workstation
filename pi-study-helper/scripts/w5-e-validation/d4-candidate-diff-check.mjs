import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const paths = (await readFile(resolve(import.meta.dirname, "d4-proposed-files.txt"), "utf8"))
  .trim().split(/\r?\n/u).filter(Boolean);
const temporary = await mkdtemp(resolve(tmpdir(), "w5-e-d4-index-"));
const environment = { ...process.env, GIT_INDEX_FILE: resolve(temporary, "index") };
const run = (args, input) => spawnSync("git", args, { cwd: repositoryRoot, env: environment, encoding: "utf8", input });

try {
  const tree = run(["read-tree", "HEAD"]);
  if (tree.status !== 0) throw new Error(tree.stderr || "git read-tree failed");
  const add = run(["add", "-A", "--pathspec-from-file=-"], `${paths.join("\n")}\n`);
  if (add.status !== 0) throw new Error(add.stderr || "git add failed");
  const names = run(["-c", "core.quotepath=false", "diff", "--cached", "--name-only"]);
  const actual = names.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const check = run(["diff", "--cached", "--check"]);
  const missing = paths.filter((path) => !actual.includes(path));
  const unexpected = actual.filter((path) => !paths.includes(path));
  const result = {
    schemaVersion: 1,
    status: check.status === 0 && missing.length === 0 && unexpected.length === 0 ? "PASS" : "FAIL",
    proposedCount: paths.length,
    isolatedIndexCount: actual.length,
    missing,
    unexpected,
    diffCheckExitCode: check.status,
    diffCheckOutput: check.stdout.trim(),
  };
  await writeFile(resolve(import.meta.dirname, "d4-diff-check.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
