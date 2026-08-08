import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "../..");
const repositoryRoot = resolve(packageRoot, "..");
const profileRoot = resolve(packageRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const decisionPath = resolve(repositoryRoot, "新版设计文档-重写版/第三周任务/W3-D2-负责人Node环境裁决.md");
const d2EvidenceArgument = process.argv.indexOf("--d2-evidence");
const d2EvidencePath = d2EvidenceArgument !== -1 && process.argv[d2EvidenceArgument + 1]
  ? resolve(packageRoot, process.argv[d2EvidenceArgument + 1])
  : resolve(scriptDirectory, "environment-prototype-rerun-d2.json");
const formalBindingPath = resolve(scriptDirectory, "environment-formal-binding-evidence.json");

const expected = {
  head: "c8b4aacffccdad92338abedfd7acb3b59b716e60",
  w3Start: "f190326a4a906b46e4001484ffa30a7839b82ed2",
  bCommit: "277805b4dc612548f4dcdf4f91189abb4ef5c8e3",
  decisionSha256: "c06d1d77ab81a766de029e8121c695efdc39757b543276d13efc7681c7485fb4",
  d1ZipSha256: "1cc5bb26ebf21c9e565403dc71c466eda5a753e2b5fda2df3bb54102d3dc04ac",
  d1Files: {
    "probe-environment.mjs": "a3dee9f1986dda26824c26138ebf1c8e26d6c84603faaa90d4b6259f391501f6",
    "environment-prototype-evidence.json": "af0b859ef893b1fca6690e39c0551c5c7ec07423adf6127d96cd00442b4697d7",
    "environment-prototype-report.md": "b03bd70946affd066be0c555389342b6ef09e10541c80ac4458edbd1d0d26657",
  },
  assetBundles: {
    "act-inspect-dataframe": "bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c",
    "act-practical": "3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c",
  },
};

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function isAncestor(commit) {
  return exec("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: repositoryRoot, windowsHide: true })
    .then(() => true)
    .catch(() => false);
}

const reasons = [];
const checks = {};
const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, windowsHide: true })).stdout.trim();
checks.head = head;
checks.formalHead = head === expected.head;
if (!checks.formalHead) reasons.push("candidate HEAD is not the approved W3-D2 decision commit");
checks.w3StartAncestor = await isAncestor(expected.w3Start);
checks.bCommitAncestor = await isAncestor(expected.bCommit);
if (!checks.w3StartAncestor) reasons.push("W3_START_COMMIT is not an ancestor of candidate HEAD");
if (!checks.bCommitAncestor) reasons.push("B formal commit is not an ancestor of candidate HEAD");

checks.decisionSha256 = await sha256(decisionPath);
checks.decisionBound = checks.decisionSha256 === expected.decisionSha256;
if (!checks.decisionBound) reasons.push("owner Node environment decision hash differs");

checks.d1SealedFiles = {};
for (const [file, hash] of Object.entries(expected.d1Files)) {
  const actual = await sha256(resolve(scriptDirectory, file));
  checks.d1SealedFiles[file] = actual;
  if (actual !== hash) reasons.push(`sealed D1 file changed: ${file}`);
}
checks.d1ZipSha256 = expected.d1ZipSha256;

const bundleDocument = await json(resolve(profileRoot, "assessments/private/task-bundles.json"));
const formalBundles = bundleDocument.bundles.filter((bundle) => Object.hasOwn(expected.assetBundles, bundle.activity.activityId));
checks.formalTaskBundleCount = formalBundles.length;
if (formalBundles.length !== 2) reasons.push("formal W3 task bundle count is not exactly two");
for (const bundle of formalBundles) {
  if (bundle.assetBundleHash !== expected.assetBundles[bundle.activity.activityId]) {
    reasons.push(`${bundle.activity.activityId} assetBundleHash differs from B freeze`);
  }
}
checks.assetBundleHashes = expected.assetBundles;

const environment = await json(resolve(profileRoot, "environments/environment-lock.json"));
const { environmentHash, ...environmentWithoutHash } = environment;
const recomputedEnvironmentHash = `sha256:${createHash("sha256").update(canonicalize(environmentWithoutHash), "utf8").digest("hex")}`;
checks.environment = {
  status: environment.status,
  environmentHash,
  recomputedEnvironmentHash,
  approvedValues: environment.status === "measured_node_submit"
    && environment.nodeVersion === "v22.23.1"
    && environment.pythonVersion === "3.13.7"
    && environment.pandasVersion === "3.0.5"
    && environment.platform === "win32-10.0.26100-x64"
    && environment.evaluatorVersion === "node-python-evaluator-w3-c1"
    && environment.limits.wallClockMs === 4000
    && environment.limits.stdoutBytes === 8192
    && environment.limits.stderrBytes === 8192
    && environment.limits.sourceBytes === 8000
    && environment.limits.datasetBytes === 65536
    && environment.capabilityFlags.processTreeTermination === true
    && environment.capabilityFlags.networkIsolation === false
    && environment.capabilityFlags.reliableMemoryLimit === false
    && !Object.hasOwn(environment.limits, "memoryBytes")
    && environment.pyodideVersion === null,
};
if (!checks.environment.approvedValues || environmentHash !== recomputedEnvironmentHash) {
  reasons.push("formal environment lock differs from W3-D40-ENV-1 or its hash is invalid");
}

