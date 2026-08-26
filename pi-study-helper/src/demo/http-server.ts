import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createSafeAgentRunExport } from "../infrastructure/agent-run-export.js";
import type { AppBootstrapFacade } from "../contracts/index.js";
import type { LearningRuntimeFacade } from "../contracts/facade.js";
import type { DemoRuntime } from "./composition-root.js";

const MAX_BODY = 64 * 1024;
const PRIVATE_KEYS = new Set(["evidenceCandidate", "knowledgeStates", "pathCandidate", "activityProgress", "correctAnswer", "answerKey", "hiddenTests", "rubric", "referenceSolution"]);
const NOT_FOUND = new Set(["session_not_found", "activity_not_found", "attempt_not_found", "agent_run_not_found"]);
const CONFLICT = new Set(["profile_revision_conflict", "session_version_conflict", "idempotency_conflict", "activity_lifecycle_conflict", "activity_version_conflict", "draft_version_conflict", "path_version_conflict", "agent_run_conflict"]);
const UNPROCESSABLE = new Set(["diagnostic_incomplete", "diagnostic_answer_invalid", "diagnostic_answer_conflict", "evidence_invalid", "prerequisite_violation", "submission_contract_error"]);
const EVALUATOR = new Set(["environment_mismatch", "evaluator_error", "evaluator_start_failed", "evaluator_timeout", "dependency_missing", "test_asset_invalid", "result_protocol_invalid", "runner_crash"]);
const PUBLIC_RUN_PREPARATION_ERRORS = new Set(["environment_mismatch", "test_asset_invalid"]);

type JsonObject = Record<string, unknown>;
type RuntimeMethod = (input: any) => Promise<unknown>;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function invalidShape(message = "Request shape is invalid."): Error {
  return Object.assign(new Error(message), { transportStatus: 400, transportCode: "invalid_request_shape" });
}

function invalidSemantic(message = "Request semantics are invalid."): Error {
  return Object.assign(new Error(message), { transportStatus: 422, transportCode: "invalid_request_semantics" });
}

function exact(value: JsonObject, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || required.some((key) => !(key in value))) throw invalidShape();
}

function stringField(value: unknown, field: string, stable = false): string {
  if (typeof value !== "string" || value.length === 0 || (stable && !ID_PATTERN.test(value))) throw invalidShape(`Invalid ${field}.`);
  return value;
}

function integerField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidShape(`Invalid ${field}.`);
  return value;
}

function stringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0) || new Set(value).size !== value.length) throw invalidShape(`Invalid ${field}.`);
}

function enumField(value: unknown, field: string, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalidShape(`Invalid ${field}.`);
  return value;
}

function background(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidShape("Invalid background.");
  const item = value as JsonObject;
  exact(item, ["python_experience", "pandas_experience", "explanation_preference"]);
  enumField(item.python_experience, "python_experience", ["none", "basic", "comfortable", "uncertain"]);
  enumField(item.pandas_experience, "pandas_experience", ["none", "basic", "comfortable", "uncertain"]);
  enumField(item.explanation_preference, "explanation_preference", ["concise", "step_by_step", "example_first"]);
}

function writeMeta(value: JsonObject): void {
  exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision"]);
  stringField(value.requestId, "requestId", true);
  stringField(value.sessionId, "sessionId", true);
  integerField(value.sessionVersion, "sessionVersion");
  integerField(value.profileRevision, "profileRevision");
}

function readMeta(value: JsonObject): void {
  exact(value, ["sessionId", "sessionVersion", "profileRevision"]);
  stringField(value.sessionId, "sessionId", true);
  integerField(value.sessionVersion, "sessionVersion");
  integerField(value.profileRevision, "profileRevision");
}

