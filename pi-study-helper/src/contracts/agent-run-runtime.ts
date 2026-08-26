import {
  AGENT_STAGE_ROLES,
  PUBLIC_RECOMMENDATION_MAX_LENGTH,
  type AgentRunStatus,
  type AgentStageRole,
  type AgentStageStatus,
  type SafeAgentMetricView,
  type SafeAgentRunView,
  type SafeAgentStageView,
  type QuizRemediationSafeView,
} from "./agent-run.js";

const RUN_KEYS = new Set([
  "runId", "requestId", "sessionId", "activityId", "profileRevision", "pathVersion",
  "evidenceVersion", "status", "currentStage", "startedAt", "finishedAt", "durationMs",
  "resultOrigin", "questionCount", "artifactSha256", "fallbackReasonCode", "remediation", "stages",
]);
const STAGE_KEYS = new Set([
  "eventId", "sequence", "role", "label", "status", "startedAt", "finishedAt", "durationMs",
  "attemptNumber", "publicSummary", "metrics", "issueCategories", "decision", "sourceClaimIds",
]);
const METRIC_KEYS = new Set(["metricId", "label", "value", "tone"]);
const REMEDIATION_KEYS = new Set([
  "lessonVariantId", "previousAttemptId", "missedQuestionCount", "weakKnowledgePointIds",
  "learnerProfileSource", "publicRecommendation", "evidenceVersion", "evidenceRefCount",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ROLES = new Set<string>(AGENT_STAGE_ROLES);
const RUN_STATUSES = new Set<AgentRunStatus>(["queued", "running", "succeeded", "failed", "fallback"]);
const STAGE_STATUSES = new Set<AgentStageStatus>([
  "queued", "running", "succeeded", "revised", "rejected", "failed", "fallback", "skipped",
]);
const TERMINAL_STAGE_STATUSES = new Set<AgentStageStatus>([
  "succeeded", "revised", "rejected", "failed", "fallback", "skipped",
]);
const ALLOWED_ROLE_TRANSITIONS: Readonly<Record<AgentStageRole, ReadonlySet<AgentStageRole>>> = {
  source: new Set(["source", "profile"]),
  profile: new Set(["profile", "generator"]),
  generator: new Set(["generator", "safety", "publish"]),
  safety: new Set(["safety", "generator", "hunter", "publish"]),
  hunter: new Set(["hunter", "generator", "defender", "judge", "publish"]),
  defender: new Set(["defender", "generator", "judge", "publish"]),
  judge: new Set(["judge", "generator", "publish"]),
  publish: new Set(["publish"]),
};

export class SafeAgentContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SafeAgentContractError";
  }
}

function fail(code: string, message: string): never {
  throw new SafeAgentContractError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, scope: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail("UNKNOWN_FIELD", `${scope}.${unknown}不在公共合同白名单中`);
}

function requiredString(value: unknown, field: string, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    fail("INVALID_STRING", `${field}必须是1至${maxLength}个字符`);
  }
  if (pattern && !pattern.test(value)) fail("INVALID_FORMAT", `${field}格式非法`);
  assertSafePublicText(value, field);
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number, pattern?: RegExp): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, maxLength, pattern);
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail("INVALID_INTEGER", `${field}必须是${min}至${max}之间的整数`);
  }
  return value as number;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) fail("INVALID_ENUM", `${field}枚举值非法`);
  return value as T;
}

function isoDate(value: unknown, field: string): string {
  const text = requiredString(value, field, 32, ISO_DATE_PATTERN);
  if (!Number.isFinite(Date.parse(text))) fail("INVALID_DATE", `${field}不是有效UTC时间`);
  return text;
}

function assertSafePublicText(value: string, field: string): void {
  const forbidden: Array<[string, RegExp]> = [
    ["SECRET_LEAK", /(?:\bsk-[A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._~-]{12,}|api[_ -]?key\s*[:=]\s*\S+)/i],
    ["PROMPT_LEAK", /(?:(?:system|developer|hidden)\s*prompt|系统提示词|开发者提示词)\s*[:：=]/i],
    ["ANSWER_LEAK", /(?:正确答案|标准答案|answer\s*key|correct\s*answer)\s*[:：=]\s*\S+/i],
    ["ABSOLUTE_PATH_LEAK", /(?:\b[A-Za-z]:[\\/]|\/(?:Users|home|root|etc|var|tmp)\/)/],
  ];
  const found = forbidden.find(([, pattern]) => pattern.test(value));
  if (found) fail(found[0], `${field}包含禁止进入公共DTO的敏感内容`);
}

function parseStringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) fail("INVALID_ARRAY", `${field}最多允许${maxItems}项`);
  const parsed = value.map((item, index) => requiredString(item, `${field}[${index}]`, maxLength));
  if (new Set(parsed).size !== parsed.length) fail("DUPLICATE_VALUE", `${field}不允许重复项`);
  return parsed;
}

function parseMetric(value: unknown, index: number): SafeAgentMetricView {
  if (!isRecord(value)) fail("INVALID_OBJECT", `metrics[${index}]必须是对象`);
  assertOnlyKeys(value, METRIC_KEYS, `metrics[${index}]`);
  return {
    metricId: requiredString(value.metricId, `metrics[${index}].metricId`, 48, ID_PATTERN),
    label: requiredString(value.label, `metrics[${index}].label`, 32),
    value: requiredString(value.value, `metrics[${index}].value`, 96),
    tone: enumValue(value.tone, new Set(["neutral", "success", "warning", "danger"]), `metrics[${index}].tone`),
  };
}

export function parseQuizRemediationSafeView(value: unknown): QuizRemediationSafeView {
  if (!isRecord(value)) fail("INVALID_OBJECT", "remediation必须是对象");
  assertOnlyKeys(value, REMEDIATION_KEYS, "remediation");
  return {
    lessonVariantId: enumValue(value.lessonVariantId, new Set(["guided", "concise", "practice"]), "remediation.lessonVariantId"),
    previousAttemptId: requiredString(value.previousAttemptId, "remediation.previousAttemptId", 96, ID_PATTERN),
    missedQuestionCount: boundedInteger(value.missedQuestionCount, "remediation.missedQuestionCount", 1, 20),
    weakKnowledgePointIds: parseStringArray(value.weakKnowledgePointIds, "remediation.weakKnowledgePointIds", 20, 96),
    learnerProfileSource: enumValue(value.learnerProfileSource, new Set(["agent", "deterministic"]), "remediation.learnerProfileSource"),
    publicRecommendation: requiredString(value.publicRecommendation, "remediation.publicRecommendation", PUBLIC_RECOMMENDATION_MAX_LENGTH),
    evidenceVersion: boundedInteger(value.evidenceVersion, "remediation.evidenceVersion", 0, 1_000_000),
    evidenceRefCount: boundedInteger(value.evidenceRefCount, "remediation.evidenceRefCount", 0, 10_000),
  };
}

