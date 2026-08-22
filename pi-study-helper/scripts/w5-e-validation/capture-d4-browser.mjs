import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { preview as createVitePreviewServer } from "vite";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const webRoot = resolve(packageRoot, "src/web");
const evidenceRoot = resolve(packageRoot, "scripts/w5-e-validation/evidence/d4");
const resultPath = resolve(packageRoot, "scripts/w5-e-validation/d4-browser-capture.json");
const vitePort = 5175;
const debugPort = 9234;
const command = "node scripts/w5-e-validation/capture-d4-browser.mjs";
const startedAtUtc = new Date().toISOString();
const runId = `w5-d4-e-${startedAtUtc.replace(/[^0-9]/gu, "")}`;
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "w5-e-d4-browser-"));
const browserProfile = resolve(temporaryRoot, "edge-profile");
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
async function portAvailable(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(true));
  });
}

for (const port of [vitePort, debugPort]) {
  if (!await portAvailable(port)) throw new Error(`required_port_in_use:${port}`);
}
await mkdir(evidenceRoot, { recursive: true });

const vite = await createVitePreviewServer({
  configFile: resolve(packageRoot, "vite.config.ts"),
  logLevel: "silent",
  preview: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: true,
  },
});
const closePreview = () => new Promise((resolveClose, rejectClose) => {
  vite.httpServer.close((error) => error === undefined ? resolveClose() : rejectClose(error));
});

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
const networkRequests = [];
const consoleMessages = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Network.requestWillBeSent") networkRequests.push({ url: message.params.request.url, type: message.params.type, method: message.params.request.method });
  if (message.method === "Runtime.consoleAPICalled") consoleMessages.push({ type: message.params.type, values: message.params.args.map((item) => item.value ?? item.description ?? "") });
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

