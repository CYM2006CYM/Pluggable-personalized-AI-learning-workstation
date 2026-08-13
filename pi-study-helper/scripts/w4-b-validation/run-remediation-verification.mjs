import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const repoRoot = resolve(appRoot, "..");
const outputDirectory = resolve(process.argv[2] ?? "../../outputs/W4-D1-B-remediation-command-logs");
const nodeHome = resolve(process.argv[3] ?? "C:/Users/Lenovo/AppData/Local/Temp/node-v22.23.1-win-x64");
const python = resolve(process.argv[4] ?? "C:/Users/Lenovo/AppData/Local/Temp/w4-d1-b-python313/Scripts/python.exe");
const node = resolve(nodeHome, "node.exe");
const npm = resolve(nodeHome, "npm.cmd");
const schemaRuntimeRoot = resolve(process.argv[5] ?? "C:/Users/Lenovo/Documents/Codex/2026-08-12/la/work/w4-b-schema-dist");
const profileRoot = resolve(appRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const revision2Root = resolve(appRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const environment = { ...process.env };
delete environment.PATH;
environment.Path = `${nodeHome};${dirname(python)};${process.env.Path ?? ""}`;
const records = [];

await mkdir(outputDirectory, { recursive: true });

async function run(name, command, args, cwd = appRoot, metadata = {}) {
  const startedAt = new Date().toISOString();
  const result = await new Promise((complete) => {
    const child = spawn(command, args, {
      cwd, env: environment, windowsHide: true,
      shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (value) => stdout.push(value));
    child.stderr.on("data", (value) => stderr.push(value));
    child.on("error", (error) => complete({ exitCode: null, stdout: Buffer.concat(stdout), stderr: Buffer.concat([...stderr, Buffer.from(String(error))]) }));
    child.on("close", (exitCode) => complete({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
  const endedAt = new Date().toISOString();
  const stem = String(records.length + 1).padStart(2, "0");
  const stdoutPath = resolve(outputDirectory, `${stem}-${name}.stdout.txt`);
  const stderrPath = resolve(outputDirectory, `${stem}-${name}.stderr.txt`);
  await writeFile(stdoutPath, result.stdout);
  await writeFile(stderrPath, result.stderr);
  const text = result.stdout.toString("utf8");
  const files = text.match(/Test Files\s+(\d+) passed(?:\s*\(\d+\))?/u);
  const tests = text.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/u);
  const record = {
    name, command: [command, ...args].join(" "), cwd, startedAt, endedAt, exitCode: result.exitCode,
    stdoutPath, stderrPath, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr),
    stdoutSummary: text.slice(-1500), stderrSummary: result.stderr.toString("utf8").slice(-1500),
    testStatistics: {
      testFiles: metadata.testFiles ?? (files ? Number(files[1]) : 0),
      passed: tests ? Number(tests[1]) : result.exitCode === 0 ? metadata.passed ?? 0 : 0,
      failed: metadata.failed ?? (result.exitCode === 0 ? 0 : null),
      skipped: tests?.[2] ? Number(tests[2]) : metadata.skipped ?? 0,
    },
    ...metadata,
  };
  if (typeof metadata.enrich === "function") metadata.enrich(record, text);
  delete record.enrich;
  records.push(record);
}

await run("locked-node", node, ["--version"], appRoot, { expected: { node: "v22.23.1" } });
await run("locked-runtime", python, ["-c", "import json,sys,pandas as pd; print(json.dumps({'python':sys.version.split()[0],'executable':sys.executable,'pandas':pd.__version__}))"], appRoot, { expected: { python: "3.13.7", pandas: "3.0.5" } });
await run("b-r1-01-full-candidate-validation", node, [resolve(scriptDirectory, "validate-w4-b-d1.mjs"), profileRoot, revision2Root, resolve(outputDirectory, "validation-result.json")], appRoot, { issueId: "B-R1-01" });
await run("a-schema-and-seal", node, [resolve(scriptDirectory, "verify-a-schema-seal.mjs"), schemaRuntimeRoot, profileRoot, resolve(outputDirectory, "a-schema-seal-result.json")], appRoot, { issueId: "B-R1-01" });
for (const filename of ["test-duplicates-public.py", "test-missing-public.py", "test-practical-public.py", "test-structure-public.py", "test-types-public.py"]) {
  await run(`public-python-${filename.replace(/\.py$/u, "")}`, python, [resolve(profileRoot, "assessments/public/tests", filename)], appRoot, {
    issueId: "B-R1-02", testFiles: 1, passed: 1, failed: 0, skipped: 0,
  });
}
await run("b-asset-and-contract-targeted", npm, ["test", "--", "--maxWorkers=1", "tests/profile-revision-3-activation.test.ts", "tests/w4-contracts.test.ts"], appRoot, { testFiles: 2 });
await run("python-evaluator-affected", npm, ["test", "--", "--maxWorkers=1", "tests/python-process-evaluation.test.ts", "tests/python-process-evaluation-r2.test.ts"], appRoot, { issueId: "B-R1-02", testFiles: 2 });
await run("typecheck", npm, ["run", "typecheck"]);
await run("check-docs", npm, ["run", "check:docs"]);
await run("smoke-extension", npm, ["run", "smoke:extension"]);
await run("full-test", npm, ["test", "--", "--maxWorkers=1"], appRoot, { testFiles: 70 });
await run("v2-6-direct-revision2-20-plus-60", node, [
  resolve(appRoot, "scripts/w2-verification/v2-6-preconditions.mjs"),
  "--development", "../evaluation/personas/development-20.jsonl",
  "--final", "../evaluation/personas/final-60.jsonl",
  "--profile", "fixtures/profiles/pandas-cleaning-v2-draft",
], appRoot, {
  issueId: "B-R3-01",
  revision2ProfilePath: revision2Root,
  enrich(record, text) {
    const output = JSON.parse(text);
    record.v26 = {
      verification: output.verification,
      status: output.status,
      development: { path: resolve(appRoot, "../evaluation/personas/development-20.jsonl"), ...output.inspection.development },
      final: { path: resolve(appRoot, "../evaluation/personas/final-60.jsonl"), ...output.inspection.final },
      runtime: output.runtime,
    };
  },
});
await run("v2-6-isolated-revision2", npm, ["test", "--", "--maxWorkers=1", "scripts/w2-verification/v2-6-preconditions.test.mjs"], appRoot, {
  issueId: "B-R3-01",
  revision2ProfilePath: revision2Root,
  testFiles: 1,
  passed: 5,
  failed: 0,
  skipped: 0,
});
await run("verify", npm, ["run", "verify"], appRoot, { testFiles: 70 });
await run("git-diff-check", "git", ["-C", repoRoot, "diff", "--check"], repoRoot);

const result = {
  role: "B", day: "W4-D1", contract: "W4-C2/W4-R1",
  issueMapping: {
    "B-R1-01": ["b-r1-01-full-candidate-validation", "a-schema-and-seal", "b-asset-and-contract-targeted"],
    "B-R1-02": ["locked-node", "locked-runtime", "public-python-*", "python-evaluator-affected", "full-test", "verify"],
    "B-R3-01": ["full-test", "v2-6-direct-revision2-20-plus-60", "v2-6-isolated-revision2", "verify"],
  },
  environment: { nodeHome, node, python, schemaRuntimeRoot, pathPrefix: `${nodeHome};${dirname(python)}` },
  records,
  allExitCodesZero: records.every((record) => record.exitCode === 0),
};
await writeFile(resolve(outputDirectory, "command-results.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputDirectory, totalCommands: records.length, allExitCodesZero: result.allExitCodesZero }, null, 2));
process.exit(result.allExitCodesZero ? 0 : 1);
