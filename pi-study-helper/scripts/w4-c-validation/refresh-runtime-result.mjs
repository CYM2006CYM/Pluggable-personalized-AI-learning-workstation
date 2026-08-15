import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "../..");
const logRoot = process.env.W4_C_LOG_ROOT ?? resolve(packageRoot, "../C-W4-D3-R3-command-logs");
const commandResultsPath = resolve(import.meta.dirname, "command-results.json");
const hash = (value) => createHash("sha256").update(value).digest("hex");
await mkdir(logRoot, { recursive: true });
const child = spawn(process.execPath, ["scripts/w4-c-validation/runtime-smoke.mjs"], {
  cwd: packageRoot,
  windowsHide: true,
  env: { ...process.env, PYTHONNOUSERSITE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
const exitCode = await new Promise((resolveExit) => child.once("close", (code) => resolveExit(code ?? 1)));
await writeFile(resolve(logRoot, "runtime-smoke-final.stdout.txt"), stdout, "utf8");
await writeFile(resolve(logRoot, "runtime-smoke-final.stderr.txt"), stderr, "utf8");
const results = JSON.parse(await readFile(commandResultsPath, "utf8"));
const index = results.commands.findIndex((entry) => entry.id === "runtime-smoke");
const smoke = JSON.parse(stdout);
results.commands[index] = {
  ...results.commands[index],
  startedUtc: smoke.startedUtc,
  endedUtc: smoke.endedUtc,
  naturalExitCode: exitCode,
  outerExitCode: exitCode,
  stdoutBytes: Buffer.byteLength(stdout),
  stdoutSha256: hash(stdout),
  stderrBytes: Buffer.byteLength(stderr),
  stderrSha256: hash(stderr),
};
await writeFile(commandResultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = exitCode;