function validateRequest(name: keyof LearningRuntimeFacade, value: JsonObject): void {
  switch (name) {
    case "startSession":
      exact(value, ["requestId", "subjectId", "mode", "goalId", "availableMinutes"], ["chapterId"]);
      stringField(value.requestId, "requestId", true); stringField(value.subjectId, "subjectId", true); stringField(value.goalId, "goalId", true);
      enumField(value.mode, "mode", ["recommended", "chapter"]); integerField(value.availableMinutes, "availableMinutes");
      if (value.chapterId !== undefined) stringField(value.chapterId, "chapterId", true);
      if (value.mode === "chapter" && value.chapterId === undefined) throw invalidSemantic("Chapter mode requires chapterId.");
      if (value.mode === "recommended" && value.chapterId !== undefined) throw invalidSemantic("Recommended mode cannot include chapterId.");
      return;
    case "recoverSession": case "completeSession":
      writeMeta(value); return;
    case "saveDiagnosticDraft":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "diagnosticId", "diagnosticVersion", "background", "diagnosticDraftVersion"], ["currentQuestionId"]);
      writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision });
      stringField(value.diagnosticId, "diagnosticId", true); integerField(value.diagnosticVersion, "diagnosticVersion"); background(value.background); integerField(value.diagnosticDraftVersion, "diagnosticDraftVersion");
      if (value.currentQuestionId !== undefined) stringField(value.currentQuestionId, "currentQuestionId", true);
      return;
    case "submitDiagnosticAnswer":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "diagnosticId", "diagnosticVersion", "questionId", "action", "diagnosticDraftVersion"], ["answer"]);
      writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision });
      stringField(value.diagnosticId, "diagnosticId", true); integerField(value.diagnosticVersion, "diagnosticVersion"); stringField(value.questionId, "questionId", true); integerField(value.diagnosticDraftVersion, "diagnosticDraftVersion");
      enumField(value.action, "action", ["answer", "skip"]);
      if (value.action === "answer" && typeof value.answer !== "string" && typeof value.answer !== "boolean") throw invalidShape("Invalid answer.");
      if (value.action === "skip" && value.answer !== undefined) throw invalidShape("Skipped answers cannot include answer.");
      return;
    case "completeDiagnostic":
      if (value.mode === "fixed") {
        exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "mode", "diagnosticId", "diagnosticVersion", "diagnosticDraftVersion"]);
        writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.diagnosticId, "diagnosticId", true); integerField(value.diagnosticVersion, "diagnosticVersion"); integerField(value.diagnosticDraftVersion, "diagnosticDraftVersion"); return;
      }
      if (value.mode === "background_only") {
        exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "mode", "background", "diagnosticDraftVersion"]);
        writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); background(value.background); integerField(value.diagnosticDraftVersion, "diagnosticDraftVersion"); return;
      }
      throw invalidShape("Invalid diagnostic completion mode.");
    case "buildPath":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "goalId", "mode", "availableMinutes", "evidenceVersion", "selectedKnowledgePointIds", "lockedNodeIds"], ["chapterId", "diagnosticSkipKnowledgePointIds"]);
      writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.goalId, "goalId", true); enumField(value.mode, "mode", ["recommended", "chapter"]); integerField(value.availableMinutes, "availableMinutes"); integerField(value.evidenceVersion, "evidenceVersion"); stringArray(value.selectedKnowledgePointIds, "selectedKnowledgePointIds"); if (value.diagnosticSkipKnowledgePointIds !== undefined) stringArray(value.diagnosticSkipKnowledgePointIds, "diagnosticSkipKnowledgePointIds"); stringArray(value.lockedNodeIds, "lockedNodeIds"); if (value.chapterId !== undefined) stringField(value.chapterId, "chapterId", true); if (value.mode === "chapter" && value.chapterId === undefined) throw invalidSemantic("Chapter mode requires chapterId."); if (value.mode === "recommended" && value.chapterId !== undefined) throw invalidSemantic("Recommended mode cannot include chapterId."); return;
    case "confirmPath":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "pathId", "pathVersion"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.pathId, "pathId", true); integerField(value.pathVersion, "pathVersion"); return;
    case "getNextStep":
      exact(value, ["sessionId", "sessionVersion", "profileRevision", "pathVersion"], ["nodeId"]); readMeta({ sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); integerField(value.pathVersion, "pathVersion"); if (value.nodeId !== undefined) stringField(value.nodeId, "nodeId", true); return;
    case "replanPath":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "pathVersion", "evidenceVersion", "trigger", "availableMinutes", "selectedKnowledgePointIds", "lockedNodeIds"], ["diagnosticSkipKnowledgePointIds"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); integerField(value.pathVersion, "pathVersion"); integerField(value.evidenceVersion, "evidenceVersion"); enumField(value.trigger, "trigger", ["knowledge_state_changed", "skip_eligibility_changed", "error_remediation", "user_constraint_changed"]); integerField(value.availableMinutes, "availableMinutes"); stringArray(value.selectedKnowledgePointIds, "selectedKnowledgePointIds"); if (value.diagnosticSkipKnowledgePointIds !== undefined) stringArray(value.diagnosticSkipKnowledgePointIds, "diagnosticSkipKnowledgePointIds"); stringArray(value.lockedNodeIds, "lockedNodeIds"); return;
    case "openActivity":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "activityId", "activityVersion", "pathVersion"], ["acknowledgedCardId", "relearn"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); integerField(value.activityVersion, "activityVersion"); integerField(value.pathVersion, "pathVersion"); if (value.acknowledgedCardId !== undefined) stringField(value.acknowledgedCardId, "acknowledgedCardId", true); if (value.relearn !== undefined && typeof value.relearn !== "boolean") throw invalidShape("Invalid relearn."); return;
    case "saveActivityDraft":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "activityId", "activityVersion", "attemptId", "draftVersion", "userText"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); integerField(value.activityVersion, "activityVersion"); stringField(value.attemptId, "attemptId", true); integerField(value.draftVersion, "draftVersion"); stringField(value.userText, "userText"); return;
    case "prepareActivityRun":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "activityId", "activityVersion", "attemptId", "draftVersion", "mode"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); integerField(value.activityVersion, "activityVersion"); stringField(value.attemptId, "attemptId", true); integerField(value.draftVersion, "draftVersion"); enumField(value.mode, "mode", ["preview"]); return;
    case "submitActivity":
      if (value.kind === "code") { exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "kind", "activityId", "activityVersion", "attemptId", "draftVersion", "userText"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); integerField(value.activityVersion, "activityVersion"); stringField(value.attemptId, "attemptId", true); integerField(value.draftVersion, "draftVersion"); stringField(value.userText, "userText"); return; }
      if (value.kind === "quiz") { exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "kind", "activityId", "activityVersion", "attemptId", "answers"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); integerField(value.activityVersion, "activityVersion"); stringField(value.attemptId, "attemptId", true); if (!Array.isArray(value.answers) || value.answers.some((answer) => typeof answer !== "object" || answer === null || Array.isArray(answer) || Object.keys(answer as JsonObject).some((key) => !["questionId", "answer"].includes(key)) || !("questionId" in (answer as JsonObject)) || !["string", "boolean"].includes(typeof (answer as JsonObject).answer) || typeof (answer as JsonObject).questionId !== "string")) throw invalidShape("Invalid quiz answers."); return; }
      throw invalidShape("Invalid activity kind.");
    case "continueActivityWithGap":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "activityId", "attemptId"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); stringField(value.attemptId, "attemptId", true); return;
    case "getActivityAttempt": case "recoverActivity":
      exact(value, ["sessionId", "sessionVersion", "profileRevision", "activityId", "attemptId"]); readMeta({ sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); stringField(value.activityId, "activityId", true); stringField(value.attemptId, "attemptId", true); return;
    case "askContextQuestion":
      exact(value, ["requestId", "sessionId", "sessionVersion", "profileRevision", "pathVersion", "nodeId", "question"], ["activityId"]); writeMeta({ requestId: value.requestId, sessionId: value.sessionId, sessionVersion: value.sessionVersion, profileRevision: value.profileRevision }); integerField(value.pathVersion, "pathVersion"); stringField(value.nodeId, "nodeId", true); stringField(value.question, "question"); if (value.activityId !== undefined) stringField(value.activityId, "activityId", true); return;
  }
}

