import { createHash, randomUUID } from "node:crypto";
import type { Evidence } from "./v2-types.js";
import type {
  QuizActivityResult,
  QuizAnswerInput,
  QuizActivitySafeView,
  QuizQuestionPrivate,
} from "../contracts/index.js";

export interface QuizActivityDefinition {
  activityId: string;
  activityVersion: number;
  profileRevision: number;
  title: string;
  prompt: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
  targetKnowledgePointIds?: string[];
}

export interface QuizAttemptSnapshot {
  attemptId: string;
  sessionId: string;
  activityId: string;
  activityVersion: number;
  profileRevision: number;
  title: string;
  prompt: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
  targetKnowledgePointIds?: string[];
  retryNumber: number;
  questionSource?: NonNullable<QuizActivitySafeView["questionSource"]>;
  gradingBinding?: QuizGradingBinding;
  legacySubtype?: "single_choice" | "judgment";
  questions: QuizQuestionPrivate[];
  status: "draft" | "submitted";
  result?: QuizActivityResult;
  openedRequestId?: string;
  submissionRequestId?: string;
  submissionHash?: string;
  submittedAt?: string;
}

export type QuizGradingBinding =
  | {
      source: "ai_reviewed";
      questionSetSha256: string;
      generationRunId: string;
    }
  | {
      source: "profile_fixed" | "profile_supplemental" | "none";
      questionSetSha256: string;
    };

export interface QuizSubmission {
  requestId: string;
  sessionId: string;
  profileRevision: number;
  activity: QuizActivityDefinition;
  attemptId: string;
  answers: QuizAnswerInput[];
  knowledgePointId: string;
  now?: string;
}

export interface QuizSubmissionCommit {
  result: QuizActivityResult;
  evidence?: Evidence;
  attempt: QuizAttemptSnapshot;
}

export class QuizRuntimeError extends Error {
  constructor(readonly errorCode: "attempt_not_found" | "submission_contract_error" | "idempotency_conflict" | "activity_version_conflict", message: string) {
    super(message);
    this.name = "QuizRuntimeError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24);
}

export function quizQuestionSetSha256(questions: readonly QuizQuestionPrivate[]): string {
  return createHash("sha256").update(JSON.stringify(questions), "utf8").digest("hex");
}

function validateGradingBinding(
  questions: readonly QuizQuestionPrivate[],
  binding: QuizGradingBinding | undefined,
  questionSource: NonNullable<QuizActivitySafeView["questionSource"]>,
): void {
  if (binding === undefined) return;
  if (binding.questionSetSha256 !== quizQuestionSetSha256(questions)) {
    throw new QuizRuntimeError("submission_contract_error", "Quiz grading binding does not match the private question snapshot");
  }
  if (binding.source === "ai_reviewed" && !binding.generationRunId) {
    throw new QuizRuntimeError("submission_contract_error", "AI-reviewed quiz binding requires a generation run ID");
  }
  const expectedSource = questionSource === "ai_live" || questionSource === "ai_recorded" ? "ai_reviewed"
    : questionSource === "ai_supplemented" ? "profile_supplemental"
      : questionSource === "profile_fixed" ? "profile_fixed" : "none";
  if (binding.source !== expectedSource) {
    throw new QuizRuntimeError("submission_contract_error", "Quiz grading source does not match the displayed question source");
  }
}

function safeQuestion(question: QuizQuestionPrivate): QuizActivitySafeView["questions"][number] {
  return {
    questionId: question.questionId,
    kind: question.kind,
    prompt: question.prompt,
    options: [...question.options],
  };
}

function validatePrivateQuestions(questions: readonly QuizQuestionPrivate[]): void {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.questionId || ids.has(question.questionId)) throw new QuizRuntimeError("submission_contract_error", "Quiz question IDs must be unique");
    ids.add(question.questionId);
    if (question.kind !== "single_choice" && question.kind !== "judgment") throw new QuizRuntimeError("submission_contract_error", "Quiz question kind is invalid");
    if (!question.prompt || !Array.isArray(question.options)) throw new QuizRuntimeError("submission_contract_error", "Quiz question safe shape is invalid");
    if (question.kind === "single_choice" && (typeof question.correctAnswer !== "string" || !question.options.includes(question.correctAnswer))) {
      throw new QuizRuntimeError("submission_contract_error", "Quiz answer key does not match options");
    }
    if (question.kind === "judgment" && typeof question.correctAnswer !== "boolean") throw new QuizRuntimeError("submission_contract_error", "Judgment answer must be boolean");
  }
}

