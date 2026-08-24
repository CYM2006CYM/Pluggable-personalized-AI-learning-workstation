import type {
  ActivityDraftOutput,
  ActivitySubmissionOutput,
  AppBootstrapSafeView,
  NextStepOutput,
  PreparedActivityOutput,
  ReplanPathOutput,
  SessionRecoverySafeView,
} from "../../../src/contracts/index.js";

export const pathNodes = [{
  nodeId: "node-basic",
  knowledgePointId: "basic-python",
  activityIds: ["act-basic"],
  status: "available" as const,
  estimatedMinutes: 12,
  reasonCodes: ["prerequisite_required"],
  difficulty: "S-R" as const,
  scaffold: "worked_example" as const,
  required: true,
  positionLocked: true,
}];

export function recovery(overrides: Partial<SessionRecoverySafeView["view"]> = {}): SessionRecoverySafeView {
  return {
    sessionId: "session-w4",
    sessionVersion: 2,
    profileRevision: 3,
    view: {
      sessionId: "session-w4", sessionVersion: 2, profileRevision: 3, subjectId: "pandas-cleaning",
      mode: "recommended", goalId: "goal-clean-orders", availableMinutes: 120, status: "active",
      stage: "learning", diagnosticRequired: true, pathVersion: 1, ...overrides,
    },
    diagnosticDraftVersion: 1,
    diagnosticDraft: {
      diagnosticDraftVersion: 1,
      background: { python_experience: "basic", pandas_experience: "basic", explanation_preference: "step_by_step" },
      currentQuestionId: "diag-q1",
      processedQuestionIds: [],
    },
    activityProgress: [],
    path: { pathId: "path-w4", pathVersion: 1, status: "active", nodes: pathNodes },
  };
}

export function bootstrap(session?: SessionRecoverySafeView): AppBootstrapSafeView {
  return {
    profiles: [{ subjectId: "pandas-cleaning", name: "Pandas Cleaning", revision: 3, modalities: ["text", "code"] }],
    goals: [{ goalId: "goal-clean-orders", title: "完成订单数据清洗" }],
    chapters: [{ chapterId: "chapter-01", title: "数据读取" }],
    diagnostic: {
      diagnosticId: "diagnostic-pandas-cleaning", diagnosticVersion: 1, estimatedMinutes: 8,
      questions: [{ questionId: "diag-q1", knowledgePointId: "basic-python", kind: "single_choice", difficulty: "S-R", prompt: "哪个表达式创建列表？", options: ["[]", "{}"], required: true }],
    },
    recoverableSessions: session === undefined ? [] : [session.view],
    ...(session === undefined ? {} : { session }),
  };
}

export const nextStep: NextStepOutput = {
  sessionId: "session-w4", sessionVersion: 2, profileRevision: 3, pathVersion: 1, completed: false,
  node: pathNodes[0],
  activity: { activityId: "act-basic", activityVersion: 1, kind: "mcq", title: "基础题组", prompt: "请选择", primaryKnowledgePointId: "basic-python", supportingKnowledgePointIds: [], questions: [], retryNumber: 0 },
  card: { cardId: "card-basic", knowledgePointId: "basic-python", title: "Python 列表", objective: "识别列表", explanation: ["列表使用方括号。"], example: "items = []", commonMistake: "误用花括号", sourceAnchorIds: ["source-basic"], estimatedMinutes: 5 },
  sourceAnchorIds: ["source-basic"], contentReadiness: "fallback",
};

