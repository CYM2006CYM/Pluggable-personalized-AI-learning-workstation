import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = resolve(process.argv[2] ?? "../../outputs/W4-D1-B-2-historical-reproduction-logs");
const node = resolve(process.argv[3] ?? "C:/Users/Lenovo/AppData/Local/Temp/node-v22.23.1-win-x64/node.exe");
const npm = resolve(process.argv[4] ?? "C:/Users/Lenovo/AppData/Local/Temp/node-v22.23.1-win-x64/npm.cmd");
const python = resolve(process.argv[5] ?? "C:/Users/Lenovo/AppData/Local/Programs/Python/Python314/python.exe");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const environment = {
  ...process.env,
  PATH: `${dirname(node)};${dirname(python)};${process.env.PATH ?? process.env.Path ?? ""}`,
  Path: `${dirname(node)};${dirname(python)};${process.env.Path ?? process.env.PATH ?? ""}`,
  ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
  SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
};
const records = [];

await mkdir(outputDirectory, { recursive: true });

async function run(name, command, args) {
  const startedAt = new Date().toISOString();
  const outcome = await new Promise((complete) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      env: environment,
      windowsHide: true,
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
  await writeFile(stdoutPath, outcome.stdout);
  await writeFile(stderrPath, outcome.stderr);
  const text = outcome.stdout.toString("utf8");
  const fileMatch = text.match(/Test Files\s+(?:(\d+) passed|(?:(\d+) failed \| )?(\d+) passed)/u);
  const testMatch = text.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?/u);
  records.push({
    name,
    command: [command, ...args].join(" "),
    cwd: appRoot,
    startedAt,
    endedAt,
    exitCode: outcome.exitCode,
    stdoutPath,
    stderrPath,
    stdoutSha256: sha256(outcome.stdout),
    stderrSha256: sha256(outcome.stderr),
    stdoutSummary: text.slice(-1500),
    stderrSummary: outcome.stderr.toString("utf8").slice(-1500),
    testStatistics: {
      testFiles: fileMatch ? Number(fileMatch[1] ?? fileMatch[2] ?? fileMatch[3]) : 0,
      passed: testMatch ? Number(testMatch[2]) : 0,
      failed: testMatch?.[1] ? Number(testMatch[1]) : 0,
      skipped: testMatch?.[3] ? Number(testMatch[3]) : 0,
    },
  });
}

await run("node-version", node, ["--version"]);
await run("python-runtime", python, ["-c", "import json,sys,pandas; print(json.dumps({'executable':sys.executable,'python':sys.version.split()[0],'pandas':pandas.__version__}))"]);
await run("full-test-python-3.14.4-reproduction", npm, ["test", "--", "--maxWorkers=1"]);
await run("verify-python-3.14.4-reproduction", npm, ["run", "verify"]);

const result = {
  role: "B",
  day: "W4-D1-B-2",
  purpose: "fresh reproduction in Python 3.14.4; this is not substituted for the missing raw artifacts of the historical initial run",
  environment: { node, npm, python },
  records,
};
await writeFile(resolve(outputDirectory, "historical-environment-reproduction.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputDirectory, records: records.map(({ name, exitCode, testStatistics }) => ({ name, exitCode, testStatistics })) }, null, 2));
process.exit(records.every((record) => record.exitCode === 0) ? 0 : 1);
