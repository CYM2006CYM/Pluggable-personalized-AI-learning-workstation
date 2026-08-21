import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const proposed = (await readFile(resolve(import.meta.dirname, "proposed-files.txt"), "utf8")).split(/\r?\n/u).filter(Boolean);
const outputPath = resolve(import.meta.dirname, "diff-check.json");
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, status: "RUNNING" }, null, 2)}\n`, "utf8");
const temporary = await mkdtemp(resolve(tmpdir(), "w5-d3-r2-index-"));
const indexPath = resolve(temporary, "index");
function git(args) {
  return new Promise((done) => {
    const stdout = []; const stderr = [];
    const child = spawn("git", args, { cwd: repositoryRoot, shell: false, windowsHide: true, env: { ...process.env, GIT_INDEX_FILE: indexPath } });
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("close", (exitCode) => done({ exitCode, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}
let result;
try {
  const readTree = await git(["read-tree", "HEAD"]);
  if (readTree.exitCode !== 0) throw new Error("temporary index read-tree failed");
  const intent = await git(["add", "--intent-to-add", "--", ...proposed]);
  if (intent.exitCode !== 0) throw new Error(`temporary index intent-to-add failed: ${intent.stderr}`);
  const check = await git(["diff", "--check", "--", ...proposed]);
  const names = await git(["-c", "core.quotepath=false", "diff", "--name-only", "--", ...proposed]);
  const covered = names.stdout.split(/\r?\n/u).filter(Boolean);
  result = { schemaVersion: 1, classification: "AUDIT_ONLY / NOT_FOR_GIT", status: check.exitCode === 0 && covered.length === proposed.length && proposed.every((path) => covered.includes(path)) ? "PASS" : "BLOCKED", method: "isolated GIT_INDEX_FILE + git add --intent-to-add + git diff --check", proposedCount: proposed.length, coveredCount: covered.length, coveredFiles: covered, exitCode: check.exitCode, stdout: check.stdout, stderr: check.stderr };
} finally {
  await rm(temporary, { recursive: true, force: true });
}
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (result.status !== "PASS") process.exitCode = 1;
