import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceRoot = resolve(packageRoot, "scripts/w5-e-validation/evidence/d2-r2");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const forbidden = [
  { id: "hidden-tests", pattern: /hiddenTests?|answerKey/giu },
  { id: "reference-solution", pattern: /referenceSolution|reference-solutions/giu },
  { id: "rubric", pattern: /rubricRef|rubrics\//giu },
  { id: "credential", pattern: /(?:sk|rk)-[A-Za-z0-9_-]{20,}|apiKey|systemPrompt/gu },
  { id: "private-data", pattern: /privateCsv|private raw submission|learnerSubmission/giu },
  { id: "host-path", pattern: /[A-Z]:(?:[\\/])+(?:Users|home|\.A_C_code)|\/home\//giu },
];

async function bytes(path) { return readFile(resolve(packageRoot, path)); }
async function json(path) { return JSON.parse(await readFile(resolve(packageRoot, path), "utf8")); }
function findings(value) {
  const text = value.toString("utf8");
  return forbidden.flatMap(({ id, pattern }) => [...text.matchAll(pattern)].map((match) => ({ id, match: match[0] })));
}

const runtimePath = "scripts/w5-e-validation/d2-runtime-test-results.json";
const browserPath = "scripts/w5-e-validation/d2-browser-capture.json";
let runtime;
let browser;
try { runtime = await json(runtimePath); } catch { runtime = undefined; }
try { browser = await json(browserPath); } catch { browser = undefined; }

function runtimeAssertion(id, fullName, input) {
  const assertion = runtime?.assertions?.find((item) => item.fullName === fullName);
  const status = runtime?.status === "PASS" && runtime?.exitCode === 0 && assertion?.status === "passed" ? "PASS" : "NOT_RUN";
  return {
    id,
    status,
    command: runtime?.command ?? "NOT_RUN",
    startedAtUtc: runtime?.startedAtUtc ?? "NOT_RUN",
    endedAtUtc: runtime?.endedAtUtc ?? "NOT_RUN",
    exitCode: runtime?.exitCode ?? "NOT_RUN",
    input,
    evidence: status === "PASS" ? { path: runtimePath, sha256: undefined, assertion: fullName } : "NOT_RUN",
  };
}

const runtimeHash = runtime === undefined ? undefined : sha256(await bytes(runtimePath));
const browserHash = browser === undefined ? undefined : sha256(await bytes(browserPath));
const assertions = [
  runtimeAssertion("preview-does-not-call-submit", "W5 D2 E runtime evidence preview success calls only draft and run and never uploads the preview result", "ActivityPage preview success with mocked Bootstrap/draft/run and instrumented fetch"),
  runtimeAssertion("preview-result-not-uploaded", "W5 D2 E runtime evidence preview success calls only draft and run and never uploads the preview result", "Captured request paths and bodies for successful preview"),
  runtimeAssertion("preview-output-not-persisted", "W5 D2 E runtime evidence preview output is displayed but never persisted in sessionStorage", "Rendered preview result and enumerated sessionStorage record fields"),
  runtimeAssertion("formal-submit-enabled-when-preview-unavailable", "W5 D2 E runtime evidence preview unavailable does not call submit and leaves formal submission enabled", "ActivityPage PREVIEW_UNAVAILABLE state and formal submit button"),
  {
    id: "worker-has-no-network-requests",
    status: browser?.status === "PASS" && browser?.exitCode === 0 && browser?.workerNetworkProbe?.assertions?.onlySameOriginModuleLoading === true ? "PASS" : "NOT_RUN",
    command: browser?.command ?? "NOT_RUN",
    startedAtUtc: browser?.startedAtUtc ?? "NOT_RUN",
    endedAtUtc: browser?.endedAtUtc ?? "NOT_RUN",
    exitCode: browser?.exitCode ?? "NOT_RUN",
    input: browser?.workerNetworkProbe?.input ?? "NOT_RUN",
    page: browser?.workerNetworkProbe?.page ?? "NOT_RUN",
    evidence: browserHash === undefined ? "NOT_RUN" : { path: browserPath, sha256: browserHash, networkRequests: browser.workerNetworkProbe?.requests ?? [] },
  },
];
for (const item of assertions) {
  if (item.evidence !== "NOT_RUN" && item.evidence.sha256 === undefined) item.evidence.sha256 = runtimeHash;
}

const surfacePaths = [
  { id: "production-bundle", paths: (await readdir(resolve(packageRoot, "dist-web/assets"))).map((name) => `dist-web/assets/${name}`) },
  { id: "worker-source-and-message-boundary", paths: ["src/web/preview/browser-code-runner.ts", "src/web/preview/create-browser-code-runner.ts", "src/web/preview/pyodide-preview.worker.ts"] },
  { id: "session-storage-schema", paths: ["src/web/state/activity-draft-storage.ts"] },
  { id: "public-bundle-fixture", paths: ["tests/web/fixtures/w4-api.ts"] },
  { id: "dom-projections", paths: browser?.captures?.map((item) => item.projectionFile) ?? [] },
  { id: "runtime-evidence-record", paths: [runtimePath] },
  { id: "validation-command-record", paths: ["scripts/w5-e-validation/d2-command-results.json"] },
];
const scans = [];
for (const surface of surfacePaths) {
  const entries = [];
  for (const path of surface.paths) {
    const value = await bytes(path);
    entries.push({ path, bytes: value.byteLength, sha256: sha256(value), findings: findings(value) });
  }
  scans.push({ surface: surface.id, entries, status: entries.length > 0 && entries.every((entry) => entry.findings.length === 0) ? "PASS" : "NOT_RUN" });
}
const security = {
  schemaVersion: 2,
  candidate: "W5-D2-E-R2",
  generatedAtUtc: new Date().toISOString(),
  runtimeAssertions: assertions,
  scans,
  status: assertions.every((item) => item.status === "PASS") && scans.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
};
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d2-security-scan.json"), `${JSON.stringify(security, null, 2)}\n`, "utf8");

const screenshots = [];
for (const capture of browser?.captures ?? []) {
  const png = await bytes(capture.pngFile);
  const projection = await json(capture.projectionFile);
  screenshots.push({
    id: capture.id,
    url: capture.url,
    viewport: capture.viewport,
    waitCondition: capture.waitCondition,
    capturedAtUtc: projection.capturedAtUtc,
    command: browser.command,
    commandExitCode: browser.exitCode,
    png: { path: capture.pngFile, bytes: (await stat(resolve(packageRoot, capture.pngFile))).size, sha256: sha256(png) },
    projection: { path: capture.projectionFile, sha256: sha256(await bytes(capture.projectionFile)), value: projection.projection },
    assertions: capture.assertions,
    status: Object.values(capture.assertions).every(Boolean) ? "PASS" : "FAIL",
  });
}
const screenshotIndex = {
  schemaVersion: 2,
  candidate: "W5-D2-E-R2",
  captureRecord: browserHash === undefined ? "NOT_RUN" : { path: browserPath, sha256: browserHash },
  browser: browser?.environment?.browser ?? "NOT_RUN",
  ports: browser?.environment === undefined ? "NOT_RUN" : { api: browser.environment.apiPort, vite: browser.environment.vitePort, cdp: browser.environment.debugPort },
  screenshots,
  status: browser?.status === "PASS" && screenshots.length === 4 && screenshots.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
};
await writeFile(resolve(packageRoot, "scripts/w5-e-validation/d2-screenshot-index.json"), `${JSON.stringify(screenshotIndex, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ security: security.status, screenshots: screenshotIndex.status, screenshotCount: screenshots.length }, null, 2)}\n`);
process.exitCode = security.status === "PASS" && screenshotIndex.status === "PASS" ? 0 : 1;