const safeActivity = {
  kind: "code", requestId: "evidence-open", sessionId: "session-e-d4", sessionVersion: 3,
  profileRevision: 3, attemptId: "attempt-e-d4", draftVersion: 1, userText: "print('formal submit')",
  activity: {
    activityId: "act-e-d4", activityVersion: 1, kind: "code_completion", title: "代码补全",
    prompt: "完成代码并提交正式评测。", primaryKnowledgePointId: "pandas.clean.inspect-dataframe",
    supportingKnowledgePointIds: ["pandas.clean.read-csv"], starterCode: "print('formal submit')",
  },
};
const safeSession = {
  sessionId: "session-e-d4", sessionVersion: 3, profileRevision: 3,
  view: { sessionId: "session-e-d4", sessionVersion: 3, profileRevision: 3, subjectId: "pandas-cleaning", mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 400, status: "active", stage: "activity", diagnosticRequired: true, pathVersion: 1 },
  diagnosticDraftVersion: 1,
  diagnosticDraft: { diagnosticDraftVersion: 1, background: { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" }, processedQuestionIds: [] },
  currentAttempt: { kind: "code", activityId: "act-e-d4", attemptId: "attempt-e-d4", status: "draft", draftVersion: 1 },
  activityProgress: [],
  path: { pathId: "path-e-d4", pathVersion: 1, status: "active", nodes: [{ nodeId: "node-inspect", knowledgePointId: "pandas.clean.inspect-dataframe", activityIds: ["act-e-d4"], status: "available", estimatedMinutes: 17, reasonCodes: ["goal_required"], difficulty: "S-U", scaffold: "hint", required: true, positionLocked: false }] },
};
const safeBootstrap = {
  profiles: [{ subjectId: "pandas-cleaning", name: "Pandas Cleaning", revision: 3, modalities: ["text", "code"] }],
  goals: [{ goalId: "goal-clean-orders", title: "完成订单数据清洗" }],
  chapters: [{ chapterId: "chapter-01", title: "数据读取" }],
  diagnostic: { diagnosticId: "diagnostic-pandas-cleaning", diagnosticVersion: 1, estimatedMinutes: 8, questions: [] },
  recoverableSessions: [safeSession.view],
  session: safeSession,
};
const fetchInjection = `(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const bootstrap = ${JSON.stringify(safeBootstrap)};
  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/api/bootstrap?recoverSessionId=session-e-d4')) {
      return Promise.resolve(new Response(JSON.stringify({ data: bootstrap }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return nativeFetch(input, init);
  };
})();`;

async function projection() {
  return evaluate(`(async () => ({
    url: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 5000),
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    pathNodes: document.querySelectorAll('.path-node').length,
    formalSource: document.querySelector('[data-formal-source="w5-a-d4"]') !== null,
    previewControls: [...document.querySelectorAll('button,a[href]')].filter((node) => /预览|公开检查/u.test(node.textContent ?? '')).length,
    formalSubmit: (() => { const node = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('提交正式评测')); return node === undefined ? null : { disabled: node.disabled, text: node.textContent }; })(),
    previewEnabled: document.querySelector('[data-preview-enabled="false"]')?.getAttribute('data-preview-enabled') ?? null,
    controlsWithoutName: [...document.querySelectorAll('button,input,select,textarea,a[href]')].filter((node) => !(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent?.trim() || node.getAttribute('name') || node.labels?.length)).length,
    resources: performance.getEntriesByType('resource').map((item) => item.name),
    storage: {
      local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
      session: Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])),
      caches: await caches.keys(),
      indexedDb: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((item) => item.name) : [],
    },
  }))()`);
}

async function capture({ id, url, width, height, waitCondition, setup }) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url });
  await waitFor(waitCondition, id);
  if (setup !== undefined) {
    await evaluate(setup);
    await waitFor("document.querySelector('[data-page=\"activity\"]') !== null", `${id}-setup`);
  }
  const value = await projection();
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const png = Buffer.from(screenshot.data, "base64");
  const pngRelative = `scripts/w5-e-validation/evidence/d4/${id}.png`;
  const projectionRelative = `scripts/w5-e-validation/evidence/d4/${id}.projection.json`;
  await writeFile(resolve(packageRoot, pngRelative), png);
  const projectionDocument = { runId, id, url: value.url, viewport: { width, height }, waitCondition, capturedAtUtc: new Date().toISOString(), projection: value };
  await writeFile(resolve(packageRoot, projectionRelative), `${JSON.stringify(projectionDocument, null, 2)}\n`, "utf8");
  const isActivity = id.startsWith("activity-");
  const assertions = {
    rootNonBlank: value.rootChildren > 0,
    noHorizontalOverflow: value.scrollWidth <= value.clientWidth,
    namedControls: value.controlsWithoutName === 0,
    expectedPage: isActivity ? value.previewControls === 0 && value.formalSubmit?.disabled === false && value.previewEnabled === "false" : value.formalSource && value.pathNodes === 7,
  };
  return {
    id, url: value.url, viewport: { width, height }, waitCondition,
    projectionFile: projectionRelative,
    projectionSha256: sha256(await readFile(resolve(packageRoot, projectionRelative))),
    pngFile: pngRelative, pngBytes: png.byteLength, pngSha256: sha256(png), assertions,
  };
}