function invalidQuery(): Error {
  return Object.assign(new Error("invalid query"), { transportStatus: 400, transportCode: "invalid_query" });
}

function assertQueryKeys(searchParams: URLSearchParams, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of searchParams.keys()) if (!allowedKeys.has(key)) throw invalidQuery();
}

function requiredQuery(searchParams: URLSearchParams, name: string): string {
  const values = searchParams.getAll(name);
  if (values.length !== 1 || values[0] === "") throw invalidQuery();
  return values[0]!;
}

function optionalQuery(searchParams: URLSearchParams, name: string): string | undefined {
  const values = searchParams.getAll(name);
  if (values.length > 1 || values[0] === "") throw invalidQuery();
  return values[0];
}

function requiredIntegerQuery(searchParams: URLSearchParams, name: string): number {
  const raw = requiredQuery(searchParams, name);
  if (!/^(0|[1-9]\d*)$/u.test(raw)) throw invalidQuery();
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw invalidQuery();
  return value;
}

function readRequestMeta(searchParams: URLSearchParams, sessionId: string): JsonObject {
  return {
    sessionId,
    sessionVersion: requiredIntegerQuery(searchParams, "sessionVersion"),
    profileRevision: requiredIntegerQuery(searchParams, "profileRevision"),
  };
}

