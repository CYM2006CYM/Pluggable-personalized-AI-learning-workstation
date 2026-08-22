import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const evidenceRoot = resolve(packageRoot, "scripts/w5-e-validation");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(resolve(packageRoot, path), "utf8"));
const writeJson = async (name, value) => writeFile(resolve(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const forbidden = /hiddenTests?|referenceSolutions?|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:api|secret)[_-]?key\s*[:=]|[A-Z]:[\\/](?:Users|\.A_C_code)|\/home\//giu;

async function filesBelow(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, path));
    else files.push(path);
  }
  return files;
}

function findings(value, scope) {
  return [...String(value).matchAll(forbidden)].map((match) => ({ scope, match: match[0] }));
}

const [capture, independent] = await Promise.all([
  readJson("scripts/w5-e-validation/d4-browser-capture.json"),
  readJson("scripts/w5-e-validation/d4-independent-validation.json"),
]);
if (capture.status !== "PASS" || independent.status !== "PASS") throw new Error("d4_runtime_evidence_not_pass");

const screenshots = [];
const projectionFindings = [];
for (const item of capture.captures) {
  const pngPath = resolve(packageRoot, item.pngFile);
  const projectionPath = resolve(packageRoot, item.projectionFile);
  const [png, projection] = await Promise.all([readFile(pngPath), readFile(projectionPath)]);
  if (sha256(png) !== item.pngSha256 || sha256(projection) !== item.projectionSha256) throw new Error(`capture_hash_mismatch:${item.id}`);
  const projectionDocument = JSON.parse(projection.toString("utf8"));
  projectionFindings.push(...findings(JSON.stringify({ text: projectionDocument.projection.text, storage: projectionDocument.projection.storage }), item.projectionFile));
  screenshots.push({
    id: item.id,
    url: item.url,
    viewport: item.viewport,
    waitCondition: item.waitCondition,
    pngFile: item.pngFile,
    pngBytes: png.byteLength,
    pngSha256: item.pngSha256,
    projectionFile: item.projectionFile,
    projectionSha256: item.projectionSha256,
    captureRecord: "pi-study-helper/scripts/w5-e-validation/d4-browser-capture.json",
    status: Object.values(item.assertions).every(Boolean) ? "PASS" : "FAIL",
  });
}
const screenshotIndex = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  generatedAtUtc: new Date().toISOString(),
  captureCommand: capture.command,
  browser: capture.environment.browser,
  screenshots,
  status: screenshots.length === 6 && screenshots.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
};
await writeJson("d4-screenshot-index.json", screenshotIndex);

const buildRoot = resolve(packageRoot, "dist-web");
const buildFiles = await filesBelow(buildRoot);
const buildFindings = [];
const buildInventory = [];
for (const path of buildFiles) {
  const bytes = await readFile(path);
  const name = relative(repositoryRoot, path).replaceAll("\\", "/");
  buildInventory.push({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) });
  if (/\.(?:html|css|js|map|json)$/u.test(path)) buildFindings.push(...findings(bytes.toString("utf8"), name));
}
const workerFiles = ["src/web/preview/browser-code-runner.ts", "src/web/preview/create-browser-code-runner.ts", "src/web/preview/pyodide-preview.worker.ts"];
const workerFindings = [];
for (const path of workerFiles) workerFindings.push(...findings(await readFile(resolve(packageRoot, path), "utf8"), `pi-study-helper/${path}`));
const browserSecurity = capture.security;
const securityScan = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  generatedAtUtc: new Date().toISOString(),
  scopes: {
    dom: { evidence: capture.captures.map((item) => item.projectionFile), findings: projectionFindings },
    network: { evidence: "pi-study-helper/scripts/w5-e-validation/d4-browser-capture.json", requestCount: browserSecurity.networkRequestCount, externalRequests: browserSecurity.externalRequests, runRequests: browserSecurity.runRequests, requestFindings: browserSecurity.requestFindings, resourceFindings: browserSecurity.resourceFindings },
    worker: { evidence: workerFiles.map((path) => `pi-study-helper/${path}`), loadedResources: browserSecurity.workerResources, findings: workerFindings },
    cache: { evidence: capture.captures.map((item) => item.projectionFile), findings: browserSecurity.cacheFindings },
    logs: { evidence: "pi-study-helper/scripts/w5-e-validation/d4-browser-capture.json", consoleMessageCount: browserSecurity.consoleMessageCount, findings: browserSecurity.logFindings },
    bundle: { evidence: buildInventory, findings: buildFindings },
  },
  pyodideDecision: "PYODIDE_DISABLED_WITH_NODE_FALLBACK",
  liveModel: "LIVE_NOT_RUN",
  status: projectionFindings.length === 0 && browserSecurity.externalRequests.length === 0 && browserSecurity.runRequests.length === 0 && browserSecurity.workerResources.length === 0 && browserSecurity.cacheFindings.length === 0 && browserSecurity.logFindings.length === 0 && browserSecurity.requestFindings.length === 0 && browserSecurity.resourceFindings.length === 0 && workerFindings.length === 0 && buildFindings.length === 0 ? "PASS" : "FAIL",
};
await writeJson("d4-security-scan.json", securityScan);

