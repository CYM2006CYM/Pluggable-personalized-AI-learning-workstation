import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDemoRuntime } from "./composition-root.js";
import { startHttpServer } from "./http-server.js";
import { resolveDemoModelMode } from "./runtime-mode.js";
import { W4_D_LIVE_PROMPT_VERSION } from "../graphs/w4-d-graph-factory.js";

const modelMode = resolveDemoModelMode(process.argv, process.env);
const live = modelMode === "live_model";
const apiPort = Number(process.env.PI_STUDY_API_PORT ?? "4310");

if (!Number.isSafeInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
  throw new Error("PI_STUDY_API_PORT must be a valid TCP port.");
}

function childExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolveExit(code);
    };
    child.once("error", () => finish(1));
    child.once("exit", (code) => finish(code ?? 1));
  });
}

async function runApi(): Promise<void> {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const dataRoot = resolve(process.env.PI_STUDY_DATA ?? resolve(packageRoot, ".demo-data"));
  const fixturesRoot = resolve(packageRoot, "fixtures/profiles");
  const liveConfig = live ? {
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
  } : undefined;
  const configuredPython = process.env.PI_PYTHON_EXECUTABLE;
  const runtime = createDemoRuntime({ dataRoot, fixturesRoot, ...(configuredPython === undefined ? {} : { pythonExecutable: resolve(configuredPython) }), liveConfig });
  const handle = startHttpServer(runtime, apiPort);
  process.once("SIGINT", () => { void handle.close().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void handle.close().finally(() => process.exit(0)); });
  try { await handle.ready; process.stdout.write("API_READY\n"); await new Promise<void>(() => undefined); }
  catch { await handle.close(); process.exitCode = 1; }
}

async function runSupervisor(): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  const api = spawn(process.execPath, [script, "--api", ...(live ? ["--live"] : [])], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, PI_DEMO_LIVE: live ? "1" : "0" } });
  const apiExit = childExit(api);
  let apiReady = false;
  const readySignal = new Promise<void>((resolveReady, rejectReady) => {
    api.stdout?.on("data", (chunk: Buffer) => { if (chunk.toString("utf8").includes("API_READY")) { apiReady = true; resolveReady(); } });
    api.once("error", rejectReady);
  });
  const ready = Promise.race([
    readySignal,
    apiExit.then((code) => { throw new Error(`api exited ${code}`); }),
  ]);
  const terminate = (child: ReturnType<typeof spawn>): void => { if (!child.killed) child.kill(); };
  try {
    await ready;
    process.stdout.write(`PI_STUDY_READY mode=${modelMode} promptVersion=${live ? W4_D_LIVE_PROMPT_VERSION : "w4-d2-v1"} apiPort=${apiPort} url=http://127.0.0.1:5173/\n`);
    const vite = spawn(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { shell: false, windowsHide: true, stdio: "ignore", env: { ...process.env } });
    const viteExit = childExit(vite);
    const result = await new Promise<number>((resolveExit) => {
      let done = false;
      const finish = (code: number) => { if (done) return; done = true; terminate(api); terminate(vite); resolveExit(code); };
      void apiExit.then(finish);
      void viteExit.then(finish);
      process.once("SIGINT", () => finish(0));
      process.once("SIGTERM", () => finish(0));
    });
    process.exitCode = result;
  } catch { terminate(api); process.exitCode = 1; }
}

if (process.argv.includes("--api")) void runApi(); else void runSupervisor();