function requestId(request: IncomingMessage): string {
  const header = request.headers["x-request-id"];
  return typeof header === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(header) ? header : `http-${randomUUID()}`;
}

const API_SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function send(response: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    ...API_SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.byteLength,
    "cache-control": "no-store",
  });
  response.end(bytes);
}

function safeError(error: unknown): { code: string; status: number } {
  const code = typeof error === "object" && error !== null
    ? "errorCode" in error && typeof error.errorCode === "string" ? error.errorCode
      : "code" in error && typeof error.code === "string" ? error.code : "internal_error"
    : "internal_error";
  if (NOT_FOUND.has(code)) return { code, status: 404 };
  if (CONFLICT.has(code)) return { code, status: 409 };
  if (UNPROCESSABLE.has(code)) return { code, status: 422 };
  if (code === "invalid_profile" || code === "storage_error") return { code, status: 500 };
  return { code, status: 500 };
}

async function body(request: IncomingMessage): Promise<JsonObject> {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw Object.assign(new Error("invalid content type"), { transportStatus: 400, transportCode: "invalid_content_type" });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY) throw Object.assign(new Error("request too large"), { transportStatus: 400, transportCode: "request_too_large" });
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("invalid json"), { transportStatus: 400, transportCode: "invalid_json" }); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw Object.assign(new Error("request shape invalid"), { transportStatus: 400, transportCode: "invalid_request_shape" });
  const value = parsed as JsonObject;
  if ([...PRIVATE_KEYS].some((key) => key in value)) throw Object.assign(new Error("private request field"), { transportStatus: 400, transportCode: "invalid_request_shape" });
  return value;
}

function withRequestId(value: JsonObject, id: string): JsonObject {
  if (value.requestId !== undefined && (typeof value.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.requestId))) {
    throw Object.assign(new Error("requestId invalid"), { transportStatus: 400, transportCode: "invalid_request_shape" });
  }
  return { ...value, requestId: value.requestId ?? id };
}

type RouteTarget = { name?: keyof LearningRuntimeFacade; call: (runtime: DemoRuntime, value: JsonObject, id: string) => Promise<unknown> };

