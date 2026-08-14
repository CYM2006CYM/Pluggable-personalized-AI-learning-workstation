import { createHash } from "node:crypto";
import type {
  AdaptiveContentPort,
  LearningCardSafeView,
  QuizQuestionPrivate,
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

export type AdaptiveArtifactKind = "card" | "quiz";

export interface AdaptiveContentSourceContext {
  profileRevision: number;
  knowledgePointId: string;
  targetId: string;
  title: string;
  sourceAnchorIds: string[];
  publicSourceSummary: string;
  estimatedMinutes?: number;
}

export interface AdaptiveContentSourceProvider {
  forCard(input: { profileRevision: number; knowledgePointId: string }): Promise<AdaptiveContentSourceContext>;
  forQuiz(input: { profileRevision: number; activityId: string }): Promise<AdaptiveContentSourceContext>;
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
}

type AcceptedArtifact =
  | { artifactKind: "card"; value: LearningCardSafeView }
  | { artifactKind: "quiz"; value: QuizQuestionPrivate[] };

interface GeneratorArtifactEnvelope {
  artifactKind: AdaptiveArtifactKind;
  riskLevel: "low" | "high";
  card?: LearningCardSafeView;
  questions?: QuizQuestionPrivate[];
}

interface AdaptiveCheckpoint {
  generationRunId: string;
  artifactKind: AdaptiveArtifactKind;
  profileRevision: number;
  targetId: string;
  modelId: string;
  promptVersion: string;
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

function isQuestion(value: unknown, allowedSources: ReadonlySet<string>, excluded: ReadonlySet<string>): value is QuizQuestionPrivate {
  if (!isRecord(value) || !exactKeys(value, [
    "questionId", "kind", "prompt", "options", "correctAnswer", "explanation", "sourceAnchorIds",
  ])) return false;
  if (!safeId(value.questionId) || excluded.has(value.questionId) || !safeText(value.prompt)
      || !safeText(value.explanation) || !safeIdList(value.sourceAnchorIds)
      || value.sourceAnchorIds.some((sourceId) => !allowedSources.has(sourceId))) return false;
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 6
      || !value.options.every((option) => safeText(option, 240)) || new Set(value.options).size !== value.options.length) return false;
  if (value.kind === "single_choice") return typeof value.correctAnswer === "string" && value.options.includes(value.correctAnswer);
  return value.kind === "judgment" && typeof value.correctAnswer === "boolean"
    && value.options.length === 2 && value.options.includes("true") && value.options.includes("false");
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

function parseGeneratorArtifact(
  output: GeneratorOutput,
  artifactKind: AdaptiveArtifactKind,
  context: AdaptiveContentSourceContext,
  excludedIds: readonly string[],
): AcceptedArtifact | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(output.candidateFeedback); } catch { return undefined; }
  if (!isRecord(parsed) || parsed.artifactKind !== artifactKind
      || (parsed.riskLevel !== "low" && parsed.riskLevel !== "high")) return undefined;
  const allowed = new Set(context.sourceAnchorIds);
  const excluded = new Set(excludedIds);
  if (artifactKind === "card") {
    if (!exactKeys(parsed, ["artifactKind", "riskLevel", "card"]) || !isCard(parsed.card, context, excluded)) return undefined;
    return { artifactKind, value: clone(parsed.card) };
  }
  if (!exactKeys(parsed, ["artifactKind", "riskLevel", "questions"]) || !Array.isArray(parsed.questions)
      || parsed.questions.length === 0 || parsed.questions.length > 6
      || !parsed.questions.every((question) => isQuestion(question, allowed, excluded))) return undefined;
  const questions = parsed.questions as QuizQuestionPrivate[];
  if (new Set(questions.map((question) => question.questionId)).size !== questions.length) return undefined;
  return { artifactKind, value: clone(questions) };
}

function publicCandidate(artifact: AcceptedArtifact): string {
  if (artifact.artifactKind === "card") return JSON.stringify({ artifactKind: "card", card: artifact.value });
  return JSON.stringify({
    artifactKind: "quiz",
    questions: artifact.value.map(({ correctAnswer: _answer, explanation: _explanation, ...safe }) => safe),
  });
}

