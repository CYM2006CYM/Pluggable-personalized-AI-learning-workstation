import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const portReady = (port) => new Promise((resolveReady) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolveReady(true); });
  socket.once("error", () => { socket.destroy(); resolveReady(false); });
});
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const digest = (value) => createHash("sha256").update(value).digest("hex");

const started = new Date().toISOString();
const child = process.platform === "win32"
  ? (await import("node:child_process")).spawn("cmd.exe", ["/d", "/s", "/c", "npm.cmd run demo"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  : (await import("node:child_process")).spawn("npm", ["run", "demo"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

let apiReadyAt;
let viteReadyAt;
const deadline = Date.now() + 45_000;
while (Date.now() < deadline && (apiReadyAt === undefined || viteReadyAt === undefined)) {
  const now = new Date().toISOString();
  if (apiReadyAt === undefined && await portReady(4310)) apiReadyAt = now;
  if (viteReadyAt === undefined && await portReady(5173)) viteReadyAt = now;
  await wait(100);
}

let bootstrapStatus = null;
let bootstrapValid = false;
if (apiReadyAt !== undefined) {
  try {
    const response = await fetch("http://127.0.0.1:4310/api/bootstrap");
    bootstrapStatus = response.status;
    const payload = await response.json();
    bootstrapValid = response.status === 200
      && Array.isArray(payload?.data?.profiles)
      && payload.data.profiles.some((profile) => profile?.revision === 3);
  } catch { bootstrapStatus = "ERROR"; }
}

let processTree = [];
if (process.platform === "win32" && child.pid !== undefined) {
  try {
    const listed = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { maxBuffer: 8 * 1024 * 1024 });
    const all = JSON.parse(listed.stdout);
    const rows = Array.isArray(all) ? all : [all];
    const ids = new Set([child.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (ids.has(row.ParentProcessId) && !ids.has(row.ProcessId)) { ids.add(row.ProcessId); changed = true; }
      }
    }
    processTree = rows.filter((row) => ids.has(row.ProcessId)).map((row) => ({
      processId: row.ProcessId,
      parentProcessId: row.ParentProcessId,
      name: row.Name,
    }));
  } catch { processTree = []; }
}

if (child.pid !== undefined) {
  try { await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]); } catch { /* process may have exited during startup */ }
}
await Promise.race([once(child, "close"), wait(5_000)]);
const closeDeadline = Date.now() + 5_000;
let apiClosed = false;
let viteClosed = false;
while (Date.now() < closeDeadline && (!apiClosed || !viteClosed)) {
  apiClosed = !(await portReady(4310));
  viteClosed = !(await portReady(5173));
  if (!apiClosed || !viteClosed) await wait(100);
}

const result = {
  command: "npm.cmd run demo",
  workingDirectory: "pi-study-helper",
  startedUtc: started,
  endedUtc: new Date().toISOString(),
  naturalExitCode: child.exitCode,
  apiReadyUtc: apiReadyAt ?? null,
  viteReadyUtc: viteReadyAt ?? null,
  apiBeforeVite: apiReadyAt !== undefined && viteReadyAt !== undefined && apiReadyAt <= viteReadyAt,
  bootstrapStatus,
  bootstrapValid,
  processTree,
  apiClosed,
  viteClosed,
  stdoutBytes: Buffer.byteLength(stdout),
  stdoutSha256: digest(stdout),
  stderrBytes: Buffer.byteLength(stderr),
  stderrSha256: digest(stderr),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.apiBeforeVite && result.bootstrapValid && result.apiClosed && result.viteClosed ? 0 : 1;
