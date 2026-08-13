import { describe, expect, it } from "vitest";
import { DeterministicQuizRuntime, QuizRuntimeError, type QuizActivityDefinition } from "../src/domain/quiz-runtime.js";
import type { QuizQuestionPrivate } from "../src/contracts/index.js";

const activity: QuizActivityDefinition = {
  activityId: "quiz-1", activityVersion: 3, profileRevision: 3, title: "题组", prompt: "答题", primaryKnowledgePointId: "kp-1", supportingKnowledgePointIds: [],
};

function questions(count: number): QuizQuestionPrivate[] {
  return Array.from({ length: count }, (_, index) => ({
    questionId: `q-${index + 1}`, kind: "single_choice" as const, prompt: `Q${index + 1}`, options: ["A", "B"], correctAnswer: "A", explanation: "说明", sourceAnchorIds: ["src-1"],
  }));
}

describe("DeterministicQuizRuntime", () => {
  it.each([[3, "insufficient"], [4, "pass"], [5, "pass"], [6, "pass"]] as const)("uses fixed thresholds for %s questions", (count, verdict) => {
    const runtime = new DeterministicQuizRuntime();
    const opened = runtime.open({ sessionId: "s", profileRevision: 3, activity, questions: questions(count), retryNumber: 0 });
    const result = runtime.submit({ requestId: `r-${count}`, sessionId: "s", profileRevision: 3, activity, attemptId: opened.attemptId, knowledgePointId: "kp-1", answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A" })) });
    expect(result.result.verdict).toBe(verdict);
    expect(result.result.correctCount).toBe(count);
    expect(result.result.requiredCorrectCount).toBe(Math.ceil(count * 0.75));
    if (count < 4) expect(result.evidence).toBeUndefined();
    else expect(result.evidence).toMatchObject({ source: "deterministic_quiz", form: "selected_response" });
  });

  it("returns one evidence for partial and fail, and supports idempotent replay", () => {
    const runtime = new DeterministicQuizRuntime();
    const opened = runtime.open({ sessionId: "s", profileRevision: 3, activity, questions: questions(4), retryNumber: 0 });
    const input = { requestId: "r", sessionId: "s", profileRevision: 3, activity, attemptId: opened.attemptId, knowledgePointId: "kp-1", answers: opened.activity.questions.map((question, index) => ({ questionId: question.questionId, answer: index === 0 ? "A" : "B" })) };
    const first = runtime.submit(input);
    expect(first.result).toMatchObject({ verdict: "partial", correctCount: 1, totalCount: 4, retryAllowed: true });
    expect(first.evidence).toMatchObject({ source: "deterministic_quiz", form: "selected_response", score: 0.25 });
    expect(runtime.submit(input)).toEqual(first);
    expect(() => runtime.submit({ ...input, answers: [] })).toThrowError(QuizRuntimeError);
  });

  it("rejects incomplete, duplicate, unknown and typed answers", () => {
    const runtime = new DeterministicQuizRuntime();
    const opened = runtime.open({ sessionId: "s", profileRevision: 3, activity, questions: questions(4), retryNumber: 0 });
    const base = { requestId: "r", sessionId: "s", profileRevision: 3, activity, attemptId: opened.attemptId, knowledgePointId: "kp-1" };
    expect(() => runtime.submit({ ...base, answers: [] })).toThrow("cover every question");
    expect(() => runtime.submit({ ...base, answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A" })).concat({ questionId: "q-1", answer: "A" }) })).toThrow();
    expect(() => runtime.submit({ ...base, answers: opened.activity.questions.slice(0, -1).map((question) => ({ questionId: question.questionId, answer: "A" })).concat({ questionId: "unknown", answer: "A" }) })).toThrow();
    expect(() => runtime.submit({ ...base, answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: true })) })).toThrow("type does not match");
    expect(() => runtime.submit({ ...base, answers: opened.activity.questions.map((question) => ({ questionId: question.questionId, answer: "A", prompt: question.prompt })) as never })).toThrow("unsupported fields");
  });
});
