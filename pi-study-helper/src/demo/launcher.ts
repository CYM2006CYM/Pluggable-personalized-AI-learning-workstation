import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDemoRuntime } from "./composition-root.js";
import { startHttpServer } from "./http-server.js";
import { resolveDemoModelMode } from "./runtime-mode.js";
import { W4_D_LIVE_PROMPT_VERSION } from "../graphs/w4-d-graph-factory.js";

const modelMode = resolveDemoModelMode(process.argv, process.env);
const live = modelMode === "live_model";
const DEFAULT_API_PORT = 4310;
const API_PORT_SEARCH_LIMIT = 10;
const WEB_PORT = 5173;

function parsePort(raw: string | undefined, fallback: number): number {
  const port = Number(raw ?? String(fallback));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PI_STUDY_API_PORT must be a valid TCP port.");
  }
  return port;
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolveAvailability) => {
    const probe = createNetServer();
    let settled = false;
    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      resolveAvailability(available);
    };
    probe.unref();
    probe.once("error", () => finish(false));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      probe.close(() => finish(true));
    });
  });
}

async function selectApiPort(): Promise<number> {
  if (process.env.PI_STUDY_API_PORT !== undefined) {
    return parsePort(process.env.PI_STUDY_API_PORT, DEFAULT_API_PORT);
  }
  for (let offset = 0; offset < API_PORT_SEARCH_LIMIT; offset += 1) {
    const candidate = DEFAULT_API_PORT + offset;
    if (await canListen(candidate)) return candidate;
  }
  throw new Error("No available local API port was found.");
}

interface DataRootSelection {
  dataRoot: string;
  sealId: string;
}

async function selectDataRoot(packageRoot: string): Promise<DataRootSelection> {
  const configured = process.env.PI_STUDY_DATA?.trim();
  if (configured) return { dataRoot: resolve(configured), sealId: "configured" };

  const sealPath = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft/quality/revision-seal.json");
  const seal = JSON.parse(await readFile(sealPath, "utf8")) as { assetTreeSha256?: unknown };
  if (typeof seal.assetTreeSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(seal.assetTreeSha256)) {
    throw new Error("Revision 3 seal is invalid.");
  }
  const sealId = seal.assetTreeSha256.slice(0, 12);
  return { dataRoot: resolve(packageRoot, `.demo-data-${sealId}`), sealId };
}

function startupFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("different seal") || message.includes("Invalid canonical Profile")) return "profile_data_incompatible";
  if (message.includes("EADDRINUSE")) return "local_port_in_use";
  if (message.includes("No available local API port")) return "no_available_api_port";
  if (message.includes("PI_STUDY_API_PORT")) return "invalid_api_port";
  if (message.includes("OPENAI_")) return "invalid_live_model_config";
  return "initialization_failed";
}

function reportStartupFailure(stage: "api" | "supervisor" | "web", error: unknown): void {
  const code = startupFailureCode(error);
  const hints: Record<string, string> = {
    profile_data_incompatible: "当前运行数据属于旧资料版本。请取消 PI_STUDY_DATA，或将它指向一个新的空目录；旧数据不会被删除。",
    local_port_in_use: "指定的本地端口已被其他程序占用。请取消 PI_STUDY_API_PORT，让启动器自动选择端口。",
    no_available_api_port: "本地 4310 至 4319 端口均被占用，请关闭占用程序或显式设置 PI_STUDY_API_PORT。",
    invalid_api_port: "PI_STUDY_API_PORT 必须是 1 至 65535 之间的整数。",
    invalid_live_model_config: "OPENAI_MODEL、OPENAI_BASE_URL、OPENAI_API_KEY 必须同时正确配置。",
    initialization_failed: "服务初始化失败。请检查资料文件、运行环境和终端中更早的错误信息。",
  };
  process.stderr.write(`PI_STUDY_STARTUP_FAILED stage=${stage} code=${code}\n${hints[code]}\n`);
}

function frontendEnvironment(apiPort: number): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, PI_STUDY_API_PORT: String(apiPort) };
  delete environment.OPENAI_MODEL;
  delete environment.OPENAI_BASE_URL;
  delete environment.OPENAI_API_KEY;
  delete environment.PI_STUDY_DATA;
  return environment;
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
  const { dataRoot } = await selectDataRoot(packageRoot);
  const fixturesRoot = resolve(packageRoot, "fixtures/profiles");
  const apiPort = parsePort(process.env.PI_STUDY_API_PORT, DEFAULT_API_PORT);
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
  catch (error) { reportStartupFailure("api", error); await handle.close(); process.exitCode = 1; }
}

async function runSupervisor(): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const apiPort = await selectApiPort();
  const { dataRoot, sealId } = await selectDataRoot(packageRoot);
  const childEnvironment = { ...process.env, PI_DEMO_LIVE: live ? "1" : "0", PI_STUDY_API_PORT: String(apiPort), PI_STUDY_DATA: dataRoot };
  const api = spawn(process.execPath, [script, "--api", ...(live ? ["--live"] : [])], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: childEnvironment });
  api.stderr?.pipe(process.stderr);
  const apiExit = childExit(api);
  const readySignal = new Promise<void>((resolveReady, rejectReady) => {
    api.stdout?.on("data", (chunk: Buffer) => { if (chunk.toString("utf8").includes("API_READY")) resolveReady(); });
    api.once("error", rejectReady);
  });
  const ready = Promise.race([
    readySignal,
    apiExit.then((code) => { throw new Error(`api exited ${code}`); }),
  ]);
  const terminate = (child: ReturnType<typeof spawn>): void => { if (!child.killed) child.kill(); };
  try {
    await ready;
    process.stdout.write(`PI_STUDY_READY mode=${modelMode} promptVersion=${live ? W4_D_LIVE_PROMPT_VERSION : "w4-d2-v1"} apiPort=${apiPort} dataSeal=${sealId} url=http://127.0.0.1:${WEB_PORT}/\n`);
    const vite = spawn(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: frontendEnvironment(apiPort) });
    vite.stdout?.pipe(process.stdout);
    vite.stderr?.pipe(process.stderr);
    const viteExit = childExit(vite);
    const result = await new Promise<{ code: number; component: "api" | "web" | "signal" }>((resolveExit) => {
      let done = false;
      const finish = (component: "api" | "web" | "signal", code: number) => { if (done) return; done = true; terminate(api); terminate(vite); resolveExit({ code, component }); };
      void apiExit.then((code) => finish("api", code));
      void viteExit.then((code) => finish("web", code));
      process.once("SIGINT", () => finish("signal", 0));
      process.once("SIGTERM", () => finish("signal", 0));
    });
    if (result.code !== 0) reportStartupFailure(result.component === "web" ? "web" : "api", new Error(`${result.component} exited ${result.code}`));
    process.exitCode = result.code;
  } catch (error) { terminate(api); reportStartupFailure("supervisor", error); process.exitCode = 1; }
}

const task = process.argv.includes("--api") ? runApi() : runSupervisor();
void task.catch((error: unknown) => {
  reportStartupFailure(process.argv.includes("--api") ? "api" : "supervisor", error);
  process.exitCode = 1;
});