function route(url: URL, method: string): RouteTarget | undefined {
  const { pathname, searchParams } = url;
  const call = (name: keyof LearningRuntimeFacade, extra: (value: JsonObject, id: string) => JsonObject = (value, id) => withRequestId(value, id)): RouteTarget => ({ name, call: (runtime: DemoRuntime, value: JsonObject, id: string) => {
    const prepared = extra(value, id);
    validateRequest(name, prepared);
    return (runtime.facade[name] as unknown as RuntimeMethod)(prepared);
  } });
  if (method === "GET" && pathname === "/api/bootstrap") return { call: (runtime) => {
    assertQueryKeys(searchParams, ["recoverSessionId"]);
    return runtime.bootstrap.getBootstrap({ recoverSessionId: optionalQuery(searchParams, "recoverSessionId") });
  } };
  let match: RegExpMatchArray | null;
  if ((match = pathname.match(/^\/api\/agent-runs\/by-request\/([^/]+)$/u)) && method === "GET") return { call: async (runtime) => {
    assertQueryKeys(searchParams, []);
    const targetRequestId = decodeURIComponent(match![1]!);
    if (!ID_PATTERN.test(targetRequestId)) throw invalidQuery();
    const run = await runtime.agentRuns.getByRequestId(targetRequestId);
    if (run === undefined) throw Object.assign(new Error("Agent run not found"), { errorCode: "agent_run_not_found" });
    return run;
  } };
  if ((match = pathname.match(/^\/api\/agent-runs\/([^/]+)\/export$/u)) && method === "GET") return { call: async (runtime) => {
    assertQueryKeys(searchParams, []);
    const runId = decodeURIComponent(match![1]!);
    if (!ID_PATTERN.test(runId)) throw invalidQuery();
    const run = await runtime.agentRuns.getByRunId(runId);
    if (run === undefined) throw Object.assign(new Error("Agent run not found"), { errorCode: "agent_run_not_found" });
    return createSafeAgentRunExport(run, new Date().toISOString());
  } };
  if ((match = pathname.match(/^\/api\/agent-runs\/([^/]+)$/u)) && method === "GET") return { call: async (runtime) => {
    assertQueryKeys(searchParams, []);
    const runId = decodeURIComponent(match![1]!);
    if (!ID_PATTERN.test(runId)) throw invalidQuery();
    const run = await runtime.agentRuns.getByRunId(runId);
    if (run === undefined) throw Object.assign(new Error("Agent run not found"), { errorCode: "agent_run_not_found" });
    return run;
  } };
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/learning-cards\/([^/]+)\/personalized-tip$/u)) && method === "POST") return {
    call: (runtime, value, id) => {
      const prepared = withRequestId({
        ...value,
        sessionId: decodeURIComponent(match![1]!),
        nodeId: decodeURIComponent(match![2]!),
      }, id);
      exact(prepared, ["requestId", "sessionId", "sessionVersion", "profileRevision", "pathVersion", "nodeId"]);
      writeMeta({ requestId: prepared.requestId, sessionId: prepared.sessionId, sessionVersion: prepared.sessionVersion, profileRevision: prepared.profileRevision });
      integerField(prepared.pathVersion, "pathVersion");
      stringField(prepared.nodeId, "nodeId", true);
      return runtime.personalizedTips.prepare(prepared as unknown as import("../contracts/facade.js").PreparePersonalizedTipInput);
    },
  };
  if (method === "POST" && pathname === "/api/sessions") return call("startSession");
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/recover$/u)) && method === "POST") return call("recoverSession", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/complete$/u)) && method === "POST") return call("completeSession", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/diagnostic\/draft$/u)) && method === "POST") return call("saveDiagnosticDraft", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/diagnostic\/answers$/u)) && method === "POST") return call("submitDiagnosticAnswer", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/diagnostic\/complete$/u)) && method === "POST") return call("completeDiagnostic", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/path$/u)) && method === "POST") return call("buildPath", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/path\/confirm$/u)) && method === "POST") return call("confirmPath", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/next-step$/u)) && method === "GET") return call("getNextStep", () => {
    assertQueryKeys(searchParams, ["sessionVersion", "profileRevision", "pathVersion", "nodeId"]);
    const nodeId = searchParams.get("nodeId") ?? undefined;
    if (nodeId !== undefined && !ID_PATTERN.test(nodeId)) throw invalidQuery();
    return { ...readRequestMeta(searchParams, match![1]!), pathVersion: requiredIntegerQuery(searchParams, "pathVersion"), ...(nodeId === undefined ? {} : { nodeId }) };
  });
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/path\/replan$/u)) && method === "POST") return call("replanPath", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/open$/u)) && method === "POST") return call("openActivity", (v, id) => withRequestId({ ...v, activityId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/draft$/u)) && method === "POST") return call("saveActivityDraft", (v, id) => withRequestId({ ...v, activityId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/run$/u)) && method === "POST") return call("prepareActivityRun", (v, id) => withRequestId({ ...v, activityId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/submit$/u)) && method === "POST") return call("submitActivity", (v, id) => withRequestId({ ...v, activityId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/continue-with-gap$/u)) && method === "POST") return call("continueActivityWithGap", (v, id) => withRequestId({ ...v, activityId: match![1] }, id));
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/attempts\/([^/]+)$/u)) && method === "GET") return call("getActivityAttempt", () => {
    assertQueryKeys(searchParams, ["sessionId", "sessionVersion", "profileRevision"]);
    const sessionId = requiredQuery(searchParams, "sessionId");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId)) throw invalidQuery();
    return { ...readRequestMeta(searchParams, sessionId), activityId: match![1], attemptId: match![2] };
  });
  if ((match = pathname.match(/^\/api\/activities\/([^/]+)\/recover$/u)) && method === "POST") return call("recoverActivity", (v) => ({ ...v, activityId: match![1] }));
  if ((match = pathname.match(/^\/api\/sessions\/([^/]+)\/context-questions$/u)) && method === "POST") return call("askContextQuestion", (v, id) => withRequestId({ ...v, sessionId: match![1] }, id));
  return undefined;
}

