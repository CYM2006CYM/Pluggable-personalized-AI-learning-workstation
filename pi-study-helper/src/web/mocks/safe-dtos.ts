import type {
  ActivityDraftOutput,
  ActivityRecoveryOutput,
  ActivitySubmissionOutput,
  CompleteSessionOutput,
  ContextAnswerOutput,
  DiagnosticCompleteOutput,
  NextStepOutput,
  PathCandidateOutput,
  PreparedActivityOutput,
  RecoverSessionOutput,
  SessionSafeView,
  StartSessionOutput,
} from "../../contracts/index.js";

export interface ProfileDisplayFixture {
  subjectId: string;
  name: string;
  revision: number;
  status: "active";
  modalities: Array<"reading" | "quiz" | "code" | "practice">;
}

export interface DiagnosticQuestionDisplayFixture {
  diagnosticId: string;
  diagnosticVersion: number;
  questionId: string;
  kind: "single_choice";
  prompt: string;
  options: string[];
  knowledgePointTitle: string;
  current: number;
  total: number;
  skippable: boolean;
}

export interface LearningCardDisplayFixture {
  artifactId: string;
  title: string;
  objective: string;
  reason: string;
  estimatedMinutes: number;
  explanation: string[];
  example: string;
  commonMistake: string;
  sourceAnchorIds: string[];
  reviewStatus: "cached_reviewed" | "profile_fallback";
}

export const profileDisplayFixture = {
  subjectId: "pandas-cleaning",
  name: "Pandas 订单数据清洗",
  revision: 2,
  status: "active",
  modalities: ["reading", "quiz", "code", "practice"],
} satisfies ProfileDisplayFixture;

const sessionSafeViewMock = {
  sessionId: "session-demo-001",
  sessionVersion: 7,
  profileRevision: 2,
  subjectId: "pandas-cleaning",
  mode: "recommended",
  goalId: "goal-clean-orders",
  availableMinutes: 90,
  status: "active",
  stage: "diagnostic",
  diagnosticRequired: true,
  pathVersion: 3,
} satisfies SessionSafeView;

export const startSessionMock = {
  ...sessionSafeViewMock,
  requestId: "mock-start-001",
} satisfies StartSessionOutput;

export const sessionConflictMock = {
  ...sessionSafeViewMock,
  sessionVersion: 8,
  errorCode: "session_version_conflict",
} satisfies SessionSafeView;

export const recoverSessionMock = {
  requestId: "mock-recover-001",
  sessionId: "session-demo-001",
  sessionVersion: 8,
  profileRevision: 2,
  view: {
    ...sessionSafeViewMock,
    sessionVersion: 8,
    status: "recoverable",
    stage: "learning",
  },
  recoveryAction: "rebuilt_derived_state",
} satisfies RecoverSessionOutput;

export const diagnosticQuestionDisplayFixture = {
  diagnosticId: "diagnostic-demo-001",
  diagnosticVersion: 2,
  questionId: "diag-05",
  kind: "single_choice",
  prompt: "同一订单编号仅有一条日期可解析时，应保留哪条记录？",
  options: ["日期可解析的记录", "原始最后一条", "金额最大的记录", "任意一条"],
  knowledgePointTitle: "处理重复订单",
  current: 5,
  total: 8,
  skippable: true,
} satisfies DiagnosticQuestionDisplayFixture;

export const diagnosticCompleteMock = {
  requestId: "mock-diagnostic-complete-001",
  sessionId: "session-demo-001",
  sessionVersion: 8,
  profileRevision: 2,
  diagnosticId: "diagnostic-demo-001",
  evidenceVersion: 4,
  capabilityProfileRevision: 1,
  diagnosticDraftVersion: 3,
  insufficientKnowledgePointIds: ["pandas.clean.duplicate-orders"],
  knowledgeStates: [
    {
      knowledgePointId: "pandas.clean.read-csv",
      profileRevision: 2,
      evidenceVersion: 4,
      aggregationVersion: "knowledge-state-v1",
      mastery: 0.92,
      confidence: 0.76,
      status: "mastered",
      validEvidenceCount: 3,
      evidenceFormCount: 2,
      evidenceIds: ["evidence-diag-01", "evidence-quiz-01", "evidence-code-01"],
      consideredEvidenceIds: ["evidence-diag-01", "evidence-quiz-01", "evidence-code-01"],
      asOf: "2026-08-08T02:00:00.000Z",
      skipEligible: true,
      lastUpdatedAt: "2026-08-08T02:00:00.000Z",
    },
    {
      knowledgePointId: "pandas.clean.missing-values",
      profileRevision: 2,
      evidenceVersion: 4,
      aggregationVersion: "knowledge-state-v1",
      mastery: 0.64,
      confidence: 0.5,
      status: "learning",
      validEvidenceCount: 2,
      evidenceFormCount: 1,
      evidenceIds: ["evidence-diag-04", "evidence-quiz-04"],
      consideredEvidenceIds: ["evidence-diag-04", "evidence-quiz-04"],
      asOf: "2026-08-08T02:00:00.000Z",
      skipEligible: false,
      lastUpdatedAt: "2026-08-08T02:00:00.000Z",
    },
    {
      knowledgePointId: "pandas.clean.duplicate-orders",
      profileRevision: 2,
      evidenceVersion: 4,
      aggregationVersion: "knowledge-state-v1",
      mastery: null,
      confidence: 0,
      status: "unverified",
      validEvidenceCount: 0,
      evidenceFormCount: 0,
      evidenceIds: [],
      consideredEvidenceIds: [],
      asOf: "2026-08-08T02:00:00.000Z",
      skipEligible: false,
      lastUpdatedAt: "2026-08-08T02:00:00.000Z",
    },
  ],
} satisfies DiagnosticCompleteOutput;

