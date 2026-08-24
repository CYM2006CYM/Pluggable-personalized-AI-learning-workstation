import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(appRoot, "..");
const outputRoot = import.meta.dirname;
const checkOnly = process.argv.includes("--check-only");
const revision3Root = resolve(appRoot, "fixtures/profiles/pandas-cleaning-revision-3-draft");
const revision2Root = resolve(appRoot, "fixtures/profiles/pandas-cleaning-v2-draft");
const sealPath = resolve(revision3Root, "quality/revision-seal.json");
const lockPath = resolve(revision3Root, "environments/environment-lock.json");
const cRoot = resolve(appRoot, "scripts/w5-c-d3");
const showcaseRoot = resolve(workspaceRoot, "evaluation/showcases");

const EXPECTED_LOCK_SHA256 = "59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43";
const EXPECTED_ENVIRONMENT_HASH = "sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76";
const HISTORICAL_W5_SEAL = "ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d";
const CURRENT_PROFILE_SEAL = "f0c009169a090de8ec9beb5afcf6aaa971f8aac847e235c96c36720f6de8d45c";
const EXPECTED_REVISION2_TREE = "2a4538272cc47a3451b434999d620f429e5deaa0eb0f2c3f95fa76e53d80786d";
const EXPECTED_UPSTREAM = "6acc56fa03986797be54156af639a905c2e74a64";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const stableJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort((a, b) => a.localeCompare(b, "en")).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
};