function acceptedArtifactIsValid(value: unknown, artifactKind: AdaptiveArtifactKind,
  context: AdaptiveContentSourceContext, excludedIds: readonly string[]): value is AcceptedArtifact {
  if (!isRecord(value) || !exactKeys(value, ["artifactKind", "value"]) || value.artifactKind !== artifactKind) return false;
  const excluded = new Set(excludedIds);
  if (artifactKind === "card") return isCard(value.value, context, excluded);
  const allowed = new Set(context.sourceAnchorIds);
  return Array.isArray(value.value) && value.value.length > 0 && value.value.length <= 6
    && value.value.every((question) => isQuestion(question, allowed, excluded))
    && new Set(value.value.map((question) => (question as QuizQuestionPrivate).questionId)).size === value.value.length;
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

function hunterIsClosed(hunter: HunterOutput): boolean {
  const ids = hunter.issues.map((issue) => issue.issueId);
  const disputed = hunter.issues.filter((issue) => issue.disputed);
  return new Set(ids).size === ids.length && (!hunter.requiresDefender || disputed.length > 0);
}

function defenderIsClosed(defender: DefenderOutput, hunter: HunterOutput): boolean {
  const disputed = hunter.issues.filter((issue) => issue.disputed).map((issue) => issue.issueId);
  const combined = [...defender.acceptedIssueIds, ...defender.rebuttedIssueIds];
  return new Set(combined).size === combined.length && combined.length === disputed.length
    && combined.every((issueId) => disputed.includes(issueId));
}

function judgeIsClosed(judge: JudgeOutput, hunter: HunterOutput): boolean {
  const issueIds = new Set(hunter.issues.map((issue) => issue.issueId));
  return new Set(judge.blockedIssueIds).size === judge.blockedIssueIds.length
    && judge.blockedIssueIds.every((issueId) => issueIds.has(issueId))
    && (judge.verdict !== "accepted" || judge.blockedIssueIds.length === 0);
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

  async prepareCard(input: { profileRevision: number; knowledgePointId: string; excludedArtifactIds: string[] }) {
    try {
      const context = await this.#options.sourceProvider.forCard(input);
      const artifact = await this.#prepare("card", context, input.excludedArtifactIds, 0);
      return artifact?.artifactKind === "card"
        ? { status: "accepted" as const, card: clone(artifact.value) }
        : { status: "unavailable" as const };
    } catch { return { status: "unavailable" as const }; }
  }

  async prepareQuiz(input: { profileRevision: number; activityId: string; retryNumber: 0 | 1; excludedQuestionIds: string[] }) {
    try {
      const context = await this.#options.sourceProvider.forQuiz(input);
      const artifact = await this.#prepare("quiz", context, input.excludedQuestionIds, input.retryNumber);
      return artifact?.artifactKind === "quiz"
        ? { status: "accepted" as const, questions: clone(artifact.value) }
        : { status: "unavailable" as const };
    } catch { return { status: "unavailable" as const }; }
  }

  async #prepare(
    artifactKind: AdaptiveArtifactKind,
    context: AdaptiveContentSourceContext,
    excludedIds: readonly string[],
    retryNumber: 0 | 1,
  ): Promise<AcceptedArtifact | undefined> {
    this.#validateContext(context, artifactKind);
    const key = [artifactKind, context.profileRevision, context.targetId, retryNumber, [...excludedIds].sort().join(","),
      this.#options.modelId, this.#options.promptVersion].join(":");
    const cached = await this.#options.privateStore.read<AdaptiveCacheRecord>("adaptive-cache", key);
    if (cached !== undefined && cached.artifactKind === artifactKind
        && acceptedArtifactIsValid(cached.artifact, artifactKind, context, excludedIds)
        && cached.profileRevision === context.profileRevision && cached.targetId === context.targetId
        && cached.modelId === this.#options.modelId && cached.promptVersion === this.#options.promptVersion) {
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
    retryNumber: 0 | 1,
    startedAt: number,
    signal: AbortSignal,
    recovered?: AdaptiveCheckpoint,
  ): Promise<AcceptedArtifact | undefined> {
    const generationRunId = stableRunId(key);
    const boundRecovery = recovered !== undefined && recovered.generationRunId === generationRunId
      && recovered.artifactKind === artifactKind && recovered.profileRevision === context.profileRevision
      && recovered.targetId === context.targetId && recovered.modelId === this.#options.modelId
      && recovered.promptVersion === this.#options.promptVersion
      && recovered.stage !== "unavailable" && recovered.stage !== "discarded";
    const checkpoint: AdaptiveCheckpoint = boundRecovery ? clone(recovered) : {
      generationRunId, artifactKind, profileRevision: context.profileRevision, targetId: context.targetId,
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion,
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
        ...(context.estimatedMinutes === undefined ? [] : [`Required estimatedMinutes=${context.estimatedMinutes}.`]),
        "Candidate content is non-authoritative until deterministic application validation.",
      ].join(" "),
      sourceIds: [...context.sourceAnchorIds],
      sourceSummary: context.publicSourceSummary,
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
            || (checkpoint.candidate !== undefined
              && checkpoint.publicGenerator.candidateFeedback !== publicCandidate(checkpoint.candidate))))
        || (checkpoint.hunter !== undefined
          && (!graphs.hunter.validateOutput(checkpoint.hunter)
            || containsAdaptiveAuthorityViolation(checkpoint.hunter) || !hunterIsClosed(checkpoint.hunter)))
        || (checkpoint.defender !== undefined
          && (checkpoint.hunter === undefined || !graphs.defender.validateOutput(checkpoint.defender)
            || containsAdaptiveAuthorityViolation(checkpoint.defender)
            || !defenderIsClosed(checkpoint.defender, checkpoint.hunter)))
        || (checkpoint.judge !== undefined
          && (checkpoint.hunter === undefined || !graphs.judge.validateOutput(checkpoint.judge)
            || containsAdaptiveAuthorityViolation(checkpoint.judge)
            || !judgeIsClosed(checkpoint.judge, checkpoint.hunter)))) {
      return this.#unavailable(key, checkpoint, "invalid_recovered_checkpoint", signal);
    }
    let artifact = checkpoint.candidate;
    let safeGenerator = checkpoint.publicGenerator;
    if (artifact === undefined || safeGenerator === undefined || checkpoint.requiresReview === undefined) {
      const generatorInput = { context: reviewContext, allowedSourcesSummary: context.publicSourceSummary };
      const generatorResult = await this.#execute("generator", `${generationRunId}.generator`, context.profileRevision, generatorInput, signal);
      checkpoint.stageOrder.push("generator"); checkpoint.updatedAt = iso(this.#clock.now());
      if (generatorResult.status !== "ok" || !graphs.generator.validateOutput(generatorResult.payload)
          || !safeId(generatorResult.payload.artifactId) || !safeText(generatorResult.payload.rationale)
          || !generatorResult.payload.riskFlags.every((flag) => safeText(flag, 240))
          || generatorResult.payload.citedSourceIds.length === 0
          || generatorResult.payload.citedSourceIds.some((id) => !context.sourceAnchorIds.includes(id) || !generatorResult.sourceRefs.includes(id))
          || !resultSourcesAreSafe(generatorResult, context.sourceAnchorIds)
          || (graphs.generator.validateOutput(generatorResult.payload)
            && containsAdaptiveAuthorityViolation({ rationale: generatorResult.payload.rationale, riskFlags: generatorResult.payload.riskFlags }))) {
        return this.#unavailable(key, checkpoint, generatorResult.status === "ok" ? "invalid_schema" : generatorResult.status, signal);
      }
      const generator = generatorResult.payload;
      artifact = parseGeneratorArtifact(generator, artifactKind, context, excludedIds);
      if (artifact === undefined) return this.#unavailable(key, checkpoint, "invalid_schema_or_authority", signal);
      let envelope: GeneratorArtifactEnvelope;
      try { envelope = JSON.parse(generator.candidateFeedback) as GeneratorArtifactEnvelope; } catch {
        return this.#unavailable(key, checkpoint, "invalid_json", signal);
      }
      checkpoint.candidate = clone(artifact);
      checkpoint.requiresReview = artifactKind === "card" || envelope.riskLevel === "high" || generator.riskFlags.length > 0;
      safeGenerator = { ...generator, candidateFeedback: publicCandidate(artifact) };
      checkpoint.publicGenerator = clone(safeGenerator);
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
    if (artifact === undefined || safeGenerator === undefined || checkpoint.requiresReview === undefined) {
      return this.#unavailable(key, checkpoint, "checkpoint_incomplete", signal);
    }
    if (!checkpoint.requiresReview) return this.#accepted(key, checkpoint, artifact, signal);

    let hunter = checkpoint.hunter;
    if (hunter === undefined) {
      checkpoint.stage = "hunter"; checkpoint.updatedAt = iso(this.#clock.now());
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
      const hunterInput = { context: reviewContext, generator: safeGenerator };
      const hunterResult = await this.#execute("hunter", `${generationRunId}.hunter`, context.profileRevision, hunterInput, signal);
      checkpoint.stageOrder.push("hunter"); checkpoint.updatedAt = iso(this.#clock.now());
      if (hunterResult.status !== "ok" || !graphs.hunter.validateOutput(hunterResult.payload)
          || !resultSourcesAreSafe(hunterResult, context.sourceAnchorIds)
          || containsAdaptiveAuthorityViolation(hunterResult.payload) || !hunterIsClosed(hunterResult.payload)) {
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
        const defenderInput = { context: reviewContext, generator: safeGenerator, hunter };
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
    const judgeInput = { context: reviewContext, generator: safeGenerator, hunter, ...(defender === undefined ? {} : { defender }) };
    const judgeResult = await this.#execute("judge", `${generationRunId}.judge`, context.profileRevision, judgeInput, signal);
    checkpoint.stageOrder.push("judge"); checkpoint.updatedAt = iso(this.#clock.now());
    if (judgeResult.status !== "ok" || !graphs.judge.validateOutput(judgeResult.payload)
        || !resultSourcesAreSafe(judgeResult, context.sourceAnchorIds)
        || containsAdaptiveAuthorityViolation(judgeResult.payload)
        || !judgeIsClosed(judgeResult.payload, hunter) || judgeResult.payload.verdict !== "accepted") {
      return this.#unavailable(key, checkpoint, judgeResult.status === "ok" ? "judge_rejected" : judgeResult.status, signal);
    }
    checkpoint.judge = clone(judgeResult.payload);
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
        return { status: "timeout", errorCode: "discard_after_60s", sourceRefs: [],
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
    signal: AbortSignal): Promise<undefined> {
    if (signal.aborted || this.#discardedSignals.has(signal)) return undefined;
    const persisted = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (persisted?.stage === "discarded") return undefined;
    checkpoint.stage = "unavailable"; checkpoint.reasonCode = reasonCode; checkpoint.updatedAt = iso(this.#clock.now());
    await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    await this.#options.privateStore.write("adaptive-trace", checkpoint.generationRunId, {
      artifactKind: checkpoint.artifactKind, generationRunId: checkpoint.generationRunId,
      stageOrder: checkpoint.stageOrder, status: "unavailable", reasonCode,
      modelId: checkpoint.modelId, promptVersion: checkpoint.promptVersion,
    });
    return undefined;
  }

  async #cache(key: string, artifact: AcceptedArtifact, source: "immediate" | "late"): Promise<void> {
    await this.#options.privateStore.write<AdaptiveCacheRecord>("adaptive-cache", key, {
      artifactKind: artifact.artifactKind, profileRevision: Number(key.split(":")[1]), targetId: key.split(":")[2] ?? "unknown",
      modelId: this.#options.modelId, promptVersion: this.#options.promptVersion,
      artifact: clone(artifact), cachedAt: iso(this.#clock.now()), source,
    });
  }

  async #markDiscarded(key: string): Promise<void> {
    const checkpoint = await this.#options.privateStore.read<AdaptiveCheckpoint>("adaptive-checkpoint", key);
    if (checkpoint !== undefined && checkpoint.publishedAt === undefined) {
      checkpoint.stage = "discarded"; checkpoint.reasonCode = "discard_after_60s";
      checkpoint.updatedAt = iso(this.#clock.now());
      await this.#options.privateStore.write("adaptive-checkpoint", key, checkpoint);
    }
  }

  #validateContext(context: AdaptiveContentSourceContext, artifactKind: AdaptiveArtifactKind): void {
    if (!Number.isInteger(context.profileRevision) || context.profileRevision < 1 || !safeId(context.knowledgePointId)
        || !safeId(context.targetId) || !safeText(context.title, 240) || !safeIdList(context.sourceAnchorIds)
        || !safeText(context.publicSourceSummary) || containsAdaptiveAuthorityViolation(context)) {
      throw new Error(`Unsafe ${artifactKind} source context`);
    }
  }
}
