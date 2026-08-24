import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { LearningCardSafeView, QuizQuestionPrivate } from "../../src/contracts/index.js";
import { DeterministicQuizRuntime, type QuizActivityDefinition } from "../../src/domain/quiz-runtime.js";

interface CoveragePoint {
  knowledgePointId: string;
  cardId: string;
  activityId: string;
  fixedQuestionGroupId: string;
  supplementalQuestionGroupId: string;
}

interface PublicGroup {
  groupId: string;
  role: "fixed" | "supplemental";
  activityId: string;
  knowledgePointId: string;
  questions: Array<Omit<QuizQuestionPrivate, "correctAnswer" | "explanation" | "sourceAnchorIds">>;
}

interface PrivateGroup { groupId: string; answers: QuizQuestionPrivate[] }

const profileRoot = resolve(import.meta.dirname, "../../fixtures/profiles/pandas-cleaning-revision-3-draft");
let points: CoveragePoint[] = [];
let cards: LearningCardSafeView[] = [];
let publicGroups: PublicGroup[] = [];
let privateGroups: PrivateGroup[] = [];

beforeAll(async () => {
  const [coverageText, cardsText, publicText, privateText] = await Promise.all([
    readFile(resolve(profileRoot, "quality/w4-b-coverage-matrix.json"), "utf8"),
    readFile(resolve(profileRoot, "cards/learning-cards.json"), "utf8"),
    readFile(resolve(profileRoot, "assessments/question-groups.json"), "utf8"),
    readFile(resolve(profileRoot, "assessments/private/quiz-answer-key.json"), "utf8"),
  ]);
  points = (JSON.parse(coverageText) as { coreKnowledgePoints: CoveragePoint[] }).coreKnowledgePoints;
  cards = (JSON.parse(cardsText) as { cards: LearningCardSafeView[] }).cards;
  publicGroups = (JSON.parse(publicText) as { groups: PublicGroup[] }).groups;
  privateGroups = (JSON.parse(privateText) as { groups: PrivateGroup[] }).groups;
});

function wrongAnswer(question: QuizQuestionPrivate): string | boolean {
  if (question.kind === "judgment") return !question.correctAnswer;
  return question.options.find((option) => option !== question.correctAnswer)!;
}

function definition(point: CoveragePoint): QuizActivityDefinition {
  return {
    activityId: point.activityId,
    activityVersion: 1,
    profileRevision: 3,
    title: point.knowledgePointId,
    prompt: "W4 V4-8 independent verification",
    primaryKnowledgePointId: point.knowledgePointId,
    supportingKnowledgePointIds: [],
  };
}

