import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const proposedPath = resolve(import.meta.dirname, "proposed-files.txt");
const proposed = (await readFile(proposedPath, "utf8")).split(/\r?\n/u).filter(Boolean);
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "w5-c-diff-index-"));
const temporaryIndex = resolve(temporaryRoot, "index");

try {
  const { stdout } = await execute("git", ["rev-parse", "--git-path", "index"], { cwd: repositoryRoot, windowsHide: true });
  const sourceIndex = resolve(repositoryRoot, stdout.trim());
  await copyFile(sourceIndex, temporaryIndex);
  const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
  await execute("git", ["add", "-N", "--", ...proposed], { cwd: repositoryRoot, env, windowsHide: true });
  await execute("git", ["diff", "--check"], { cwd: repositoryRoot, env, windowsHide: true });
  process.stdout.write(`git diff --check covered ${proposed.length} proposed files through an isolated intent-to-add index\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
