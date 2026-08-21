import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const proposedPath = resolve(import.meta.dirname, "proposed-files.txt");
const outputPath = resolve(import.meta.dirname, "diff-check.json");
const paths = (await readFile(proposedPath, "utf8")).trim().split(/\r?\n/u).filter(Boolean);
let previousResult;
try { previousResult = JSON.parse(await readFile(outputPath, "utf8")); } catch { previousResult = undefined; }
const temp = await mkdtemp(resolve(tmpdir(), "w5-b-d3-index-"));
const indexPath = resolve(temp, "index");
const env = { ...process.env, GIT_INDEX_FILE: indexPath };
const run = (args, input) => spawnSync("git", args, { cwd: workspaceRoot, env, encoding: "utf8", input });
try {
  const readTree = run(["read-tree", "HEAD"]);
  if (readTree.status !== 0) throw new Error(readTree.stderr || "git read-tree failed");
  const add = run(["add", "-A", "--pathspec-from-file=-"], `${paths.join("\n")}\n`);
  if (add.status !== 0) throw new Error(add.stderr || "git add in isolated index failed");
  const names = run(["-c", "core.quotepath=false", "diff", "--cached", "--name-only"]);
  if (names.status !== 0) throw new Error(names.stderr || "git diff --name-only failed");
  const actual = names.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const check = run(["diff", "--cached", "--check"]);
  const missing = paths.filter((path) => !actual.includes(path));
  const unexpected = actual.filter((path) => !paths.includes(path));
  const result = {
    schemaVersion: 1,
    status: check.status === 0 && missing.length === 0 && unexpected.length === 0 ? "PASS" : "FAIL",
    proposedCount: paths.length,
    stagedInIsolatedIndexCount: actual.length,
    missing,
    unexpected,
    diffCheckExitCode: check.status,
    diffCheckOutput: check.stdout.trim(),
    historicalFailures: previousResult?.status === "FAIL"
      ? [{ status: "FAIL", diffCheckExitCode: previousResult.diffCheckExitCode, diffCheckOutput: previousResult.diffCheckOutput }]
      : previousResult?.historicalFailures ?? [],
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
