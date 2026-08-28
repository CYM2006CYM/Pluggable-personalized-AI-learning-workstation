import { createHash } from "node:crypto";
import type {
  AdaptiveContentPort,
  AdaptiveContentUnavailableReason,
  LearningCardSafeView,
  QuizQuestionPrivate,
  QuizRemediationContext,
  LessonVariantId,
  LessonPersonalizationContext,
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
import type { AgentRunRepository, AppendAgentStageInput } from "../infrastructure/agent-run-repository.js";
import { quizQuestionSetSha256 } from "../domain/quiz-runtime.js";
import { guidingQuestionFailure } from "../domain/personalized-lesson-guide.js";
import {
  defenderOutputIsClosed,
  defenderRoute,
  highRiskHunterOutput,
  judgeOutputIsClosed,
} from "./review-decision-policy.js";

export type AdaptiveArtifactKind = "card" | "quiz";

export interface AdaptiveContentSourceContext {
  profileRevision: number;
  knowledgePointId: string;
  targetId: string;
  title: string;
  sourceAnchorIds: string[];
  publicSourceSummary: string;
  targetKnowledgePointIds?: string[];
  estimatedMinutes?: number;
  lessonVariantId?: LessonVariantId;
  personalizationContext?: LessonPersonalizationContext;
  remediationContext?: QuizRemediationContext;
}

export interface AdaptiveContentSourceProvider {
  forCard(input: { profileRevision: number; knowledgePointId: string; lessonVariantId?: LessonVariantId }): Promise<AdaptiveContentSourceContext>;
  forQuiz(input: { profileRevision: number; activityId: string; lessonVariantId?: LessonVariantId; targetKnowledgePointIds?: string[] }): Promise<AdaptiveContentSourceContext>;
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
  agentRuns?: AgentRunRepository;
}

type AcceptedArtifact =
  | { artifactKind: "card"; riskLevel: "low" | "high"; value: LearningCardSafeView }
  | { artifactKind: "quiz"; riskLevel: "low" | "high"; value: QuizQuestionPrivate[] };

interface AdaptiveAcceptedReviewProof {
  generationRunId: string;
  candidateSha256: string;
  stageOrder: string[];
  completedStages: Array<"generator" | "safety" | "hunter" | "defender" | "judge">;
  safetyAudit: DeterministicSafetyAudit;
  hunter: HunterOutput;
  defender: DefenderOutput | null;
  judge: JudgeOutput;
}

interface DeterministicSafetyAudit {
  inputCandidateSha256: string;
  outputCandidateSha256: string;
  normalization: "none" | "quiz_option_order_balanced";
}

interface AdaptiveCheckpoint {
  generationRunId: string;
  artifactKind: AdaptiveArtifactKind;
  profileRevision: number;
  targetId: string;
  targetKnowledgePointIds?: string[];
  modelId: string;
  promptVersion: string;
  lessonVariantId?: LessonVariantId;
  personalizationContextSha256?: string;
  remediationContextSha256?: string;
  stage: "generator" | "hunter" | "defender" | "judge" | "accepted" | "unavailable" | "discarded";
  stageOrder: string[];
  candidate?: AcceptedArtifact;
  requiresReview?: boolean;
  publicGenerator?: GeneratorOutput;
  hunter?: HunterOutput;
  defender?: DefenderOutput;
  judge?: JudgeOutput;
  safetyAudit?: DeterministicSafetyAudit;
  acceptedReviewProof?: AdaptiveAcceptedReviewProof;
  judgeRevisionCount?: number;
  pendingJudgeRepairInstruction?: string;
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
  targetKnowledgePointIds?: string[];
  modelId: string;
  promptVersion: string;
  lessonVariantId?: LessonVariantId;
  personalizationContextSha256?: string;
  remediationContextSha256?: string;
  artifact: AcceptedArtifact;
  acceptedReviewProof: AdaptiveAcceptedReviewProof;
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
const CROSS_QUESTION_REFERENCE = /(?:上一|下一|前一|后一|第[一二三四五六七八九十\d]+)(?:道|个)?(?:题|问)|(?:previous|prior|earlier|next)\s+question|question\s*\d+/iu;
const CROSS_QUESTION_DEPENDENCY = /(?:答案|正确(?:项|答案|选项|结论)|结论|已(?:经)?给出|已知|可知|参照|参考|直接保留)|(?:answer|correct\s+(?:answer|option)|given|shown|refer|above|below)/iu;
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "activityresult", "cursor", "evidence", "gold", "knowledgestate", "mastery", "path", "rubric", "score",
]);
const PUBLIC_STAGE_LABELS = {
  generator: "Generator生成候选内容",
  safety: "确定性安全检查",
  hunter: "Hunter反向找错",
  defender: "Defender辩护",
  judge: "Judge最终裁决",
} as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
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

function containsCrossQuestionAnswerHint(value: string): boolean {
  return CROSS_QUESTION_REFERENCE.test(value) && CROSS_QUESTION_DEPENDENCY.test(value);
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-z]/giu, "").toLowerCase();
}

function targetKnowledgePointIds(context: AdaptiveContentSourceContext): string[] {
  return context.targetKnowledgePointIds === undefined || context.targetKnowledgePointIds.length === 0
    ? [context.knowledgePointId]
    : [...context.targetKnowledgePointIds];
}

function remediationContextSha256(context: AdaptiveContentSourceContext): string | undefined {
  return context.remediationContext === undefined
    ? undefined
    : createHash("sha256").update(JSON.stringify(context.remediationContext), "utf8").digest("hex");
}

function personalizationContextSha256(context: AdaptiveContentSourceContext): string | undefined {
  return context.personalizationContext === undefined
    ? undefined
    : createHash("sha256").update(JSON.stringify(context.personalizationContext), "utf8").digest("hex");
}

function excludedQuestionPrompts(context: AdaptiveContentSourceContext): Set<string> {
  return new Set((context.remediationContext?.excludedQuestionPrompts ?? []).map((item) => item.trim()));
}

export function containsAdaptiveAuthorityViolation(value: unknown, depth = 0): boolean {
  if (depth > 10) return true;
  if (typeof value === "string") return FORBIDDEN_TEXT.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some((item) => containsAdaptiveAuthorityViolation(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(normalizedKey(key)) || containsAdaptiveAuthorityViolation(item, depth + 1));
}

function questionFailureDetail(
  value: unknown,
  allowedSources: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  excludedPrompts: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!isRecord(value)) return "question_not_object";
  if (!exactKeys(value, [
    "questionId", "kind", "prompt", "options", "correctAnswer", "explanation", "sourceAnchorIds",
  ])) return "question_fields";
  if (!safeId(value.questionId)) return "question_id";
  if (excluded.has(value.questionId)) return "question_id_excluded";
  if (!safeText(value.prompt)) return "question_prompt";
  if (excludedPrompts.has(value.prompt.trim())) return "question_prompt_reused";
  if (!safeText(value.explanation)) return "question_explanation";
  if (!safeIdList(value.sourceAnchorIds)
      || value.sourceAnchorIds.some((sourceId) => !allowedSources.has(sourceId))) return "question_sources";
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 6
      || !value.options.every((option) => safeText(option, 240))) return "question_options";
  if (new Set(value.options).size !== value.options.length) return "question_options_duplicate";
  if ([value.prompt, value.explanation, ...value.options].some((text) => containsCrossQuestionAnswerHint(text as string))) {
    return "question_cross_answer_hint";
  }
  if (value.kind !== "single_choice") return "question_kind";
  return typeof value.correctAnswer === "string" && value.options.includes(value.correctAnswer)
    ? undefined
    : "question_answer";
}

function isQuestion(
  value: unknown,
  allowedSources: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  excludedPrompts: ReadonlySet<string> = new Set(),
): value is QuizQuestionPrivate {
  return questionFailureDetail(value, allowedSources, excluded, excludedPrompts) === undefined;
}

/**
 * Spreads answer positions without introducing non-reproducible randomness.
 * The answer text stays authoritative; only the public option order changes.
 */
export function balanceQuizAnswerPositions(
  questions: readonly QuizQuestionPrivate[],
): QuizQuestionPrivate[] {
  if (questions.length === 0) return [];
  if (questions.some((question) => question.kind !== "single_choice"
      || typeof question.correctAnswer !== "string"
      || !question.options.includes(question.correctAnswer)
      || question.options.length < 2)) {
    return questions.map((question) => clone(question));
  }
  const positionCount = Math.min(...questions.map((question) => question.options.length));
  const seedSource = questions.map((question) => `${question.questionId}:${question.prompt}`).join("|");
  const startPosition = Number.parseInt(
    createHash("sha256").update(seedSource, "utf8").digest("hex").slice(0, 8),
    16,
  ) % positionCount;

  return questions.map((question, questionIndex) => {
    const correctAnswer = question.correctAnswer as string;
    const currentPosition = question.options.indexOf(correctAnswer);
    const targetPosition = (startPosition + questionIndex) % positionCount;
    if (currentPosition === targetPosition) return clone(question);
    const options = question.options.filter((_option, optionIndex) => optionIndex !== currentPosition);
    options.splice(targetPosition, 0, correctAnswer);
    return { ...clone(question), options };
  });
}

/**
 * Safety-level distribution rule. The rule scales down for questions with only
 * two options, while requiring at least three used positions when possible.
 */
export function quizAnswerDistributionFailure(
  questions: readonly QuizQuestionPrivate[],
): string | undefined {
  if (questions.length === 0) return "question_answer_distribution_empty";
  const positions = questions.map((question) => question.options.indexOf(question.correctAnswer as string));
  if (positions.some((position) => position < 0)) return "question_answer_distribution_invalid";
  const availablePositionCount = Math.min(...questions.map((question) => question.options.length));
  const requiredPositionCount = Math.min(3, availablePositionCount, questions.length);
  if (new Set(positions).size < requiredPositionCount) return "question_answer_distribution_concentrated";
  const maximumPerPosition = Math.ceil(questions.length / requiredPositionCount);
  const counts = new Map<number, number>();
  for (const position of positions) counts.set(position, (counts.get(position) ?? 0) + 1);
  return [...counts.values()].some((count) => count > maximumPerPosition)
    ? "question_answer_distribution_imbalanced"
    : undefined;
}