const d2Evidence = await json(d2EvidencePath);
const formalBinding = await json(formalBindingPath);
checks.d2Evidence = {
  status: d2Evidence.status,
  decision: d2Evidence.decision,
  ownerDecision: d2Evidence.binding?.ownerDecision,
  ownerDecisionCommit: d2Evidence.binding?.ownerDecisionCommit,
  formalEnvironmentHash: d2Evidence.binding?.formalEnvironmentHash,
  bFormalCommit: d2Evidence.binding?.bFormalCommit,
  assetBundleHashes: d2Evidence.binding?.assetBundleHashes,
};
checks.d2EvidenceBound = d2Evidence.status === "measured_node_submit"
  && d2Evidence.decision === "W3-D40-ENV-1"
  && d2Evidence.binding?.ownerDecision === "W3-D40-ENV-1"
  && d2Evidence.binding?.ownerDecisionCommit === expected.head
  && d2Evidence.binding?.bFormalCommit === expected.bCommit
  && d2Evidence.binding?.formalEnvironmentHash === environmentHash
  && JSON.stringify(d2Evidence.binding?.assetBundleHashes) === JSON.stringify(expected.assetBundles);
checks.formalBindingEvidence = formalBinding.status === "PASS"
  && formalBinding.decision?.id === "W3-D40-ENV-1"
  && formalBinding.gitBinding?.candidateHead === expected.head
  && formalBinding.formalEnvironmentLock?.environmentHash === environmentHash
  && formalBinding.d2RerunEvidence?.sha256 === await sha256(d2EvidencePath);
if (!checks.d2EvidenceBound) reasons.push("D2 rerun evidence is pending or not bound to W3-D40-ENV-1");
if (!checks.formalBindingEvidence) reasons.push("formal binding evidence does not match the D2 rerun evidence");

for (const file of [
  "src/infrastructure/activity-rubric.ts",
  "src/infrastructure/python-process-evaluation-adapter.ts",
  "scripts/python-evaluator.py",
  "tests/activity-rubric.test.ts",
  "tests/python-process-evaluation.test.ts",
  "scripts/w3-code-evaluation/environment-prototype-rerun-d2.json",
  "scripts/w3-code-evaluation/environment-formal-binding-evidence.json",
]) {
  try {
    await stat(resolve(packageRoot, file));
  } catch {
    reasons.push(`missing C candidate file: ${file}`);
  }
}

const sourceFiles = [
  "src/infrastructure/code-evaluation-port.ts",
  "src/infrastructure/activity-rubric.ts",
  "src/infrastructure/python-process-evaluation-adapter.ts",
];
const sources = (await Promise.all(sourceFiles.map((file) => readFile(resolve(packageRoot, file), "utf8")))).join("\n");
checks.cBoundaryScan = !/(?:AttemptRepository|EvidenceRepository|KnowledgeState|PathRepository|UnitOfWork|SessionCommit)/u.test(sources);
checks.publicResultBoundary = !/(?:hiddenTests|referenceSolution|privateCsv|stdoutRaw|stderrRaw)/u.test(await readFile(resolve(packageRoot, "src/infrastructure/code-evaluation-port.ts"), "utf8"));
if (!checks.cBoundaryScan || !checks.publicResultBoundary) reasons.push("C source crosses the public ActivityResult or formal fact boundary");

const v33 = await json(resolve(scriptDirectory, "v3-3-author-evidence.json"));
const v34 = await json(resolve(scriptDirectory, "v3-4-boundary-evidence.json"));
const v36 = await json(resolve(scriptDirectory, "v3-6-failure-matrix.json"));
checks.authorEvidence = v33.authorTest?.testsPassed === 20
  && v33.authorTest?.testsFailed === 0
  && v33.formalTaskRuns?.every((run) => run.repeatCount === 3 && run.passCount === 3 && run.fieldIdentical === true);
checks.r2Evidence = v33.r2AdditionalTests?.testsPassed === 8
  && v33.r2AdditionalTests?.testsFailed === 0
  && v36.r2AdditionalCoverage?.negativeEvidence === false;
checks.boundaryEvidence = v34.sourceScan?.status === "PASS" && v34.separatePublicHiddenProcesses === true;
checks.failureMatrix = v36.evaluatorErrorCreatesNegativeEvidence === false && v36.formalFactsCreatedByC === false;
if (!checks.authorEvidence) reasons.push("V3-3 author evidence is incomplete");
if (!checks.r2Evidence) reasons.push("R2 additional failure and protocol evidence is incomplete");
if (!checks.boundaryEvidence) reasons.push("V3-4 boundary evidence is incomplete");
if (!checks.failureMatrix) reasons.push("V3-6 failure evidence is incomplete");

const result = {
  schemaVersion: 2,
  status: reasons.length === 0 ? "PASS" : "BLOCKED",
  contract: "W3-C3/W3-R2",
  decision: "W3-D40-ENV-1",
  checks,
  reasons,
  profileStatus: "draft",
  formalUpload: "not_authorized",
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1 && process.argv[outputIndex + 1]) {
  await writeFile(resolve(packageRoot, process.argv[outputIndex + 1]), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));
if (reasons.length > 0) process.exitCode = 1;
