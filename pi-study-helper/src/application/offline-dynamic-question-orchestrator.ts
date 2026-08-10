import type { ModelExecutionPort } from "../infrastructure/model-execution-port.js";

export type DynamicQuestion =
  | {
    artifactId: string;
    kind: "single_choice";
    prompt: string;
    options: string[];
    sourceAnchorIds: string[];
    rationale: string;
  }
  | {
    artifactId: string;
    kind: "judgment";
    prompt: string;
    sourceAnchorIds: string[];
    rationale: string;
  };

export type OfflineDynamicQuestionReason =
  | "recorded_response_accepted"
  | "permission_denied"
  | "invalid_output"
  | "timeout"
  | "provider_error";

export interface OfflineDynamicQuestionInput {
  runId: string;
  profileRevision: number;
  promptVersion: string;
  safeContext: Readonly<Record<string, unknown>>;
}

export interface OfflineDynamicQuestionResult {
  status: "accepted" | "fallback";
  reasonCode: OfflineDynamicQuestionReason;
  question: DynamicQuestion;
  usedFallback: boolean;
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FORBIDDEN_KEYS = new Set([
  "activityresult",
  "answerkey",
  "apikey",
  "correctanswer",
  "diagnosticanswer",
  "evidence",
  "gold",
  "hiddentest",
  "hiddentests",
  "hostpath",
  "knowledgestate",
  "mastery",
  "path",
  "privatecsv",
  "rawannotation",
  "rawannotations",
  "referenceimplementation",
  "referenceimplementations",
  "rubric",
  "score",
  "secret",
  "systempath",
]);
const FORBIDDEN_TEXT = [
  /(?:sk|api)[-_][A-Za-z0-9]{12,}/u,
  /[A-Za-z]:[\\/][^\s]*/u,
  /\\\\[^\\/\s]+[\\/][^\s]*/u,
  /\/(?:home|Users|tmp)\/[A-Za-z0-9._-]+(?:[\\/]\S*)?/iu,
  /\bAuthorization\s*:\s*Bearer\s+\S+/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/u,
  /\b(?:accessToken|apiKey|authorization|secret|password)\s*[:=]\s*\S+/iu,
];

const FALLBACK_QUESTION: DynamicQuestion = {
  artifactId: "w3-fixed-fallback-columns",
  kind: "single_choice",
  prompt: "Which DataFrame attribute lists its column labels?",
  options: ["df.columns", "df.names", "df.fields"],
  sourceAnchorIds: ["src-pandas-columns"],
  rationale: "This pre-reviewed question uses only the registered public Pandas summary.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && [...expected].sort().every((key, index) => key === keys[index]);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function isStableIdList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 16
    && value.every(isStableId)
    && new Set(value).size === value.length;
}

function isSafeText(value: unknown, maximum = 800): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z]/giu, "").toLowerCase();
}

function isSafeContext(value: Readonly<Record<string, unknown>>): boolean {
  if (!hasExactKeys(value, ["knowledgePointId", "targetDifficulty", "sourceIds", "publicSourceSummary"])) {
    return false;
  }
  return isStableId(value.knowledgePointId)
    && isSafeText(value.targetDifficulty, 160)
    && isStableIdList(value.sourceIds)
    && isSafeText(value.publicSourceSummary);
}

export function containsAgentAuthorityViolation(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof value === "string") return FORBIDDEN_TEXT.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some((item) => containsAgentAuthorityViolation(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    FORBIDDEN_KEYS.has(normalizedKey(key)) || containsAgentAuthorityViolation(item, depth + 1));
}

export function isDynamicQuestion(value: unknown): value is DynamicQuestion {
  if (!isRecord(value) || containsAgentAuthorityViolation(value)) return false;
  const common = ["artifactId", "kind", "prompt", "sourceAnchorIds", "rationale"];
  if (!isStableId(value.artifactId)
    || !isSafeText(value.prompt)
    || !isSafeText(value.rationale)
    || !isStableIdList(value.sourceAnchorIds)) return false;
  if (value.kind === "judgment") return hasExactKeys(value, common);
  if (value.kind !== "single_choice" || !hasExactKeys(value, [...common, "options"])) return false;
  return Array.isArray(value.options)
    && value.options.length >= 3
    && value.options.length <= 5
    && value.options.every((option) => isSafeText(option, 160))
    && new Set(value.options).size === value.options.length;
}

function cloneQuestion(question: DynamicQuestion): DynamicQuestion {
  return JSON.parse(JSON.stringify(question)) as DynamicQuestion;
}

export function fixedDynamicQuestionFallback(): DynamicQuestion {
  return cloneQuestion(FALLBACK_QUESTION);
}

export class OfflineDynamicQuestionOrchestrator {
  readonly #modelExecutionPort: ModelExecutionPort;

  constructor(modelExecutionPort: ModelExecutionPort) {
    this.#modelExecutionPort = modelExecutionPort;
  }

  async run(input: OfflineDynamicQuestionInput, signal: AbortSignal): Promise<OfflineDynamicQuestionResult> {
    if (!isSafeContext(input.safeContext) || containsAgentAuthorityViolation(input.safeContext)) {
      return this.#fallback("permission_denied");
    }
    const execution = await this.#modelExecutionPort.execute({
      graphId: "dynamic-objective-question",
      runId: input.runId,
      profileRevision: input.profileRevision,
      promptVersion: input.promptVersion,
      safeContext: input.safeContext,
      budget: { timeoutMs: 60_000 },
    }, signal);
    if (execution.status === "timeout") return this.#fallback("timeout");
    if (execution.status === "provider_error") return this.#fallback("provider_error");
    if (execution.status === "invalid_output") return this.#fallback("invalid_output");
    if (containsAgentAuthorityViolation(execution.payload)) return this.#fallback("permission_denied");
    if (!isDynamicQuestion(execution.payload)) return this.#fallback("invalid_output");
    const contextSourceIds = Array.isArray(input.safeContext.sourceIds)
      && input.safeContext.sourceIds.every(isStableId) ? input.safeContext.sourceIds : [];
    const allowed = new Set(contextSourceIds);
    const returned = new Set(execution.sourceRefs);
    if (execution.payload.sourceAnchorIds.some((sourceId) => !allowed.has(sourceId) || !returned.has(sourceId))) {
      return this.#fallback("invalid_output");
    }
    return {
      status: "accepted",
      reasonCode: "recorded_response_accepted",
      question: cloneQuestion(execution.payload),
      usedFallback: false,
    };
  }

  #fallback(reasonCode: Exclude<OfflineDynamicQuestionReason, "recorded_response_accepted">): OfflineDynamicQuestionResult {
    return { status: "fallback", reasonCode, question: fixedDynamicQuestionFallback(), usedFallback: true };
  }
}
