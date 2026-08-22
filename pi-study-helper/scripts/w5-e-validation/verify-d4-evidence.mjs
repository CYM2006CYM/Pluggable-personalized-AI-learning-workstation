import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const deliveryRootIndex = process.argv.indexOf("--delivery-root");
const deliveryRoot = deliveryRootIndex === -1
  ? resolve(repositoryRoot, "新版设计文档-重写版/第五周任务/W5-D4-E-2")
  : resolve(process.argv[deliveryRootIndex + 1]);
const zipName = "W5-D4-E-delivery.zip";
const zipPath = resolve(deliveryRoot, zipName);
const sidecarPath = `${zipPath}.sha256`;
const reportPath = resolve(deliveryRoot, "W5-D4-E-交付报告.md");
const outputPath = resolve(deliveryRoot, "W5-D4-E-package-verification.json");
const prePackage = process.argv.includes("--pre-package");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeLf = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?|\n/gu, "\n"), "utf8");
const readJson = async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
const readLines = async (path) => (await readFile(resolve(repositoryRoot, path), "utf8")).split(/\r?\n/u).filter(Boolean);
const hostPathFree = (value) => !/[A-Z]:(?:[\\/])+(?:Users|\.A_C_code)|\/home\//iu.test(String(value));

function statisticsValid(command) {
  if (command.statistics?.applicability === "NOT_APPLICABLE") return command.statistics.testFiles === "NOT_APPLICABLE" && command.statistics.tests === "NOT_APPLICABLE";
  if (command.statistics?.applicability !== "APPLICABLE") return false;
  const groups = [command.statistics.testFiles, command.statistics.tests];
  if (groups.some((group) => group.total !== group.passed + group.failed + group.skipped)) return false;
  const failed = groups.some((group) => group.failed > 0);
  return command.exitCode === 0 ? !failed : failed;
}

function formalScopeValid(paths) {
  const forbidden = /(?:w5-d1-e-|scripts\/w5-e-validation\/d2-|handoff-w5-e-d2|\.png$|node_modules|dist-web|\.demo-build|(?:^|\/)private\/|rubrics|reference-solutions|hidden)/iu;
  const ownerBlockerFiles = new Set(["pi-study-helper/package.json", "pi-study-helper/vite.config.ts", "pi-study-helper/src/demo/launcher.ts"]);
  return paths.length > 0 && paths.every((path) => !forbidden.test(path) && (path.startsWith("pi-study-helper/src/web/") || path.startsWith("pi-study-helper/tests/web/") || path.startsWith("pi-study-helper/scripts/w5-e-validation/") || ownerBlockerFiles.has(path) || path === "新版设计文档-重写版/第五周任务/handoff-w5-e-d4.md"));
}

function archiveSetValid(actual, manifest) {
  const expected = [...manifest.entries.map((item) => item.path), ...(manifest.selfExcluded ?? [])].sort();
  return JSON.stringify([...actual].sort()) === JSON.stringify(expected);
}

function expectedFailure(value, id) {
  if (value) throw new Error(`negative_self_test_did_not_fail:${id}`);
  return { id, status: "PASS" };
}

async function filesBelow(root, directory = root) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) values.push(...await filesBelow(root, path));
    else values.push(relative(root, path).replaceAll("\\", "/"));
  }
  return values;
}

const commands = await readJson("pi-study-helper/scripts/w5-e-validation/d4-command-results.json");
const independent = await readJson("pi-study-helper/scripts/w5-e-validation/d4-independent-validation.json");
const browser = await readJson("pi-study-helper/scripts/w5-e-validation/d4-browser-capture.json");
const security = await readJson("pi-study-helper/scripts/w5-e-validation/d4-security-scan.json");
const screenshots = await readJson("pi-study-helper/scripts/w5-e-validation/d4-screenshot-index.json");
const codeChain = await readJson("pi-study-helper/scripts/w5-e-validation/d4-real-code-chain.json");
const generatedShowcases = await readJson("pi-study-helper/src/web/showcase/formal-showcase-data.json");
const formal = await readLines("pi-study-helper/scripts/w5-e-validation/d4-proposed-files.txt");
const audit = await readLines("pi-study-helper/scripts/w5-e-validation/d4-audit-only-files.txt");
const zipList = await readLines("pi-study-helper/scripts/w5-e-validation/d4-zip-files.txt");
const manifest = await readJson("pi-study-helper/scripts/w5-e-validation/d4-sha256-manifest.json");
const activityPage = await readFile(resolve(packageRoot, "src/web/pages/ActivityPage.tsx"), "utf8");
const showcaseSource = await readFile(resolve(packageRoot, "src/web/showcase/formal-showcase-data.ts"), "utf8");