function cardFailureDetail(value: unknown, context: AdaptiveContentSourceContext, excluded: ReadonlySet<string>): string | undefined {
  if (!isRecord(value) || !exactKeys(value, [
    "cardId", "knowledgePointId", "title", "objective", "explanation", "example", "commonMistake",
    "sourceAnchorIds", "estimatedMinutes",
  ])) return "card";
  const baseValid = safeId(value.cardId) && !excluded.has(value.cardId)
    && value.knowledgePointId === context.knowledgePointId
    && safeText(value.title, 240) && safeText(value.objective) && safeText(value.example) && safeText(value.commonMistake)
    && Array.isArray(value.explanation) && value.explanation.length > 0 && value.explanation.length <= 12
    && value.explanation.every((item) => safeText(item))
    && safeIdList(value.sourceAnchorIds)
    && value.sourceAnchorIds.every((sourceId) => context.sourceAnchorIds.includes(sourceId))
    && Number.isInteger(value.estimatedMinutes) && (value.estimatedMinutes as number) > 0
    && (context.estimatedMinutes === undefined || value.estimatedMinutes === context.estimatedMinutes);
  if (!baseValid) return "card";
  const questionFailure = guidingQuestionFailure(value.example);
  return questionFailure === undefined ? undefined : `card_guiding_question_${questionFailure}`;
}

function isCard(value: unknown, context: AdaptiveContentSourceContext, excluded: ReadonlySet<string>): value is LearningCardSafeView {
  return cardFailureDetail(value, context, excluded) === undefined;
}

type GeneratorArtifactParseResult =
  | { ok: true; artifact: AcceptedArtifact; safetyAudit: DeterministicSafetyAudit }
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
  const excludedPrompts = excludedQuestionPrompts(context);
  if (artifactKind === "card") {
    if (!exactKeys(parsed, ["artifactKind", "riskLevel", "card"])) return { ok: false, detail: "candidate_fields" };
    const cardFailure = cardFailureDetail(parsed.card, context, excluded);
    if (cardFailure !== undefined) return { ok: false, detail: `candidate_${cardFailure}` };
    if (!isCard(parsed.card, context, excluded)) return { ok: false, detail: "candidate_card" };
    const artifact: AcceptedArtifact = { artifactKind, riskLevel: parsed.riskLevel, value: clone(parsed.card) };
    const candidateSha256 = acceptedArtifactSha256(artifact);
    return {
      ok: true,
      artifact,
      safetyAudit: { inputCandidateSha256: candidateSha256, outputCandidateSha256: candidateSha256, normalization: "none" },
    };
  }
  if (!exactKeys(parsed, ["artifactKind", "riskLevel", "questions"])) return { ok: false, detail: "candidate_fields" };
  if (!Array.isArray(parsed.questions)) return { ok: false, detail: "candidate_questions_array" };
  if (parsed.questions.length < 4 || parsed.questions.length > 6) return { ok: false, detail: "candidate_question_count" };
  for (let index = 0; index < parsed.questions.length; index += 1) {
    const detail = questionFailureDetail(parsed.questions[index], allowed, excluded, excludedPrompts);
    if (detail !== undefined) return { ok: false, detail: `candidate_${detail}_${index + 1}` };
  }
  const questions = parsed.questions as QuizQuestionPrivate[];
  if (new Set(questions.map((question) => question.questionId)).size !== questions.length) {
    return { ok: false, detail: "candidate_question_ids_duplicate" };
  }
  const balancedQuestions = balanceQuizAnswerPositions(questions);
  const distributionFailure = quizAnswerDistributionFailure(balancedQuestions);
  if (distributionFailure !== undefined) return { ok: false, detail: `candidate_${distributionFailure}` };
  const inputArtifact: AcceptedArtifact = { artifactKind, riskLevel: parsed.riskLevel, value: clone(questions) };
  const outputArtifact: AcceptedArtifact = { artifactKind, riskLevel: parsed.riskLevel, value: balancedQuestions };
  const inputCandidateSha256 = acceptedArtifactSha256(inputArtifact);
  const outputCandidateSha256 = acceptedArtifactSha256(outputArtifact);
  return {
    ok: true,
    artifact: outputArtifact,
    safetyAudit: {
      inputCandidateSha256,
      outputCandidateSha256,
      normalization: inputCandidateSha256 === outputCandidateSha256 ? "none" : "quiz_option_order_balanced",
    },
  };
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
    && value.value.every((question) => isQuestion(question, allowed, excluded, excludedQuestionPrompts(context)))
    && new Set(value.value.map((question) => (question as QuizQuestionPrivate).questionId)).size === value.value.length
    && quizAnswerDistributionFailure(value.value as QuizQuestionPrivate[]) === undefined;
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

function acceptedArtifactSha256(artifact: AcceptedArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact), "utf8").digest("hex");
}

function resultSourcesAreSafe(result: ModelExecutionResult, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return result.sourceRefs.every((sourceId) => allowedSet.has(sourceId));
}

function sourceAnchorIdsAreSafe(sourceAnchorIds: readonly string[], allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return sourceAnchorIds.length > 0 && sourceAnchorIds.every((sourceId) => allowedSet.has(sourceId));
}

function hunterEvidenceSourcesAreSafe(hunter: HunterOutput, allowed: readonly string[]): boolean {
  return hunter.issues.every((issue) => sourceAnchorIdsAreSafe(issue.sourceAnchorIds, allowed));
}

function defenderEvidenceSourcesAreSafe(defender: DefenderOutput, allowed: readonly string[]): boolean {
  return defender.issueAssessments.every((assessment) => sourceAnchorIdsAreSafe(assessment.sourceAnchorIds, allowed));
}

function judgeEvidenceSourcesAreSafe(judge: JudgeOutput, allowed: readonly string[]): boolean {
  return judge.issueDecisions.every((decision) => sourceAnchorIdsAreSafe(decision.sourceAnchorIds, allowed))
    && judge.additionalIssues.every((issue) => sourceAnchorIdsAreSafe(issue.sourceAnchorIds, allowed));
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
    candidate_card_guiding_question_empty: "example 必须提供一句完整的课前引导问题。",
    candidate_card_guiding_question_length: "example 去掉固定引导语后应为 18 至 120 个字符的一句话。",
    candidate_card_guiding_question_not_chinese: "example 必须是无需翻译即可理解的中文问题。",
    candidate_card_guiding_question_not_a_question: "example 必须以中文或英文问号结尾。",
    candidate_card_guiding_question_missing_guiding_verb: "example 必须用『为什么、如何、怎样、怎么』之一提出可贯穿本节正文的核心问题。",
    candidate_card_guiding_question_context_dependent: "example 必须让从未读过本节的学生也能独立看懂：删除样例中的具体数字、裸变量名、代码符号，以及『这张表、上述示例、这里』等悬空指代；改问贯穿本节正文的核心矛盾。",
    candidate_questions_array: "questions 必须是 JSON 数组。",
    candidate_question_count: "questions 必须包含 4 至 6 道彼此不同的题，不能照抄单题结构示例。",
    candidate_question_not_object: "每道题必须是 JSON 对象。",
    candidate_question_fields: "每道题只能包含 questionId、kind、prompt、options、correctAnswer、explanation、sourceAnchorIds 七个字段。",
    candidate_question_id: "每道题的 questionId 必须是唯一的短 ASCII 标识符。",
    candidate_question_id_excluded: "不得复用输入中 excludedQuestionIds 已排除的 questionId。",
    candidate_question_prompt: "每道题必须提供非空、无敏感信息的中文 prompt。",
    candidate_question_prompt_reused: "不得逐字复用上一轮错题题干；必须更换题面，但继续考察对应的薄弱知识。",
    candidate_question_explanation: "每道题必须提供基于教学正文的非空中文 explanation。",
    candidate_question_sources: "每道题的 sourceAnchorIds 必须非空，且只能逐字复制 allowedSourceIds。",
    candidate_question_options: "每道题必须提供 2 至 6 个非空字符串选项。",
    candidate_question_options_duplicate: "同一道题的 options 不得重复。",
    candidate_question_cross_answer_hint: "每道题必须能够独立作答。逐题扫描 prompt、options 和 explanation，删除所有同时包含‘上一题/下一题/第几题/第几问’与‘答案/正确项/结论/参照’的句子；不得用其他题已给出的信息提示答案。修复后再次逐字段自检，任何跨题引用都不能保留。",
    candidate_question_kind: "当前动态 quiz 只允许中文单选题；每道题的 kind 必须逐字写为 single_choice，不得输出 judgment 或其他题型。",
    candidate_question_answer: "correctAnswer 必须是字符串，并与 options 中某个选项逐字一致。",
    candidate_question_ids_duplicate: "4 至 6 道题的 questionId 必须全部唯一。",
    candidate_question_answer_distribution_empty: "题组不得为空。",
    candidate_question_answer_distribution_invalid: "每道题的 correctAnswer 必须能在本题 options 中定位。",
    candidate_question_answer_distribution_concentrated: "正确答案位置必须在可用选项位置间分散；有三个以上可用位置时至少覆盖三个位置。",
    candidate_question_answer_distribution_imbalanced: "正确答案位置分布不得明显失衡；四至六题时同一位置通常不得超过两次。",
    candidate_risk_flags_mismatch: "riskLevel=low 时外层 riskFlags 必须为空；riskLevel=high 时必须列出具体风险。",
    graph_output_schema: "外层必须且只能返回 artifactId、candidateFeedback、rationale、citedSourceIds、riskFlags 五个字段。",
    status_invalid_output: "上一轮外层结构不是有效的五字段 JSON，请严格按输出 Schema 重新生成。",
  };
  const requirement = requirements[normalized] ?? (artifactKind === "card"
    ? "严格重新核对五字段外层结构、card 字段、正文依据、个性化重点和来源绑定。"
    : "严格重新核对五字段外层结构、candidateFeedback 内层结构、题量、答案和来源绑定。");
  return `上一轮候选未通过确定性校验，失败类别=${detail}。${requirement} 重新输出完整候选，不解释修复过程。`;
}

function hunterIsClosed(hunter: HunterOutput, riskLevel: AcceptedArtifact["riskLevel"]): boolean {
  const ids = hunter.issues.map((issue) => issue.issueId);
  return new Set(ids).size === ids.length
    // Hunter may report whether it expects a defense for compatibility, but it
    // does not own routing. A high-risk flag must be backed by a concrete issue.
    && (riskLevel !== "high" || hunter.issues.length > 0)
    && hunter.recommendedVerdict === (hunter.issues.length === 0 ? "accepted" : "revise");
}

function defenderConcededIssueIds(defender: DefenderOutput): string[] {
  return defender.issueAssessments
    .filter((assessment) => assessment.position === "conceded")
    .map((assessment) => assessment.issueId);
}

function defenderRebuttedIssueIds(defender: DefenderOutput): string[] {
  return defender.issueAssessments
    .filter((assessment) => assessment.position === "rebutted")
    .map((assessment) => assessment.issueId);
}