export interface HttpServerHandle {
  server: Server;
  ready: Promise<DemoRuntime>;
  close(): Promise<void>;
}

async function serveAgentRunEvents(
  runtime: DemoRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method !== "GET") return false;
  const match = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/events$/u);
  if (match === null) return false;
  assertQueryKeys(url.searchParams, ["after"]);
  const runId = decodeURIComponent(match[1]!);
  if (!ID_PATTERN.test(runId)) throw invalidQuery();
  const after = url.searchParams.has("after") ? requiredIntegerQuery(url.searchParams, "after") : 0;
  const initial = await runtime.agentRuns.getByRunId(runId);
  if (initial === undefined) {
    send(response, 404, { error: { code: "agent_run_not_found", message: "Agent run not found." } });
    return true;
  }
  response.writeHead(200, {
    ...API_SECURITY_HEADERS,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
  let lastSequence = after;
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const terminal = (status: string) => status === "succeeded" || status === "failed" || status === "fallback";
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat !== undefined) clearInterval(heartbeat);
    response.end();
  };
  const push = (run: Awaited<ReturnType<DemoRuntime["agentRuns"]["getByRunId"]>>, force = false) => {
    if (run === undefined || closed) return;
    const sequence = run.stages.at(-1)?.sequence ?? 0;
    if (!force && sequence <= lastSequence && !terminal(run.status)) return;
    lastSequence = Math.max(lastSequence, sequence);
    response.write(`id: ${lastSequence}\nevent: run\ndata: ${JSON.stringify(run)}\n\n`);
    if (terminal(run.status)) close();
  };
  unsubscribe = runtime.agentRuns.subscribe(runId, push);
  request.once("close", close);
  heartbeat = setInterval(() => { if (!closed) response.write(": heartbeat\n\n"); }, 15_000);
  push(await runtime.agentRuns.getByRunId(runId), true);
  return true;
}

export function startHttpServer(runtimePromise: Promise<DemoRuntime>, port = 4310): HttpServerHandle {
  let runtime: DemoRuntime | undefined;
  let initializationError = false;
  const runtimeReady = runtimePromise.then((value) => { runtime = value; return value; }, (error) => { initializationError = true; throw error; });
  const server = createServer(async (request, response) => {
    const id = requestId(request);
    if (runtime === undefined) { send(response, 503, { requestId: id, error: { code: initializationError ? "initialization_failed" : "initialization_not_ready", message: "Service initialization is not ready." } }); return; }
    let target: RouteTarget | undefined;
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (await serveAgentRunEvents(runtime, request, response, url)) return;
      target = route(url, request.method ?? "GET");
      if (target === undefined) { send(response, 404, { requestId: id, error: { code: "not_found", message: "Resource not found." } }); return; }
      const input = request.method === "GET" ? {} : await body(request);
      const data = await target.call(runtime, input, id);
      const status = typeof data === "object" && data !== null && "contentReadiness" in data && data.contentReadiness === "preparing" ? 202 : 200;
      send(response, status, { requestId: id, data });
    } catch (error) {
      const transport = error as { transportStatus?: number; transportCode?: string };
      if (transport.transportStatus !== undefined) { send(response, transport.transportStatus, { requestId: id, error: { code: transport.transportCode ?? "invalid_request", message: "Request format is invalid." } }); return; }
      const mapped = safeError(error);
      if (target?.name === "prepareActivityRun" && PUBLIC_RUN_PREPARATION_ERRORS.has(mapped.code)) {
        send(response, 500, { requestId: id, error: { code: mapped.code, message: "The public preview could not be prepared." } });
        return;
      }
      if (EVALUATOR.has(mapped.code)) {
        send(response, 200, { requestId: id, data: { status: "evaluator_error", errorCode: mapped.code, verdict: "not_graded" } });
        return;
      }
      send(response, mapped.status, { requestId: id, error: { code: mapped.code, message: "The request could not be completed." } });
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  const listenReady = new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port }, () => resolveListen());
  });
  const ready = Promise.all([runtimeReady, listenReady]).then(([value]) => value);
  return { server, ready, close: async () => {
    await runtime?.close();
    if (!server.listening) return;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  } };
}