const manifestHashes = [];
for (const item of manifest.entries) {
  const raw = await readFile(resolve(repositoryRoot, item.path));
  const bytes = item.hashMode === "utf8-lf-v1" ? normalizeLf(raw) : raw;
  manifestHashes.push(item.sha256 === sha256(bytes) && item.byteLength === bytes.byteLength);
}
const formalHostPathFindings = [];
for (const path of formal) {
  const raw = await readFile(resolve(repositoryRoot, path));
  if (!hostPathFree(raw.toString("utf8"))) formalHostPathFindings.push(path);
}
const currentChecks = [
  { id: "command-statistics", status: commands.commands.every(statisticsValid) ? "PASS" : "FAIL" },
  { id: "command-status", status: commands.overallStatus === "PASS" && commands.commands.every((item) => item.status === "PASS") ? "PASS" : "FAIL" },
  { id: "environment", status: commands.environmentPass ? "PASS" : "FAIL" },
  { id: "independent-validation", status: independent.status === "PASS" && independent.pathLegality.rate === "3/3" && independent.pairChecks.every((item) => item.minimumThree && item.exactFormalMatch) ? "PASS" : "FAIL" },
  { id: "closed-state", status: Object.values(independent.closedState).every(Boolean) && !activityPage.includes("运行公开检查") && !activityPage.includes("prepareActivityRun") ? "PASS" : "FAIL" },
  { id: "formal-showcase-source", status: showcaseSource.includes("./formal-showcase-data.json?raw") && generatedShowcases.pathResults?.status === "PASS" && generatedShowcases.differences?.status === "PASS" && !showcaseSource.includes("node-basic-python") ? "PASS" : "FAIL" },
  { id: "real-code-chain", status: codeChain.status === "PASS" && codeChain.codeActivities?.length === 5 && codeChain.codeActivities.every((item) => item.pageSubmit && item.formalVerdict === "pass") && codeChain.finalPractical && codeChain.nextStepCompleted && codeChain.sessionCompleted && codeChain.privateCodeIncluded === false ? "PASS" : "FAIL" },
  { id: "browser", status: browser.status === "PASS" && browser.captures.length === 6 ? "PASS" : "FAIL" },
  { id: "security", status: security.status === "PASS" ? "PASS" : "FAIL" },
  { id: "screenshots", status: screenshots.status === "PASS" && screenshots.screenshots.length === 6 ? "PASS" : "FAIL" },
  { id: "formal-scope", status: formalScopeValid(formal) ? "PASS" : "FAIL" },
  { id: "formal-host-paths", status: formalHostPathFindings.length === 0 ? "PASS" : "FAIL", findings: formalHostPathFindings },
  { id: "audit-scope", status: audit.length === 6 && audit.every((path) => path.endsWith(".png") && path.includes("/evidence/d4/")) ? "PASS" : "FAIL" },
  { id: "manifest-set", status: archiveSetValid(formal, manifest) ? "PASS" : "FAIL" },
  { id: "manifest-hashes", status: manifestHashes.every(Boolean) ? "PASS" : "FAIL" },
  { id: "zip-list", status: zipList.length === formal.length + audit.length + 1 && zipList.includes("ZIP-MANIFEST.json") ? "PASS" : "FAIL" },
];
const negativeSelfTests = [
  expectedFailure(statisticsValid({ exitCode: 0, statistics: { applicability: "MISSING" } }), "missing-test-statistics-fails"),
  expectedFailure(statisticsValid({ exitCode: 0, statistics: { applicability: "APPLICABLE", testFiles: { passed: 0, failed: 1, skipped: 0, total: 1 }, tests: { passed: 0, failed: 1, skipped: 0, total: 1 } } }), "statistics-exit-conflict-fails"),
  expectedFailure(formalScopeValid([...formal, "pi-study-helper/scripts/w5-e-validation/d2-command-results.json"]), "d2-evidence-rejected"),
  expectedFailure(formalScopeValid([...formal, "pi-study-helper/scripts/w5-e-validation/evidence/d4/example.png"]), "png-rejected-from-formal"),
  expectedFailure(archiveSetValid(["a"], { entries: [{ path: "a" }, { path: "extra" }], selfExcluded: [] }), "archive-missing-entry-fails"),
  expectedFailure(archiveSetValid(["a", "extra"], { entries: [{ path: "a" }], selfExcluded: [] }), "archive-extra-entry-fails"),
  expectedFailure(hostPathFree("D:/" + ".A_C_code/work/result.json"), "host-path-fails"),
  expectedFailure(activityPage.includes("运行公开检查") || activityPage.includes("prepareActivityRun"), "preview-entry-fails"),
];

