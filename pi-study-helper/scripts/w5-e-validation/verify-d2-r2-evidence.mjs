import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const deliveryRoot = resolve(repositoryRoot, "..", "W5-D2");
const zipName = "W5-D2-E-R2-delivery.zip";
const zipPath = resolve(deliveryRoot, zipName);
const sidecarPath = `${zipPath}.sha256`;
const reportPath = resolve(deliveryRoot, "W5-D2-E-R2-交付报告.md");
const prePackage = process.argv.includes("--pre-package");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
const readLines = async (path) => (await readFile(resolve(repositoryRoot, path), "utf8")).split(/\r?\n/u).filter(Boolean);

function statisticsValid(command) {
  if (command.statistics?.applicability === "NOT_APPLICABLE") return command.statistics.testFiles === "NOT_APPLICABLE" && command.statistics.tests === "NOT_APPLICABLE";
  if (command.statistics?.applicability !== "APPLICABLE") return false;
  const groups = [command.statistics.testFiles, command.statistics.tests];
  if (groups.some((group) => group.total !== group.passed + group.failed + group.skipped)) return false;
  const failures = groups.some((group) => group.failed > 0);
  return command.exitCode === 0 ? !failures : failures;
}
function runtimeValid(security) {
  return security.status === "PASS" && security.runtimeAssertions.length >= 5 && security.runtimeAssertions.every((item) => item.status === "PASS" && item.exitCode === 0 && item.command !== "NOT_RUN" && item.startedAtUtc !== "NOT_RUN" && item.evidence !== "NOT_RUN" && /^[a-f0-9]{64}$/u.test(item.evidence.sha256));
}
function formalScopeValid(paths) {
  const forbidden = /(?:w5-d1-e-|\.png$|(?:^|\/)evidence\/d2\/|node_modules|dist-web|\.demo-build)/u;
  return paths.length > 0 && paths.every((path) => !forbidden.test(path) && (path.startsWith("pi-study-helper/src/web/") || path.startsWith("pi-study-helper/tests/web/") || path.startsWith("pi-study-helper/scripts/w5-e-validation/") || path === "新版设计文档-重写版/第五周任务/handoff-w5-e-d2.md"));
}
function archiveSetValid(actual, manifest) {
  const expected = [...manifest.files.map((item) => item.path), ...(manifest.selfExcluded ?? [])].sort();
  return JSON.stringify([...actual].sort()) === JSON.stringify(expected);
}
function hostPathFree(value) {
  return !/[A-Z]:(?:[\\/])+(?:Users|home|\.A_C_code)|\/home\//iu.test(String(value));
}
function expectedFailure(value, label) {
  if (value) throw new Error(`negative_self_test_did_not_fail:${label}`);
  return { id: label, status: "PASS" };
}
async function filesBelow(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, path));
    else result.push(relative(root, path).replaceAll("\\", "/"));
  }
  return result;
}

const commands = await readJson("pi-study-helper/scripts/w5-e-validation/d2-command-results.json");
const security = await readJson("pi-study-helper/scripts/w5-e-validation/d2-security-scan.json");
const screenshots = await readJson("pi-study-helper/scripts/w5-e-validation/d2-screenshot-index.json");
const formal = await readLines("pi-study-helper/scripts/w5-e-validation/d2-proposed-files.txt");
const audit = await readLines("pi-study-helper/scripts/w5-e-validation/d2-audit-only-files.txt");
const zipList = await readLines("pi-study-helper/scripts/w5-e-validation/d2-zip-files.txt");
const formalManifest = await readJson("pi-study-helper/scripts/w5-e-validation/d2-sha256-manifest.json");
const formalHostPathFindings = [];
for (const path of formal) {
  const value = await readFile(resolve(repositoryRoot, path), "utf8");
  if (!hostPathFree(value)) formalHostPathFindings.push(path);
}

const currentChecks = [
  { id: "command-statistics", status: commands.commands.every(statisticsValid) ? "PASS" : "FAIL" },
  { id: "command-overall-status", status: commands.overallStatus === "PASS" && commands.commands.every((item) => item.status === "PASS") ? "PASS" : "FAIL" },
  { id: "runtime-evidence", status: runtimeValid(security) ? "PASS" : "FAIL" },
  { id: "browser-capture", status: screenshots.status === "PASS" && screenshots.screenshots.length === 4 ? "PASS" : "FAIL" },
  { id: "formal-scope", status: formalScopeValid(formal) ? "PASS" : "FAIL" },
  { id: "formal-host-path-scan", status: formalHostPathFindings.length === 0 ? "PASS" : "FAIL", findings: formalHostPathFindings },
  { id: "audit-scope", status: audit.length === 4 && audit.every((path) => path.endsWith(".png")) ? "PASS" : "FAIL" },
  { id: "formal-manifest", status: formalManifest.files.length + formalManifest.selfExcluded.length === formal.length && formalManifest.files.every((item) => /^[a-f0-9]{64}$/u.test(item.sha256)) ? "PASS" : "FAIL" },
  { id: "zip-list-separation", status: zipList.length === formal.length + audit.length + 1 && zipList.includes("ZIP-MANIFEST.json") ? "PASS" : "FAIL" },
];