let result;
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: fetchInjection });
  const version = await send("Browser.getVersion");
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  const captures = [];
  const caseIds = ["showcase-high-foundation", "showcase-non-computer-beginner", "showcase-practice-oriented"];
  for (const caseId of caseIds) {
    captures.push(await capture({ id: `showcase-${caseId.replace("showcase-", "")}-desktop`, url: `${baseUrl}/showcases?case=${caseId}`, width: 1440, height: 1000, waitCondition: `document.body.innerText.includes('${caseId}')` }));
  }
  captures.push(await capture({ id: "showcase-practice-mobile", url: `${baseUrl}/showcases?case=showcase-practice-oriented`, width: 390, height: 844, waitCondition: "document.body.innerText.includes('showcase-practice-oriented')" }));
  const activitySetup = `(() => { history.pushState({ usr: { opened: ${JSON.stringify(safeActivity)} }, key: 'e-d4', idx: 1 }, '', '/activity/session-e-d4/act-e-d4'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); return true; })()`;
  captures.push(await capture({ id: "activity-closed-desktop", url: `${baseUrl}/`, width: 1440, height: 1000, waitCondition: "document.querySelector('#root')?.childElementCount > 0", setup: activitySetup }));
  captures.push(await capture({ id: "activity-closed-mobile", url: `${baseUrl}/`, width: 390, height: 844, waitCondition: "document.querySelector('#root')?.childElementCount > 0", setup: activitySetup }));

  const capturedRequests = networkRequests.map((request) => ({ ...request, url: request.url.replace(/\?.*$/u, "") }));
  const externalRequests = capturedRequests.filter((request) => {
    const origin = new URL(request.url).origin;
    return origin !== baseUrl && origin !== `http://127.0.0.1:${debugPort}` && !request.url.startsWith("data:");
  });
  const runRequests = capturedRequests.filter((request) => /\/api\/activities\/[^/]+\/run$/u.test(new URL(request.url).pathname));
  const workerResources = captures.flatMap((item) => item.projectionFile).length === 0 ? [] : capturedRequests.filter((request) => /worker/iu.test(request.url));
  const projectionDocuments = await Promise.all(captures.map(async (item) => JSON.parse(await readFile(resolve(packageRoot, item.projectionFile), "utf8"))));
  const storageValues = projectionDocuments.map((document) => document.projection.storage);
  const sensitivePattern = /hiddenTests|referenceSolution|rubric|BEGIN PRIVATE KEY|api[_-]?key|[A-Z]:[\\/](?:Users|\.A_C_code)/iu;
  const domFindings = [];
  for (const captureItem of captures) {
    const document = JSON.parse(await readFile(resolve(packageRoot, captureItem.projectionFile), "utf8"));
    if (sensitivePattern.test(document.projection.text)) domFindings.push(captureItem.id);
  }
  const cacheFindings = storageValues.filter((value) => sensitivePattern.test(JSON.stringify(value)) || value.caches.length > 0 || value.indexedDb.length > 0);
  const logFindings = consoleMessages.filter((message) => sensitivePattern.test(JSON.stringify(message)));
  const resourceFindings = projectionDocuments.flatMap((document) => document.projection.resources.filter((url) => sensitivePattern.test(url)));
  const requestFindings = capturedRequests.filter((request) => sensitivePattern.test(request.url));
  const capturePass = captures.every((item) => Object.values(item.assertions).every(Boolean));
  const securityPass = externalRequests.length === 0 && runRequests.length === 0 && workerResources.length === 0 && domFindings.length === 0 && cacheFindings.length === 0 && logFindings.length === 0 && resourceFindings.length === 0 && requestFindings.length === 0;
  result = {
    schemaVersion: 1, candidate: "W5-D4-E", runId, command, startedAtUtc, endedAtUtc: new Date().toISOString(),
    exitCode: capturePass && securityPass ? 0 : 1,
    environment: { browser: version.product, protocolVersion: version.protocolVersion, vitePort, debugPort },
    captures,
    security: {
      networkRequestCount: capturedRequests.length, externalRequests, runRequests, workerResources,
      domFindings, cacheFindings, logFindings, resourceFindings, requestFindings, consoleMessageCount: consoleMessages.length,
      assertions: { noExternalRequests: externalRequests.length === 0, noRunRequests: runRequests.length === 0, noWorkerResources: workerResources.length === 0, domSafe: domFindings.length === 0, cacheSafe: cacheFindings.length === 0, logsSafe: logFindings.length === 0, resourceUrlsSafe: resourceFindings.length === 0, requestUrlsSafe: requestFindings.length === 0 },
    },
    status: capturePass && securityPass ? "PASS" : "FAIL",
  };
} catch (error) {
  result = { schemaVersion: 1, candidate: "W5-D4-E", runId, command, startedAtUtc, endedAtUtc: new Date().toISOString(), exitCode: 1, error: error instanceof Error ? error.message : "browser_capture_failed", status: "FAIL" };
} finally {
  socket.close();
  if (!browser.killed) browser.kill();
  await Promise.race([new Promise((resolveExit) => browser.once("exit", resolveExit)), pause(5_000)]);
  await closePreview();
  const resolvedTemporary = resolve(temporaryRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  if (resolvedTemporary.startsWith(`${resolvedSystemTemp}\\`) || resolvedTemporary.startsWith(`${resolvedSystemTemp}/`)) {
    try { await rm(resolvedTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* OS cleanup is best effort. */ }
  }
}

await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: result.status, runId, captures: result.captures?.length ?? 0, security: result.security?.assertions ?? null }, null, 2)}\n`);
process.exitCode = result.status === "PASS" ? 0 : 1;
