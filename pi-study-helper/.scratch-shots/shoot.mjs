/*
 * 截图工具：先导航到页面，执行一段 JS，再截图。
 *
 * 为什么需要它：`msedge --screenshot` 只能拍首屏，点不了按钮。
 * 侧栏折叠、浮层展开、标签切换这类"交互后状态"必须先在页面里
 * 跑一段脚本才能拍到。
 *
 * 用 Node 自带的 WebSocket 直接连 Edge 的调试端口，不装 Playwright。
 *
 * 用法：
 *   node tools/shoot-with-action.mjs <url> <out.png> [动作JS文件] [窗口宽高]
 *   node tools/shoot-with-action.mjs http://127.0.0.1:5173/path/xxx out.png action.js 1440,900
 *
 * 动作文件里直接写页面上下文的 JS，例如：
 *   document.querySelector(".sidebar-toggle").click();
 */
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const PROFILE = "C:/Users/25173/AppData/Local/Temp/edge-cdp";

const [url, out, actionFile, size] = process.argv.slice(2);
if (url === undefined || out === undefined) {
  console.error("用法: node shoot-with-action.mjs <url> <out.png> [动作JS文件] [宽,高]");
  process.exit(1);
}
const [width, height] = (size ?? "1440,900").split(",").map((n) => Number(n.trim()));
const action = actionFile !== undefined && existsSync(actionFile)
  ? readFileSync(actionFile, "utf8")
  : "";

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  `--window-size=${width},${height}`,
  url,
], { stdio: "ignore" });

async function listTargets() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page !== undefined) return page;
    } catch {
      // 浏览器还没起来，继续等
    }
    await delay(500);
  }
  throw new Error("等不到 Edge 的调试端口");
}

const target = await listTargets();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error !== undefined) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

function send(method, params = {}) {
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url });
  await delay(6000); // 等 React 挂载 + 接口回来

  if (action !== "") {
    // 动作脚本的返回值会打印出来，方便用断言式动作自证（例如回读侧栏宽度）。
    const result = await send("Runtime.evaluate", {
      expression: action,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result?.exceptionDetails === undefined && result?.result?.value !== undefined) {
      console.log(`  动作返回：${JSON.stringify(result.result.value)}`);
    }
    if (result?.result?.value?.hover !== undefined) {
      // 动作脚本返回 { hover: {x, y} } 时，派发一次真实鼠标移动。
      // headless 里 CSS :hover 不会自己触发；这条路径尚未验证，别依赖它。
      const { x, y } = result.result.value.hover;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
    }
    await delay(1200); // 等过渡动画走完
  }

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`${out} (${width}x${height})`);
} finally {
  ws.close();
  edge.kill();
}
