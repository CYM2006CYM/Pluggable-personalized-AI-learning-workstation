import { createHash } from "node:crypto";
import type {
  AdaptiveContentPort,
  LearningCardSafeView,
  QuizQuestionPrivate,
  LessonVariantId,
} from "../contracts/index.js";
import {
  createStudyReviewGraphs,
  type DefenderOutput,
  type GeneratorOutput,
  type HunterOutput,
  type JudgeOutput,
} from "../graphs/v2-learning-graphs.js";
import type { ModelExecutionPort, ModelExecutionResult } from "../infrastructure/model-execution-port.js";
import type { W4PrivateRuntimeStore } from "../infrastructure/w4-private-runtime-store.js";
import { quizQuestionSetSha256 } from "../domain/quiz-runtime.js";

export type AdaptiveArtifactKind = "card" | "quiz";

export interface AdaptiveContentSourceContext {
  profileRevision: number;
  knowledgePointId: string;
  targetId: string;
  title: string;
  sourceAnchorIds: string[];
  publicSourceSummary: string;
  estimatedMinutes?: number;
  lessonVariantId?: LessonVariantId;
}

export interface AdaptiveContentSourceProvider {
  forCard(input: { profileRevision: number; knowledgePointId: string; lessonVariantId?: LessonVariantId }): Promise<AdaptiveContentSourceContext>;
  forQuiz(input: { profileRevision: number; activityId: string; lessonVariantId?: LessonVariantId }): Promise<AdaptiveContentSourceContext>;
}

export interface AdaptiveContentClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface AdaptiveContentServiceOptions {
  modelExecutionPort: ModelExecutionPort;
  sourceProvider: AdaptiveContentSourceProvider;
  privateStore: W4PrivateRuntimeStore;
  modelId: string;
  promptVersion: string;
  clock?: AdaptiveContentClock;
  fallbackAfterMs?: number;
  discardAfterMs?: number;
  executionMode?: "recorded_response" | "live_model";
}

type AcceptedArtifact =
  | { artifactKind: "card"; riskLevel: "low" | "high"; value: LearningCardSafeView }
  | { artifactKind: "quiz"; riskLevel: "low" | "high"; value: QuizQuestionPrivate[] };

interface AdaptiveCheckpoint {
  generationRunId: string;
  artifactKind: AdaptiveArtifactKind;
  profileRevision: number;
  targetId: string;
  modelId: string;
  promptVersion: string;
  lessonVariantId?: LessonVariantId;
  stage: "generator" | "hunter" | "defender" | "judge" | "accepted" | "unavailable" | "discarded";
  stageOrder: string[];
  candidate?: AcceptedArtifact;
  requiresReview?: boolean;
  publicGenerator?: GeneratorOutput;
  hunter?: HunterOutput;
  defender?: DefenderOutput;
  judge?: JudgeOutput;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  lateCachedAt?: string;
  reasonCode?: string;
}

interface AdaptiveCacheRecord {
  artifactKind: AdaptiveArtifactKind;
  profileRevision: number;
  targetId: string;
  modelId: string;
  promptVersion: string;
  lessonVariantId?: LessonVariantId;
  artifact: AcceptedArtifact;
  cachedAt: string;
  source: "immediate" | "late";
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const FORBIDDEN_TEXT = [
  /(?:sk|api)[-_][A-Za-z0-9]{12,}/u,
  /[A-Za-z]:[\\/][^\s]*/u,
  /\\\\[^\\/\s]+[\\/][^\s]*/u,
  /\/(?:home|Users|tmp)\/[A-Za-z0-9._-]+(?:[\\/]\S*)?/iu,
  /\bAuthorization\s*:\s*Bearer\s+\S+/iu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/u,
  /\b(?:accessToken|apiKey|authorization|secret|password)\s*[:=]\s*\S+/iu,
  /\b(?:hidden tests?|reference solutions?|private csv|rubric)\b/iu,
];
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "activityresult", "cursor", "evidence", "gold", "knowledgestate", "mastery", "path", "rubric", "score",
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function safeText(value: unknown, maximum = 2_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    && !FORBIDDEN_TEXT.some((pattern) => pattern.test(value));
}

function safeIdList(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 32
    && value.every(safeId) && new Set(value).size === value.length;
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-z]/giu, "").toLowerCase();
}

export function containsAdaptiveAuthorityViolation(value: unknown, depth = 0): boolean {
  if (depth > 10) return true;
  if (typeof value === "string") return FORBIDDEN_TEXT.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some((item) => containsAdaptiveAuthorityViolation(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(normalizedKey(key)) || containsAdaptiveAuthorityViolation(item, depth + 1));
}

function questionFailureDetail(value: unknown, allowedSources: ReadonlySet<string>, excluded: ReadonlySet<string>): string | undefined {
  if (!isRecord(value)) return "question_not_object";
  if (!exactKeys(value, [
    "questionId", "kind", "prompt", "options", "correctAnswer", "explanation", "sourceAnchorIds",
  ])) return "question_fields";
  if (!safeId(value.questionId)) return "question_id";
  if (excluded.has(value.questionId)) return "question_id_excluded";
  if (!safeText(value.prompt)) return "question_prompt";
  if (!safeText(value.explanation)) return "question_explanation";
  if (!safeIdList(value.sourceAnchorIds)
      || value.sourceAnchorIds.some((sourceId) => !allowedSources.has(sourceId))) return "question_sources";
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 6
      || !value.options.every((option) => safeText(option, 240))) return "question_options";
  if (new Set(value.options).size !== value.options.length) return "question_options_duplicate";
  if (value.kind !== "single_choice") return "question_kind";
  return typeof value.correctAnswer === "string" && value.options.includes(value.correctAnswer)
    ? undefined
    : "question_answer";
}