if (!prePackage) {
  const sidecar = (await readFile(sidecarPath, "utf8")).trim();
  const zipBytes = await readFile(zipPath);
  const sidecarMatch = sidecar.match(/^([a-f0-9]{64})  (.+)$/u);
  currentChecks.push({ id: "sidecar", status: sidecarMatch?.[1] === sha256(zipBytes) && sidecarMatch?.[2] === zipName ? "PASS" : "FAIL" });
  const extraction = await mkdtemp(resolve(tmpdir(), "w5-d4-e-package-verify-"));
  try {
    const unpack = spawnSync("tar", ["-xf", zipPath, "-C", extraction], { encoding: "utf8" });
    if (unpack.status !== 0) throw new Error(`zip_extract_failed:${unpack.stderr}`);
    const zipManifest = JSON.parse(await readFile(resolve(extraction, "ZIP-MANIFEST.json"), "utf8"));
    const actual = await filesBelow(extraction);
    currentChecks.push({ id: "zip-file-set", status: archiveSetValid(actual, zipManifest) ? "PASS" : "FAIL" });
    currentChecks.push({ id: "zip-list-match", status: JSON.stringify([...actual].sort()) === JSON.stringify([...zipList].sort()) ? "PASS" : "FAIL" });
    let hashesPass = true;
    for (const item of zipManifest.entries) {
      const raw = await readFile(resolve(extraction, item.path));
      const bytes = item.hashMode === "utf8-lf-v1" ? normalizeLf(raw) : raw;
      if (sha256(bytes) !== item.sha256 || bytes.byteLength !== item.byteLength) hashesPass = false;
    }
    currentChecks.push({ id: "zip-entry-hashes", status: hashesPass ? "PASS" : "FAIL" });
    currentChecks.push({ id: "zip-forbidden-content", status: actual.every((path) => !/(?:node_modules|dist-web|\.demo-build|scripts\/w5-e-validation\/d2-|handoff-w5-e-d2|\.zip$|\.sha256$)/iu.test(path)) ? "PASS" : "FAIL" });
  } finally {
    await rm(extraction, { recursive: true, force: true });
  }
  const report = await readFile(reportPath, "utf8");
  const fullPassed = commands.commands.find((item) => item.id === "full-test")?.statistics?.tests?.passed;
  currentChecks.push({ id: "report", status: report.includes(zipName) && report.includes(sha256(zipBytes)) && Number.isInteger(fullPassed) && report.includes(`${fullPassed} passed`) ? "PASS" : "FAIL" });
  negativeSelfTests.push(expectedFailure(sidecar === `${"0".repeat(64)}  ${zipName}`, "wrong-sidecar-hash-fails"));
  negativeSelfTests.push(expectedFailure(basename(zipPath) !== zipName, "wrong-zip-name-fails"));
}

const result = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  generatedAtUtc: new Date().toISOString(),
  mode: prePackage ? "PRE_PACKAGE" : "FINAL_PACKAGE",
  currentChecks,
  negativeSelfTests,
  status: currentChecks.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
};
if (!prePackage) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.status === "PASS" ? 0 : 1;
