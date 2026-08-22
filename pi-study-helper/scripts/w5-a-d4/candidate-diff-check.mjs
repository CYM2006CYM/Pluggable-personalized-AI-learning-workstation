import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const outputPath = resolve(import.meta.dirname, "diff-check.json");
const paths = (await readFile(resolve(import.meta.dirname, "patch-files.txt"), "utf8"))
  .trim().split(/\r?\n/u).filter(Boolean);
let previous;
try { previous = JSON.parse(await readFile(outputPath, "utf8")); } catch { previous = undefined; }
const temporary = await mkdtemp(resolve(tmpdir(), "w5-a-d4-index-"));
const env = { ...process.env, GIT_INDEX_FILE: resolve(temporary, "index") };
const run = (args, input) => spawnSync("git", args, { cwd: workspaceRoot, env, encoding: "utf8", input });
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
    schemaVersion: 2,
    status: check.status === 0 && missing.length === 0 && unexpected.length === 0 ? "PASS" : "FAIL",
    patchCount: paths.length,
    isolatedIndexCount: actual.length,
    missing,
    unexpected,
    diffCheckExitCode: check.status,
    diffCheckOutput: check.stdout.trim(),
    historicalFailures: previous?.status === "FAIL"
      ? [{
          status: "FAIL",
          reason: "full_candidate_list_was_used_as_post_upload_patch_list",
          expectedCount: previous.proposedCount,
          actualCount: previous.isolatedIndexCount,
          missing: previous.missing,
          unexpected: previous.unexpected,
          diffCheckExitCode: previous.diffCheckExitCode,
          diffCheckOutput: previous.diffCheckOutput,
        }]
      : previous?.historicalFailures ?? [],
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
