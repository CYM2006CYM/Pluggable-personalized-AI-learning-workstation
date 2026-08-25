import type { Difficulty, EvidenceForm, JsonValue, LearningRuntimeErrorCode } from "./v2-types.js";

export type DiagnosticQuestionKind = "single_choice" | "judgment";

export interface DiagnosticBlueprintAsset {
  blueprintId: string;
  profileRevision: number;
  goalIds: string[];
  estimatedMinutes: number;
  minimumCoverage: number;
  questions: DiagnosticQuestionAsset[];
  scoringVersion: string;
  [extensionName: `x-${string}`]: JsonValue;
}

export interface DiagnosticQuestionAsset {
  questionId: string;
  knowledgePointId: string;
  kind: DiagnosticQuestionKind;
  difficulty: Difficulty;
  prompt: string;
  options?: string[];
  maxScore: number;
  required: boolean;
  evaluatorRef: string;
  sourceAnchorIds: string[];
  evidenceForm?: Extract<EvidenceForm, "selected_response" | "code_reasoning">;
}

export interface DiagnosticAnswerKeyAsset {
  blueprintId: string;
  evaluatorVersion: string;
  answers: DiagnosticAnswerKeyEntry[];
}

export type DiagnosticAnswerKeyEntry =
  | { questionId: string; kind: "single_choice"; correctAnswer: string }
  | { questionId: string; kind: "judgment"; correctAnswer: boolean };

export interface DiagnosticAnswerRecord {
  questionId: string;
  requestId: string;
  status: "answered" | "skipped";
  submittedAnswer?: string | boolean;
  normalizedScore?: number;
  evidenceId?: string;
  evaluatorVersion?: string;
  createdAt: string;
}

export class DiagnosticValidationError extends Error {
  constructor(readonly errorCode: LearningRuntimeErrorCode, message: string) {
    super(message);
    this.name = "DiagnosticValidationError";
  }
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DIFFICULTIES = new Set<Difficulty>(["S-R", "S-U", "M-U", "M-A", "C-A"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, extensions = false): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key) && !(extensions && key.startsWith("x-"))) {
      throw new DiagnosticValidationError("invalid_profile", `${label}.${key} is an unknown field`);
    }
  }
}

function stableId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !STABLE_ID.test(value)) {
    throw new DiagnosticValidationError("invalid_profile", `${label} must be a stable ASCII identifier`);
  }
}

function uniqueStrings(value: unknown, label: string, nonEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new DiagnosticValidationError("invalid_profile", `${label} must be an array of non-empty strings`);
  }
  if ((nonEmpty && value.length === 0) || new Set(value).size !== value.length) {
    throw new DiagnosticValidationError("invalid_profile", `${label} must be non-empty and unique`);
  }
}

