import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const promptDir = resolve(projectRoot, "fixtures/model-prompts/w3");
const responseFile = resolve(here, "recorded-responses.json");
const unauthorizedFile = resolve(here, "unauthorized-requests.json");
const promptFile = resolve(promptDir, "dynamic-objective-question.md");
const configFile = resolve(promptDir, "model-configuration.json");
const manifestFile = resolve(here, "candidate-manifest.sha256");
const expectedRuns = new Set([
  "w3-d1-single-choice-normal", "w3-d1-judgment-normal", "w3-d1-invalid-output",
  "w3-d1-authority-violation", "w3-d1-timeout", "w3-d1-provider-error",
]);
const forbiddenValuePatterns = [
  /OPENAI_API_KEY\s*[=:]\s*(?!["'`]?\s*(?:env:)?OPENAI_API_KEY\b)/iu,
  /(?:sk|api)[-_][A-Za-z0-9]{12,}/u,
  /[A-Za-z]:[\\/][^\s]*/u,
  /\\\\[^\\/\s]+[\\/][^\s]*/u,
  /\/(?:home|Users|tmp)\/[A-Za-z0-9._-]+(?:[\\/]\S*)?/iu,
  /\bAuthorization\s*:\s*Bearer\s+\S+/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/u,
  /\b(?:accessToken|apiKey|authorization|secret|password)\s*[:=]\s*\S+/iu,
];
const sensitivePatternCanaries = [
  "D:\\private\\hidden.csv",
  "\\\\server\\share\\private.csv",
  "/home/tester/private.csv",
  "/tmp/tester/private.csv",
  "Authorization: Bearer review-credential-placeholder",
  "password=review-credential-placeholder",
];
const allowedCredentialReferences = ["env:OPENAI_API_KEY"];

function fail(message) { throw new Error(`[w3-d1-materials] ${message}`); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function stableId(value) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value); }
function exactKeys(value, expected) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function stableIds(value) {
  return Array.isArray(value) && value.length > 0 && value.every(stableId) && new Set(value).size === value.length;
}
function validQuestion(value) {
  const common = ["artifactId", "kind", "prompt", "sourceAnchorIds", "rationale"];
  if (!isRecord(value) || !stableId(value.artifactId) || typeof value.prompt !== "string"
    || typeof value.rationale !== "string" || !stableIds(value.sourceAnchorIds)) return false;
  if (value.kind === "judgment") return exactKeys(value, common);
  return value.kind === "single_choice" && exactKeys(value, [...common, "options"])
    && Array.isArray(value.options) && value.options.length >= 3 && value.options.length <= 5
    && value.options.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value.options).size === value.options.length;
}

for (const canary of sensitivePatternCanaries) {
  if (!forbiddenValuePatterns.some((pattern) => pattern.test(canary))) {
    fail(`sensitive-value scanner does not reject canary: ${canary}`);
  }
}
for (const reference of allowedCredentialReferences) {
  if (forbiddenValuePatterns.some((pattern) => pattern.test(reference))) {
    fail(`sensitive-value scanner rejects allowed environment reference: ${reference}`);
  }
}

const [responseText, unauthorizedText, promptText, configText] = await Promise.all([
  readFile(responseFile, "utf8"), readFile(unauthorizedFile, "utf8"),
  readFile(promptFile, "utf8"), readFile(configFile, "utf8"),
]);
const responses = JSON.parse(responseText);
const unauthorized = JSON.parse(unauthorizedText);
const config = JSON.parse(configText);
if (!exactKeys(responses, ["recordings"]) || !Array.isArray(responses.recordings)) fail("recordings root is invalid");
const seen = new Set();
for (const item of responses.recordings) {
  if (!stableId(item.runId) || seen.has(item.runId)) fail("recording runId must be unique and stable");
  seen.add(item.runId);
  if (item.graphId !== "dynamic-objective-question" || item.modelId !== "deepseek-chat" || item.promptVersion !== "w3-d1-v1") fail(`${item.runId} binding is invalid`);
  if (item.status === "ok" && item.runId.endsWith("normal") && !validQuestion(item.payload)) fail(`${item.runId} normal payload is invalid`);
  if (item.status === "timeout" && item.errorCode !== "timeout") fail(`${item.runId} timeout is invalid`);
  if (item.status === "provider_error" && item.errorCode !== "provider_error") fail(`${item.runId} provider error is invalid`);
}
if (seen.size !== expectedRuns.size || [...expectedRuns].some((runId) => !seen.has(runId))) fail("required scenario coverage is incomplete");
if (!exactKeys(unauthorized, ["cases"]) || unauthorized.cases.length !== 6) fail("authority case coverage is incomplete");
const authorityKeys = unauthorized.cases.map(({ safeContext }) => Object.keys(safeContext)[0]?.toLowerCase());
for (const expected of ["mastery", "knowledgestate", "path", "rubric", "activityresult", "gold"]) {
  if (!authorityKeys.includes(expected)) fail(`missing authority case ${expected}`);
}
if (!promptText.includes("w3-d1-v1") || !promptText.includes("single_choice") || !promptText.includes("judgment")) fail("prompt contract is incomplete");
if (config.mode !== "recorded_responses_only" || config.networkEnabled !== false || config.liveModelCapabilityClaimed !== false
  || config.timeoutMs !== 60000 || config.sessionTokenBudget !== 100000 || config.fallbackPolicy !== "w3-fixed-fallback-v1") fail("offline model configuration is invalid");

const scanFiles = [responseFile, unauthorizedFile, promptFile, configFile];
for (const file of scanFiles) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbiddenValuePatterns) if (pattern.test(text)) fail(`sensitive-value scan failed for ${relative(projectRoot, file)}`);
}
for (const item of responses.recordings.filter(({ runId }) => runId.endsWith("normal"))) {
  const keys = JSON.stringify(item.payload).match(/"([^"\\]+)"\s*:/gu)?.map((entry) => entry.slice(1, entry.indexOf('"', 1)).replace(/[^a-z]/giu, "").toLowerCase()) ?? [];
  for (const forbidden of ["hiddentest", "hiddentests", "referenceimplementation", "privatecsv", "rawannotation", "rawannotations", "apikey", "hostpath"]) {
    if (keys.includes(forbidden)) fail(`${item.runId} contains forbidden context key ${forbidden}`);
  }
}

const candidateFiles = [
  resolve(projectRoot, "src/application/offline-dynamic-question-orchestrator.ts"),
  promptFile, configFile, responseFile, unauthorizedFile,
  resolve(here, "offline-dynamic-question.test.ts"),
  resolve(here, "validate-w3-materials.mjs"),
  resolve(here, "d1-handoff.md"),
].sort();
const hashes = [];
for (const file of candidateFiles) {
  const bytes = await readFile(file);
  hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  ${relative(projectRoot, file).replaceAll("\\", "/")}`);
}
const sealedManifest = (await readFile(manifestFile, "utf8")).trim().split(/\r?\n/u).sort();
if (JSON.stringify(sealedManifest) !== JSON.stringify([...hashes].sort())) fail("sealed candidate SHA-256 manifest differs from current files");
console.log(JSON.stringify({
  status: "PASS",
  schemas: 2,
  recordedScenarios: seen.size,
  authorityCases: unauthorized.cases.length,
  scannedFiles: scanFiles.length,
  sensitivePatternCanaries: sensitivePatternCanaries.length,
}, null, 2));
console.log(hashes.join("\n"));