export function parseSafeAgentStageView(value: unknown): SafeAgentStageView {
  if (!isRecord(value)) fail("INVALID_OBJECT", "工位事件必须是对象");
  assertOnlyKeys(value, STAGE_KEYS, "stage");
  if (!Array.isArray(value.metrics) || value.metrics.length > 12) fail("INVALID_ARRAY", "metrics最多允许12项");
  const metrics = value.metrics.map(parseMetric);
  if (new Set(metrics.map((metric) => metric.metricId)).size !== metrics.length) {
    fail("DUPLICATE_METRIC", "同一事件的metricId不得重复");
  }
  const startedAt = isoDate(value.startedAt, "stage.startedAt");
  const finishedAt = optionalString(value.finishedAt, "stage.finishedAt", 32, ISO_DATE_PATTERN);
  const durationMs = value.durationMs === undefined ? undefined : boundedInteger(value.durationMs, "stage.durationMs", 0, 3_600_000);
  if (finishedAt && Date.parse(finishedAt) < Date.parse(startedAt)) fail("INVALID_TIME_RANGE", "工位完成时间早于开始时间");
  if ((finishedAt === undefined) !== (durationMs === undefined)) fail("INCOMPLETE_TIMING", "finishedAt与durationMs必须同时出现");
  const status = enumValue(value.status, STAGE_STATUSES, "stage.status");
  if ((status === "queued" || status === "running") && finishedAt) fail("INVALID_TIMING_STATE", "等待或运行中事件不能包含完成时间");
  if (TERMINAL_STAGE_STATUSES.has(status) && !finishedAt) fail("INVALID_TIMING_STATE", "终态事件必须包含完成时间和耗时");
  return {
    eventId: requiredString(value.eventId, "stage.eventId", 96, ID_PATTERN),
    sequence: boundedInteger(value.sequence, "stage.sequence", 1, 10_000),
    role: enumValue(value.role, ROLES as ReadonlySet<AgentStageRole>, "stage.role"),
    label: requiredString(value.label, "stage.label", 40),
    status,
    startedAt,
    ...(finishedAt ? { finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    attemptNumber: boundedInteger(value.attemptNumber, "stage.attemptNumber", 1, 20),
    publicSummary: requiredString(value.publicSummary, "stage.publicSummary", 600),
    metrics,
    issueCategories: parseStringArray(value.issueCategories, "stage.issueCategories", 12, 48),
    ...(value.decision === undefined ? {} : { decision: enumValue(value.decision, new Set<"accepted" | "revise" | "rejected">(["accepted", "revise", "rejected"]), "stage.decision") }),
    sourceClaimIds: parseStringArray(value.sourceClaimIds, "stage.sourceClaimIds", 32, 96),
  };
}

function assertEventSequence(stages: readonly SafeAgentStageView[]): void {
  const eventIds = new Set<string>();
  let previous: SafeAgentStageView | undefined;
  for (const [index, stage] of stages.entries()) {
    if (stage.sequence !== index + 1) fail("INVALID_SEQUENCE", `事件sequence必须从1连续递增，当前为${stage.sequence}`);
    if (eventIds.has(stage.eventId)) fail("DUPLICATE_EVENT", `eventId重复：${stage.eventId}`);
    eventIds.add(stage.eventId);
    if (!previous) {
      if (stage.role !== "source") fail("INVALID_ROLE_TRANSITION", "首个工位事件必须从教学依据开始");
      previous = stage;
      continue;
    }
    if (!ALLOWED_ROLE_TRANSITIONS[previous.role].has(stage.role)) {
      fail("INVALID_ROLE_TRANSITION", `不允许从${previous.role}跳转到${stage.role}`);
    }
    if (stage.role === previous.role && stage.attemptNumber < previous.attemptNumber) {
      fail("INVALID_ATTEMPT", "同一工位的attemptNumber不得倒退");
    }
    if (stage.role === previous.role && stage.attemptNumber === previous.attemptNumber) {
      const valid = (previous.status === "queued" && stage.status === "running")
        || (previous.status === "running" && TERMINAL_STAGE_STATUSES.has(stage.status));
      if (!valid) fail("INVALID_STAGE_TRANSITION", `同一工位同一轮次不允许从${previous.status}变为${stage.status}`);
    }
    if (Date.parse(stage.startedAt) < Date.parse(previous.startedAt)) fail("INVALID_EVENT_TIME", "事件开始时间不得倒退");
    previous = stage;
  }
}

export function parseSafeAgentRunView(value: unknown): SafeAgentRunView {
  if (!isRecord(value)) fail("INVALID_OBJECT", "Agent运行视图必须是对象");
  assertOnlyKeys(value, RUN_KEYS, "run");
  if (!Array.isArray(value.stages) || value.stages.length > 128) fail("INVALID_ARRAY", "stages最多允许128项");
  const stages = value.stages.map(parseSafeAgentStageView);
  assertEventSequence(stages);
  const status = enumValue(value.status, RUN_STATUSES, "run.status");
  const startedAt = isoDate(value.startedAt, "run.startedAt");
  const finishedAt = optionalString(value.finishedAt, "run.finishedAt", 32, ISO_DATE_PATTERN);
  const durationMs = value.durationMs === undefined ? undefined : boundedInteger(value.durationMs, "run.durationMs", 0, 3_600_000);
  if ((finishedAt === undefined) !== (durationMs === undefined)) fail("INCOMPLETE_TIMING", "run.finishedAt与run.durationMs必须同时出现");
  if ((status === "queued" || status === "running") && finishedAt) fail("INVALID_TIMING_STATE", "等待或运行中的run不能包含完成时间");
  if (!RUN_STATUSES.has(status)) fail("INVALID_ENUM", "run.status非法");
  if (["succeeded", "failed", "fallback"].includes(status) && !finishedAt) fail("INVALID_TIMING_STATE", "终态run必须包含完成时间和耗时");
  if (finishedAt && Date.parse(finishedAt) < Date.parse(startedAt)) fail("INVALID_TIME_RANGE", "run完成时间早于开始时间");
  const currentStage = enumValue(value.currentStage, ROLES as ReadonlySet<AgentStageRole>, "run.currentStage");
  if (stages.length > 0 && currentStage !== stages.at(-1)!.role) fail("CURRENT_STAGE_MISMATCH", "currentStage必须与最后一条事件一致");
  if (stages.some((stage) => Date.parse(stage.startedAt) < Date.parse(startedAt))) fail("INVALID_EVENT_TIME", "工位事件早于run开始时间");
  const resultOrigin = enumValue(value.resultOrigin, new Set<SafeAgentRunView["resultOrigin"]>(["ai_live", "ai_recorded", "profile_fixed", "unknown"]), "run.resultOrigin");
  const fallbackReasonCode = optionalString(value.fallbackReasonCode, "run.fallbackReasonCode", 64, ID_PATTERN);
  if (status === "fallback" && (resultOrigin !== "profile_fixed" || !fallbackReasonCode)) {
    fail("INVALID_FALLBACK", "fallback必须声明profile_fixed来源和原因码");
  }
  return {
    runId: requiredString(value.runId, "run.runId", 96, ID_PATTERN),
    requestId: requiredString(value.requestId, "run.requestId", 96, ID_PATTERN),
    sessionId: requiredString(value.sessionId, "run.sessionId", 96, ID_PATTERN),
    activityId: requiredString(value.activityId, "run.activityId", 96, ID_PATTERN),
    profileRevision: boundedInteger(value.profileRevision, "run.profileRevision", 1, 1_000),
    pathVersion: boundedInteger(value.pathVersion, "run.pathVersion", 1, 1_000_000),
    evidenceVersion: boundedInteger(value.evidenceVersion, "run.evidenceVersion", 0, 1_000_000),
    status,
    currentStage,
    startedAt,
    ...(finishedAt ? { finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    resultOrigin,
    questionCount: boundedInteger(value.questionCount, "run.questionCount", 0, 20),
    ...(value.artifactSha256 === undefined ? {} : { artifactSha256: requiredString(value.artifactSha256, "run.artifactSha256", 64, SHA256_PATTERN) }),
    ...(fallbackReasonCode ? { fallbackReasonCode } : {}),
    ...(value.remediation === undefined ? {} : { remediation: parseQuizRemediationSafeView(value.remediation) }),
    stages,
  };
}

function projectMetric(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { metricId: value.metricId, label: value.label, value: value.value, tone: value.tone };
}

/** Copies only public fields. Private trace fields are deliberately ignored before validation. */
export function projectSafeAgentStageView(privateTrace: unknown): SafeAgentStageView {
  if (!isRecord(privateTrace)) fail("INVALID_OBJECT", "私有trace必须是对象");
  const projected: Record<string, unknown> = {};
  for (const key of STAGE_KEYS) {
    if (privateTrace[key] !== undefined) projected[key] = key === "metrics" && Array.isArray(privateTrace[key])
      ? privateTrace[key].map(projectMetric)
      : privateTrace[key];
  }
  return parseSafeAgentStageView(projected);
}

export function appendSafeAgentStage(
  run: SafeAgentRunView,
  nextEvent: unknown,
  nextRunStatus: AgentRunStatus = "running",
): SafeAgentRunView {
  if (["succeeded", "failed", "fallback"].includes(run.status)) fail("RUN_ALREADY_TERMINAL", "终态run不能继续追加事件");
  const stage = parseSafeAgentStageView(nextEvent);
  const candidate: SafeAgentRunView = {
    ...run,
    status: nextRunStatus,
    currentStage: stage.role,
    stages: [...run.stages, stage],
  };
  return parseSafeAgentRunView(candidate);
}