export function parseDiagnosticBlueprint(value: unknown): DiagnosticBlueprintAsset {
  if (!isRecord(value)) throw new DiagnosticValidationError("invalid_profile", "Diagnostic blueprint must be an object");
  assertKeys(value, [
    "blueprintId", "profileRevision", "goalIds", "estimatedMinutes", "minimumCoverage", "questions", "scoringVersion",
  ], "diagnostic", true);
  stableId(value.blueprintId, "diagnostic.blueprintId");
  stableId(value.scoringVersion, "diagnostic.scoringVersion");
  if (!Number.isInteger(value.profileRevision) || (value.profileRevision as number) < 1) {
    throw new DiagnosticValidationError("invalid_profile", "diagnostic.profileRevision must be a positive integer");
  }
  uniqueStrings(value.goalIds, "diagnostic.goalIds", true);
  if (!Number.isInteger(value.estimatedMinutes) || (value.estimatedMinutes as number) < 1 || (value.estimatedMinutes as number) > 10) {
    throw new DiagnosticValidationError("invalid_profile", "diagnostic.estimatedMinutes must be an integer from 1 to 10");
  }
  if (typeof value.minimumCoverage !== "number" || value.minimumCoverage <= 0 || value.minimumCoverage > 1) {
    throw new DiagnosticValidationError("invalid_profile", "diagnostic.minimumCoverage must be in (0, 1]");
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    throw new DiagnosticValidationError("invalid_profile", "diagnostic.questions must be non-empty");
  }

  const seen = new Set<string>();
  for (const [index, raw] of value.questions.entries()) {
    if (!isRecord(raw)) throw new DiagnosticValidationError("invalid_profile", `diagnostic.questions[${index}] must be an object`);
    assertKeys(raw, [
      "questionId", "knowledgePointId", "kind", "difficulty", "prompt", "options", "maxScore", "required", "evaluatorRef", "sourceAnchorIds", "evidenceForm",
    ], `diagnostic.questions[${index}]`);
    stableId(raw.questionId, `diagnostic.questions[${index}].questionId`);
    stableId(raw.knowledgePointId, `diagnostic.questions[${index}].knowledgePointId`);
    if (seen.has(raw.questionId)) throw new DiagnosticValidationError("invalid_profile", "Diagnostic question IDs must be unique");
    seen.add(raw.questionId);
    if (raw.kind !== "single_choice" && raw.kind !== "judgment") {
      throw new DiagnosticValidationError("invalid_profile", `diagnostic.questions[${index}].kind is unsupported`);
    }
    if (typeof raw.difficulty !== "string" || !DIFFICULTIES.has(raw.difficulty as Difficulty)) {
      throw new DiagnosticValidationError("invalid_profile", `diagnostic.questions[${index}].difficulty is unsupported`);
    }
    if (typeof raw.prompt !== "string" || raw.prompt.trim() === "") {
      throw new DiagnosticValidationError("invalid_profile", `diagnostic.questions[${index}].prompt is required`);
    }
    if (raw.kind === "single_choice") {
      uniqueStrings(raw.options, `diagnostic.questions[${index}].options`, true);
      if ((raw.options as string[]).length < 3 || (raw.options as string[]).length > 5) {
        throw new DiagnosticValidationError("invalid_profile", "Single-choice questions require 3 to 5 options");
      }
    } else if (raw.options !== undefined) {
      throw new DiagnosticValidationError("invalid_profile", "Judgment questions must omit options");
    }
    if (raw.maxScore !== 1 || typeof raw.required !== "boolean") {
      throw new DiagnosticValidationError("invalid_profile", "Diagnostic maxScore must be 1 and required must be boolean");
    }
    if (raw.evaluatorRef !== `private/answer-key.json#${raw.questionId}`) {
      throw new DiagnosticValidationError("invalid_profile", "Diagnostic evaluatorRef must use the private answer key");
    }
    uniqueStrings(raw.sourceAnchorIds, `diagnostic.questions[${index}].sourceAnchorIds`, true);
    if (raw.evidenceForm !== undefined && raw.evidenceForm !== "selected_response" && raw.evidenceForm !== "code_reasoning") {
      throw new DiagnosticValidationError("invalid_profile", `diagnostic.questions[${index}].evidenceForm is unsupported`);
    }
  }
  return value as unknown as DiagnosticBlueprintAsset;
}

export function parseDiagnosticAnswerKey(value: unknown, blueprint: DiagnosticBlueprintAsset): DiagnosticAnswerKeyAsset {
  if (!isRecord(value)) throw new DiagnosticValidationError("invalid_profile", "Diagnostic answer key must be an object");
  assertKeys(value, ["blueprintId", "evaluatorVersion", "answers"], "answerKey");
  stableId(value.blueprintId, "answerKey.blueprintId");
  stableId(value.evaluatorVersion, "answerKey.evaluatorVersion");
  if (value.blueprintId !== blueprint.blueprintId || !Array.isArray(value.answers)) {
    throw new DiagnosticValidationError("invalid_profile", "Answer key does not match diagnostic blueprint");
  }
  const byQuestion = new Map(blueprint.questions.map((question) => [question.questionId, question]));
  const seen = new Set<string>();
  for (const [index, raw] of value.answers.entries()) {
    if (!isRecord(raw)) throw new DiagnosticValidationError("invalid_profile", `answerKey.answers[${index}] must be an object`);
    assertKeys(raw, ["questionId", "kind", "correctAnswer"], `answerKey.answers[${index}]`);
    stableId(raw.questionId, `answerKey.answers[${index}].questionId`);
    if (seen.has(raw.questionId)) throw new DiagnosticValidationError("invalid_profile", "Answer key question IDs must be unique");
    seen.add(raw.questionId);
    const question = byQuestion.get(raw.questionId);
    if (question === undefined || raw.kind !== question.kind) {
      throw new DiagnosticValidationError("invalid_profile", "Answer key must close exactly over the blueprint");
    }
    if (question.kind === "single_choice") {
      if (typeof raw.correctAnswer !== "string" || !question.options?.includes(raw.correctAnswer)) {
        throw new DiagnosticValidationError("invalid_profile", "Single-choice correct answer must equal an option");
      }
    } else if (typeof raw.correctAnswer !== "boolean") {
      throw new DiagnosticValidationError("invalid_profile", "Judgment correct answer must be boolean");
    }
  }
  if (seen.size !== blueprint.questions.length) {
    throw new DiagnosticValidationError("invalid_profile", "Answer key must contain exactly one answer per question");
  }
  return value as unknown as DiagnosticAnswerKeyAsset;
}