export class DeterministicQuizRuntime {
  private readonly attempts = new Map<string, QuizAttemptSnapshot>();
  private readonly submissions = new Map<string, { hash: string; commit: QuizSubmissionCommit }>();

  open(input: {
    sessionId: string;
    profileRevision: number;
    activity: QuizActivityDefinition;
    questions: QuizQuestionPrivate[];
    retryNumber: number;
    questionSource?: NonNullable<QuizActivitySafeView["questionSource"]>;
    gradingBinding?: QuizGradingBinding;
    legacySubtype?: "single_choice" | "judgment";
    targetKnowledgePointIds?: string[];
    excludedQuestionIds?: string[];
    requestId?: string;
  }): { attemptId: string; activity: QuizActivitySafeView } {
    if (input.activity.profileRevision !== input.profileRevision) throw new QuizRuntimeError("activity_version_conflict", "Activity revision does not match session");
    validatePrivateQuestions(input.questions);
    validateGradingBinding(input.questions, input.gradingBinding, input.questionSource ?? "profile_fixed");
    const excluded = new Set(input.excludedQuestionIds ?? []);
    const questions = input.questions.filter((question) => !excluded.has(question.questionId));
    const attemptId = input.requestId === undefined
      ? `attempt-${randomUUID()}`
      : `attempt-${hash(`${input.sessionId}:${input.activity.activityId}:${input.requestId}`)}`;
    const snapshot: QuizAttemptSnapshot = {
      attemptId,
      sessionId: input.sessionId,
      activityId: input.activity.activityId,
      activityVersion: input.activity.activityVersion,
      profileRevision: input.profileRevision,
      title: input.activity.title,
      prompt: input.activity.prompt,
      primaryKnowledgePointId: input.activity.primaryKnowledgePointId,
      supportingKnowledgePointIds: [...input.activity.supportingKnowledgePointIds],
      ...(input.targetKnowledgePointIds === undefined ? {} : { targetKnowledgePointIds: [...new Set(input.targetKnowledgePointIds)] }),
      retryNumber: input.retryNumber,
      questionSource: input.questionSource ?? "profile_fixed",
      ...(input.gradingBinding === undefined ? {} : { gradingBinding: structuredClone(input.gradingBinding) }),
      ...(input.legacySubtype === undefined ? {} : { legacySubtype: input.legacySubtype }),
      questions: structuredClone(questions),
      status: "draft",
      ...(input.requestId === undefined ? {} : { openedRequestId: input.requestId }),
    };
    this.attempts.set(attemptId, snapshot);
    return {
      attemptId,
      activity: {
        activityId: input.activity.activityId,
        activityVersion: input.activity.activityVersion,
        kind: "mcq",
        title: input.activity.title,
        prompt: input.activity.prompt,
        primaryKnowledgePointId: input.activity.primaryKnowledgePointId,
        supportingKnowledgePointIds: [...input.activity.supportingKnowledgePointIds],
        ...(input.targetKnowledgePointIds === undefined ? {} : { targetKnowledgePointIds: [...new Set(input.targetKnowledgePointIds)] }),
        questions: questions.map(safeQuestion),
        retryNumber: input.retryNumber,
        questionSource: input.questionSource ?? "profile_fixed",
      },
    };
  }

  getAttempt(attemptId: string): QuizAttemptSnapshot {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new QuizRuntimeError("attempt_not_found", "Quiz attempt does not exist");
    return structuredClone(attempt);
  }

  restore(attempt: QuizAttemptSnapshot): void {
    validatePrivateQuestions(attempt.questions);
    validateGradingBinding(attempt.questions, attempt.gradingBinding, attempt.questionSource ?? "profile_fixed");
    this.attempts.set(attempt.attemptId, structuredClone(attempt));
  }