const testCommand = commands.commands.find((item) => item.id === "test-web");
const negativeSelfTests = [
  expectedFailure(statisticsValid({ exitCode: 0, statistics: { applicability: "MISSING" } }), "missing-test-statistics-fails"),
  expectedFailure(statisticsValid({ exitCode: 0, statistics: { applicability: "APPLICABLE", testFiles: { passed: 0, failed: 1, skipped: 0, total: 1 }, tests: { passed: 0, failed: 1, skipped: 0, total: 1 } } }), "exit-statistics-conflict-fails"),
  expectedFailure(runtimeValid({ status: "PASS", runtimeAssertions: [{ status: "NOT_RUN", exitCode: 0, evidence: "NOT_RUN" }] }), "runtime-not-run-cannot-pass"),
  expectedFailure(formalScopeValid([...formal, "pi-study-helper/scripts/w5-e-validation/w5-d1-e-preparation.md"]), "d1-material-rejected"),
  expectedFailure(formalScopeValid([...formal, "pi-study-helper/scripts/w5-e-validation/evidence/d2-r2/start.png"]), "png-rejected-from-git"),
  expectedFailure(hostPathFree(["C:", "\\\\", "Users", "example", "AppData", "evidence.json"].join("\\")), "json-escaped-host-path-fails"),
  expectedFailure(archiveSetValid(["a"], { files: [{ path: "a" }, { path: "extra" }], selfExcluded: [] }), "archive-missing-entry-fails"),
  expectedFailure(archiveSetValid(["a", "extra"], { files: [{ path: "a" }], selfExcluded: [] }), "archive-extra-entry-fails"),
  expectedFailure(testCommand === undefined, "report-source-test-command-present"),
];

if (!prePackage) {
  const sidecar = (await readFile(sidecarPath, "utf8")).trim();
  const zipBytes = await readFile(zipPath);
  const sidecarMatch = sidecar.match(/^([a-f0-9]{64})  (.+)$/u);
  currentChecks.push({ id: "sidecar", status: sidecarMatch?.[1] === sha256(zipBytes) && sidecarMatch?.[2] === zipName ? "PASS" : "FAIL" });
  const extraction = await mkdtemp(resolve(tmpdir(), "w5-d2-e-r2-verify-"));
  try {
    const unpack = spawnSync("tar", ["-xf", zipPath, "-C", extraction], { encoding: "utf8" });
    if (unpack.status !== 0) throw new Error(`zip_extract_failed:${unpack.stderr}`);
    const zipManifest = JSON.parse(await readFile(resolve(extraction, "ZIP-MANIFEST.json"), "utf8"));
    const actual = await filesBelow(extraction);
    currentChecks.push({ id: "zip-manifest-set", status: archiveSetValid(actual, zipManifest) ? "PASS" : "FAIL" });
    currentChecks.push({ id: "zip-list-match", status: JSON.stringify([...actual].sort()) === JSON.stringify([...zipList].sort()) ? "PASS" : "FAIL" });
    let hashesPass = true;
    for (const item of zipManifest.files) {
      if (sha256(await readFile(resolve(extraction, item.path))) !== item.sha256) hashesPass = false;
    }
    currentChecks.push({ id: "zip-entry-hashes", status: hashesPass ? "PASS" : "FAIL" });
  } finally {
    await rm(extraction, { recursive: true, force: true });
  }
  const report = await readFile(reportPath, "utf8");
  const expectedWeb = `WEB_TESTS=${testCommand.statistics.tests.passed}/${testCommand.statistics.tests.failed}/${testCommand.statistics.tests.skipped}`;
  const full = commands.commands.find((item) => item.id === "full-test");
  const expectedFull = `FULL_TESTS=${full.statistics.tests.passed}/${full.statistics.tests.failed}/${full.statistics.tests.skipped}`;
  currentChecks.push({ id: "report-statistics", status: report.includes(expectedWeb) && report.includes(expectedFull) ? "PASS" : "FAIL" });
  negativeSelfTests.push(expectedFailure(sidecar === `${"0".repeat(64)}  ${zipName}`, "wrong-sidecar-hash-fails"));
  negativeSelfTests.push(expectedFailure(basename(zipPath) !== zipName, "wrong-zip-name-fails"));
}

const result = { schemaVersion: 1, candidate: "W5-D2-E-R2", generatedAtUtc: new Date().toISOString(), mode: prePackage ? "PRE_PACKAGE" : "FINAL_PACKAGE", currentChecks, negativeSelfTests, status: currentChecks.every((item) => item.status === "PASS") ? "PASS" : "FAIL" };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.status === "PASS" ? 0 : 1;
