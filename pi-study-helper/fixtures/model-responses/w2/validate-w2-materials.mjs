import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPT_VERSION = "w2-d4-v1";
const here = dirname(fileURLToPath(import.meta.url));
const responseFile = resolve(here, "recorded-responses.json");
const promptDir = resolve(here, "../../model-prompts/w2");
const responseText = await readFile(responseFile, "utf8");
const fixture = JSON.parse(responseText);

const fail = (message) => {
  throw new Error(`[w2-d-materials] ${message}`);
};
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isStableId = (value) => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
const hasExactKeys = (value, required, optional = []) => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
};
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const isStableIdArray = (value) => Array.isArray(value) && value.every(isStableId);

const payloadValidators = {
  "dynamic-objective-question": (payload) => {
    if (!hasExactKeys(payload, ["artifactId", "kind", "prompt", "sourceAnchorIds", "rationale"], ["options"])) return false;
    if (!isStableId(payload.artifactId) || !["single_choice", "judgment"].includes(payload.kind)) return false;
    if (typeof payload.prompt !== "string" || typeof payload.rationale !== "string" || !isStableIdArray(payload.sourceAnchorIds)) return false;
    if (payload.kind === "single_choice") {
      return isStringArray(payload.options)
        && payload.options.length >= 3
        && payload.options.length <= 5
        && new Set(payload.options).size === payload.options.length;
    }
    return payload.options === undefined;
  },
  generator: (payload) => hasExactKeys(payload, ["artifactId", "candidateFeedback", "rationale", "citedSourceIds", "riskFlags"])
    && isStableId(payload.artifactId)
    && typeof payload.candidateFeedback === "string"
    && typeof payload.rationale === "string"
    && isStableIdArray(payload.citedSourceIds)
    && isStableIdArray(payload.riskFlags),
  hunter: (payload) => {
    if (!hasExactKeys(payload, ["issues", "requiresDefender", "recommendedVerdict"])) return false;
    if (!Array.isArray(payload.issues) || typeof payload.requiresDefender !== "boolean") return false;
    if (!["accepted", "revise", "rejected"].includes(payload.recommendedVerdict)) return false;
    const issuesValid = payload.issues.every((issue) => hasExactKeys(issue, ["issueId", "severity", "message", "disputed"])
      && isStableId(issue.issueId)
      && ["low", "medium", "high"].includes(issue.severity)
      && typeof issue.message === "string"
      && typeof issue.disputed === "boolean");
    const hasHighDispute = payload.issues.some((issue) => issue.severity === "high" && issue.disputed);
    return issuesValid && payload.requiresDefender === hasHighDispute;
  },
  defender: (payload) => hasExactKeys(payload, ["defenseSummary", "acceptedIssueIds", "rebuttedIssueIds", "residualRisks"])
    && typeof payload.defenseSummary === "string"
    && isStableIdArray(payload.acceptedIssueIds)
    && isStableIdArray(payload.rebuttedIssueIds)
    && isStableIdArray(payload.residualRisks)
    && payload.acceptedIssueIds.every((id) => !payload.rebuttedIssueIds.includes(id)),
  judge: (payload) => hasExactKeys(payload, ["verdict", "finalSafeFeedback", "summary", "blockedIssueIds"])
    && ["accepted", "revise", "rejected"].includes(payload.verdict)
    && typeof payload.finalSafeFeedback === "string"
    && typeof payload.summary === "string"
    && isStableIdArray(payload.blockedIssueIds),
};

if (!isRecord(fixture) || Object.keys(fixture).length !== 1 || !Array.isArray(fixture.recordings)) {
  fail("recorded-responses.json must contain only a recordings array");
}

const allowedRecordingKeys = [
  "runId", "graphId", "status", "payload", "errorCode", "sourceRefs",
  "traceSummary", "modelId", "promptVersion", "durationMs",
];
const allowedStatuses = new Set(["ok", "invalid_output", "timeout", "provider_error"]);
const allowedErrors = {
  invalid_output: new Set(["invalid_json"]),
  timeout: new Set(["timeout"]),
  provider_error: new Set(["provider_error", "refusal"]),
};
const seenRunIds = new Set();
for (const recording of fixture.recordings) {
  if (!isRecord(recording) || !Object.keys(recording).every((key) => allowedRecordingKeys.includes(key))) fail("recording has an unknown field");
  if (!isStableId(recording.runId) || seenRunIds.has(recording.runId)) fail("runId must be unique and stable");
  seenRunIds.add(recording.runId);
  if (!isStableId(recording.graphId) || !(recording.graphId in payloadValidators) || !allowedStatuses.has(recording.status)) fail(`${recording.runId} has invalid graphId or status`);
  if (!isStableId(recording.modelId) || recording.promptVersion !== PROMPT_VERSION) fail(`${recording.runId} has invalid model or prompt version`);
  if (!isStableIdArray(recording.sourceRefs)) fail(`${recording.runId} sourceRefs must be stable IDs`);
  if (typeof recording.traceSummary !== "string" || recording.traceSummary.length > 6400) fail(`${recording.runId} traceSummary is invalid`);
  if (recording.durationMs !== undefined && (!Number.isInteger(recording.durationMs) || recording.durationMs < 0 || recording.durationMs > 60000)) fail(`${recording.runId} durationMs is invalid`);
  if (recording.status === "ok") {
    if (recording.errorCode !== undefined || !payloadValidators[recording.graphId](recording.payload)) fail(`${recording.runId} has an invalid success payload`);
    const cited = recording.graphId === "generator" ? recording.payload.citedSourceIds
      : recording.graphId === "dynamic-objective-question" ? recording.payload.sourceAnchorIds
        : [];
    if (!cited.every((id) => recording.sourceRefs.includes(id))) fail(`${recording.runId} cites a source missing from sourceRefs`);
  } else {
    if (recording.payload !== undefined || !allowedErrors[recording.status].has(recording.errorCode)) fail(`${recording.runId} has an invalid failure result`);
  }
}

