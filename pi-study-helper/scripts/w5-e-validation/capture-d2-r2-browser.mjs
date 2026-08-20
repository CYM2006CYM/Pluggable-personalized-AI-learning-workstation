import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import react from "@vitejs/plugin-react";
import { createServer as createViteServer } from "vite";
import { createDemoRuntime } from "../../.demo-build/demo/composition-root.js";
import { startHttpServer } from "../../.demo-build/demo/http-server.js";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const webRoot = resolve(packageRoot, "src/web");
const contractsRoot = resolve(packageRoot, "src/contracts");
const evidenceRoot = resolve(packageRoot, "scripts/w5-e-validation/evidence/d2-r2");
const resultPath = resolve(packageRoot, "scripts/w5-e-validation/d2-browser-capture.json");
const apiPort = 4311;
const vitePort = 5174;
const debugPort = 9233;
const command = "node scripts/w5-e-validation/capture-d2-r2-browser.mjs";
const startedAtUtc = new Date().toISOString();
const runId = `w5-d2-e-r2-${startedAtUtc.replace(/[^0-9]/gu, "")}`;
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d2-r2-browser-"));
const dataRoot = resolve(temporaryRoot, "data");
const browserProfile = resolve(temporaryRoot, "edge-profile");
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function portAvailable(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(true));
  });
}

for (const port of [apiPort, vitePort, debugPort]) {
  if (!await portAvailable(port)) throw new Error(`required_port_in_use:${port}`);
}
await mkdir(evidenceRoot, { recursive: true });

const fixturesRoot = resolve(packageRoot, "fixtures/profiles");
const runtime = createDemoRuntime({ dataRoot, fixturesRoot, pythonExecutable: process.env.PI_PYTHON_EXECUTABLE });
const api = startHttpServer(runtime, apiPort);
await api.ready;
const vite = await createViteServer({
  root: webRoot,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: true,
    proxy: {
      "^/api/(?:bootstrap(?:\\?|$)|sessions(?:/|$)|activities(?:/|$))": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
    fs: {
      strict: true,
      allow: [webRoot, contractsRoot, packageRoot],
      deny: ["**/mocks/**", "**/fixtures/profiles/**", "**/fixtures/model-*/**", "**/private/**", "**/rubrics/**", "**/reference-solutions/**", "**/hidden/**"],
    },
  },
});
await vite.listen();

const browser = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--disable-extensions",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${browserProfile}`,
  "about:blank",
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

async function target() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      const page = targets.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* Edge is starting. */ }
    await pause(100);
  }
  throw new Error("edge_debug_target_timeout");
}

const page = await target();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});
let sequence = 0;
const pending = new Map();
let collectNetwork = false;
const networkRequests = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Network.requestWillBeSent" && collectNetwork) {
    networkRequests.push({ url: message.params.request.url, type: message.params.type, method: message.params.request.method });
  }
  if (message.id === undefined) return;
  const operation = pending.get(message.id);
  if (operation === undefined) return;
  pending.delete(message.id);
  if (message.error === undefined) operation.resolve(message.result);
  else operation.reject(new Error(message.error.message));
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "browser_evaluation_failed");
  return result.result?.value;
}

