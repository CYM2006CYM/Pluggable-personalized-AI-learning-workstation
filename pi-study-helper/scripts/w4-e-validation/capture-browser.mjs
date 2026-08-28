import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [edgePath, url, outputPath, widthText = "1440", heightText = "1000", portText = "9223"] = process.argv.slice(2);
if (!edgePath || !url || !outputPath) throw new Error("Usage: node capture-browser.mjs <edge> <url> <output.png> [width] [height] [debugPort]");
const width = Number(widthText);
const height = Number(heightText);
const debugPort = Number(portText);
const profileRoot = resolve(`${outputPath}.profile`);

const browser = spawn(edgePath, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileRoot}`, "about:blank",
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });

let browserStderr = "";
browser.stderr.on("data", (chunk) => { browserStderr += String(chunk); });

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

async function target() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      const page = targets.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Edge has not opened the debugging endpoint yet.
    }
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
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
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

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url });

  let projection;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const evaluation = await send("Runtime.evaluate", {
      expression: "JSON.stringify({readyState:document.readyState,rootChildren:document.querySelector('#root')?.childElementCount??0,text:document.body.innerText.slice(0,500),scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})",
      returnByValue: true,
    });
    projection = JSON.parse(evaluation.result.value);
    if (projection.readyState === "complete" && projection.rootChildren > 0) break;
    await pause(100);
  }
  if (projection?.rootChildren === 0) throw new Error(`browser_root_blank:${JSON.stringify(projection)}`);
  await pause(500);
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  process.stdout.write(`${JSON.stringify({ url, outputPath, width, height, projection }, null, 2)}\n`);
  await send("Browser.close");
} finally {
  socket.close();
  if (!browser.killed) browser.kill();
  if (browserStderr.includes("DevTools listening")) process.stderr.write("Edge CDP session initialized.\n");
}