export const openedQuiz: ActivityDraftOutput = {
  kind: "quiz", requestId: "open-1", sessionId: "session-w4", sessionVersion: 3, profileRevision: 3, attemptId: "attempt-1",
  activity: {
    activityId: "act-basic", activityVersion: 1, kind: "mcq", title: "基础题组", prompt: "完成全部题目",
    primaryKnowledgePointId: "basic-python", supportingKnowledgePointIds: [], retryNumber: 0,
    questions: [
      { questionId: "q1", kind: "single_choice", prompt: "列表字面量？", options: ["[]", "{}"] },
      { questionId: "q2", kind: "judgment", prompt: "列表有顺序。", options: [] },
      { questionId: "q3", kind: "single_choice", prompt: "追加方法？", options: ["append", "add"] },
      { questionId: "q4", kind: "judgment", prompt: "索引从0开始。", options: [] },
    ],
  },
};

export const openedCode: ActivityDraftOutput = {
  kind: "code", requestId: "open-code-1", sessionId: "session-w4", sessionVersion: 3,
  profileRevision: 3, attemptId: "attempt-code-1", draftVersion: 1, userText: "print('server draft')",
  activity: {
    activityId: "act-code", activityVersion: 2, kind: "code_completion", title: "代码活动",
    prompt: "完成公开检查", primaryKnowledgePointId: "pandas.clean.read-csv",
    supportingKnowledgePointIds: [], starterCode: "print('starter')",
  },
};

export const savedCode: ActivityDraftOutput = {
  ...openedCode,
  requestId: "save-code-1",
  sessionVersion: 4,
  draftVersion: 2,
  userText: "print('edited draft')",
};

export const preparedCode: PreparedActivityOutput = {
  requestId: "prepare-code-1", sessionId: "session-w4", sessionVersion: 4, profileRevision: 3,
  runId: "run-code-1", activityId: "act-code", mode: "preview", environmentId: "public-pandas",
  starterCodeHash: "starter-hash", publicDatasetFiles: [], publicTestSources: ["public/test_read.py"],
  expiresAt: "2026-08-16T01:00:00.000Z", bundleHash: "bundle-hash",
};

export const quizSubmission: ActivitySubmissionOutput = {
  kind: "quiz", requestId: "submit-quiz-1", sessionId: "session-w4", sessionVersion: 4,
  profileRevision: 3, attemptId: "attempt-1", committed: true, evidenceId: "evidence-1", evidenceVersion: 1,
  result: {
    kind: "quiz", verdict: "partial", correctCount: 2, totalCount: 4, requiredCorrectCount: 3,
    retryAllowed: true, safeFeedback: "本次结果已记录，可进行一次重试。",
    answerReview: openedQuiz.kind === "quiz" ? openedQuiz.activity.questions.map((question, index) => ({
      questionId: question.questionId, prompt: question.prompt, correct: index < 2,
      correctAnswer: question.kind === "judgment" ? false : question.options[0]!,
      explanation: "安全复盘", sourceAnchorIds: ["source-basic"],
    })) : [],
  },
};

export const codeSubmission: ActivitySubmissionOutput = {
  kind: "code", requestId: "submit-code-1", sessionId: "session-w4", sessionVersion: 5,
  profileRevision: 3, attemptId: "attempt-code-1", committed: true, evidenceId: "evidence-code-1", evidenceVersion: 1,
  result: {
    executionStatus: "completed", verdict: "pass", score: 1, safeFeedback: "公开与私有检查通过。",
    evaluatorVersion: "evaluator-v1", environmentHash: "environment-hash", assetBundleHash: "asset-hash",
  },
};

export function replan(overrides: Partial<ReplanPathOutput> = {}): ReplanPathOutput {
  return {
    requestId: "replan-1", sessionId: "session-w4", sessionVersion: 4, profileRevision: 3,
    changed: true, pathId: "path-w4", pathVersion: 2, nodes: pathNodes,
    fallbackToPrevious: false, changeReasons: ["available_minutes_changed"], ...overrides,
  };
}

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ requestId: "http-test", data }), { status, headers: { "content-type": "application/json" } });
}

export function fail(status: number, code: string): Response {
  return new Response(JSON.stringify({ requestId: "http-test", error: { code, message: "safe error" } }), { status, headers: { "content-type": "application/json" } });
}