const versionConflictRecording = fixture.recordings.find(({ runId }) => runId === "w2-d4-judge-version-conflict");
if (versionConflictRecording?.status !== "ok"
  || versionConflictRecording.errorCode !== undefined
  || versionConflictRecording.modelId !== "stale-deepseek-chat"
  || versionConflictRecording.promptVersion !== PROMPT_VERSION) {
  fail("version conflict scenario must be a port-loadable success with a stale modelId");
}
for (const recording of fixture.recordings) {
  if (recording.runId !== "w2-d4-judge-version-conflict" && recording.modelId !== "deepseek-chat") {
    fail(`${recording.runId} must use the configured checkpoint modelId`);
  }
}

const requiredScenarios = [
  "w2-d4-dynamic-question-normal",
  "w2-d4-generator-normal",
  "w2-d4-hunter-no-dispute",
  "w2-d4-hunter-high-risk",
  "w2-d4-defender-dispute",
  "w2-d4-judge-accepted",
  "w2-d4-judge-rejected",
  "w2-d4-generator-invalid",
  "w2-d4-hunter-timeout",
  "w2-d4-generator-refusal",
  "w2-d4-judge-provider-fallback",
  "w2-d4-judge-version-conflict",
];
for (const runId of requiredScenarios) if (!seenRunIds.has(runId)) fail(`missing scenario ${runId}`);

const promptFiles = [
  "README.md",
  "d15-configuration.md",
  "dynamic-objective-question.md",
  "generator.md",
  "hunter.md",
  "defender.md",
  "judge.md",
  "d20-token-budget-question.md",
  "d4-ae-audit-request.md",
  "d-handoff-checklist.md",
];
const promptText = [];
for (const file of promptFiles) {
  const content = await readFile(resolve(promptDir, file), "utf8");
  if (!content.includes(PROMPT_VERSION)) fail(`${file} is missing prompt version`);
  promptText.push(content);
}
const allPromptText = promptText.join("\n");
for (const required of [
  "OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_API_KEY", "deepseek-chat",
  "0.7", "0.2", "60", "100000", "fallback", "Evidence", "KnowledgeState",
  "外部代码评测器", "GoA/OAEO", "SSE", "批量离线生成", "V4-1", "V4-7",
]) {
  if (!allPromptText.includes(required)) fail(`prompt materials missing ${required}`);
}

const sensitivePatterns = [
  /sk-[A-Za-z0-9_-]{16,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/u,
  /[A-Za-z]:\\[^\r\n]+/u,
  /(?:^|[\s"'])(?:\/Users|\/home|\/root)\/[^\s"']+/mu,
  /file:\/\//u,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/u,
];
for (const pattern of sensitivePatterns) {
  if (pattern.test(responseText)) fail(`recorded response matched sensitive pattern ${pattern}`);
}

const forbiddenFixtureKeys = new Set([
  "answer", "correctAnswer", "answerKey", "expectedOutput", "hiddenTests",
  "privateCsvPath", "referenceSolution", "rubric", "blockingRules", "apiKey",
  "hostPath", "learnerCode", "userCode", "rawCode", "evidence", "knowledgeState",
  "score", "mastery", "path",
].map((key) => key.toLowerCase()));
const scanKeys = (value, location = "recordings") => {
  if (Array.isArray(value)) return value.forEach((item, index) => scanKeys(item, `${location}[${index}]`));
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFixtureKeys.has(key.toLowerCase())) fail(`${location}.${key} is a forbidden sensitive field`);
    scanKeys(child, `${location}.${key}`);
  }
};
scanKeys(fixture.recordings);

console.log(`W2 D materials validation passed: ${fixture.recordings.length} recordings, ${promptFiles.length} prompt/config/audit files, 0 sensitive matches`);