export const pathCandidateMock = {
  requestId: "mock-path-001",
  sessionId: "session-demo-001",
  sessionVersion: 9,
  profileRevision: 2,
  status: "candidate",
  pathId: "path-demo-001",
  pathVersion: 3,
  missingPrerequisiteIds: [],
  minimumRequiredMinutes: 75,
  nodes: [
    {
      nodeId: "node-read-csv",
      knowledgePointId: "pandas.clean.read-csv",
      activityIds: ["act-read-csv"],
      status: "completed",
      estimatedMinutes: 10,
      reasonCodes: ["prior_evidence"],
      difficulty: "S-R",
      scaffold: "none",
      required: true,
      positionLocked: true,
    },
    {
      nodeId: "node-missing-values",
      knowledgePointId: "pandas.clean.missing-values",
      activityIds: ["act-missing"],
      status: "available",
      estimatedMinutes: 20,
      reasonCodes: ["low_mastery", "goal_required"],
      difficulty: "M-U",
      scaffold: "hint",
      required: true,
      positionLocked: false,
    },
    {
      nodeId: "node-duplicates",
      knowledgePointId: "pandas.clean.duplicate-orders",
      activityIds: ["act-duplicates"],
      status: "locked",
      estimatedMinutes: 25,
      reasonCodes: ["evidence_insufficient"],
      difficulty: "M-A",
      scaffold: "worked_example",
      required: true,
      positionLocked: false,
    },
    {
      nodeId: "node-practical",
      knowledgePointId: "pandas.clean.validate-result",
      activityIds: ["act-practical"],
      status: "locked",
      estimatedMinutes: 60,
      reasonCodes: ["prerequisite_gap", "goal_required"],
      difficulty: "C-A",
      scaffold: "none",
      required: true,
      positionLocked: true,
    },
  ],
} satisfies PathCandidateOutput;

export const nextStepMock = {
  sessionId: "session-demo-001",
  sessionVersion: 10,
  profileRevision: 2,
  pathVersion: 3,
  completed: false,
  node: pathCandidateMock.nodes[1],
  activity: {
    activityId: "act-missing",
    activityVersion: 2,
    kind: "code_completion",
    title: "补全按列缺失处理",
    prompt: "按冻结规则处理订单字段缺失，并返回清洗后的数据表。",
    primaryKnowledgePointId: "pandas.clean.missing-values",
    supportingKnowledgePointIds: ["pandas.clean.inspect-dataframe"],
    starterCode: "def clean_missing(df):\n    clean_df = df.copy()\n    # TODO\n    return clean_df\n",
  },
} satisfies NextStepOutput;

export const learningCardDisplayFixture = {
  artifactId: "artifact-missing-values-001",
  title: "按字段职责处理缺失值",
  objective: "区分关键标识、业务数值和说明文本的缺失处理方式。",
  reason: "诊断证据显示该知识点仍需练习，且它是类型规范化的先修。",
  estimatedMinutes: 12,
  explanation: [
    "先确认字段是否承担唯一标识职责。",
    "只删除关键标识缺失的记录，其他字段按业务合同转换。",
    "处理后重新检查列结构和数据类型。",
  ],
  example: "先复制数据表，再对关键列应用明确的缺失规则。",
  commonMistake: "对所有含缺失值的记录统一删除，会破坏仍可用的业务数据。",
  sourceAnchorIds: ["src-pandas-missing-data", "src-pandas-dtypes"],
  reviewStatus: "cached_reviewed",
} satisfies LearningCardDisplayFixture;

export const contextAnswerMock = {
  requestId: "mock-context-001",
  sessionId: "session-demo-001",
  sessionVersion: 10,
  profileRevision: 2,
  answer: "关键标识决定记录能否继续参与订单流程，因此先确认其缺失规则。",
  sourceAnchorIds: ["src-pandas-missing-data"],
  softEvidenceId: "soft-evidence-context-001",
} satisfies ContextAnswerOutput;