describe("W4 E V4-8 six-point independent verification", () => {
  it("binds exactly six independent core knowledge points", () => {
    expect(points).toHaveLength(6);
    expect(new Set(points.map((point) => point.knowledgePointId)).size).toBe(6);
  });

  it.each([0, 1, 2, 3, 4, 5])("verifies all V4-8 invariants for core point %s", (index) => {
    const point = points[index]!;
    const card = cards.find((item) => item.cardId === point.cardId);
    const fixedPublic = publicGroups.find((group) => group.groupId === point.fixedQuestionGroupId);
    const supplementalPublic = publicGroups.find((group) => group.groupId === point.supplementalQuestionGroupId);
    const fixedPrivate = privateGroups.find((group) => group.groupId === point.fixedQuestionGroupId);
    const supplementalPrivate = privateGroups.find((group) => group.groupId === point.supplementalQuestionGroupId);

    expect(card).toMatchObject({ cardId: point.cardId, knowledgePointId: point.knowledgePointId });
    expect(fixedPublic).toMatchObject({ role: "fixed", activityId: point.activityId, knowledgePointId: point.knowledgePointId });
    expect(fixedPublic?.questions.length).toBeGreaterThanOrEqual(4);
    expect(fixedPublic?.questions.length).toBeLessThanOrEqual(6);
    expect(fixedPrivate?.answers.map((question) => question.questionId)).toEqual(fixedPublic?.questions.map((question) => question.questionId));

    const activity = definition(point);
    const passRuntime = new DeterministicQuizRuntime();
    const opened = passRuntime.open({
      requestId: `${point.activityId}-pass-open`, sessionId: `${point.activityId}-pass`, profileRevision: 3,
      activity, questions: structuredClone(fixedPrivate!.answers), retryNumber: 0,
    });
    const openingJson = JSON.stringify(opened);
    expect(opened.activity.primaryKnowledgePointId).toBe(point.knowledgePointId);
    expect(openingJson).not.toMatch(/correctAnswer|answerKey|explanation|sourceAnchorIds/iu);

    const passed = passRuntime.submit({
      requestId: `${point.activityId}-pass-submit`, sessionId: `${point.activityId}-pass`, profileRevision: 3,
      activity, attemptId: opened.attemptId, knowledgePointId: point.knowledgePointId,
      answers: fixedPrivate!.answers.map((question) => ({ questionId: question.questionId, answer: question.correctAnswer })),
    });
    expect(passed.result).toMatchObject({
      verdict: "pass",
      correctCount: fixedPrivate!.answers.length,
      totalCount: fixedPrivate!.answers.length,
      requiredCorrectCount: Math.ceil(fixedPrivate!.answers.length * 0.75),
      retryAllowed: false,
    });
    expect(passed.evidence?.score).toBe(passed.result.correctCount / passed.result.totalCount);
    for (const review of passed.result.answerReview ?? []) {
      expect(Object.keys(review).sort()).toEqual(["correct", "correctAnswer", "explanation", "prompt", "questionId", "sourceAnchorIds"]);
      expect(review.prompt).toEqual(expect.any(String));
    }

    const retryRuntime = new DeterministicQuizRuntime();
    const first = retryRuntime.open({
      requestId: `${point.activityId}-fail-open`, sessionId: `${point.activityId}-retry`, profileRevision: 3,
      activity, questions: structuredClone(fixedPrivate!.answers), retryNumber: 0,
    });
    const failed = retryRuntime.submit({
      requestId: `${point.activityId}-fail-submit`, sessionId: `${point.activityId}-retry`, profileRevision: 3,
      activity, attemptId: first.attemptId, knowledgePointId: point.knowledgePointId,
      answers: fixedPrivate!.answers.map((question) => ({ questionId: question.questionId, answer: wrongAnswer(question) })),
    });
    expect(failed.result).toMatchObject({ verdict: "fail", correctCount: 0, retryAllowed: true });
    expect(failed.evidence?.score).toBe(0);

    expect(supplementalPublic).toMatchObject({ role: "supplemental", activityId: point.activityId, knowledgePointId: point.knowledgePointId });
    const retry = retryRuntime.open({
      requestId: `${point.activityId}-retry-open`, sessionId: `${point.activityId}-retry`, profileRevision: 3,
      activity, questions: structuredClone(supplementalPrivate!.answers), retryNumber: 1,
      excludedQuestionIds: first.activity.questions.map((question) => question.questionId),
    });
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(retry.activity.retryNumber).toBe(1);
    const firstIds = new Set(first.activity.questions.map((question) => question.questionId));
    expect(retry.activity.questions.some((question) => firstIds.has(question.questionId))).toBe(false);

    const insufficient = retryRuntime.submit({
      requestId: `${point.activityId}-retry-submit`, sessionId: `${point.activityId}-retry`, profileRevision: 3,
      activity, attemptId: retry.attemptId, knowledgePointId: point.knowledgePointId,
      answers: supplementalPrivate!.answers.map((question) => ({ questionId: question.questionId, answer: question.correctAnswer })),
    });
    expect(insufficient.result).toMatchObject({
      verdict: "insufficient", totalCount: supplementalPrivate!.answers.length, retryAllowed: true,
    });
    expect(insufficient.evidence).toBeUndefined();
    expect(insufficient.attempt.status).toBe("submitted");
  });
});