async function waitFor(condition, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${condition})`)) return;
    await pause(100);
  }
  throw new Error(`browser_wait_timeout:${label}`);
}

async function capture({ id, url, width, height, waitCondition }) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url });
  await waitFor(waitCondition, id);
  const projection = await evaluate(`(() => ({
    url: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 2000),
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    landmarks: { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length },
    controlsWithoutName: [...document.querySelectorAll('button,input,select,textarea,a[href]')].filter((node) => !(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent?.trim() || node.getAttribute('name'))).length,
  }))()`);
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const png = Buffer.from(screenshot.data, "base64");
  const pngRelative = `scripts/w5-e-validation/evidence/d2-r2/${id}.png`;
  const projectionRelative = `scripts/w5-e-validation/evidence/d2-r2/${id}.projection.json`;
  await writeFile(resolve(packageRoot, pngRelative), png);
  const projectionDocument = { runId, id, url, viewport: { width, height }, waitCondition, capturedAtUtc: new Date().toISOString(), projection };
  await writeFile(resolve(packageRoot, projectionRelative), `${JSON.stringify(projectionDocument, null, 2)}\n`, "utf8");
  return {
    id,
    url,
    viewport: { width, height },
    waitCondition,
    projectionFile: projectionRelative,
    projectionSha256: sha256(await readFile(resolve(packageRoot, projectionRelative))),
    pngFile: pngRelative,
    pngBytes: png.byteLength,
    pngSha256: sha256(png),
    assertions: {
      rootNonBlank: projection.rootChildren > 0,
      noHorizontalOverflow: projection.scrollWidth <= projection.clientWidth,
      namedControls: projection.controlsWithoutName === 0,
      waitConditionSatisfied: true,
    },
  };
}

let result;
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  const version = await send("Browser.getVersion");
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  const captures = [];
  captures.push(await capture({ id: "start-desktop", url: `${baseUrl}/`, width: 1440, height: 1000, waitCondition: "document.querySelector('select[aria-label=\"学习资料包\"]') !== null" }));
  captures.push(await capture({ id: "start-mobile", url: `${baseUrl}/`, width: 390, height: 844, waitCondition: "document.querySelector('select[aria-label=\"学习资料包\"]') !== null" }));
  const recoveryUrl = `${baseUrl}/study?sessionId=session-missing&nodeId=node-basic&activityId=act-basic`;
  captures.push(await capture({ id: "study-recovery-desktop", url: recoveryUrl, width: 1440, height: 1000, waitCondition: "document.body.innerText.includes('DEEP_LINK_SESSION_UNAVAILABLE')" }));
  captures.push(await capture({ id: "study-recovery-mobile", url: recoveryUrl, width: 390, height: 844, waitCondition: "document.body.innerText.includes('DEEP_LINK_SESSION_UNAVAILABLE')" }));

  await send("Page.navigate", { url: `${baseUrl}/` });
  await waitFor("document.querySelector('select[aria-label=\"学习资料包\"]') !== null", "worker-probe-page");
  networkRequests.length = 0;
  collectNetwork = true;
  const workerProbe = await evaluate(`(async () => {
    const module = await import('/preview/create-browser-code-runner.ts');
    const bundle = {
      runId: 'r2-worker-probe', sessionId: 'session-probe', activityId: 'activity-probe', profileRevision: 3,
      environmentId: 'pyodide-candidate', starterCodeHash: 'sha256:starter', publicDatasetFiles: [],
      publicTestSources: ['assert True'], expiresAt: '2026-08-20T23:59:59.000Z', bundleHash: 'sha256:bundle'
    };
    try {
      await module.createBrowserCodeRunner().run(bundle, 'print(1)', new AbortController().signal);
      return { outcome: 'UNEXPECTED_SUCCESS' };
    } catch (error) {
      return { outcome: 'REJECTED', code: error?.code, name: error?.name };
    }
  })()`);
  await pause(250);
  collectNetwork = false;
  const normalizedRequests = networkRequests.map((request) => ({ ...request, url: request.url.replace(/\?.*$/u, "") }));
  const externalRequests = normalizedRequests.filter((request) => new URL(request.url).origin !== baseUrl);
  const dataRequests = normalizedRequests.filter((request) => ["Fetch", "XHR", "WebSocket"].includes(request.type));
  const workerNetworkProbe = {
    page: `${baseUrl}/`,
    input: { runId: "r2-worker-probe", activityId: "activity-probe", code: "print(1)" },
    outcome: workerProbe,
    requests: normalizedRequests,
    assertions: {
      previewUnavailable: workerProbe.outcome === "REJECTED" && workerProbe.code === "preview_unavailable",
      externalRequestCount: externalRequests.length,
      dataRequestCount: dataRequests.length,
      onlySameOriginModuleLoading: externalRequests.length === 0 && dataRequests.length === 0,
    },
  };
  const capturePass = captures.every((item) => Object.values(item.assertions).every(Boolean));
  const workerPass = workerNetworkProbe.assertions.previewUnavailable && workerNetworkProbe.assertions.onlySameOriginModuleLoading;
  result = {
    schemaVersion: 1,
    candidate: "W5-D2-E-R2",
    runId,
    command,
    startedAtUtc,
    endedAtUtc: new Date().toISOString(),
    exitCode: capturePass && workerPass ? 0 : 1,
    environment: { browser: version.product, protocolVersion: version.protocolVersion, apiPort, vitePort, debugPort },
    captures,
    workerNetworkProbe,
    status: capturePass && workerPass ? "PASS" : "FAIL",
  };
} catch (error) {
  result = {
    schemaVersion: 1,
    candidate: "W5-D2-E-R2",
    runId,
    command,
    startedAtUtc,
    endedAtUtc: new Date().toISOString(),
    exitCode: 1,
    error: error instanceof Error ? error.message : "browser_capture_failed",
    status: "FAIL",
  };
} finally {
  socket.close();
  if (!browser.killed) browser.kill();
  await Promise.race([
    new Promise((resolveExit) => browser.once("exit", resolveExit)),
    pause(5_000),
  ]);
  await vite.close();
  await api.close();
  const resolvedTemporary = resolve(temporaryRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  if (resolvedTemporary.startsWith(`${resolvedSystemTemp}\\`) || resolvedTemporary.startsWith(`${resolvedSystemTemp}/`)) {
    try {
      await rm(resolvedTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Temporary browser profiles are audit-excluded and OS cleanup is best effort.
    }
  }
}

await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: result.status, runId, captures: result.captures?.length ?? 0, workerNetworkProbe: result.workerNetworkProbe?.assertions ?? null }, null, 2)}\n`);
process.exitCode = result.status === "PASS" ? 0 : 1;