export const activityDraftMock = {
  kind: "code",
  requestId: "mock-activity-open-001",
  sessionId: "session-demo-001",
  sessionVersion: 11,
  profileRevision: 2,
  attemptId: "attempt-demo-001",
  draftVersion: 3,
  activity: nextStepMock.activity,
  userText: nextStepMock.activity.starterCode ?? "",
} satisfies ActivityDraftOutput;

export const preparedActivityMock = {
  requestId: "mock-activity-run-001",
  sessionId: "session-demo-001",
  sessionVersion: 11,
  profileRevision: 2,
  runId: "run-preview-001",
  activityId: "act-missing",
  mode: "preview",
  environmentId: "env-python-pandas-candidate",
  starterCodeHash: "sha256:starter-code-demo",
  publicDatasetFiles: [
    { name: "orders-public.csv", content: "order_id,amount\nA-001,12.50\n", hash: "sha256:public-data-demo" },
  ],
  publicTestSources: ["检查返回值包含固定订单字段。", "检查关键标识列不存在缺失值。"],
  expiresAt: "2026-08-08T03:00:00.000Z",
  bundleHash: "sha256:public-preview-bundle-demo",
} satisfies PreparedActivityOutput;

export const activitySubmissionMock = {
  kind: "code",
  requestId: "mock-activity-submit-001",
  sessionId: "session-demo-001",
  sessionVersion: 12,
  profileRevision: 2,
  attemptId: "attempt-demo-001",
  committed: true,
  evidenceId: "evidence-activity-001",
  evidenceVersion: 5,
  result: {
    executionStatus: "completed",
    verdict: "partial",
    errorKind: "learner",
    errorCode: "test_failed",
    score: 0.78,
    dimensionResults: { structure: 1, missing_values: 0.7, stability: 0.6 },
    testPoints: [
      { pointNumber: 1, scope: "public", status: "passed" },
      { pointNumber: 2, scope: "sealed", status: "passed" },
      { pointNumber: 3, scope: "sealed", status: "passed" },
      { pointNumber: 4, scope: "sealed", status: "failed" },
      { pointNumber: 5, scope: "sealed", status: "failed" },
    ],
    safeFeedback: "关键标识缺失处理正确；请再检查说明字段的规范化结果。",
    durationMs: 824,
    evaluatorVersion: "node-pandas-v1",
    environmentHash: "sha256:environment-demo",
    assetBundleHash: "sha256:activity-bundle-demo",
  },
} satisfies ActivitySubmissionOutput;

export const evaluatorFeedbackMock = {
  kind: "code",
  requestId: "mock-activity-submit-002",
  sessionId: "session-demo-001",
  sessionVersion: 11,
  profileRevision: 2,
  attemptId: "attempt-demo-001",
  committed: false,
  result: {
    executionStatus: "failed",
    verdict: "not_graded",
    errorKind: "evaluator",
    errorCode: "evaluator_timeout",
    safeFeedback: "评测环境暂时未完成判定，这不是学习者代码错误。草稿已经保留。",
    evaluatorVersion: "node-pandas-v1",
    environmentHash: "sha256:environment-demo",
    assetBundleHash: "sha256:activity-bundle-demo",
  },
} satisfies ActivitySubmissionOutput;

export const activityRecoveryMock = {
  sessionId: "session-demo-001",
  sessionVersion: 11,
  profileRevision: 2,
  attempt: {
    kind: "code",
    sessionId: "session-demo-001",
    sessionVersion: 11,
    profileRevision: 2,
    activityId: "act-missing",
    attemptId: "attempt-demo-001",
    status: "draft",
    draftVersion: 3,
    codeHash: "sha256:learner-draft-demo",
  },
  draftVersion: 3,
  userText: activityDraftMock.userText,
  recoveryAction: "resume_draft",
} satisfies ActivityRecoveryOutput;

export const completeSessionMock = {
  requestId: "mock-complete-session-001",
  sessionId: "session-demo-001",
  sessionVersion: 13,
  profileRevision: 2,
  completedAt: "2026-08-08T03:30:00.000Z",
  summary: "已完成缺失值处理练习；重复订单和最终验证仍需直接证据。",
  nextRecommendation: "继续当前路径中的重复订单短验证。",
} satisfies CompleteSessionOutput;

export const FACADE_DTO_MOCKS = {
  activityDraft: activityDraftMock,
  activityRecovery: activityRecoveryMock,
  activitySubmission: activitySubmissionMock,
  completeSession: completeSessionMock,
  contextAnswer: contextAnswerMock,
  diagnosticComplete: diagnosticCompleteMock,
  evaluatorFeedback: evaluatorFeedbackMock,
  nextStep: nextStepMock,
  pathCandidate: pathCandidateMock,
  preparedActivity: preparedActivityMock,
  recoverSession: recoverSessionMock,
  sessionConflict: sessionConflictMock,
  startSession: startSessionMock,
} as const;

export const PAGE_DISPLAY_FIXTURES = {
  diagnosticQuestion: diagnosticQuestionDisplayFixture,
  learningCard: learningCardDisplayFixture,
  profile: profileDisplayFixture,
} as const;
