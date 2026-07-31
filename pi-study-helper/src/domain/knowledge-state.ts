import type {
  Evidence,
  EvidenceIndependence,
  EvidenceSource,
  KnowledgeState,
  KnowledgeStatus,
  LearningRuntimeErrorCode,
} from "./v2-types.js";

export const KNOWLEDGE_AGGREGATION_VERSION = "knowledge-state-v1" as const;

export const EVIDENCE_SOURCE_WEIGHTS: Readonly<Record<EvidenceSource, number>> = {
  fixed_diagnostic: 1,
  deterministic_quiz: 1,
  code_submit: 1.2,
  practical_rubric: 1.2,
  legacy_final_answer: 0.6,
  self_report: 0,
  context_question: 0,
  hint_view: 0,
  public_run: 0,
  evaluator_error: 0,
};

export const EVIDENCE_INDEPENDENCE_WEIGHTS: Readonly<Record<EvidenceIndependence, number>> = {
  independent: 1,
  hinted: 0.8,
  worked_example: 0.5,
  answer_exposed: 0,
};

const DAY_MS = 86_400_000;

export class KnowledgeStateCalculationError extends Error {
  readonly errorCode: LearningRuntimeErrorCode = "evidence_invalid";

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeStateCalculationError";
  }
}

export interface CalculateKnowledgeStateInput {
  knowledgePointId: string;
  profileRevision: number;
  evidenceVersion: number;
  evidence: readonly Evidence[];
  asOf: string | Date;
  requiresCodeEvidence?: boolean;
  nonSkippable?: boolean;
}

interface WeightedEvidence {
  evidence: Evidence;
  createdAtMs: number;
  weight: number;
}

function parseAsOf(value: string | Date): { iso: string; ms: number } {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new KnowledgeStateCalculationError("asOf must be a valid ISO timestamp");
  return { iso: date.toISOString(), ms };
}

function recencyWeight(ageDays: number): number {
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.9;
  return 0.8;
}

function stableNewestFirst(left: Evidence, right: Evidence): number {
  const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (createdDifference !== 0) return createdDifference;
  return left.evidenceId.localeCompare(right.evidenceId, "en");
}

function statusFor(mastery: number | null, confidence: number, count: number, forms: number): KnowledgeStatus {
  if (count === 0 || mastery === null) return "unverified";
  if (mastery < 0.35) return "support_needed";
  if (mastery < 0.7) return "learning";
  if (mastery >= 0.85 && confidence >= 0.4 && count >= 2 && forms >= 2) return "mastered";
  return "ready";
}

function eligibleEvidence(input: CalculateKnowledgeStateInput, asOfMs: number): WeightedEvidence[] {
  const sorted = [...input.evidence]
    .filter((item) => item.knowledgePointId === input.knowledgePointId)
    .filter((item) => item.profileRevision === input.profileRevision)
    .filter((item) => item.impact === "mastery")
    .sort(stableNewestFirst);

  const seenAttempts = new Set<string>();
  const result: WeightedEvidence[] = [];

  for (const item of sorted) {
    if (typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
      throw new KnowledgeStateCalculationError(`Evidence ${item.evidenceId} has an invalid score`);
    }

    const sourceWeight = EVIDENCE_SOURCE_WEIGHTS[item.source];
    const independenceWeight = EVIDENCE_INDEPENDENCE_WEIGHTS[item.independence];
    if (sourceWeight <= 0 || independenceWeight <= 0) continue;

    const createdAtMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs > asOfMs) {
      throw new KnowledgeStateCalculationError(`Evidence ${item.evidenceId} has an invalid or future createdAt`);
    }

    if (item.attemptId !== undefined) {
      if (seenAttempts.has(item.attemptId)) continue;
      seenAttempts.add(item.attemptId);
    }

    const ageDays = Math.floor((asOfMs - createdAtMs) / DAY_MS);
    result.push({
      evidence: item,
      createdAtMs,
      weight: sourceWeight * independenceWeight * recencyWeight(ageDays),
    });
  }

  return result;
}

export function calculateKnowledgeState(input: CalculateKnowledgeStateInput): KnowledgeState {
  if (!Number.isInteger(input.profileRevision) || input.profileRevision < 1) {
    throw new KnowledgeStateCalculationError("profileRevision must be a positive integer");
  }
  if (!Number.isInteger(input.evidenceVersion) || input.evidenceVersion < 0) {
    throw new KnowledgeStateCalculationError("evidenceVersion must be a non-negative integer");
  }

  const asOf = parseAsOf(input.asOf);
  const allValid = eligibleEvidence(input, asOf.ms);
  const considered = allValid.slice(0, 7);

  let mastery: number | null = null;
  let confidence = 0;
  const formCount = new Set(considered.map((item) => item.evidence.form)).size;

  if (considered.length > 0) {
    const denominator = considered.reduce((sum, item) => sum + item.weight, 0);
    const numerator = considered.reduce((sum, item) => sum + (item.evidence.score as number) * item.weight, 0);
    mastery = numerator / denominator;

    const base = Math.min(0.75, 0.25 * Math.log2(1 + Math.min(considered.length, 7)));
    const recentWindow = considered.slice(0, Math.min(3, considered.length));
    const scores = recentWindow.map((item) => item.evidence.score as number);
    const range = Math.max(...scores) - Math.min(...scores);
    const conflictPenalty = recentWindow.length >= 2 && range >= 0.5 ? 0.2 : 0;
    const consistencyBonus = recentWindow.length >= 2 && conflictPenalty === 0 && range <= 0.2 ? 0.1 : 0;
    confidence = Math.max(0, Math.min(1, base + consistencyBonus - conflictPenalty));
  }

  const status = statusFor(mastery, confidence, considered.length, formCount);
  const hasRequiredCodeEvidence = !input.requiresCodeEvidence || considered.some((item) =>
    item.evidence.source === "code_submit" || item.evidence.source === "practical_rubric"
  );
  const skipEligible = status === "mastered"
    && input.nonSkippable !== true
    && hasRequiredCodeEvidence;

  return {
    knowledgePointId: input.knowledgePointId,
    profileRevision: input.profileRevision,
    evidenceVersion: input.evidenceVersion,
    aggregationVersion: KNOWLEDGE_AGGREGATION_VERSION,
    mastery,
    confidence,
    status,
    validEvidenceCount: considered.length,
    evidenceFormCount: formCount,
    evidenceIds: allValid.map((item) => item.evidence.evidenceId),
    consideredEvidenceIds: considered.map((item) => item.evidence.evidenceId),
    asOf: asOf.iso,
    skipEligible,
    lastUpdatedAt: asOf.iso,
  };
}

export interface CalculateKnowledgeStatesInput {
  knowledgePoints: ReadonlyArray<{
    id: string;
    requiresCodeEvidence?: boolean;
    nonSkippable?: boolean;
  }>;
  profileRevision: number;
  evidenceVersion: number;
  evidence: readonly Evidence[];
  asOf: string | Date;
}

export function calculateKnowledgeStates(input: CalculateKnowledgeStatesInput): KnowledgeState[] {
  return input.knowledgePoints.map((point) => calculateKnowledgeState({
    knowledgePointId: point.id,
    profileRevision: input.profileRevision,
    evidenceVersion: input.evidenceVersion,
    evidence: input.evidence,
    asOf: input.asOf,
    requiresCodeEvidence: point.requiresCodeEvidence,
    nonSkippable: point.nonSkippable,
  }));
}