function defenderResidualRisks(defender: DefenderOutput): string[] {
  return defender.issueAssessments.flatMap((assessment) => assessment.residualRisk === null
    ? []
    : [assessment.residualRisk]);
}

function defenderRepairInstruction(failure: string, hunter: HunterOutput): string {
  return [
    `上一轮Defender输出未通过确定性校验，失败类别=${failure}。`,
    `expectedIssueIds=${JSON.stringify(hunter.issues.map((issue) => issue.issueId))}。`,
    "只返回defenseSummary和issueAssessments两个字段；issueAssessments必须恰好覆盖每个expectedIssueId一次。",
    "每项必须包含issueId、position、rationale、sourceAnchorIds、residualRisk；position只能是conceded或rebutted，不得遗漏、重复、新增或改写issueId。",
  ].join(" ");
}

function lastStageIndex(stageOrder: readonly string[], prefixes: readonly string[]): number {
  for (let index = stageOrder.length - 1; index >= 0; index -= 1) {
    const stage = stageOrder[index]!;
    if (prefixes.some((prefix) => stage === prefix || stage.startsWith(`${prefix}-`))) return index;
  }
  return -1;
}

function acceptedReviewStageOrderIsComplete(stageOrder: readonly string[], hunter: HunterOutput): boolean {
  const generatorIndex = lastStageIndex(stageOrder, ["generator"]);
  const hunterIndex = lastStageIndex(stageOrder, ["hunter"]);
  const judgeIndex = lastStageIndex(stageOrder, ["judge"]);
  if (!(generatorIndex >= 0 && generatorIndex < hunterIndex && hunterIndex < judgeIndex)) return false;
  if (!hunter.issues.some((issue) => issue.severity === "high")) return true;
  const defenderIndex = lastStageIndex(stageOrder, ["defender"]);
  return hunterIndex < defenderIndex && defenderIndex < judgeIndex;
}

function acceptedReviewProofIsValid(
  value: unknown,
  artifact: AcceptedArtifact,
  context: AdaptiveContentSourceContext,
  generationRunId: string,
): value is AdaptiveAcceptedReviewProof {
  if (!isRecord(value) || !exactKeys(value, [
    "generationRunId", "candidateSha256", "stageOrder", "completedStages", "safetyAudit", "hunter", "defender", "judge",
  ])) return false;
  if (value.generationRunId !== generationRunId || value.candidateSha256 !== acceptedArtifactSha256(artifact)
      || !Array.isArray(value.stageOrder) || !value.stageOrder.every((stage) => typeof stage === "string")
      || !Array.isArray(value.completedStages) || !isRecord(value.safetyAudit)
      || value.safetyAudit.outputCandidateSha256 !== value.candidateSha256
      || typeof value.safetyAudit.inputCandidateSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.safetyAudit.inputCandidateSha256)
      || typeof value.safetyAudit.outputCandidateSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.safetyAudit.outputCandidateSha256)
      || (value.safetyAudit.normalization !== "none" && value.safetyAudit.normalization !== "quiz_option_order_balanced")) return false;
  const graphs = createStudyReviewGraphs();
  if (!graphs.hunter.validateOutput(value.hunter) || !graphs.judge.validateOutput(value.judge)
      || value.judge.verdict !== "accepted" || !hunterIsClosed(value.hunter, artifact.riskLevel)
      || !judgeOutputIsClosed(value.judge, value.hunter)
      || containsAdaptiveAuthorityViolation(value.hunter) || containsAdaptiveAuthorityViolation(value.judge)
      || !hunterEvidenceSourcesAreSafe(value.hunter, context.sourceAnchorIds)
      || !judgeEvidenceSourcesAreSafe(value.judge, context.sourceAnchorIds)
      || !acceptedReviewStageOrderIsComplete(value.stageOrder, value.hunter)) return false;
  const defenderRequired = value.hunter.issues.some((issue) => issue.severity === "high");
  if (defenderRequired) {
    const routedHunter = highRiskHunterOutput(value.hunter);
    if (!graphs.defender.validateOutput(value.defender) || !defenderOutputIsClosed(value.defender, routedHunter)
        || containsAdaptiveAuthorityViolation(value.defender)
        || !defenderEvidenceSourcesAreSafe(value.defender, context.sourceAnchorIds)) return false;
  } else if (value.defender !== null) return false;
  const expectedStages = ["generator", "safety", "hunter", ...(defenderRequired ? ["defender"] : []), "judge"];
  return JSON.stringify(value.completedStages) === JSON.stringify(expectedStages);
}

function buildAcceptedReviewProof(checkpoint: AdaptiveCheckpoint, artifact: AcceptedArtifact): AdaptiveAcceptedReviewProof | undefined {
  if (checkpoint.safetyAudit === undefined || checkpoint.hunter === undefined
      || checkpoint.judge === undefined || checkpoint.judge.verdict !== "accepted") return undefined;
  const defenderRequired = checkpoint.hunter.issues.some((issue) => issue.severity === "high");
  if (defenderRequired !== (checkpoint.defender !== undefined)) return undefined;
  return {
    generationRunId: checkpoint.generationRunId,
    candidateSha256: acceptedArtifactSha256(artifact),
    stageOrder: [...checkpoint.stageOrder],
    completedStages: ["generator", "safety", "hunter", ...(defenderRequired ? ["defender" as const] : []), "judge"],
    safetyAudit: clone(checkpoint.safetyAudit),
    hunter: clone(checkpoint.hunter),
    defender: checkpoint.defender === undefined ? null : clone(checkpoint.defender),
    judge: clone(checkpoint.judge),
  };
}

function judgeRepairInstruction(judge: JudgeOutput): string {
  const blocked = new Set(judge.blockedIssueIds);
  const confirmedIssues = judge.issueDecisions
    .filter((decision) => decision.decision === "upheld" && blocked.has(decision.issueId))
    .map((decision) => ({
      issueId: decision.issueId,
      rationale: decision.rationale,
      sourceAnchorIds: decision.sourceAnchorIds,
    }));
  const additionalIssues = judge.additionalIssues
    .filter((issue) => blocked.has(issue.issueId))
    .map((issue) => ({
      issueId: issue.issueId,
      severity: issue.severity,
      category: issue.category,
      candidateField: issue.candidateField,
      message: issue.message,
      evidenceSummary: issue.evidenceSummary,
      sourceAnchorIds: issue.sourceAnchorIds,
    }));
  return [
    "Judge要求返修当前候选。只修改被确认的候选内容问题，不得更改教学正文、来源允许列表、画像事实或权威判分。",
    `judgeUpheldIssues=${JSON.stringify(confirmedIssues)}`,
    `judgeAdditionalIssues=${JSON.stringify(additionalIssues)}`,
    "重新输出完整候选；新候选将从确定性Safety开始重新经过Hunter、必要的Defender和Judge审核。",
  ].join(" ");
}

/** D-owned implementation of A's frozen AdaptiveContentPort. */
export class AdaptiveContentService implements AdaptiveContentPort {
  readonly #options: AdaptiveContentServiceOptions;
  readonly #clock: AdaptiveContentClock;
  readonly #fallbackAfterMs: number;
  readonly #discardAfterMs: number;
  readonly #discardedSignals = new WeakSet<AbortSignal>();
  readonly #closedAgentRunIds = new Set<string>();