  submit(input: QuizSubmission): QuizSubmissionCommit {
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt) throw new QuizRuntimeError("attempt_not_found", "Quiz attempt does not exist");
    if (attempt.sessionId !== input.sessionId || attempt.profileRevision !== input.profileRevision || attempt.activityId !== input.activity.activityId || attempt.activityVersion !== input.activity.activityVersion) {
      throw new QuizRuntimeError("activity_version_conflict", "Quiz attempt binding does not match");
    }
    const identity = { ...input, now: undefined };
    const submissionHash = hash(identity);
    const existing = this.submissions.get(`${input.requestId}:${input.attemptId}`);
    if (existing) {
      if (existing.hash !== submissionHash) throw new QuizRuntimeError("idempotency_conflict", "Quiz requestId has different content");
      return structuredClone(existing.commit);
    }
    if (attempt.status === "submitted") {
      if (attempt.submissionRequestId !== input.requestId || attempt.submissionHash !== submissionHash || attempt.result === undefined) {
        throw new QuizRuntimeError("idempotency_conflict", "Quiz Attempt was submitted with different content");
      }
      const replay: QuizSubmissionCommit = {
        result: structuredClone(attempt.result),
        attempt: structuredClone(attempt),
        ...(attempt.result.verdict === "insufficient" ? {} : { evidence: createEvidence(input, attempt.result) }),
      };
      this.submissions.set(`${input.requestId}:${input.attemptId}`, { hash: submissionHash, commit: structuredClone(replay) });
      return replay;
    }
    const expected = new Map(attempt.questions.map((question) => [question.questionId, question]));
    if (input.answers.length !== expected.size) throw new QuizRuntimeError("submission_contract_error", "Quiz submission must cover every question exactly once");
    const seen = new Set<string>();
    let correctCount = 0;
    const review: NonNullable<QuizActivityResult["answerReview"]> = [];
    for (const answer of input.answers) {
      if (typeof answer !== "object" || answer === null || Array.isArray(answer)
          || Object.keys(answer).some((key) => key !== "questionId" && key !== "answer")) {
        throw new QuizRuntimeError("submission_contract_error", "Quiz answer contains unsupported fields");
      }
      const question = expected.get(answer.questionId);
      if (!question || seen.has(answer.questionId)) throw new QuizRuntimeError("submission_contract_error", "Quiz submission contains an unknown or duplicate question");
      seen.add(answer.questionId);
      const validType = question.kind === "single_choice" ? typeof answer.answer === "string" && question.options.includes(answer.answer) : typeof answer.answer === "boolean";
      if (!validType) throw new QuizRuntimeError("submission_contract_error", "Quiz answer type does not match the question");
      const correct = answer.answer === question.correctAnswer;
      if (correct) correctCount += 1;
      review.push({
        questionId: question.questionId,
        prompt: question.prompt,
        correct,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        sourceAnchorIds: [...question.sourceAnchorIds],
      });
    }
    const totalCount = expected.size;
    const legacySingleQuestion = attempt.legacySubtype !== undefined;
    const requiredCorrectCount = legacySingleQuestion ? 1 : Math.ceil(totalCount * 0.75);
    const verdict: QuizActivityResult["verdict"] = legacySingleQuestion
      ? correctCount === requiredCorrectCount ? "pass" : "fail"
      : totalCount < 4 ? "insufficient" : correctCount >= requiredCorrectCount ? "pass" : correctCount === 0 ? "fail" : "partial";
    const result: QuizActivityResult = {
      kind: "quiz",
      verdict,
      correctCount,
      totalCount,
      requiredCorrectCount,
      retryAllowed: verdict !== "pass",
      safeFeedback: legacySingleQuestion
        ? verdict === "pass" ? "题目已通过。" : "本题未通过，可以换一组题继续练习。"
        : verdict === "pass" ? "题组已通过。" : verdict === "insufficient" ? "当前题组不足以形成确定性判定，可以重新生成题组。" : "本次结果已记录，可以换一组题继续练习。",
      answerReview: review,
    };
    attempt.status = "submitted";
    attempt.result = structuredClone(result);
    attempt.submissionRequestId = input.requestId;
    attempt.submissionHash = submissionHash;
    attempt.submittedAt = input.now ?? new Date().toISOString();
    const commit: QuizSubmissionCommit = {
      result,
      attempt: structuredClone(attempt),
      ...(verdict === "insufficient" ? {} : {
        evidence: createEvidence(input, result),
      }),
    };
    this.submissions.set(`${input.requestId}:${input.attemptId}`, { hash: submissionHash, commit: structuredClone(commit) });
    return commit;
  }
}

function createEvidence(input: QuizSubmission, result: QuizActivityResult): Evidence {
  return {
    evidenceId: `evidence-${hash(`${input.sessionId}:${input.attemptId}`)}`,
    requestId: input.requestId,
    sessionId: input.sessionId,
    knowledgePointId: input.knowledgePointId,
    profileRevision: input.profileRevision,
    kind: "mcq",
    source: "deterministic_quiz",
    form: "selected_response",
    impact: "mastery",
    outcome: result.verdict === "pass" ? "correct" : result.verdict === "partial" ? "partial" : "incorrect",
    score: result.totalCount === 0 ? 0 : result.correctCount / result.totalCount,
    independence: "independent",
    activityId: input.activity.activityId,
    attemptId: input.attemptId,
    createdAt: input.now ?? new Date().toISOString(),
  };
}