function isQuestion(value: unknown, allowedSources: ReadonlySet<string>, excluded: ReadonlySet<string>): value is QuizQuestionPrivate {
  return questionFailureDetail(value, allowedSources, excluded) === undefined;
}

function isCard(value: unknown, context: AdaptiveContentSourceContext, excluded: ReadonlySet<string>): value is LearningCardSafeView {
  if (!isRecord(value) || !exactKeys(value, [
    "cardId", "knowledgePointId", "title", "objective", "explanation", "example", "commonMistake",
    "sourceAnchorIds", "estimatedMinutes",
  ])) return false;
  return safeId(value.cardId) && !excluded.has(value.cardId)
    && value.knowledgePointId === context.knowledgePointId
    && safeText(value.title, 240) && safeText(value.objective) && safeText(value.example) && safeText(value.commonMistake)
    && Array.isArray(value.explanation) && value.explanation.length > 0 && value.explanation.length <= 12
    && value.explanation.every((item) => safeText(item))
    && safeIdList(value.sourceAnchorIds)
    && value.sourceAnchorIds.every((sourceId) => context.sourceAnchorIds.includes(sourceId))
    && Number.isInteger(value.estimatedMinutes) && (value.estimatedMinutes as number) > 0
    && (context.estimatedMinutes === undefined || value.estimatedMinutes === context.estimatedMinutes);
}

type GeneratorArtifactParseResult =
  | { ok: true; artifact: AcceptedArtifact }
  | { ok: false; detail: string };

function parseGeneratorArtifact(
  output: GeneratorOutput,
  artifactKind: AdaptiveArtifactKind,
  context: AdaptiveContentSourceContext,
  excludedIds: readonly string[],
): GeneratorArtifactParseResult {
  let parsed: unknown;
  try {
    parsed = typeof output.candidateFeedback === "string"
      ? JSON.parse(normalizeGeneratorJson(output.candidateFeedback))
      : clone(output.candidateFeedback);
  } catch { return { ok: false, detail: "candidate_json" }; }
  if (!isRecord(parsed)) return { ok: false, detail: "candidate_root" };
  if (parsed.artifactKind !== artifactKind) return { ok: false, detail: "candidate_artifact_kind" };
  if (parsed.riskLevel !== "low" && parsed.riskLevel !== "high") return { ok: false, detail: "candidate_risk_level" };
  const allowed = new Set(context.sourceAnchorIds);
  const excluded = new Set(excludedIds);
  if (artifactKind === "card") {
    if (!exactKeys(parsed, ["artifactKind", "riskLevel", "card"])) return { ok: false, detail: "candidate_fields" };
    if (!isCard(parsed.card, context, excluded)) return { ok: false, detail: "candidate_card" };
    return { ok: true, artifact: { artifactKind, riskLevel: parsed.riskLevel, value: clone(parsed.card) } };
  }
  if (!exactKeys(parsed, ["artifactKind", "riskLevel", "questions"])) return { ok: false, detail: "candidate_fields" };
  if (!Array.isArray(parsed.questions)) return { ok: false, detail: "candidate_questions_array" };
  if (parsed.questions.length < 4 || parsed.questions.length > 6) return { ok: false, detail: "candidate_question_count" };
  for (let index = 0; index < parsed.questions.length; index += 1) {
    const detail = questionFailureDetail(parsed.questions[index], allowed, excluded);
    if (detail !== undefined) return { ok: false, detail: `candidate_${detail}_${index + 1}` };
  }
  const questions = parsed.questions as QuizQuestionPrivate[];
  if (new Set(questions.map((question) => question.questionId)).size !== questions.length) {
    return { ok: false, detail: "candidate_question_ids_duplicate" };
  }
  return { ok: true, artifact: { artifactKind, riskLevel: parsed.riskLevel, value: clone(questions) } };
}

function normalizeGeneratorJson(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return (fenced?.[1] ?? trimmed).trim();
}

function publicCandidate(artifact: AcceptedArtifact): string {
  if (artifact.artifactKind === "card") return JSON.stringify({ artifactKind: "card", riskLevel: artifact.riskLevel, card: artifact.value });
  return JSON.stringify({
    artifactKind: "quiz",
    riskLevel: artifact.riskLevel,
    questions: artifact.value.map(({ correctAnswer: _answer, explanation: _explanation, ...safe }) => safe),
  });
}

function privateReviewGenerator(artifact: AcceptedArtifact, generator: GeneratorOutput): GeneratorOutput {
  const candidateFeedback = artifact.artifactKind === "card"
    ? JSON.stringify({ artifactKind: "card", riskLevel: artifact.riskLevel, card: artifact.value })
    : JSON.stringify({ artifactKind: "quiz", riskLevel: artifact.riskLevel, questions: artifact.value });
  return { ...generator, candidateFeedback };
}