  constructor(options: AdaptiveContentServiceOptions) {
    if (!safeId(options.modelId) || !safeId(options.promptVersion)) throw new TypeError("modelId and promptVersion must be stable IDs");
    this.#options = options;
    this.#clock = options.clock ?? defaultClock();
    this.#fallbackAfterMs = options.fallbackAfterMs ?? 15_000;
    this.#discardAfterMs = options.discardAfterMs ?? 60_000;
    if (!(this.#fallbackAfterMs > 0 && this.#discardAfterMs >= this.#fallbackAfterMs)) {
      throw new RangeError("Adaptive content deadlines must satisfy 0 < fallback <= discard");
    }
  }

  async prepareCard(input: { profileRevision: number; knowledgePointId: string; excludedArtifactIds: string[]; lessonVariantId?: LessonVariantId; personalizationContext?: LessonPersonalizationContext; agentRunId?: string }) {
    try {
      const sourceContext = await this.#options.sourceProvider.forCard(input);
      const context: AdaptiveContentSourceContext = {
        ...sourceContext,
        ...(input.personalizationContext === undefined ? {} : { personalizationContext: clone(input.personalizationContext) }),
      };
      const key = this.#key("card", context, input.excludedArtifactIds, 0);
      const artifact = await this.#prepare("card", context, input.excludedArtifactIds, 0, input.agentRunId);
      return artifact?.artifactKind === "card"
        ? {
            status: "accepted" as const,
            card: clone(artifact.value),
            origin: this.#options.executionMode ?? "recorded_response",
            reviewBinding: {
              generationRunId: stableRunId(this.#key("card", context, input.excludedArtifactIds, 0)),
              acceptedCardSha256: createHash("sha256").update(JSON.stringify(artifact.value), "utf8").digest("hex"),
            },
          }
        : await this.#publicUnavailableResult(key, input.agentRunId !== undefined);
    } catch {
      await this.#recordUnexpectedPipelineFailure(input.agentRunId);
      return { status: "unavailable" as const };
    }
  }

  async prepareQuiz(input: { profileRevision: number; activityId: string; retryNumber: number; excludedQuestionIds: string[]; lessonVariantId?: LessonVariantId; targetKnowledgePointIds?: string[]; remediationContext?: QuizRemediationContext; agentRunId?: string }) {
    try {
      const sourceContext = await this.#options.sourceProvider.forQuiz(input);
      const context: AdaptiveContentSourceContext = {
        ...sourceContext,
        ...(input.remediationContext === undefined ? {} : { remediationContext: clone(input.remediationContext) }),
      };
      const key = this.#key("quiz", context, input.excludedQuestionIds, input.retryNumber);
      const artifact = await this.#prepare("quiz", context, input.excludedQuestionIds, input.retryNumber, input.agentRunId);
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
        : await this.#publicUnavailableResult(key, input.agentRunId !== undefined);
    } catch {
      await this.#recordUnexpectedPipelineFailure(input.agentRunId);
      return { status: "unavailable" as const };
    }
  }

  #key(artifactKind: AdaptiveArtifactKind, context: AdaptiveContentSourceContext,
    excludedIds: readonly string[], retryNumber: number): string {
    const keyParts: Array<string | number> = [artifactKind, context.profileRevision, context.targetId];
    if (context.targetKnowledgePointIds !== undefined) keyParts.push(targetKnowledgePointIds(context).join(","));
    const remediationHash = remediationContextSha256(context);
    if (remediationHash !== undefined) keyParts.push(remediationHash);
    const personalizationHash = personalizationContextSha256(context);
    if (personalizationHash !== undefined) keyParts.push(personalizationHash);
    keyParts.push(retryNumber, [...excludedIds].sort().join(","), this.#options.modelId, this.#options.promptVersion);
    if (this.#options.executionMode === "live_model" && context.lessonVariantId !== undefined) keyParts.push(context.lessonVariantId);
    return keyParts.join(":");
  }

  async #prepare(
    artifactKind: AdaptiveArtifactKind,
    context: AdaptiveContentSourceContext,
    excludedIds: readonly string[],
    retryNumber: number,
    agentRunId?: string,
  ): Promise<AcceptedArtifact | undefined> {
    this.#validateContext(context, artifactKind);
    const key = this.#key(artifactKind, context, excludedIds, retryNumber);
    const artifactLabel = artifactKind === "card" ? "个性化提醒" : "AI题组";
    // 缓存/checkpoint也是Generator准备阶段的一部分。先公开工位状态，
    // 避免本地存储异常时页面错误地显示“Generator尚未触发”。
    const generatorPreparationStartedAt = await this.#beginPublicStage(
      agentRunId,
      "generator",
      1,
      `正在检查已审核缓存并准备生成候选${artifactLabel}。`,
      [
        { metricId: "attempt", label: "执行轮次", value: "第1轮", tone: "neutral" },
        { metricId: "model", label: "模型", value: this.#options.modelId, tone: "neutral" },
      ],
    );
    const cached = await this.#options.privateStore.read<AdaptiveCacheRecord>("adaptive-cache", key);
    if (cached !== undefined && cached.artifactKind === artifactKind
        && acceptedArtifactIsValid(cached.artifact, artifactKind, context, excludedIds)
        && acceptedReviewProofIsValid(cached.acceptedReviewProof, cached.artifact, context, stableRunId(key))
        && cached.profileRevision === context.profileRevision && cached.targetId === context.targetId
        && JSON.stringify(cached.targetKnowledgePointIds ?? [context.knowledgePointId]) === JSON.stringify(targetKnowledgePointIds(context))
        && cached.modelId === this.#options.modelId && cached.promptVersion === this.#options.promptVersion
        && cached.lessonVariantId === context.lessonVariantId
        && cached.personalizationContextSha256 === personalizationContextSha256(context)
        && cached.remediationContextSha256 === remediationContextSha256(context)) {
      await this.#recordReviewedCache(agentRunId, cached.source, artifactKind);
      return clone(cached.artifact);
    }
    const recoverable = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (recoverable?.stage === "accepted"
        && acceptedArtifactIsValid(recoverable.candidate, artifactKind, context, excludedIds)
        && acceptedReviewProofIsValid(recoverable.acceptedReviewProof, recoverable.candidate, context, stableRunId(key))
        && JSON.stringify(recoverable.acceptedReviewProof.stageOrder) === JSON.stringify(recoverable.stageOrder)) {
      await this.#cache(key, recoverable.candidate, "immediate", context, recoverable.acceptedReviewProof);
      if (recoverable.publishedAt === undefined) {
        recoverable.publishedAt = iso(this.#clock.now()); recoverable.updatedAt = recoverable.publishedAt;
        await this.#options.privateStore.write("adaptive-checkpoint", key, recoverable);
      }
      await this.#recordReviewedCache(agentRunId, "immediate", artifactKind);
      return clone(recoverable.candidate);
    }

    const startedAt = this.#clock.now();
    const controller = new AbortController();
    const work = this.#generate(
      key,
      artifactKind,
      context,
      excludedIds,
      retryNumber,
      startedAt,
      controller.signal,
      recoverable?.stage === "accepted" ? undefined : recoverable,
      agentRunId,
      generatorPreparationStartedAt,
    );
    const early = await Promise.race([
      work.then((artifact) => ({ type: "result" as const, artifact })),
      this.#clock.sleep(this.#fallbackAfterMs).then(() => ({ type: "deadline" as const })),
    ]);
    if (early.type === "result") {
      if (early.artifact !== undefined) {
        const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
        if (checkpoint !== undefined
            && acceptedReviewProofIsValid(checkpoint.acceptedReviewProof, early.artifact, context, stableRunId(key))
            && JSON.stringify(checkpoint.acceptedReviewProof.stageOrder) === JSON.stringify(checkpoint.stageOrder)) {
          await this.#cache(key, early.artifact, "immediate", context, checkpoint.acceptedReviewProof);
          checkpoint.publishedAt = iso(this.#clock.now()); checkpoint.updatedAt = checkpoint.publishedAt;
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        } else return undefined;
      }
      return early.artifact;
    }
    this.#discardedSignals.add(controller.signal);
    if (agentRunId !== undefined) this.#closedAgentRunIds.add(agentRunId);
    controller.abort();
    await this.#recordOwnedTimeout(agentRunId);
    await this.#markDiscarded(key);
    void work.catch(() => undefined);
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
    agentRunId?: string,
    generatorPreparationStartedAt?: number,
  ): Promise<AcceptedArtifact | undefined> {
    const artifactLabel = artifactKind === "card" ? "个性化提醒" : "AI题组";
    const generationRunId = stableRunId(key);
    const boundRecovery = recovered !== undefined && recovered.generationRunId === generationRunId
      && recovered.artifactKind === artifactKind && recovered.profileRevision === context.profileRevision
      && recovered.targetId === context.targetId && recovered.modelId === this.#options.modelId
      && recovered.promptVersion === this.#options.promptVersion
      && recovered.lessonVariantId === context.lessonVariantId
      && recovered.personalizationContextSha256 === personalizationContextSha256(context)
      && recovered.remediationContextSha256 === remediationContextSha256(context)
      && recovered.stage !== "unavailable" && recovered.stage !== "discarded";
    const checkpoint: AdaptiveCheckpoint = boundRecovery ? clone(recovered) : {
      generationRunId, artifactKind, profileRevision: context.profileRevision, targetId: context.targetId,
      ...(targetKnowledgePointIds(context).length === 0 ? {} : { targetKnowledgePointIds: targetKnowledgePointIds(context) }),
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion,
      ...(context.lessonVariantId === undefined ? {} : { lessonVariantId: context.lessonVariantId }),
      ...(personalizationContextSha256(context) === undefined ? {} : { personalizationContextSha256: personalizationContextSha256(context) }),
      ...(remediationContextSha256(context) === undefined ? {} : { remediationContextSha256: remediationContextSha256(context) }),
      stage: "generator", stageOrder: [], createdAt: iso(startedAt), updatedAt: iso(startedAt),
    };
    let prestartedGeneratorAt = generatorPreparationStartedAt;
    const needsGenerator = checkpoint.candidate === undefined
      || checkpoint.publicGenerator === undefined
      || checkpoint.requiresReview === undefined;
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
        `Target knowledge points=${targetKnowledgePointIds(context).join(",")}.`,
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
      ...(context.personalizationContext === undefined ? {} : { personalizationContext: clone(context.personalizationContext) }),
      ...(context.remediationContext === undefined ? {} : { retryContext: clone(context.remediationContext) }),
    };
    const graphs = createStudyReviewGraphs();
    if ((checkpoint.candidate !== undefined
          && (!acceptedArtifactIsValid(checkpoint.candidate, artifactKind, context, excludedIds)
            || checkpoint.safetyAudit === undefined
            || checkpoint.safetyAudit.outputCandidateSha256 !== acceptedArtifactSha256(checkpoint.candidate)))
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
            || !defenderOutputIsClosed(checkpoint.defender, checkpoint.hunter)))
        || (checkpoint.judge !== undefined
          && (checkpoint.hunter === undefined || !graphs.judge.validateOutput(checkpoint.judge)
            || containsAdaptiveAuthorityViolation(checkpoint.judge)
            || !judgeOutputIsClosed(checkpoint.judge, checkpoint.hunter)))) {
      if (prestartedGeneratorAt !== undefined) {
        await this.#finishPublicStage(
          agentRunId,
          "generator",
          1,
          prestartedGeneratorAt,
          "failed",
          `恢复的${artifactLabel} checkpoint未通过确定性校验，已停止本轮生成。`,
          { issueCategories: ["恢复状态无效"] },
        );
      }
      return this.#unavailable(key, checkpoint, "invalid_recovered_checkpoint", signal);
    }
    if (!needsGenerator && prestartedGeneratorAt !== undefined) {
      await this.#finishPublicStage(
        agentRunId,
        "generator",
        1,
        prestartedGeneratorAt,
        "skipped",
        `已恢复同一上下文的Generator候选，继续完成${artifactLabel}审核。`,
        { metrics: [{ metricId: "cache-source", label: "复用来源", value: "审核checkpoint", tone: "neutral" }] },
      );
      prestartedGeneratorAt = undefined;
    }
    let artifact = checkpoint.candidate;
    let safeGenerator = checkpoint.publicGenerator;
    if (artifact === undefined || safeGenerator === undefined || checkpoint.requiresReview === undefined) {
      const baseGeneratorInput = { context: reviewContext, allowedSourcesSummary: context.publicSourceSummary };
      let generatorResult: ModelExecutionResult | undefined;
      let generator: GeneratorOutput | undefined;
      let generatorDetail = "graph_output_schema";
      let nextAttempt: "initial" | "provider-retry" | "repair" | "judge-repair" = checkpoint.pendingJudgeRepairInstruction === undefined
        ? "initial"
        : "judge-repair";
      let providerRetries = 0;
      let candidateRepairs = 0;
      const generatorAttemptOffset = (checkpoint.judgeRevisionCount ?? 0) * 3;
      // A transient provider retry and a malformed-candidate repair are separate
      // budgets. A recovered provider must still get one precise schema repair.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const attemptNumber = generatorAttemptOffset + attempt + 1;
        const generatorInput = nextAttempt === "initial" || nextAttempt === "provider-retry"
          ? baseGeneratorInput
          : nextAttempt === "judge-repair"
            ? { ...baseGeneratorInput, repairInstruction: checkpoint.pendingJudgeRepairInstruction }
            : { ...baseGeneratorInput, repairInstruction: generatorRepairInstruction(generatorDetail, artifactKind) };
        const attemptSuffix = nextAttempt === "initial" ? ""
          : nextAttempt === "provider-retry" ? ".retry"
            : nextAttempt === "judge-repair" ? `.judge-revision-${checkpoint.judgeRevisionCount ?? 1}`
              : ".repair";
        const generatorStartedAt = prestartedGeneratorAt !== undefined && attemptNumber === 1 && nextAttempt === "initial"
          ? prestartedGeneratorAt
          : await this.#beginPublicStage(
              agentRunId,
              "generator",
              attemptNumber,
              nextAttempt === "initial" ? `正在根据当前教学正文和安全学情事实生成候选${artifactLabel}。`
                : nextAttempt === "provider-retry" ? "模型服务上一轮未形成有效响应，正在执行一次受控重试。"
                  : nextAttempt === "judge-repair" ? "Judge已确认候选需要返修，Generator正在按阻塞问题生成完整新候选。"
                  : "候选未通过确定性合同，正在按失败类别定向修复。",
              [
                { metricId: "attempt", label: "执行轮次", value: `第${attemptNumber}轮`, tone: attemptNumber === 1 ? "neutral" : "warning" },
                { metricId: "model", label: "模型", value: this.#options.modelId, tone: "neutral" },
              ],
            );
        prestartedGeneratorAt = undefined;
        generatorResult = await this.#execute("generator", `${generationRunId}.generator${attemptSuffix}`,
          context.profileRevision, generatorInput, signal);
        checkpoint.stageOrder.push(nextAttempt === "initial" ? "generator"
          : nextAttempt === "provider-retry" ? "generator-retry"
            : nextAttempt === "judge-repair" ? "generator-judge-repair"
              : "generator-repair");
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
          const hasNextAttempt = attempt + 1 < 3;
          const canProviderRetry = hasNextAttempt && generatorResult.status === "provider_error" && providerRetries < 1;
          const canRepair = hasNextAttempt
            && (generatorResult.status === "ok" || generatorResult.status === "invalid_output")
            && candidateRepairs < 1;
          await this.#finishPublicStage(
            agentRunId,
            "generator",
            attemptNumber,
            generatorStartedAt,
            canProviderRetry || canRepair ? "revised" : "failed",
            canProviderRetry || canRepair ? "本轮未形成可审核候选，系统将按受控预算重试。" : "Generator未形成可审核候选。",
            {
              metrics: [{ metricId: "failure-category", label: "失败类别", value: generatorDetail, tone: "danger" }],
              issueCategories: [generatorResult.status === "provider_error" ? "模型服务异常" : "输出合同不符"],
            },
          );
          if (canProviderRetry) {
            providerRetries += 1;
            nextAttempt = "provider-retry";
            continue;
          }
          if (canRepair) {
            candidateRepairs += 1;
            nextAttempt = "repair";
            continue;
          }
          return this.#unavailable(key, checkpoint, generatorResult.status === "ok" ? "invalid_schema" : generatorResult.status, signal, generatorDetail);
        }
        await this.#finishPublicStage(
          agentRunId,
          "generator",
          attemptNumber,
          generatorStartedAt,
          "succeeded",
          "Generator已返回候选，进入确定性安全与Schema检查。",
          { metrics: [{ metricId: "source-count", label: "引用来源", value: `${generatorResult.sourceRefs.length}项`, tone: "neutral" }] },
        );
        generator = generatorResult.payload as GeneratorOutput;
        const safetyStartedAt = await this.#beginPublicStage(
          agentRunId,
          "safety",
          attemptNumber,
          artifactKind === "card"
            ? "正在检查提醒字段、正文依据、画像响应、来源绑定和敏感信息边界。"
            : "正在检查题量、字段、答案唯一性、来源绑定和敏感信息边界。",
        );
        const parsed = parseGeneratorArtifact(generator, artifactKind, context, excludedIds);
        artifact = parsed.ok ? parsed.artifact : undefined;
        generatorDetail = parsed.ok ? "candidate_risk_flags_mismatch" : parsed.detail;
        if (parsed.ok && generatorRiskIsBound(parsed.artifact, generator)) {
          artifact = parsed.artifact;
          checkpoint.safetyAudit = clone(parsed.safetyAudit);
          await this.#finishPublicStage(
            agentRunId,
            "safety",
            attemptNumber,
            safetyStartedAt,
            "succeeded",
            parsed.safetyAudit.normalization === "quiz_option_order_balanced"
              ? "候选已通过确定性检查；Safety按固定算法标准化了单选题选项顺序，并保留前后哈希供审核链核对。"
              : "候选已通过确定性安全与输出合同检查，候选内容未发生标准化改写。",
            {
              metrics: [
                { metricId: "question-count", label: "候选题量", value: artifact.artifactKind === "quiz" ? `${artifact.value.length}道` : "1份卡片", tone: "success" },
                { metricId: "risk-level", label: "风险等级", value: artifact.riskLevel === "high" ? "高风险" : "低风险", tone: artifact.riskLevel === "high" ? "warning" : "success" },
                { metricId: "normalization", label: "确定性标准化", value: parsed.safetyAudit.normalization, tone: parsed.safetyAudit.normalization === "none" ? "success" : "warning" },
                { metricId: "input-sha256", label: "输入候选哈希", value: parsed.safetyAudit.inputCandidateSha256.slice(0, 12), tone: "neutral" },
                { metricId: "output-sha256", label: "输出候选哈希", value: parsed.safetyAudit.outputCandidateSha256.slice(0, 12), tone: "neutral" },
              ],
            },
          );
          break;
        }
        artifact = undefined;
        delete checkpoint.safetyAudit;
        const hasNextAttempt = attempt + 1 < 3;
        const canRepair = hasNextAttempt && candidateRepairs < 2;
        await this.#finishPublicStage(
          agentRunId,
          "safety",
          attemptNumber,
          safetyStartedAt,
          canRepair ? "revised" : "failed",
          canRepair ? "候选未通过确定性检查，将返回Generator定向修复。" : `候选重复违反确定性合同，已停止${artifactLabel}发布。`,
          {
            metrics: [{ metricId: "failure-category", label: "失败类别", value: generatorDetail, tone: "danger" }],
            issueCategories: ["确定性合同不符"],
          },
        );
        if (canRepair) {
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
      delete checkpoint.pendingJudgeRepairInstruction;
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
    if (artifact === undefined || safeGenerator === undefined || checkpoint.requiresReview !== true) {
      return this.#unavailable(key, checkpoint, "checkpoint_incomplete", signal);
    }
    const reviewGenerator = privateReviewGenerator(artifact, safeGenerator);
    if (checkpoint.safetyAudit === undefined) {
      return this.#unavailable(key, checkpoint, "safety_audit_missing", signal);
    }
    const auditedReviewContext = { ...reviewContext, safetySummary: clone(checkpoint.safetyAudit) };

    let hunter = checkpoint.hunter;
    if (hunter === undefined) {
      checkpoint.stage = "hunter"; checkpoint.updatedAt = iso(this.#clock.now());
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
      const hunterInput = { context: auditedReviewContext, generator: reviewGenerator };
      let hunterFailure = "unknown";
      const reviewRound = checkpoint.judgeRevisionCount ?? 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const attemptNumber = reviewRound * 2 + attempt + 1;
        const hunterStartedAt = await this.#beginPublicStage(
          agentRunId,
          "hunter",
          attemptNumber,
          attempt === 0
            ? artifactKind === "card"
              ? "Hunter正在反向检查正文依据、画像响应、错误示例和越权表述。"
              : "Hunter正在反向检查歧义、错误、来源不足和高风险答案。"
            : `Hunter上一轮未形成有效审查（${hunterFailure}），正在按合同重试。`,
        );
        const currentHunterInput = attempt === 0
          ? hunterInput
          : {
              ...hunterInput,
              reviewInstruction: hunterFailure === "hunter_contract"
                ? "Hunter只负责找错和举证。issues非空时recommendedVerdict必须为revise，issues为空时必须为accepted；高风险候选至少报告一个具体问题。requiresDefender只是兼容建议字段，不拥有服务端路由权。"
                : `上一轮失败类别=${hunterFailure}。只返回Hunter三字段JSON，并纠正该失败类别。`,
            };
        const hunterResult = await this.#execute(
          "hunter",
          `${generationRunId}.hunter${attempt === 0 ? "" : ".retry"}`,
          context.profileRevision,
          currentHunterInput,
          signal,
        );
        checkpoint.stageOrder.push(attempt === 0 ? "hunter" : "hunter-retry"); checkpoint.updatedAt = iso(this.#clock.now());
        let outputValid = false;
        let sourcesValid = false;
        let authorityValid = false;
        let hunterOutput: HunterOutput | undefined;
        let closureValid = false;
        try {
          outputValid = hunterResult.status === "ok" && graphs.hunter.validateOutput(hunterResult.payload);
          sourcesValid = outputValid
            && resultSourcesAreSafe(hunterResult, context.sourceAnchorIds)
            && hunterEvidenceSourcesAreSafe(hunterResult.payload as HunterOutput, context.sourceAnchorIds);
          authorityValid = outputValid && !containsAdaptiveAuthorityViolation(hunterResult.payload);
          hunterOutput = outputValid ? hunterResult.payload as HunterOutput : undefined;
          closureValid = hunterOutput !== undefined && hunterIsClosed(hunterOutput, artifact.riskLevel);
        } catch {
          hunterFailure = "hunter_processing_error";
          const retryable = attempt === 0;
          await this.#finishPublicStage(
            agentRunId,
            "hunter",
            attemptNumber,
            hunterStartedAt,
            retryable ? "revised" : "failed",
            retryable ? "Hunter结果处理出现异常，正在使用同一候选执行一次隔离重试。" : "Hunter结果处理连续异常，未发布未经完整审核的AI内容。",
            {
              metrics: [{ metricId: "failure-category", label: "失败类别", value: hunterFailure, tone: "danger" }],
              issueCategories: ["审查处理异常"],
            },
          );
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
          if (retryable) continue;
          return this.#unavailable(key, checkpoint, "hunter_invalid", signal, hunterFailure);
        }
        if (!outputValid || !sourcesValid || !authorityValid || !closureValid) {
          hunterFailure = hunterResult.status !== "ok"
            ? `status_${hunterResult.status}_${hunterResult.errorCode ?? "unknown"}`
            : !graphs.hunter.validateOutput(hunterResult.payload) ? "hunter_schema"
              : !sourcesValid ? "hunter_source_refs"
                : !authorityValid ? "hunter_authority" : "hunter_contract";
          const retryable = attempt === 0;
          await this.#finishPublicStage(
            agentRunId,
            "hunter",
            attemptNumber,
            hunterStartedAt,
            retryable ? "revised" : "failed",
            retryable ? "Hunter返回结果未通过审查合同，将按失败类别受控重试。" : "Hunter未形成可验证的安全审查结论。",
            {
              metrics: [
                { metricId: "result-status", label: "执行结果", value: hunterResult.status, tone: "danger" },
                { metricId: "failure-category", label: "失败类别", value: hunterFailure, tone: "danger" },
              ],
              issueCategories: ["审查合同不符"],
            },
          );
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
          if (retryable) continue;
          return this.#unavailable(key, checkpoint, hunterResult.status === "ok" ? "hunter_invalid" : hunterResult.status, signal, hunterFailure);
        }
        hunter = hunterOutput!; checkpoint.hunter = clone(hunter);
        const hunterCategories = [...new Set(hunter.issues.map((issue) => issue.category))];
        const hunterSourceIds = uniqueIds(hunter.issues.flatMap((issue) => issue.sourceAnchorIds));
        await this.#finishPublicStage(agentRunId, "hunter", attemptNumber, hunterStartedAt, "succeeded", hunter.issues.length === 0
          ? "Hunter未发现需要阻塞发布的问题。"
          : `Hunter发现${hunter.issues.length}项问题（${hunterCategories.join("、") || "待分类"}），已提交Judge独立裁决。`, {
          metrics: [
            { metricId: "issue-count", label: "问题数量", value: `${hunter.issues.length}项`, tone: hunter.issues.length === 0 ? "success" : "warning" },
            { metricId: "hunter-route-advice", label: "Hunter路由建议", value: hunter.requiresDefender ? "建议辩护" : "未建议辩护", tone: hunter.requiresDefender ? "warning" : "neutral" },
            { metricId: "issue-categories", label: "问题类别", value: hunterCategories.join("、") || "无", tone: hunterCategories.length === 0 ? "success" : "warning" },
          ],
          issueCategories: [...new Set(hunter.issues.map((issue) => `${issue.severity}风险`))],
          sourceClaimIds: hunterSourceIds,
        });
        await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        break;
      }
      if (hunter === undefined) return this.#unavailable(key, checkpoint, "hunter_invalid", signal, hunterFailure);
    }
    let defender = checkpoint.defender;
    const route = defenderRoute(hunter);
    if (route.required) {
      const defenderHunter = highRiskHunterOutput(hunter);
      if (defender === undefined) {
        checkpoint.stage = "defender"; checkpoint.updatedAt = iso(this.#clock.now());
        await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        const defenderInput = { context: auditedReviewContext, generator: reviewGenerator, hunter: defenderHunter };
        let defenderFailure = "unknown";
        const reviewRound = checkpoint.judgeRevisionCount ?? 0;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const defenderAttemptNumber = reviewRound * 2 + attempt + 1;
          const defenderStartedAt = await this.#beginPublicStage(
            agentRunId,
            "defender",
            defenderAttemptNumber,
            attempt === 0
              ? "Hunter报告了high风险问题，Defender正在依据正文逐项辩护或承认。"
              : `Defender上一轮输出未通过合同校验（${defenderFailure}），正在按问题ID定向重试。`,
          );
          const currentDefenderInput = attempt === 0
            ? defenderInput
            : { ...defenderInput, reviewInstruction: defenderRepairInstruction(defenderFailure, defenderHunter) };
          const revisionSuffix = reviewRound === 0 ? "" : `.revision-${reviewRound}`;
          const defenderResult = await this.#execute(
            "defender",
            `${generationRunId}.defender${revisionSuffix}${attempt === 0 ? "" : ".contract-repair"}`,
            context.profileRevision,
            currentDefenderInput,
            signal,
          );
          checkpoint.stageOrder.push(attempt === 0 ? "defender" : "defender-retry"); checkpoint.updatedAt = iso(this.#clock.now());
          const outputValid = defenderResult.status === "ok" && graphs.defender.validateOutput(defenderResult.payload);
          const sourcesValid = outputValid
            && resultSourcesAreSafe(defenderResult, context.sourceAnchorIds)
            && defenderEvidenceSourcesAreSafe(defenderResult.payload as DefenderOutput, context.sourceAnchorIds);
          const authorityValid = outputValid && !containsAdaptiveAuthorityViolation(defenderResult.payload);
          const closureValid = outputValid && defenderOutputIsClosed(defenderResult.payload as DefenderOutput, defenderHunter);
          if (!outputValid || !sourcesValid || !authorityValid || !closureValid) {
            defenderFailure = defenderResult.status !== "ok"
              ? `status_${defenderResult.status}_${defenderResult.errorCode ?? "unknown"}`
              : !graphs.defender.validateOutput(defenderResult.payload) ? "defender_schema"
                : !sourcesValid ? "defender_source_refs"
                  : !authorityValid ? "defender_authority" : "defender_issue_closure";
            const retryable = attempt === 0;
            await this.#finishPublicStage(
              agentRunId,
              "defender",
              defenderAttemptNumber,
              defenderStartedAt,
              retryable ? "revised" : "failed",
              retryable
                ? "Defender输出未完整覆盖Hunter问题，正在按原问题ID修复一次。"
                : "Defender连续未形成可验证的逐项回应，未发布未经完整审核的AI内容。",
              {
                metrics: [
                  { metricId: "result-status", label: "执行结果", value: defenderResult.status, tone: "danger" },
                  { metricId: "failure-category", label: "失败类别", value: defenderFailure, tone: "danger" },
                ],
                issueCategories: ["辩护合同不符"],
              },
            );
            await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
            if (retryable) continue;
            return this.#unavailable(
              key,
              checkpoint,
              defenderResult.status === "ok" ? "defender_invalid" : defenderResult.status,
              signal,
              defenderFailure,
            );
          }
          defender = defenderResult.payload as DefenderOutput; checkpoint.defender = clone(defender);
          const concededIssueIds = defenderConcededIssueIds(defender);
          const rebuttedIssueIds = defenderRebuttedIssueIds(defender);
          const residualRisks = defenderResidualRisks(defender);
          const defenderSourceIds = uniqueIds(defender.issueAssessments.flatMap((assessment) => assessment.sourceAnchorIds));
          await this.#finishPublicStage(agentRunId, "defender", defenderAttemptNumber, defenderStartedAt, "succeeded", `Defender已逐项回应Hunter证据（承认${concededIssueIds.length}项、反驳${rebuttedIssueIds.length}项），交由Judge独立裁决。`, {
            metrics: [
              { metricId: "accepted-issues", label: "承认问题", value: `${concededIssueIds.length}项`, tone: concededIssueIds.length > 0 ? "warning" : "neutral" },
              { metricId: "rebutted-issues", label: "完成反驳", value: `${rebuttedIssueIds.length}项`, tone: "neutral" },
              { metricId: "residual-risks", label: "剩余风险", value: `${residualRisks.length}项`, tone: residualRisks.length > 0 ? "danger" : "success" },
            ],
            sourceClaimIds: defenderSourceIds,
          });
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
          break;
        }
        if (defender === undefined) return this.#unavailable(key, checkpoint, "defender_invalid", signal, defenderFailure);
      }
    } else {
      await this.#recordSkippedStage(agentRunId, "defender", "Hunter未报告high风险问题，按节流规则跳过Defender并直接交给Judge。", [
        { metricId: "trigger", label: "程序路由结论", value: "无high风险问题", tone: "success" },
      ]);
    }
    checkpoint.stage = "judge"; checkpoint.updatedAt = iso(this.#clock.now());
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    const baseJudgeInput = { context: auditedReviewContext, generator: reviewGenerator, hunter,
      ...(defender === undefined ? {} : { defender }) };
    let acceptedJudge: JudgeOutput | undefined;
    let judgeDetail = "unknown";
    const judgeAttemptOffset = (checkpoint.judgeRevisionCount ?? 0) * 2;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptNumber = judgeAttemptOffset + attempt + 1;
      const judgeInput = attempt === 0
        ? baseJudgeInput
        : { ...baseJudgeInput, reviewInstruction: `上一轮裁决未通过确定性校验，失败类别=${judgeDetail}。请只修复裁决结构和问题闭合。` };
      const judgeStartedAt = await this.#beginPublicStage(
        agentRunId,
        "judge",
        attemptNumber,
        attempt === 0 ? "Judge正在综合候选、Hunter问题和Defender辩护作最终裁决。" : "Judge正在修复上一轮裁决结构并重新闭合问题。",
      );
      const judgeRoundSuffix = (checkpoint.judgeRevisionCount ?? 0) === 0 ? "" : `.revision-${checkpoint.judgeRevisionCount}`;
      const judgeResult = await this.#execute("judge", `${generationRunId}.judge${judgeRoundSuffix}${attempt === 0 ? "" : ".contract-repair"}`,
        context.profileRevision, judgeInput, signal);
      checkpoint.stageOrder.push(attempt === 0 ? "judge" : "judge-repair"); checkpoint.updatedAt = iso(this.#clock.now());
      if (judgeResult.status !== "ok") {
        judgeDetail = `status_${judgeResult.status}_${judgeResult.errorCode ?? "unknown"}`;
        const canRetry = attempt === 0 && (judgeResult.status === "invalid_output" || judgeResult.status === "provider_error");
        await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, canRetry ? "revised" : "failed",
          canRetry ? "本轮裁决未形成有效结构，将按预算修复一次。" : "Judge未形成可验证裁决。", {
            metrics: [{ metricId: "failure-category", label: "失败类别", value: judgeDetail, tone: "danger" }],
            issueCategories: ["裁决执行异常"],
          });
        if (canRetry) continue;
        return this.#unavailable(
          key,
          checkpoint,
          judgeResult.status === "invalid_output" ? "judge_invalid" : judgeResult.status,
          signal,
          judgeDetail,
        );
      }
      if (!graphs.judge.validateOutput(judgeResult.payload)) {
        judgeDetail = "invalid_schema";
        await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, attempt === 0 ? "revised" : "failed",
          attempt === 0 ? "裁决结构未通过确定性校验，将定向修复一次。" : "裁决结构连续无效，本轮未形成可验证的Judge结论。", {
            metrics: [{ metricId: "failure-category", label: "失败类别", value: judgeDetail, tone: "danger" }],
          });
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_invalid", signal, judgeDetail);
      }
      if (!resultSourcesAreSafe(judgeResult, context.sourceAnchorIds)
        || !judgeEvidenceSourcesAreSafe(judgeResult.payload, context.sourceAnchorIds)) {
        judgeDetail = "invalid_source_refs";
        await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, attempt === 0 ? "revised" : "failed",
          attempt === 0 ? "裁决证据引用未绑定来源，将按允许来源修复一次。" : "裁决连续引用未绑定来源，本轮未形成可验证的Judge结论。", {
          issueCategories: ["来源未绑定"],
        });
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_invalid", signal, judgeDetail);
      }
      if (containsAdaptiveAuthorityViolation(judgeResult.payload)) {
        judgeDetail = "authority_violation";
        await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, attempt === 0 ? "revised" : "failed",
          attempt === 0 ? "裁决触碰安全边界，将清除违规内容后修复一次。" : "裁决连续触碰安全边界，本轮未形成可验证的Judge结论。", {
            issueCategories: ["权威边界冲突"],
          });
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_invalid", signal, judgeDetail);
      }
      if (!judgeOutputIsClosed(judgeResult.payload, hunter)) {
        judgeDetail = "invalid_issue_closure";
        await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, attempt === 0 ? "revised" : "failed",
          attempt === 0 ? "问题闭合关系不完整，将定向修复一次。" : "问题闭合关系连续无效，本轮未形成可验证的Judge结论。", {
            issueCategories: ["问题闭合不完整"],
          });
        if (attempt === 0) continue;
        return this.#unavailable(key, checkpoint, "judge_invalid", signal, judgeDetail);
      }
      if (judgeResult.payload.verdict === "rejected") {
        const judgeSourceIds = uniqueIds([
          ...judgeResult.payload.issueDecisions.flatMap((decision) => decision.sourceAnchorIds),
          ...judgeResult.payload.additionalIssues.flatMap((issue) => issue.sourceAnchorIds),
        ]);
        await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, "rejected", `Judge确认存在无法安全闭合的问题（阻塞${judgeResult.payload.blockedIssueIds.length}项），拒绝发布本轮${artifactLabel}。`, {
          metrics: [{ metricId: "verdict", label: "裁决", value: "rejected", tone: "danger" }],
          issueCategories: ["Judge最终拒绝"], decision: "rejected", sourceClaimIds: judgeSourceIds,
        });
        checkpoint.judge = clone(judgeResult.payload);
        await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        return this.#unavailable(key, checkpoint, "judge_rejected", signal, "verdict_rejected");
      }
      if (judgeResult.payload.verdict === "revise") {
        const revisionCount = checkpoint.judgeRevisionCount ?? 0;
        const canReviseCandidate = revisionCount < 1;
        await this.#finishPublicStage(
          agentRunId,
          "judge",
          attemptNumber,
          judgeStartedAt,
          canReviseCandidate ? "revised" : "rejected",
          canReviseCandidate
            ? `Judge已确认阻塞问题，授权Generator执行一次受控返修；返修候选将从Safety开始完整重审。`
            : `Judge再次要求返修，但本轮受控返修预算已耗尽，停止发布${artifactLabel}。`,
          {
            metrics: [
              { metricId: "verdict", label: "裁决", value: "revise", tone: "warning" },
              { metricId: "blocked-count", label: "阻塞问题", value: `${judgeResult.payload.blockedIssueIds.length}项`, tone: "danger" },
              { metricId: "revision-budget", label: "候选返修预算", value: canReviseCandidate ? "剩余1次" : "已耗尽", tone: canReviseCandidate ? "warning" : "danger" },
            ],
            issueCategories: [canReviseCandidate ? "Judge要求返修" : "返修预算耗尽"],
            decision: canReviseCandidate ? "revise" : "rejected",
            sourceClaimIds: uniqueIds([
              ...judgeResult.payload.issueDecisions.flatMap((decision) => decision.sourceAnchorIds),
              ...judgeResult.payload.additionalIssues.flatMap((issue) => issue.sourceAnchorIds),
            ]),
          },
        );
        checkpoint.judge = clone(judgeResult.payload);
        if (!canReviseCandidate) {
          await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
          return this.#unavailable(key, checkpoint, "judge_repair_exhausted", signal, "verdict_revise_budget_exhausted");
        }
        checkpoint.judgeRevisionCount = revisionCount + 1;
        checkpoint.pendingJudgeRepairInstruction = judgeRepairInstruction(judgeResult.payload);
        checkpoint.stage = "generator";
        delete checkpoint.candidate;
        delete checkpoint.publicGenerator;
        delete checkpoint.hunter;
        delete checkpoint.defender;
        delete checkpoint.judge;
        await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
        return this.#generate(
          key,
          artifactKind,
          context,
          excludedIds,
          retryNumber,
          startedAt,
          signal,
          checkpoint,
          agentRunId,
        );
      }
      await this.#finishPublicStage(agentRunId, "judge", attemptNumber, judgeStartedAt, "succeeded", `Judge综合正文与审核意见完成裁决，确认问题已闭合，允许发布本轮${artifactLabel}。`, {
        metrics: [
          { metricId: "verdict", label: "裁决", value: "accepted", tone: "success" },
          { metricId: "blocked-count", label: "阻塞问题", value: `${judgeResult.payload.blockedIssueIds.length}项`, tone: judgeResult.payload.blockedIssueIds.length === 0 ? "success" : "danger" },
          { metricId: "overruled-count", label: "推翻Hunter指控", value: `${judgeResult.payload.issueDecisions.filter((decision) => decision.decision === "overruled").length}项`, tone: "neutral" },
          { metricId: "additional-count", label: "Judge补充问题", value: `${judgeResult.payload.additionalIssues.length}项`, tone: judgeResult.payload.additionalIssues.length === 0 ? "success" : "warning" },
        ],
        decision: "accepted",
        sourceClaimIds: uniqueIds([
          ...judgeResult.payload.issueDecisions.flatMap((decision) => decision.sourceAnchorIds),
          ...judgeResult.payload.additionalIssues.flatMap((issue) => issue.sourceAnchorIds),
        ]),
      });
      acceptedJudge = judgeResult.payload;
      break;
    }
    if (acceptedJudge === undefined) return this.#unavailable(key, checkpoint, "judge_rejected", signal, judgeDetail);
    checkpoint.judge = clone(acceptedJudge);
    return this.#accepted(key, checkpoint, artifact, signal);
  }

  async #beginPublicStage(
    agentRunId: string | undefined,
    role: keyof typeof PUBLIC_STAGE_LABELS,
    attemptNumber: number,
    publicSummary: string,
    metrics: AppendAgentStageInput["metrics"] = [],
  ): Promise<number> {
    const startedAt = this.#clock.now();
    if (agentRunId !== undefined && this.#options.agentRuns !== undefined) {
      await this.#appendPublicStage(agentRunId, {
        role,
        label: PUBLIC_STAGE_LABELS[role],
        status: "running",
        startedAt: iso(startedAt),
        attemptNumber,
        publicSummary,
        metrics,
      });
    }
    return startedAt;
  }

  async #finishPublicStage(
    agentRunId: string | undefined,
    role: keyof typeof PUBLIC_STAGE_LABELS,
    attemptNumber: number,
    startedAt: number,
    status: Exclude<AppendAgentStageInput["status"], "queued" | "running">,
    publicSummary: string,
    options: Pick<AppendAgentStageInput, "metrics" | "issueCategories" | "decision" | "sourceClaimIds"> = {},
  ): Promise<void> {
    if (agentRunId === undefined || this.#options.agentRuns === undefined) return;
    const finishedAt = this.#clock.now();
    await this.#appendPublicStage(agentRunId, {
      role,
      label: PUBLIC_STAGE_LABELS[role],
      status,
      startedAt: iso(startedAt),
      finishedAt: iso(finishedAt),
      durationMs: Math.max(0, finishedAt - startedAt),
      attemptNumber,
      publicSummary,
      ...options,
    });
  }

  async #recordSkippedStage(
    agentRunId: string | undefined,
    role: keyof typeof PUBLIC_STAGE_LABELS,
    publicSummary: string,
    metrics: AppendAgentStageInput["metrics"] = [],
  ): Promise<void> {
    if (agentRunId === undefined || this.#options.agentRuns === undefined) return;
    const now = this.#clock.now();
    await this.#appendPublicStage(agentRunId, {
      role,
      label: PUBLIC_STAGE_LABELS[role],
      status: "skipped",
      startedAt: iso(now),
      finishedAt: iso(now),
      durationMs: 0,
      attemptNumber: 1,
      publicSummary,
      metrics,
    });
  }

  async #appendPublicStage(agentRunId: string, event: AppendAgentStageInput): Promise<void> {
    if (this.#closedAgentRunIds.has(agentRunId)) return;
    const repository = this.#options.agentRuns;
    if (repository === undefined) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await repository.append(agentRunId, event);
        return;
      } catch (error) {
        const persisted = await repository.getByRunId(agentRunId).catch(() => undefined);
        const alreadyWritten = persisted?.stages.some((stage) => stage.role === event.role
          && stage.status === event.status
          && stage.attemptNumber === event.attemptNumber
          && stage.startedAt === event.startedAt
          && stage.publicSummary === event.publicSummary) === true;
        if (alreadyWritten) return;
        if (attempt === 1) throw error;
      }
    }
  }

  async #recordUnexpectedPipelineFailure(agentRunId: string | undefined): Promise<void> {
    const repository = this.#options.agentRuns;
    if (agentRunId === undefined || repository === undefined) return;
    try {
      const run = await repository.getByRunId(agentRunId);
      const stages = run?.stages ?? [];
      let running: (typeof stages)[number] | undefined;
      for (let index = stages.length - 1; index >= 0; index -= 1) {
        const candidate = stages[index]!;
        if (candidate.status !== "running" || !Object.hasOwn(PUBLIC_STAGE_LABELS, candidate.role)) continue;
        const hasTerminalPair = stages.slice(index + 1).some((stage) => stage.role === candidate.role
          && stage.attemptNumber === candidate.attemptNumber
          && stage.startedAt === candidate.startedAt
          && stage.status !== "queued"
          && stage.status !== "running");
        if (!hasTerminalPair) {
          running = candidate;
          break;
        }
      }
      if (running === undefined) return;
      const role = running.role as keyof typeof PUBLIC_STAGE_LABELS;
      const finishedAt = this.#clock.now();
      await this.#appendPublicStage(agentRunId, {
        role,
        label: PUBLIC_STAGE_LABELS[role],
        status: "failed",
        startedAt: running.startedAt,
        finishedAt: iso(finishedAt),
        durationMs: Math.max(0, finishedAt - Date.parse(running.startedAt)),
        attemptNumber: running.attemptNumber,
        publicSummary: `${PUBLIC_STAGE_LABELS[role]}出现未预期的处理异常，本轮内容未发布。`,
        metrics: [{ metricId: "failure-category", label: "失败类别", value: "stage_processing_error", tone: "danger" }],
        issueCategories: ["工位处理异常"],
      });
    } catch {
      // Public observability must never expose raw provider or storage errors.
    }
  }

  async #recordOwnedTimeout(agentRunId: string | undefined): Promise<void> {
    const repository = this.#options.agentRuns;
    if (agentRunId === undefined || repository === undefined) return;
    try {
      const run = await repository.getByRunId(agentRunId);
      if (run === undefined || ["succeeded", "failed", "fallback"].includes(run.status)) return;
      let running: (typeof run.stages)[number] | undefined;
      for (let index = run.stages.length - 1; index >= 0; index -= 1) {
        const candidate = run.stages[index]!;
        if (candidate.status !== "running" || !Object.hasOwn(PUBLIC_STAGE_LABELS, candidate.role)) continue;
        const hasTerminalPair = run.stages.slice(index + 1).some((stage) => stage.role === candidate.role
          && stage.attemptNumber === candidate.attemptNumber
          && stage.startedAt === candidate.startedAt
          && stage.status !== "queued" && stage.status !== "running");
        if (!hasTerminalPair) { running = candidate; break; }
      }
      if (running === undefined) return;
      const finishedAt = this.#clock.now();
      await repository.append(agentRunId, {
        role: running.role,
        label: running.label,
        status: "failed",
        startedAt: running.startedAt,
        finishedAt: iso(finishedAt),
        durationMs: Math.max(0, finishedAt - Date.parse(running.startedAt)),
        attemptNumber: running.attemptNumber,
        publicSummary: `${running.label}超过${Math.ceil(this.#fallbackAfterMs / 1_000)}秒仍未完成，已取消本轮模型执行并转入固定保障。`,
        metrics: [{ metricId: "failure-category", label: "失败类别", value: "generation_timeout", tone: "danger" }],
        issueCategories: ["生成超时"],
      });
    } catch {
      // The upper runtime may already own and finalize this run.
    }
  }

  async #recordReviewedCache(agentRunId: string | undefined, source: "immediate" | "late", artifactKind: AdaptiveArtifactKind): Promise<void> {
    if (agentRunId === undefined || this.#options.agentRuns === undefined) return;
    const cacheMetric = [{ metricId: "cache-source", label: "复用来源", value: source === "late" ? "延迟审核缓存" : "已审核缓存", tone: "neutral" as const }];
    const artifactLabel = artifactKind === "card" ? "个性化提醒" : "题组";
    await this.#recordSkippedStage(agentRunId, "generator", `命中同一正文、版本和上下文下的已审核${artifactLabel}，本次未重新调用Generator。`, cacheMetric);
    await this.#recordSkippedStage(agentRunId, "safety", `已复用原${artifactLabel}的确定性安全检查结论。`, cacheMetric);
    await this.#recordSkippedStage(agentRunId, "hunter", `已复用原${artifactLabel}的Hunter审核结论。`, cacheMetric);
    await this.#recordSkippedStage(agentRunId, "defender", `已复用原${artifactLabel}的Defender条件执行结论。`, cacheMetric);
    await this.#recordSkippedStage(agentRunId, "judge", `已复用原${artifactLabel}的Judge接受结论。`, cacheMetric);
  }

  async #execute(graphId: "generator" | "hunter" | "defender" | "judge", runId: string, profileRevision: number,
    safeContext: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ModelExecutionResult> {
    try {
      const result = await this.#options.modelExecutionPort.execute({
        graphId, runId, profileRevision, promptVersion: this.#options.promptVersion,
        safeContext, budget: { timeoutMs: this.#discardAfterMs },
      }, signal);
      if (signal.aborted) {
        return { status: "timeout", errorCode: this.#deadlineReasonCode(), sourceRefs: [],
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
    const acceptedReviewProof = buildAcceptedReviewProof(checkpoint, artifact);
    if (acceptedReviewProof === undefined) return this.#unavailable(key, checkpoint, "accepted_review_proof_invalid", signal);
    checkpoint.stage = "accepted"; checkpoint.candidate = clone(artifact); checkpoint.acceptedReviewProof = acceptedReviewProof;
    checkpoint.updatedAt = iso(this.#clock.now());
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    await this.#options.privateStore.write("adaptive-trace", checkpoint.generationRunId, {
      artifactKind: checkpoint.artifactKind, generationRunId: checkpoint.generationRunId,
      stageOrder: checkpoint.stageOrder, status: "accepted", modelId: checkpoint.modelId,
      promptVersion: checkpoint.promptVersion, candidateSha256: acceptedReviewProof.candidateSha256,
      judgeVerdict: acceptedReviewProof.judge.verdict,
    });
    return clone(artifact);
  }

  async #publicUnavailableResult(key: string, includeReason: boolean): Promise<{
    status: "unavailable";
    reasonCode?: AdaptiveContentUnavailableReason;
  }> {
    const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    const reasonCode = checkpoint?.reasonCode;
    if (reasonCode === "judge_rejected") return includeReason ? { status: "unavailable", reasonCode: "review_rejected" } : { status: "unavailable" };
    if (reasonCode === "judge_repair_exhausted") return includeReason ? { status: "unavailable", reasonCode: "repair_exhausted" } : { status: "unavailable" };
    if (reasonCode === "timeout" || reasonCode?.startsWith("discard_after_") === true) {
      return includeReason ? { status: "unavailable", reasonCode: "generation_timeout" } : { status: "unavailable" };
    }
    // A still-running checkpoint means the caller reached its bounded wait.
    if (checkpoint !== undefined && checkpoint.stage !== "unavailable" && checkpoint.stage !== "discarded") {
      return includeReason ? { status: "unavailable", reasonCode: "generation_timeout" } : { status: "unavailable" };
    }
    return { status: "unavailable" };
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

  async #cache(key: string, artifact: AcceptedArtifact, source: "immediate" | "late", context: AdaptiveContentSourceContext,
    acceptedReviewProof: AdaptiveAcceptedReviewProof): Promise<void> {
    await this.#options.privateStore.write<AdaptiveCacheRecord>("adaptive-cache", key, {
      artifactKind: artifact.artifactKind, profileRevision: Number(key.split(":")[1]), targetId: key.split(":")[2] ?? "unknown",
      ...(context.targetKnowledgePointIds === undefined ? {} : { targetKnowledgePointIds: targetKnowledgePointIds(context) }),
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion,
      ...(context.lessonVariantId === undefined ? {} : { lessonVariantId: context.lessonVariantId }),
      ...(personalizationContextSha256(context) === undefined ? {} : { personalizationContextSha256: personalizationContextSha256(context) }),
      ...(remediationContextSha256(context) === undefined ? {} : { remediationContextSha256: remediationContextSha256(context) }),
      artifact: clone(artifact), acceptedReviewProof: clone(acceptedReviewProof), cachedAt: iso(this.#clock.now()), source,
    });
  }

  async #markDiscarded(key: string): Promise<void> {
    const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (checkpoint !== undefined && checkpoint.publishedAt === undefined) {
      checkpoint.stage = "discarded"; checkpoint.reasonCode = this.#deadlineReasonCode();
      checkpoint.updatedAt = iso(this.#clock.now());
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
  }

  #deadlineReasonCode(): string {
    return this.#fallbackAfterMs % 1_000 === 0
      ? `discard_after_${this.#fallbackAfterMs / 1_000}s`
      : `discard_after_${this.#fallbackAfterMs}ms`;
  }

  #validateContext(context: AdaptiveContentSourceContext, artifactKind: AdaptiveArtifactKind): void {
    const { personalizationContext, ...authorityCheckedContext } = context;
    if (!Number.isInteger(context.profileRevision) || context.profileRevision < 1 || !safeId(context.knowledgePointId)
        || !safeId(context.targetId) || !safeText(context.title, 240) || !safeIdList(context.sourceAnchorIds)
        || (context.targetKnowledgePointIds !== undefined && !safeIdList(context.targetKnowledgePointIds, true))
        || (personalizationContext !== undefined && !this.#validPersonalizationContext(personalizationContext))
        || (context.remediationContext !== undefined && !this.#validRemediationContext(context.remediationContext, context.sourceAnchorIds))
        || !safeText(context.publicSourceSummary, 16_000) || containsAdaptiveAuthorityViolation(authorityCheckedContext)) {
      throw new Error(`Unsafe ${artifactKind} source context`);
    }
  }

  #validPersonalizationContext(context: LessonPersonalizationContext): boolean {
    return ["unverified", "support_needed", "learning", "ready", "mastered"].includes(context.knowledgeStatus)
      && (context.mastery === null || (Number.isFinite(context.mastery) && context.mastery >= 0 && context.mastery <= 1))
      && Number.isFinite(context.confidence) && context.confidence >= 0 && context.confidence <= 1
      && Number.isInteger(context.validEvidenceCount) && context.validEvidenceCount >= 0
      && Number.isInteger(context.evidenceFormCount) && context.evidenceFormCount >= 0
      && ["concise", "step_by_step", "example_first", "uncertain"].includes(context.explanationPreference)
      && (context.journey === undefined || (
        Number.isInteger(context.journey.currentPosition)
        && Number.isInteger(context.journey.totalLessons)
        && context.journey.currentPosition >= 1
        && context.journey.totalLessons === context.journey.lessons.length
        && context.journey.currentPosition <= context.journey.totalLessons
        && context.journey.totalLessons <= 12
        && context.journey.lessons.every((lesson) => safeId(lesson.knowledgePointId)
          && safeText(lesson.title, 240)
          && safeText(lesson.objective, 1_200))
      ));
  }

  #validRemediationContext(context: QuizRemediationContext, allowedSources: readonly string[]): boolean {
    return safeId(context.previousAttemptId)
      && safeIdList(context.excludedQuestionIds, true)
      && context.excludedQuestionPrompts.length > 0
      && context.excludedQuestionPrompts.length <= 32
      && context.excludedQuestionPrompts.every((prompt) => safeText(prompt))
      && new Set(context.excludedQuestionPrompts).size === context.excludedQuestionPrompts.length
      && context.missedQuestions.length > 0
      && context.missedQuestions.length <= 6
      && context.missedQuestions.every((item) => safeId(item.questionId)
        && context.excludedQuestionIds.includes(item.questionId)
        && safeText(item.prompt)
        && safeText(item.explanation)
        && safeIdList(item.sourceAnchorIds)
        && item.sourceAnchorIds.every((id) => allowedSources.includes(id)))
      && safeText(context.learnerProfileSummary)
      && safeIdList(context.learnerProfileEvidenceRefs, true)
      && (context.learnerProfileSource === "agent" || context.learnerProfileSource === "deterministic");
  }
}