async function allFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link is forbidden: ${relative(workspaceRoot, absolute)}`);
    if (entry.isDirectory()) files.push(...await allFiles(absolute));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function rawSnapshot(root) {
  const entries = [];
  for (const absolute of await allFiles(root)) {
    const bytes = await readFile(absolute);
    entries.push({
      path: relative(root, absolute).replaceAll("\\", "/"),
      sha256: digest(bytes),
      byteLength: bytes.byteLength,
    });
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")));
  const treeSha256 = digest(Buffer.concat(entries.map((entry) => Buffer.from(`${entry.path}\0raw-binary\0${entry.sha256}\0${entry.byteLength}\n`, "utf8"))));
  return { fileCount: entries.length, treeSha256, entries };
}

async function calculateSeal() {
  const manifest = await json(resolve(revision3Root, "profile.json"));
  const entries = [];
  for (const absolute of await allFiles(revision3Root)) {
    const path = relative(revision3Root, absolute).replaceAll("\\", "/");
    if (path === "quality/revision-seal.json") continue;
    const raw = await readFile(absolute);
    const payload = path === "profile.json"
      ? Buffer.from(stableJson({ ...JSON.parse(raw.toString("utf8")), status: "draft" }), "utf8")
      : raw;
    entries.push({
      path,
      hashMode: path === "profile.json" ? "utf8-json-keys-sorted-arrays-preserved-no-whitespace-v1" : "raw-binary",
      sha256: digest(payload),
      byteLength: payload.byteLength,
    });
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")));
  const assetTreeSha256 = digest(Buffer.concat(entries.map((entry) => Buffer.from(`${entry.path}\0${entry.hashMode}\0${entry.sha256}\0${entry.byteLength}\n`, "utf8"))));
  return { schemaVersion: 1, subjectId: manifest.subjectId, revision: manifest.revision, entries, assetTreeSha256 };
}

function deepValue(root, path) {
  return path.split(".").reduce((value, key) => value?.[key], root);
}

const [lockBytes, lock, cMeasurement, cMapping, bMapping, storedSeal, diagnostic, matrix] = await Promise.all([
  readFile(lockPath),
  json(lockPath),
  json(resolve(cRoot, "environment-measurement.json")),
  json(resolve(cRoot, "environment-field-mapping.json")),
  json(resolve(outputRoot, "environment-lock-evidence-mapping.json")),
  json(sealPath),
  json(resolve(revision3Root, "assessments/diagnostic/questions.json")),
  json(resolve(showcaseRoot, "w5-d3-expected-differences.json")),
]);

ensure(bMapping.upstreamCommit === EXPECTED_UPSTREAM, "B mapping is not bound to C's formal commit");
ensure(cMeasurement.status === "PASS", "C environment measurement is not PASS");
ensure(cMapping.classification === "C_TO_B_STRUCTURED_RECOMMENDATION_ONLY", "C field mapping classification changed");
ensure(cMeasurement.notes?.pyodide === "NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE", "Pyodide NOT_RUN evidence is missing");
ensure(cMeasurement.notes?.measuredDualBackend === false, "dual-backend capability must remain false");
ensure(lock.status === "measured_node_submit" && lock.pyodideVersion === null, "closed Pyodide lock state is invalid");
ensure(lock.capabilityFlags.processTreeTermination === true, "process tree termination proof was not retained");
ensure(lock.capabilityFlags.networkIsolation === false && lock.capabilityFlags.reliableMemoryLimit === false, "unproved capabilities must remain false");
ensure(digest(lockBytes) === EXPECTED_LOCK_SHA256, "environment-lock.json raw SHA-256 changed");
const { environmentHash, ...environmentHashInput } = lock;
const recalculatedEnvironmentHash = `sha256:${digest(Buffer.from(stableJson(environmentHashInput), "utf8"))}`;
ensure(environmentHash === EXPECTED_ENVIRONMENT_HASH && recalculatedEnvironmentHash === EXPECTED_ENVIRONMENT_HASH, "environmentHash does not recalculate");
for (const field of bMapping.fields) {
  ensure(field.action === "KEEP", `B mapping contains a non-KEEP action: ${field.field}`);
  ensure(stableJson(deepValue(lock, field.field)) === stableJson(field.lockValue), `lock value mismatch: ${field.field}`);
  ensure(stableJson(field.lockValue) === stableJson(field.evidenceValue), `C evidence mismatch: ${field.field}`);
}
ensure(bMapping.decision === "NO_PROFILE_BYTE_CHANGE_REQUIRED", "B must not fabricate an environment-lock byte change");

const recalculatedSeal = await calculateSeal();
ensure(storedSeal.assetTreeSha256 === CURRENT_PROFILE_SEAL && recalculatedSeal.assetTreeSha256 === CURRENT_PROFILE_SEAL, "current revision 3 seal hash changed");
ensure(stableJson(storedSeal.entries) === stableJson(recalculatedSeal.entries), "revision 3 seal entries do not match the asset tree");
const revision2 = await rawSnapshot(revision2Root);
ensure(revision2.fileCount === 71 && revision2.treeSha256 === EXPECTED_REVISION2_TREE, "revision 2 bytes changed");

const caseFiles = [
  "computer-background/input.json",
  "beginner-background/input.json",
  "task-oriented/input.json",
];
const cases = await Promise.all(caseFiles.map((path) => json(resolve(showcaseRoot, path))));
const questionById = new Map(diagnostic.questions.map((question) => [question.questionId, question]));
const allowedExperience = new Set(["none", "basic", "comfortable", "uncertain"]);
const allowedPreference = new Set(["concise", "step_by_step", "example_first", "uncertain"]);
const caseIds = new Set();
const inputBindings = [];
for (let index = 0; index < cases.length; index += 1) {
  const item = cases[index];
  ensure(item.schemaVersion === 1 && item.contract === "W5-C1/W5-R1", `case contract is invalid: ${item.caseId}`);
  ensure(!caseIds.has(item.caseId), `duplicate caseId: ${item.caseId}`);
  caseIds.add(item.caseId);
  ensure(item.profileBinding.subjectId === "pandas-cleaning" && item.profileBinding.profileRevision === 3, `case Profile binding is invalid: ${item.caseId}`);
  ensure(item.profileBinding.assetTreeSha256 === HISTORICAL_W5_SEAL, `historical case seal binding is invalid: ${item.caseId}`);
  ensure(item.entry.mode === "recommended" && item.entry.goalId === "goal-clean-orders" && item.entry.availableMinutes === 400, `case common entry boundary changed: ${item.caseId}`);
  ensure(allowedExperience.has(item.background.python_experience) && allowedExperience.has(item.background.pandas_experience), `case experience value is invalid: ${item.caseId}`);
  ensure(allowedPreference.has(item.background.explanation_preference), `case explanation preference is invalid: ${item.caseId}`);
  ensure(item.diagnostic.blueprintId === diagnostic.blueprintId, `case diagnostic blueprint changed: ${item.caseId}`);
  ensure(item.diagnostic.answers.length === diagnostic.questions.length, `case does not cover every diagnostic question: ${item.caseId}`);
  const answered = new Set();
  for (const answer of item.diagnostic.answers) {
    ensure(!answered.has(answer.questionId), `case repeats a diagnostic question: ${item.caseId}/${answer.questionId}`);
    answered.add(answer.questionId);
    const question = questionById.get(answer.questionId);
    ensure(question !== undefined, `case references an unknown public question: ${item.caseId}/${answer.questionId}`);
    ensure(answer.action === "answer" || answer.action === "skip", `case action is invalid: ${item.caseId}/${answer.questionId}`);
    if (answer.action === "skip") ensure(!Object.hasOwn(answer, "answer"), `skip must not carry an answer: ${item.caseId}/${answer.questionId}`);
    if (answer.action === "answer" && question.kind === "single_choice") ensure(question.options.includes(answer.answer), `answer is not a public option: ${item.caseId}/${answer.questionId}`);
    if (answer.action === "answer" && question.kind === "judgment") ensure(typeof answer.answer === "boolean", `judgment answer must be boolean: ${item.caseId}/${answer.questionId}`);
  }
  const raw = await readFile(resolve(showcaseRoot, caseFiles[index]));
  inputBindings.push({ caseId: item.caseId, path: `evaluation/showcases/${caseFiles[index]}`, sha256: digest(raw), byteLength: raw.byteLength });
}
ensure(caseIds.size === 3, "exactly three showcase inputs are required");
ensure(matrix.status === "EXPECTED_ONLY_A_PATHENGINE_PENDING_E_INDEPENDENT_REVIEW_PENDING", "expected matrix was mislabeled as actual output");
ensure(matrix.pairs.length === 3, "three pairwise comparisons are required");
for (const pair of matrix.pairs) {
  ensure(caseIds.has(pair.leftCaseId) && caseIds.has(pair.rightCaseId), "matrix references an unknown case");
  ensure(Array.isArray(pair.hypotheses) && pair.hypotheses.length >= 3, `pair lacks three expected differences: ${pair.leftCaseId}/${pair.rightCaseId}`);
}

const result = {
  schemaVersion: 1,
  contract: "W5-C1/W5-R1",
  status: "PASS",
  upstream: { cFormalCommit: EXPECTED_UPSTREAM, decisionId: "W5-D64-PYODIDE-1" },
  environment: {
    decision: bMapping.decision,
    lockSha256: digest(lockBytes),
    environmentHash: { recorded: environmentHash, recalculated: recalculatedEnvironmentHash },
    pyodide: "NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE",
    measuredDualBackend: false,
  },
  revision3: { entryCount: recalculatedSeal.entries.length, assetTreeSha256: recalculatedSeal.assetTreeSha256, storedSealMatches: true },
  revision2: { fileCount: revision2.fileCount, treeSha256: revision2.treeSha256, unchanged: true },
  showcases: { caseCount: cases.length, pairCount: matrix.pairs.length, minimumHypothesesPerPair: Math.min(...matrix.pairs.map((pair) => pair.hypotheses.length)), inputBindings, actualPathOutputIncluded: false, aPathEngineStatus: "PENDING", eIndependentReviewStatus: "PENDING" },
};

if (!checkOnly) {
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputRoot, "environment-lock-diff.json"), `${JSON.stringify({ schemaVersion: 1, status: "NO_CHANGE", beforeSha256: EXPECTED_LOCK_SHA256, afterSha256: digest(lockBytes), changedFields: [], reason: bMapping.reason }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputRoot, "seal-recalculation.json"), `${JSON.stringify({ schemaVersion: 1, status: "PASS", entryCount: recalculatedSeal.entries.length, storedAssetTreeSha256: storedSeal.assetTreeSha256, recalculatedAssetTreeSha256: recalculatedSeal.assetTreeSha256, matches: true }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputRoot, "revision-2-immutability.json"), `${JSON.stringify({ schemaVersion: 1, status: "PASS", fileCount: revision2.fileCount, treeSha256: revision2.treeSha256, expectedTreeSha256: EXPECTED_REVISION2_TREE, unchanged: true }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputRoot, "showcase-input-bindings.json"), `${JSON.stringify({ schemaVersion: 1, status: "HISTORICAL_INPUTS_ONLY", profileRevision: 3, assetTreeSha256: HISTORICAL_W5_SEAL, entries: inputBindings, aPathEngineStatus: "PENDING", eIndependentReviewStatus: "PENDING" }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputRoot, "verification-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  ]);
}

console.log(JSON.stringify(result, null, 2));
