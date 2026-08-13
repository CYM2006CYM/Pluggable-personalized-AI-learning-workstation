import type { LearningCardSafeView, QuizQuestionPrivate } from "../contracts/index.js";

export interface QuizContentSelectionInput {
  dynamic: readonly QuizQuestionPrivate[];
  supplemental: readonly QuizQuestionPrivate[];
  fixed: readonly QuizQuestionPrivate[];
  excludedQuestionIds: readonly string[];
  allowedSourceAnchorIds?: readonly string[];
}

export interface QuizContentSelection {
  source: "dynamic" | "supplemental" | "fixed" | "insufficient";
  questions: QuizQuestionPrivate[];
}

const QUESTION_KEYS = new Set(["questionId", "kind", "prompt", "options", "correctAnswer", "explanation", "sourceAnchorIds"]);
const CARD_KEYS = new Set(["cardId", "knowledgePointId", "title", "objective", "explanation", "example", "commonMistake", "sourceAnchorIds", "estimatedMinutes"]);

export function selectDeterministicCard(input: {
  dynamic?: LearningCardSafeView;
  fixed?: LearningCardSafeView;
  knowledgePointId: string;
  contentEstimatedMinutes: number;
  allowedSourceAnchorIds: readonly string[];
}): { source: "dynamic" | "fixed" | "unavailable"; card?: LearningCardSafeView } {
  const allowed = new Set(input.allowedSourceAnchorIds);
  const valid = (card: LearningCardSafeView | undefined): card is LearningCardSafeView => card !== undefined
    && Object.keys(card).every((key) => CARD_KEYS.has(key))
    && card.knowledgePointId === input.knowledgePointId
    && card.estimatedMinutes === input.contentEstimatedMinutes
    && !!card.cardId && !!card.title && !!card.objective && !!card.example && !!card.commonMistake
    && Array.isArray(card.explanation) && card.explanation.length >= 1
    && Array.isArray(card.sourceAnchorIds) && card.sourceAnchorIds.length >= 1
    && card.sourceAnchorIds.every((id) => allowed.has(id));
  if (valid(input.dynamic)) return { source: "dynamic", card: structuredClone(input.dynamic) };
  if (valid(input.fixed)) return { source: "fixed", card: structuredClone(input.fixed) };
  return { source: "unavailable" };
}

function validQuestion(question: QuizQuestionPrivate, allowedSources?: ReadonlySet<string>): boolean {
  if (Object.keys(question).some((key) => !QUESTION_KEYS.has(key)) || !question.questionId || !question.prompt
      || (question.kind !== "single_choice" && question.kind !== "judgment")
      || !Array.isArray(question.options) || new Set(question.options).size !== question.options.length
      || !question.explanation || !Array.isArray(question.sourceAnchorIds) || question.sourceAnchorIds.length === 0
      || new Set(question.sourceAnchorIds).size !== question.sourceAnchorIds.length
      || (allowedSources !== undefined && question.sourceAnchorIds.some((id) => !allowedSources.has(id)))) return false;
  return question.kind === "single_choice"
    ? typeof question.correctAnswer === "string" && question.options.includes(question.correctAnswer)
    : typeof question.correctAnswer === "boolean";
}

function validCollection(
  items: readonly QuizQuestionPrivate[],
  excluded: ReadonlySet<string>,
  allowedSources?: ReadonlySet<string>,
): QuizQuestionPrivate[] {
  const ids = new Set<string>();
  const valid: QuizQuestionPrivate[] = [];
  for (const item of items) {
    if (!validQuestion(item, allowedSources) || excluded.has(item.questionId) || ids.has(item.questionId)) continue;
    ids.add(item.questionId);
    valid.push(structuredClone(item));
  }
  return valid;
}

export function selectDeterministicQuizContent(input: QuizContentSelectionInput): QuizContentSelection {
  const excluded = new Set(input.excludedQuestionIds);
  const allowed = input.allowedSourceAnchorIds === undefined ? undefined : new Set(input.allowedSourceAnchorIds);
  const dynamic = validCollection(input.dynamic, excluded, allowed);
  if (dynamic.length >= 4 && dynamic.length <= 6) return { source: "dynamic", questions: dynamic };

  if (dynamic.length > 0 && dynamic.length < 4) {
    const used = new Set(dynamic.map((item) => item.questionId));
    const supplemental = validCollection(input.supplemental, new Set([...excluded, ...used]), allowed);
    const supplemented = [...dynamic, ...supplemental.slice(0, 4 - dynamic.length)];
    if (supplemented.length >= 4) return { source: "supplemental", questions: supplemented };
  }

  const fixedWasUsed = input.fixed.some((item) => excluded.has(item.questionId));
  const fixed = validCollection(input.fixed, excluded, allowed);
  if (!fixedWasUsed && fixed.length === input.fixed.length && fixed.length >= 4 && fixed.length <= 6) {
    return { source: "fixed", questions: fixed };
  }
  return { source: "insufficient", questions: dynamic.slice(0, 3) };
}