function acceptedArtifactIsValid(value: unknown, artifactKind: AdaptiveArtifactKind,
  context: AdaptiveContentSourceContext, excludedIds: readonly string[]): value is AcceptedArtifact {
  if (!isRecord(value) || !exactKeys(value, ["artifactKind", "riskLevel", "value"]) || value.artifactKind !== artifactKind
      || (value.riskLevel !== "low" && value.riskLevel !== "high")) return false;
  const excluded = new Set(excludedIds);
  if (artifactKind === "card") return isCard(value.value, context, excluded);
  const allowed = new Set(context.sourceAnchorIds);
  return Array.isArray(value.value) && value.value.length >= 4 && value.value.length <= 6
    && value.value.every((question) => isQuestion(question, allowed, excluded))
    && new Set(value.value.map((question) => (question as QuizQuestionPrivate).questionId)).size === value.value.length;
}

function generatorRiskIsBound(artifact: AcceptedArtifact, generator: GeneratorOutput): boolean {
  return artifact.riskLevel === "high" ? generator.riskFlags.length > 0 : generator.riskFlags.length === 0;
}

function defaultClock(): AdaptiveContentClock {
  return { now: () => Date.now(), sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) };
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function stableRunId(key: string): string {
  return `w4-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function resultSourcesAreSafe(result: ModelExecutionResult, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return result.sourceRefs.every((sourceId) => allowedSet.has(sourceId));
}

function generatorFailureDetail(result: ModelExecutionResult, context: AdaptiveContentSourceContext): string {
  if (result.status !== "ok") return `status_${result.status}`;
  if (!isRecord(result.payload)) return "payload_not_object";
  if (!safeId(result.payload.artifactId)) return "artifact_id";
  if (!safeText(result.payload.rationale)) return "rationale";
  if (!Array.isArray(result.payload.riskFlags) || !result.payload.riskFlags.every((flag) => safeText(flag, 240))) return "risk_flags";
  if (!Array.isArray(result.payload.citedSourceIds) || result.payload.citedSourceIds.length === 0) return "cited_sources_empty";
  if (result.payload.citedSourceIds.some((id) => !context.sourceAnchorIds.includes(id) || !result.sourceRefs.includes(id))) return "cited_sources_unbound";
  if (!resultSourcesAreSafe(result, context.sourceAnchorIds)) return "source_refs";
  if (containsAdaptiveAuthorityViolation({ rationale: result.payload.rationale, riskFlags: result.payload.riskFlags })) return "authority_text";
  return "graph_output_schema";
}

function generatorRepairInstruction(detail: string, artifactKind: AdaptiveArtifactKind): string {
  const normalized = detail.replace(/_\d+$/u, "");
  const requirements: Record<string, string> = {
    candidate_json: "candidateFeedback 必须直接输出为单个 JSON 对象，不要转义成字符串，不要使用 Markdown 围栏或追加说明。",
    candidate_root: "candidateFeedback 解析结果必须是 JSON 对象。",
    candidate_fields: artifactKind === "quiz"
      ? "candidateFeedback 解析后只能包含 artifactKind、riskLevel、questions 三个字段。"
      : "candidateFeedback 解析后只能包含 artifactKind、riskLevel、card 三个字段。",
    candidate_artifact_kind: `artifactKind 必须为 ${artifactKind}。`,
    candidate_risk_level: "riskLevel 只能为 low 或 high，并与外层 riskFlags 一致。",
    candidate_card: "card 必须完整满足卡片字段、当前知识点、来源 ID 和预计时间合同。",
    candidate_questions_array: "questions 必须是 JSON 数组。",
    candidate_question_count: "questions 必须包含 4 至 6 道彼此不同的题，不能照抄单题结构示例。",
    candidate_question_not_object: "每道题必须是 JSON 对象。",
    candidate_question_fields: "每道题只能包含 questionId、kind、prompt、options、correctAnswer、explanation、sourceAnchorIds 七个字段。",
    candidate_question_id: "每道题的 questionId 必须是唯一的短 ASCII 标识符。",
    candidate_question_id_excluded: "不得复用输入中 excludedQuestionIds 已排除的 questionId。",
    candidate_question_prompt: "每道题必须提供非空、无敏感信息的中文 prompt。",
    candidate_question_explanation: "每道题必须提供基于教学正文的非空中文 explanation。",
    candidate_question_sources: "每道题的 sourceAnchorIds 必须非空，且只能逐字复制 allowedSourceIds。",
    candidate_question_options: "每道题必须提供 2 至 6 个非空字符串选项。",
    candidate_question_options_duplicate: "同一道题的 options 不得重复。",
    candidate_question_kind: "当前动态 quiz 只允许中文单选题；每道题的 kind 必须逐字写为 single_choice，不得输出 judgment 或其他题型。",
    candidate_question_answer: "correctAnswer 必须是字符串，并与 options 中某个选项逐字一致。",
    candidate_question_ids_duplicate: "4 至 6 道题的 questionId 必须全部唯一。",
    candidate_risk_flags_mismatch: "riskLevel=low 时外层 riskFlags 必须为空；riskLevel=high 时必须列出具体风险。",
    graph_output_schema: "外层必须且只能返回 artifactId、candidateFeedback、rationale、citedSourceIds、riskFlags 五个字段。",
    status_invalid_output: "上一轮外层结构不是有效的五字段 JSON，请严格按输出 Schema 重新生成。",
  };
  const requirement = requirements[normalized] ?? "严格重新核对五字段外层结构、candidateFeedback 内层结构、题量、答案和来源绑定。";
  return `上一轮候选未通过确定性校验，失败类别=${detail}。${requirement} 重新输出完整候选，不解释修复过程。`;
}

function hunterIsClosed(hunter: HunterOutput, riskLevel: AcceptedArtifact["riskLevel"]): boolean {
  const ids = hunter.issues.map((issue) => issue.issueId);
  const disputed = hunter.issues.filter((issue) => issue.disputed);
  // The Defender stage is conditional, but the condition itself is authoritative:
  // a disputed Hunter issue must never be silently accepted without a defense.
  return new Set(ids).size === ids.length
    && hunter.requiresDefender === (disputed.length > 0)
    && (riskLevel !== "high" || disputed.length > 0)
    && hunter.recommendedVerdict === (hunter.issues.length === 0 ? "accepted" : "revise");
}

function defenderIsClosed(defender: DefenderOutput, hunter: HunterOutput): boolean {
  const disputed = hunter.issues.filter((issue) => issue.disputed).map((issue) => issue.issueId);
  const combined = [...defender.acceptedIssueIds, ...defender.rebuttedIssueIds];
  return new Set(combined).size === combined.length && combined.length === disputed.length
    && combined.every((issueId) => disputed.includes(issueId));
}

function judgeIsClosed(judge: JudgeOutput, hunter: HunterOutput, defender?: DefenderOutput): boolean {
  const issueIds = new Set(hunter.issues.map((issue) => issue.issueId));
  const acceptedCanClose = hunter.issues.length === 0
    || (hunter.issues.every((issue) => issue.disputed)
      && defender !== undefined
      && defender.acceptedIssueIds.length === 0
      && defender.residualRisks.length === 0
      && defender.rebuttedIssueIds.length === hunter.issues.length);
  return new Set(judge.blockedIssueIds).size === judge.blockedIssueIds.length
    && judge.blockedIssueIds.every((issueId) => issueIds.has(issueId))
    && (judge.verdict !== "accepted" || (judge.blockedIssueIds.length === 0 && acceptedCanClose));
}

/** D-owned implementation of A's frozen AdaptiveContentPort. */
export class AdaptiveContentService implements AdaptiveContentPort {
  readonly #options: AdaptiveContentServiceOptions;
  readonly #clock: AdaptiveContentClock;
  readonly #fallbackAfterMs: number;
  readonly #discardAfterMs: number;
  readonly #discardedSignals = new WeakSet<AbortSignal>();

  constructor(options: AdaptiveContentServiceOptions) {
    if (!safeId(options.modelId) || !safeId(options.promptVersion)) throw new TypeError("modelId and promptVersion must be stable IDs");
    this.#options = options;
    this.#clock = options.clock ?? defaultClock();
    this.#fallbackAfterMs = options.fallbackAfterMs ?? 15_000;
    this.#discardAfterMs = options.discardAfterMs ?? 60_000;
    if (!(this.#fallbackAfterMs > 0 && this.#discardAfterMs > this.#fallbackAfterMs)) {
      throw new RangeError("Adaptive content deadlines must satisfy 0 < fallback < discard");
    }
  }

  async prepareCard(input: { profileRevision: number; knowledgePointId: string; excludedArtifactIds: string[]; lessonVariantId?: LessonVariantId }) {
    try {
      const context = await this.#options.sourceProvider.forCard(input);
      const artifact = await this.#prepare("card", context, input.excludedArtifactIds, 0);
      return artifact?.artifactKind === "card"
        ? { status: "accepted" as const, card: clone(artifact.value) }
        : { status: "unavailable" as const };
    } catch { return { status: "unavailable" as const }; }
  }

  async prepareQuiz(input: { profileRevision: number; activityId: string; retryNumber: number; excludedQuestionIds: string[]; lessonVariantId?: LessonVariantId }) {
    try {
      const context = await this.#options.sourceProvider.forQuiz(input);
      const artifact = await this.#prepare("quiz", context, input.excludedQuestionIds, input.retryNumber);
      return artifact?.artifactKind === "quiz"
        ? {
            status: "accepted" as const,
            questions: clone(artifact.value),
            origin: this.#options.executionMode ?? "recorded_response",
            reviewBinding: {
              generationRunId: stableRunId(this.#key("quiz", context, input.excludedQuestionIds, input.retryNumber)),
              acceptedQuestionSetSha256: quizQuestionSetSha256(artifact.value),
            },
          }
        : { status: "unavailable" as const };
    } catch { return { status: "unavailable" as const }; }
  }

  #key(artifactKind: AdaptiveArtifactKind, context: AdaptiveContentSourceContext,
    excludedIds: readonly string[], retryNumber: number): string {
    const keyParts: Array<string | number> = [artifactKind, context.profileRevision, context.targetId, retryNumber,
      [...excludedIds].sort().join(","), this.#options.modelId, this.#options.promptVersion];
    if (this.#options.executionMode === "live_model" && context.lessonVariantId !== undefined) keyParts.push(context.lessonVariantId);
    return keyParts.join(":");
  }

  async #prepare(
    artifactKind: AdaptiveArtifactKind,
    context: AdaptiveContentSourceContext,
    excludedIds: readonly string[],
    retryNumber: number,
  ): Promise<AcceptedArtifact | undefined> {
    this.#validateContext(context, artifactKind);
    const key = this.#key(artifactKind, context, excludedIds, retryNumber);
    const cached = await this.#options.privateStore.read<AdaptiveCacheRecord>("adaptive-cache", key);
    if (cached !== undefined && cached.artifactKind === artifactKind
        && acceptedArtifactIsValid(cached.artifact, artifactKind, context, excludedIds)
        && cached.profileRevision === context.profileRevision && cached.targetId === context.targetId
        && cached.modelId === this.#options.modelId && cached.promptVersion === this.#options.promptVersion
        && cached.lessonVariantId === context.lessonVariantId) {
      return clone(cached.artifact);
    }
    const recoverable = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (recoverable?.stage === "accepted"
        && acceptedArtifactIsValid(recoverable.candidate, artifactKind, context, excludedIds)) {
      await this.#cache(key, recoverable.candidate, "immediate");
      if (recoverable.publishedAt === undefined) {
        recoverable.publishedAt = iso(this.#clock.now()); recoverable.updatedAt = recoverable.publishedAt;
        await this.#options.privateStore.write("adaptive-checkpoint", key, recoverable);
      }
      return clone(recoverable.candidate);
    }

    const startedAt = this.#clock.now();
    const controller = new AbortController();
    const work = this.#generate(key, artifactKind, context, excludedIds, retryNumber, startedAt, controller.signal, recoverable);
    const early = await Promise.race([
      work.then((artifact) => ({ type: "result" as const, artifact })),
      this.#clock.sleep(this.#fallbackAfterMs).then(() => ({ type: "deadline" as const })),
    ]);
    if (early.type === "result") {
      if (early.artifact !== undefined) {
        await this.#cache(key, early.artifact, "immediate");
        const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
        if (checkpoint !== undefined) {
          checkpoint.publishedAt = iso(this.#clock.now()); checkpoint.updatedAt = checkpoint.publishedAt;
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        }
      }
      return early.artifact;
    }

    void Promise.race([
      work.then((artifact) => ({ type: "result" as const, artifact })),
      this.#clock.sleep(this.#discardAfterMs - this.#fallbackAfterMs).then(() => ({ type: "discard" as const })),
    ]).then(async (late) => {
      if (late.type === "result" && late.artifact !== undefined
          && this.#clock.now() - startedAt < this.#discardAfterMs) {
        await this.#cache(key, late.artifact, "late");
        const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
        if (checkpoint !== undefined) {
          checkpoint.lateCachedAt = iso(this.#clock.now()); checkpoint.updatedAt = checkpoint.lateCachedAt;
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        }
      } else {
        this.#discardedSignals.add(controller.signal);
        controller.abort();
        await this.#markDiscarded(key);
        void work.finally(() => this.#markDiscarded(key)).catch(() => undefined);
      }
    }).catch(() => undefined);
    return undefined;
  }

  async #generate(
    key: string,
    artifactKind: AdaptiveArtifactKind,
    context: AdaptiveContentSourceContext,
    excludedIds: readonly string[],
    retryNumber: number,
    startedAt: number,
    signal: AbortSignal,
    recovered?: AdaptiveCheckpoint,
  ): Promise<AcceptedArtifact | undefined> {
    const generationRunId = stableRunId(key);
    const boundRecovery = recovered !== undefined && recovered.generationRunId === generationRunId
      && recovered.artifactKind === artifactKind && recovered.profileRevision === context.profileRevision
      && recovered.targetId === context.targetId && recovered.modelId === this.#options.modelId
      && recovered.promptVersion === this.#options.promptVersion
      && recovered.lessonVariantId === context.lessonVariantId
      && recovered.stage !== "unavailable" && recovered.stage !== "discarded";
    const checkpoint: AdaptiveCheckpoint = boundRecovery ? clone(recovered) : {
      generationRunId, artifactKind, profileRevision: context.profileRevision, targetId: context.targetId,
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion,
      ...(context.lessonVariantId === undefined ? {} : { lessonVariantId: context.lessonVariantId }),
      stage: "generator", stageOrder: [], createdAt: iso(startedAt), updatedAt: iso(startedAt),
    };
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    const reviewContext = {
      activity: {
        activityId: context.targetId,
        activityVersion: 1,
        kind: artifactKind === "quiz" ? "mcq" as const : "explain" as const,
        title: context.title,
        primaryKnowledgePointId: context.knowledgePointId,
        supportingKnowledgePointIds: [],
      },
      safeFeedback: [
        `Requested artifactKind=${artifactKind}.`,
        `Target=${context.targetId}; knowledgePointId=${context.knowledgePointId}.`,
        ...(context.lessonVariantId === undefined ? [] : [`Selected lessonVariant=${context.lessonVariantId}.`]),
        ...(context.estimatedMinutes === undefined ? [] : [`Required estimatedMinutes=${context.estimatedMinutes}.`]),
        "Candidate content is non-authoritative until deterministic application validation.",
      ].join(" "),
      sourceIds: [...context.sourceAnchorIds],
      sourceSummary: context.publicSourceSummary,
      // Keep the lesson body and the source allowlist explicit in the model input.
      // The legacy sourceSummary field remains for compatibility with recorded runs.
      allowedSourceIds: [...context.sourceAnchorIds],
      teachingContent: context.publicSourceSummary,
    };
    const graphs = createStudyReviewGraphs();
    if ((checkpoint.candidate !== undefined
          && !acceptedArtifactIsValid(checkpoint.candidate, artifactKind, context, excludedIds))
        || (checkpoint.publicGenerator !== undefined
          && (!graphs.generator.validateOutput(checkpoint.publicGenerator)
            || !safeId(checkpoint.publicGenerator.artifactId) || !safeText(checkpoint.publicGenerator.rationale)
            || checkpoint.publicGenerator.citedSourceIds.length === 0
            || checkpoint.publicGenerator.citedSourceIds.some((id) => !context.sourceAnchorIds.includes(id))
            || !checkpoint.publicGenerator.riskFlags.every((flag) => safeText(flag, 240))
            || containsAdaptiveAuthorityViolation({ rationale: checkpoint.publicGenerator.rationale,
              riskFlags: checkpoint.publicGenerator.riskFlags })
            || (checkpoint.candidate !== undefined && !generatorRiskIsBound(checkpoint.candidate, checkpoint.publicGenerator))
            || (checkpoint.candidate !== undefined
              && checkpoint.publicGenerator.candidateFeedback !== publicCandidate(checkpoint.candidate))))
        || (checkpoint.hunter !== undefined
          && (!graphs.hunter.validateOutput(checkpoint.hunter)
            || containsAdaptiveAuthorityViolation(checkpoint.hunter)
            || checkpoint.candidate === undefined || !hunterIsClosed(checkpoint.hunter, checkpoint.candidate.riskLevel)))
        || (checkpoint.defender !== undefined
          && (checkpoint.hunter === undefined || !graphs.defender.validateOutput(checkpoint.defender)
            || containsAdaptiveAuthorityViolation(checkpoint.defender)
            || !defenderIsClosed(checkpoint.defender, checkpoint.hunter)))
        || (checkpoint.judge !== undefined
          && (checkpoint.hunter === undefined || !graphs.judge.validateOutput(checkpoint.judge)
            || containsAdaptiveAuthorityViolation(checkpoint.judge)
            || !judgeIsClosed(checkpoint.judge, checkpoint.hunter, checkpoint.defender)))) {
      return this.#unavailable(key, checkpoint, "invalid_recovered_checkpoint", signal);
    }
    let artifact = checkpoint.candidate;
    let safeGenerator = checkpoint.publicGenerator;
    if (artifact === undefined || safeGenerator === undefined || checkpoint.requiresReview === undefined) {
      const baseGeneratorInput = { context: reviewContext, allowedSourcesSummary: context.publicSourceSummary };
      let generatorResult: ModelExecutionResult | undefined;
      let generator: GeneratorOutput | undefined;
      let generatorDetail = "graph_output_schema";
      let nextAttempt: "initial" | "provider-retry" | "repair" = "initial";
      let providerRetries = 0;
      let candidateRepairs = 0;
      // A transient provider retry and a malformed-candidate repair are separate
      // budgets. A recovered provider must still get one precise schema repair.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const generatorInput = nextAttempt === "initial" || nextAttempt === "provider-retry"
          ? baseGeneratorInput
          : { ...baseGeneratorInput, repairInstruction: generatorRepairInstruction(generatorDetail, artifactKind) };
        const attemptSuffix = nextAttempt === "initial" ? "" : nextAttempt === "provider-retry" ? ".retry" : ".repair";
        generatorResult = await this.#execute("generator", `${generationRunId}.generator${attemptSuffix}`,
          context.profileRevision, generatorInput, signal);
        checkpoint.stageOrder.push(nextAttempt === "initial" ? "generator" : nextAttempt === "provider-retry" ? "generator-retry" : "generator-repair");
        checkpoint.updatedAt = iso(this.#clock.now());
        const outerValid = generatorResult.status === "ok"
          && graphs.generator.validateOutput(generatorResult.payload)
          && safeId(generatorResult.payload.artifactId)
          && safeText(generatorResult.payload.rationale)
          && generatorResult.payload.riskFlags.every((flag) => safeText(flag, 240))
          && generatorResult.payload.citedSourceIds.length > 0
          && generatorResult.payload.citedSourceIds.every((id) => context.sourceAnchorIds.includes(id))
          && generatorResult.payload.citedSourceIds.every((id) => generatorResult!.sourceRefs.includes(id))
          && resultSourcesAreSafe(generatorResult, context.sourceAnchorIds)
          && !containsAdaptiveAuthorityViolation({ rationale: generatorResult.payload.rationale, riskFlags: generatorResult.payload.riskFlags });
        if (!outerValid) {
          generatorDetail = generatorResult.status === "ok" ? generatorFailureDetail(generatorResult, context) : `status_${generatorResult.status}`;
          if (generatorResult.status === "provider_error" && providerRetries < 1) {
            providerRetries += 1;
            nextAttempt = "provider-retry";
            continue;
          }
          if ((generatorResult.status === "ok" || generatorResult.status === "invalid_output") && candidateRepairs < 1) {
            candidateRepairs += 1;
            nextAttempt = "repair";
            continue;
          }
          return this.#unavailable(key, checkpoint, generatorResult.status === "ok" ? "invalid_schema" : generatorResult.status, signal, generatorDetail);
        }
        generator = generatorResult.payload as GeneratorOutput;
        const parsed = parseGeneratorArtifact(generator, artifactKind, context, excludedIds);
        artifact = parsed.ok ? parsed.artifact : undefined;
        generatorDetail = parsed.ok ? "candidate_risk_flags_mismatch" : parsed.detail;
        if (artifact !== undefined && generatorRiskIsBound(artifact, generator)) break;
        artifact = undefined;
        if (candidateRepairs < 1) {
          candidateRepairs += 1;
          nextAttempt = "repair";
          continue;
        }
        return this.#unavailable(key, checkpoint, "invalid_schema_or_authority", signal, generatorDetail);
      }
      if (generatorResult === undefined || generator === undefined || artifact === undefined) {
        return this.#unavailable(key, checkpoint, "invalid_schema_or_authority", signal, generatorDetail);
      }
      checkpoint.candidate = clone(artifact);
      // Every model-generated candidate is reviewed. Risk flags only decide what
      // Hunter reports; they must never let a low-risk quiz bypass answer review.
      checkpoint.requiresReview = true;
      safeGenerator = { ...generator, candidateFeedback: publicCandidate(artifact) };
      checkpoint.publicGenerator = clone(safeGenerator);
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
    if (artifact === undefined || safeGenerator === undefined || checkpoint.requiresReview !== true) {
      return this.#unavailable(key, checkpoint, "checkpoint_incomplete", signal);
    }
    const reviewGenerator = privateReviewGenerator(artifact, safeGenerator);

    let hunter = checkpoint.hunter;
    if (hunter === undefined) {
      checkpoint.stage = "hunter"; checkpoint.updatedAt = iso(this.#clock.now());
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
      const hunterInput = { context: reviewContext, generator: reviewGenerator };
      const hunterResult = await this.#execute("hunter", `${generationRunId}.hunter`, context.profileRevision, hunterInput, signal);
      checkpoint.stageOrder.push("hunter"); checkpoint.updatedAt = iso(this.#clock.now());
      if (hunterResult.status !== "ok" || !graphs.hunter.validateOutput(hunterResult.payload)
          || !resultSourcesAreSafe(hunterResult, context.sourceAnchorIds)
          || containsAdaptiveAuthorityViolation(hunterResult.payload) || !hunterIsClosed(hunterResult.payload, artifact.riskLevel)) {
        return this.#unavailable(key, checkpoint, hunterResult.status === "ok" ? "hunter_invalid" : hunterResult.status, signal);
      }
      hunter = hunterResult.payload; checkpoint.hunter = clone(hunter);
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
    let defender = checkpoint.defender;
    if (hunter.requiresDefender) {
      if (defender === undefined) {
        checkpoint.stage = "defender"; checkpoint.updatedAt = iso(this.#clock.now());
        await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        const defenderInput = { context: reviewContext, generator: reviewGenerator, hunter };
        const defenderResult = await this.#execute("defender", `${generationRunId}.defender`, context.profileRevision, defenderInput, signal);
        checkpoint.stageOrder.push("defender"); checkpoint.updatedAt = iso(this.#clock.now());
        if (defenderResult.status !== "ok" || !graphs.defender.validateOutput(defenderResult.payload)
            || !resultSourcesAreSafe(defenderResult, context.sourceAnchorIds)
            || containsAdaptiveAuthorityViolation(defenderResult.payload)
            || !defenderIsClosed(defenderResult.payload, hunter)) {
          return this.#unavailable(key, checkpoint, defenderResult.status === "ok" ? "defender_invalid" : defenderResult.status, signal);
        }
        defender = defenderResult.payload; checkpoint.defender = clone(defender);
        await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
      }
    }
    checkpoint.stage = "judge"; checkpoint.updatedAt = iso(this.#clock.now());
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    const baseJudgeInput = { context: reviewContext, generator: reviewGenerator, hunter,
      ...(defender === undefined ? {} : { defender }) };
    let acceptedJudge: JudgeOutput | undefined;
    let judgeDetail = "unknown";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const judgeInput = attempt === 0
        ? baseJudgeInput
        : { ...baseJudgeInput, reviewInstruction: `上一轮裁决未通过确定性校验，失败类别=${judgeDetail}。请只修复裁决结构和问题闭合。` };
      const judgeResult = await this.#execute("judge", `${generationRunId}.judge${attempt === 0 ? "" : ".repair"}`,
        context.profileRevision, judgeInput, signal);
      checkpoint.stageOrder.push(attempt === 0 ? "judge" : "judge-repair"); checkpoint.updatedAt = iso(this.#clock.now());
      if (judgeResult.status !== "ok") {
        judgeDetail = `status_${judgeResult.status}_${judgeResult.errorCode ?? "unknown"}`;
        if (attempt === 0 && (judgeResult.status === "invalid_output" || judgeResult.status === "provider_error")) continue;
        return this.#unavailable(key, checkpoint, judgeResult.status, signal, judgeDetail);
      }
      if (!graphs.judge.validateOutput(judgeResult.payload)) {
        judgeDetail = "invalid_schema";
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_rejected", signal, judgeDetail);
      }
      if (!resultSourcesAreSafe(judgeResult, context.sourceAnchorIds)) {
        return this.#unavailable(key, checkpoint, "judge_rejected", signal, "invalid_source_refs");
      }
      if (containsAdaptiveAuthorityViolation(judgeResult.payload)) {
        judgeDetail = "authority_violation";
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_rejected", signal, "authority_violation");
      }
      if (!judgeIsClosed(judgeResult.payload, hunter, defender)) {
        const substantiveIssueRemains = hunter.issues.some((issue) => !issue.disputed)
          || (defender !== undefined
            && (defender.acceptedIssueIds.length > 0 || defender.residualRisks.length > 0));
        judgeDetail = substantiveIssueRemains ? "unresolved_substantive_issue" : "invalid_issue_closure";
        if (substantiveIssueRemains) {
          return this.#unavailable(key, checkpoint, "judge_rejected", signal, judgeDetail);
        }
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_rejected", signal, judgeDetail);
      }
      if (judgeResult.payload.verdict !== "accepted") {
        return this.#unavailable(key, checkpoint, "judge_rejected", signal, `verdict_${judgeResult.payload.verdict}`);
      }
      acceptedJudge = judgeResult.payload;
      break;
    }
    if (acceptedJudge === undefined) return this.#unavailable(key, checkpoint, "judge_rejected", signal, judgeDetail);
    checkpoint.judge = clone(acceptedJudge);
    return this.#accepted(key, checkpoint, artifact, signal);
  }

  async #execute(graphId: "generator" | "hunter" | "defender" | "judge", runId: string, profileRevision: number,
    safeContext: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ModelExecutionResult> {
    try {
      const result = await this.#options.modelExecutionPort.execute({
        graphId, runId, profileRevision, promptVersion: this.#options.promptVersion,
        safeContext, budget: { timeoutMs: this.#discardAfterMs },
      }, signal);
      if (signal.aborted) {
        return { status: "timeout", errorCode: this.#discardReasonCode(), sourceRefs: [],
          traceSummary: "execution completed after the discard deadline", modelId: this.#options.modelId,
          promptVersion: this.#options.promptVersion };
      }
      if (result.modelId !== this.#options.modelId || result.promptVersion !== this.#options.promptVersion) {
        return { status: "provider_error", errorCode: "version_conflict", sourceRefs: [],
          traceSummary: "model or prompt binding mismatch", modelId: this.#options.modelId,
          promptVersion: this.#options.promptVersion };
      }
      return result;
    } catch {
      return { status: "provider_error", errorCode: "provider_error", sourceRefs: [], traceSummary: "execution failed safely",
        modelId: this.#options.modelId, promptVersion: this.#options.promptVersion };
    }
  }

  async #accepted(key: string, checkpoint: AdaptiveCheckpoint, artifact: AcceptedArtifact,
    signal: AbortSignal): Promise<AcceptedArtifact | undefined> {
    if (signal.aborted || this.#discardedSignals.has(signal)) return undefined;
    checkpoint.stage = "accepted"; checkpoint.candidate = clone(artifact); checkpoint.updatedAt = iso(this.#clock.now());
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    await this.#options.privateStore.write("adaptive-trace", checkpoint.generationRunId, {
      artifactKind: checkpoint.artifactKind, generationRunId: checkpoint.generationRunId,
      stageOrder: checkpoint.stageOrder, status: "accepted", modelId: checkpoint.modelId,
      promptVersion: checkpoint.promptVersion,
    });
    return clone(artifact);
  }

  async #unavailable(key: string, checkpoint: AdaptiveCheckpoint, reasonCode: string,
    signal: AbortSignal, detailCode?: string): Promise<undefined> {
    if (signal.aborted || this.#discardedSignals.has(signal)) return undefined;
    const persisted = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (persisted?.stage === "discarded") return undefined;
    checkpoint.stage = "unavailable"; checkpoint.reasonCode = reasonCode; checkpoint.updatedAt = iso(this.#clock.now());
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    await this.#options.privateStore.write("adaptive-trace", checkpoint.generationRunId, {
      artifactKind: checkpoint.artifactKind, generationRunId: checkpoint.generationRunId,
      stageOrder: checkpoint.stageOrder, status: "unavailable", reasonCode,
      modelId: checkpoint.modelId, promptVersion: checkpoint.promptVersion,
      ...(detailCode === undefined ? {} : { detailCode }),
    });
    return undefined;
  }

  async #cache(key: string, artifact: AcceptedArtifact, source: "immediate" | "late"): Promise<void> {
    await this.#options.privateStore.write<AdaptiveCacheRecord>("adaptive-cache", key, {
      artifactKind: artifact.artifactKind, profileRevision: Number(key.split(":")[1]), targetId: key.split(":")[2] ?? "unknown",
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion,
      ...(key.split(":")[7] === undefined || key.split(":")[7] === "" ? {} : { lessonVariantId: key.split(":")[7] as LessonVariantId }),
      artifact: clone(artifact), cachedAt: iso(this.#clock.now()), source,
    });
  }

  async #markDiscarded(key: string): Promise<void> {
    const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (checkpoint !== undefined && checkpoint.publishedAt === undefined) {
      checkpoint.stage = "discarded"; checkpoint.reasonCode = this.#discardReasonCode();
      checkpoint.updatedAt = iso(this.#clock.now());
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
  }

  #discardReasonCode(): string {
    return this.#discardAfterMs % 1_000 === 0
      ? `discard_after_${this.#discardAfterMs / 1_000}s`
      : `discard_after_${this.#discardAfterMs}ms`;
  }

  #validateContext(context: AdaptiveContentSourceContext, artifactKind: AdaptiveArtifactKind): void {
    if (!Number.isInteger(context.profileRevision) || context.profileRevision < 1 || !safeId(context.knowledgePointId)
        || !safeId(context.targetId) || !safeText(context.title, 240) || !safeIdList(context.sourceAnchorIds)
        || !safeText(context.publicSourceSummary, 16_000) || containsAdaptiveAuthorityViolation(context)) {
      throw new Error(`Unsafe ${artifactKind} source context`);
    }
  }
}