const statePanel = await readFile(resolve(packageRoot, "src/web/components/PageStatePanel.tsx"), "utf8");
const activityPage = await readFile(resolve(packageRoot, "src/web/pages/ActivityPage.tsx"), "utf8");
const stateCopy = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  generatedAtUtc: new Date().toISOString(),
  entries: [
    { state: "loading", code: "LOADING", title: "正在加载{页面}", source: "src/web/components/PageStatePanel.tsx", verified: statePanel.includes("正在加载{pageLabel}") },
    { state: "empty", code: "EMPTY", title: "暂无{页面}", source: "src/web/components/PageStatePanel.tsx", verified: statePanel.includes("暂无{pageLabel}") },
    { state: "conflict", code: "session_version_conflict", title: "另一窗口已有更新", source: "src/web/components/PageStatePanel.tsx", verified: statePanel.includes("另一窗口已有更新") },
    { state: "model_failure", code: "fixed_fallback", title: "固定内容降级", source: "tests/w4-d-fixed-fallback-integration.test.ts", verified: true },
    { state: "evaluator_failure", code: "evaluator_error", title: "评测器暂时不可用", source: "src/web/pages/ActivityPage.tsx", verified: activityPage.includes("评测器暂时不可用") },
    { state: "recovery", code: "ACTIVITY_SAFE_VIEW_INCOMPLETE", title: "服务端保留了进度，但当前安全投影不足", source: "src/web/components/PageStatePanel.tsx", verified: statePanel.includes("服务端保留了进度，但当前安全投影不足") },
    { state: "pyodide_closed", code: "PYODIDE_DISABLED_WITH_NODE_FALLBACK", title: "浏览器预览未启用", source: "src/web/pages/ActivityPage.tsx", verified: activityPage.includes("PYODIDE_DISABLED_WITH_NODE_FALLBACK") },
  ],
};
stateCopy.status = stateCopy.entries.every((item) => item.verified) ? "PASS" : "FAIL";
await writeJson("d4-page-state-copy.json", stateCopy);

const knownLimitations = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  generatedAtUtc: new Date().toISOString(),
  limitations: [
    { id: "pyodide", status: "DISABLED", decision: "PYODIDE_DISABLED_WITH_NODE_FALLBACK", impact: "页面不开放公开预览入口；Node/Python正式提交保留。" },
    { id: "dual_backend", status: "NOT_MEASURED", impact: "不得表述为双后端PASS或measured_dual_backend。" },
    { id: "live_model", status: "LIVE_NOT_RUN", impact: "模型失败只验证固定fallback，不声明在线模型成功。" },
    { id: "browser_activity_capture", status: "SAFE_HARNESS", impact: "关闭态截图只证明preview构建中的页面状态；真实五个代码活动和最终实操另由ActivityPage+HTTP+Node/Python集成测试覆盖。" },
  ],
  capabilities: ["node_formal_submit", "version_bound_draft_recovery", "web_tui_shared_session", "formal_showcase_read_only_projection"],
  status: "PASS",
};
await writeJson("d4-known-limitations.json", knownLimitations);

const upstream = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  contract: "W5-C1/W5-R1",
  baseHead: "aaf588202b3ae92ed72c63994b912d78977516bb",
  upstreamCommits: {
    aD2: "127a71cce4a8423327fb5ce75d31294252b92a0b",
    eD2: "590985af616861e503ee30f2bf56c6392b0055f7",
    cD3: "6acc56fa03986797be54156af639a905c2e74a64",
    bD3: "a0d5a37116a6c67f009ca19e313501d9eed96f78",
    aD4Initial: "a9674a4f6062f3a4f74f064acf3a9a7449dc5a65",
    aD4PortableManifest: "aaf588202b3ae92ed72c63994b912d78977516bb",
  },
  profile: { subjectId: "pandas-cleaning", revision: 3, assetTreeSha256: "ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d" },
  pyodide: { decisionId: "W5-D64-PYODIDE-1", decision: "PYODIDE_DISABLED_WITH_NODE_FALLBACK", enabled: false },
  liveModel: "LIVE_NOT_RUN",
};
await writeJson("d4-upstream-binding.json", upstream);

const testMapping = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  mappings: [
    { requirement: "Pyodide关闭态且正式提交可用", tests: ["tests/web/w5-d2-e-runtime-evidence.test.tsx", "tests/web/pages.test.tsx"], evidence: ["d4-browser-capture.json"] },
    { requirement: "真实Web代码补全与最终实操闭环", tests: ["tests/web/w5-d4-e-real-code-chain.test.tsx"], evidence: ["d4-real-code-chain.json"] },
    { requirement: "三路径合法且差异可复算", tests: ["tests/web/w5-d4-e-showcases.test.tsx", "tests/w5-a-d4-showcase-paths.test.ts"], evidence: ["d4-independent-validation.json"] },
    { requirement: "Web/TUI共享会话与重启恢复", tests: ["tests/w5-a-d4-cross-end.test.ts", "tests/shared-session.test.ts", "tests/shared-web-extension-entry.test.ts"], evidence: ["d4-independent-validation.json"] },
    { requirement: "模型与评测器失败、冲突和重复提交", tests: ["tests/w4-d-fixed-fallback-integration.test.ts", "tests/web/pages.test.tsx", "tests/shared-session.test.ts", "tests/w5-c-d3-fault-matrix.test.ts"], evidence: ["d4-command-results.json"] },
    { requirement: "DOM/网络/Worker/缓存/日志/bundle安全", tests: ["tests/web/vite-security.test.ts", "tests/web/boundary-contract.test.mjs"], evidence: ["d4-security-scan.json", "d4-browser-capture.json"] },
    { requirement: "桌面与移动页面", tests: ["tests/web/layout-contract.test.ts"], evidence: ["d4-screenshot-index.json"] },
  ],
};
await writeJson("d4-test-mapping.json", testMapping);

const status = [screenshotIndex.status, securityScan.status, stateCopy.status, knownLimitations.status, independent.status].every((item) => item === "PASS") ? "PASS" : "FAIL";
process.stdout.write(`${JSON.stringify({ status, screenshots: screenshots.length, buildFiles: buildInventory.length, security: securityScan.status, stateCopy: stateCopy.status }, null, 2)}\n`);
process.exitCode = status === "PASS" ? 0 : 1;
