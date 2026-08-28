import type { ActivitySafeView } from "../application/learning-runtime-facade.js";
import type { LessonPersonalizationContext } from "../contracts/index.js";

export type ReviewGraphId = "generator" | "hunter" | "defender" | "judge";

export interface ReviewActivityContext {
  activityId: string;
  activityVersion: number;
  kind: ActivitySafeView["kind"];
  title: string;
  primaryKnowledgePointId: string;
  supportingKnowledgePointIds: string[];
}

export interface ReviewSafeContext {
  activity: ReviewActivityContext;
  safeFeedback: string;
  sourceIds: string[];
  sourceSummary: string;
  /** Explicit machine-readable allowlist; the model must copy these IDs verbatim. */
  allowedSourceIds?: string[];
  /** The selected Chinese lesson body, kept separate from source metadata for the model. */
  teachingContent?: string;
  /** Deterministic, answer-free learner facts that may only change the tip emphasis. */
  personalizationContext?: LessonPersonalizationContext;
  /** Answer-free facts from the latest failed attempt and the learner profile Agent. */
  retryContext?: {
    previousAttemptId: string;
    excludedQuestionIds: string[];
    excludedQuestionPrompts: string[];
    missedQuestions: Array<{
      questionId: string;
      prompt: string;
      explanation: string;
      sourceAnchorIds: string[];
    }>;
    learnerProfileSummary: string;
    learnerProfileEvidenceRefs: string[];
    learnerProfileSource: "agent" | "deterministic";
  };
  /** Deterministic, answer-free record of Safety normalization applied before review. */
  safetySummary?: {
    inputCandidateSha256: string;
    outputCandidateSha256: string;
    normalization: "none" | "quiz_option_order_balanced";
  };
}

export interface GeneratorInput {
  context: ReviewSafeContext;
  allowedSourcesSummary: string;
  /** Present only on a deterministic repair attempt after an invalid candidate. */
  repairInstruction?: string;
}

export interface GeneratorOutput {
  artifactId: string;
  /** Live generators return a typed object; legacy recordings may contain a JSON string. */
  candidateFeedback: string | Record<string, unknown>;
  rationale: string;
  citedSourceIds: string[];
  riskFlags: string[];
}

export interface HunterIssue {
  issueId: string;
  severity: "low" | "medium" | "high";
  category: string;
  candidateField: string;
  message: string;
  evidenceSummary: string;
  sourceAnchorIds: string[];
  disputed: boolean;
}

export interface HunterInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
  /** Present only when the first Hunter response failed deterministic validation. */
  reviewInstruction?: string;
}

export interface HunterOutput {
  issues: HunterIssue[];
  requiresDefender: boolean;
  recommendedVerdict: "accepted" | "revise";
}

export interface DefenderInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
  hunter: HunterOutput;
  /** Present only when the first Defender response failed deterministic validation. */
  reviewInstruction?: string;
}

export interface DefenderIssueAssessment {
  issueId: string;
  position: "rebutted" | "conceded";
  rationale: string;
  sourceAnchorIds: string[];
  residualRisk: string | null;
}

export interface DefenderOutput {
  defenseSummary: string;
  issueAssessments: DefenderIssueAssessment[];
}

export interface JudgeInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
  hunter: HunterOutput;
  defender?: DefenderOutput;
  /** Present only when the first Judge response failed structural closure checks. */
  reviewInstruction?: string;
}

export interface JudgeIssueDecision {
  issueId: string;
  decision: "upheld" | "overruled";
  rationale: string;
  sourceAnchorIds: string[];
}

export interface JudgeAdditionalIssue {
  issueId: string;
  severity: "low" | "medium" | "high";
  category: string;
  candidateField: string;
  message: string;
  evidenceSummary: string;
  sourceAnchorIds: string[];
}

export interface JudgeOutput {
  verdict: "accepted" | "revise" | "rejected";
  finalSafeFeedback: string;
  summary: string;
  issueDecisions: JudgeIssueDecision[];
  additionalIssues: JudgeAdditionalIssue[];
  blockedIssueIds: string[];
}

export interface ReviewRoleDefinition<Input, Output> {
  graphId: ReviewGraphId;
  validateInput(value: unknown): value is Input;
  validateOutput(value: unknown): value is Output;
  buildSystemPrompt(input: Input): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return isStringArray(value) && value.length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return keys.every((key) => allowed.has(key)) && required.every((key) => key in value);
}

function isActivityContext(value: unknown): value is ReviewActivityContext {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    "activityId",
    "activityVersion",
    "kind",
    "title",
    "primaryKnowledgePointId",
    "supportingKnowledgePointIds",
  ])
    && isNonEmptyString(value.activityId)
    && typeof value.activityVersion === "number"
    && isNonEmptyString(value.kind)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.primaryKnowledgePointId)
    && isStringArray(value.supportingKnowledgePointIds);
}

function isReviewSafeContext(value: unknown): value is ReviewSafeContext {
  if (!isRecord(value)) return false;
  const sourceIds = value.sourceIds;
  return hasOnlyKeys(value, [
    "activity",
    "safeFeedback",
    "sourceIds",
    "sourceSummary",
  ], ["allowedSourceIds", "teachingContent", "personalizationContext", "retryContext", "safetySummary"])
    && isActivityContext(value.activity)
    && isNonEmptyString(value.safeFeedback)
    && isStringArray(sourceIds)
    && isNonEmptyString(value.sourceSummary)
    && (value.allowedSourceIds === undefined || (isStringArray(value.allowedSourceIds)
      && value.allowedSourceIds.length === sourceIds.length
      && value.allowedSourceIds.every((sourceId, index) => sourceId === sourceIds[index])))
    && (value.teachingContent === undefined || isNonEmptyString(value.teachingContent))
    && (value.personalizationContext === undefined || isPersonalizationContext(value.personalizationContext))
    && (value.retryContext === undefined || isRetryContext(value.retryContext, sourceIds))
    && (value.safetySummary === undefined || (isRecord(value.safetySummary)
      && hasOnlyKeys(value.safetySummary, ["inputCandidateSha256", "outputCandidateSha256", "normalization"])
      && typeof value.safetySummary.inputCandidateSha256 === "string"
      && /^[a-f0-9]{64}$/u.test(value.safetySummary.inputCandidateSha256)
      && typeof value.safetySummary.outputCandidateSha256 === "string"
      && /^[a-f0-9]{64}$/u.test(value.safetySummary.outputCandidateSha256)
      && (value.safetySummary.normalization === "none"
        || value.safetySummary.normalization === "quiz_option_order_balanced")));
}

function isPersonalizationContext(value: unknown): value is LessonPersonalizationContext {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "knowledgeStatus",
    "mastery",
    "confidence",
    "validEvidenceCount",
    "evidenceFormCount",
    "explanationPreference",
  ], ["journey"])) return false;
  return ["unverified", "support_needed", "learning", "ready", "mastered"].includes(String(value.knowledgeStatus))
    && (value.mastery === null || (typeof value.mastery === "number" && Number.isFinite(value.mastery)
      && value.mastery >= 0 && value.mastery <= 1))
    && typeof value.confidence === "number" && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1
    && Number.isInteger(value.validEvidenceCount) && Number(value.validEvidenceCount) >= 0
    && Number.isInteger(value.evidenceFormCount) && Number(value.evidenceFormCount) >= 0
    && ["concise", "step_by_step", "example_first", "uncertain"].includes(String(value.explanationPreference))
    && (value.journey === undefined || isLessonJourney(value.journey));
}

function isLessonJourney(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["currentPosition", "totalLessons", "lessons"])) return false;
  if (!Number.isInteger(value.currentPosition) || !Number.isInteger(value.totalLessons)
      || Number(value.currentPosition) < 1 || Number(value.totalLessons) < 1
      || !Array.isArray(value.lessons) || value.lessons.length !== value.totalLessons) return false;
  if (Number(value.currentPosition) > value.lessons.length) return false;
  return value.lessons.every((lesson) => isRecord(lesson)
    && hasOnlyKeys(lesson, ["knowledgePointId", "title", "objective"])
    && isNonEmptyString(lesson.knowledgePointId)
    && isNonEmptyString(lesson.title)
    && isNonEmptyString(lesson.objective));
}

function isRetryContext(value: unknown, allowedSourceIds: string[]): value is NonNullable<ReviewSafeContext["retryContext"]> {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "previousAttemptId",
    "excludedQuestionIds",
    "excludedQuestionPrompts",
    "missedQuestions",
    "learnerProfileSummary",
    "learnerProfileEvidenceRefs",
    "learnerProfileSource",
  ])) return false;
  const excludedQuestionIds = value.excludedQuestionIds;
  const excludedQuestionPrompts = value.excludedQuestionPrompts;
  const missedQuestions = value.missedQuestions;
  if (!isNonEmptyString(value.previousAttemptId)
      || !isStringArray(excludedQuestionIds)
      || !isStringArray(excludedQuestionPrompts)
      || !Array.isArray(missedQuestions)
      || missedQuestions.length === 0
      || !isNonEmptyString(value.learnerProfileSummary)
      || !Array.isArray(value.learnerProfileEvidenceRefs)
      || !value.learnerProfileEvidenceRefs.every(isNonEmptyString)
      || (value.learnerProfileSource !== "agent" && value.learnerProfileSource !== "deterministic")) return false;
  return missedQuestions.every((item) => isRecord(item)
    && hasOnlyKeys(item, ["questionId", "prompt", "explanation", "sourceAnchorIds"])
    && isNonEmptyString(item.questionId)
    && excludedQuestionIds.includes(item.questionId)
    && isNonEmptyString(item.prompt)
    && isNonEmptyString(item.explanation)
    && isStringArray(item.sourceAnchorIds)
    && item.sourceAnchorIds.every((id) => allowedSourceIds.includes(id)));
}

function isGeneratorInput(value: unknown): value is GeneratorInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "allowedSourcesSummary"], ["repairInstruction"])
    && isReviewSafeContext(value.context)
    && isNonEmptyString(value.allowedSourcesSummary)
    && (value.repairInstruction === undefined || isNonEmptyString(value.repairInstruction));
}

function isGeneratorOutput(value: unknown): value is GeneratorOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["artifactId", "candidateFeedback", "rationale", "citedSourceIds", "riskFlags"])
    && isNonEmptyString(value.artifactId)
    && (isNonEmptyString(value.candidateFeedback) || isRecord(value.candidateFeedback))
    && isNonEmptyString(value.rationale)
    && isStringArray(value.citedSourceIds)
    && isStringArray(value.riskFlags);
}

function isHunterIssue(value: unknown): value is HunterIssue {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "issueId",
      "severity",
      "category",
      "candidateField",
      "message",
      "evidenceSummary",
      "sourceAnchorIds",
      "disputed",
    ])
    && isNonEmptyString(value.issueId)
    && (value.severity === "low" || value.severity === "medium" || value.severity === "high")
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.candidateField)
    && isNonEmptyString(value.message)
    && isNonEmptyString(value.evidenceSummary)
    && isNonEmptyStringArray(value.sourceAnchorIds)
    && (value.disputed === true || value.disputed === false);
}

function isHunterInput(value: unknown): value is HunterInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator"], ["reviewInstruction"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator)
    && (value.reviewInstruction === undefined || isNonEmptyString(value.reviewInstruction));
}

function isHunterOutput(value: unknown): value is HunterOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["issues", "requiresDefender", "recommendedVerdict"])
    && Array.isArray(value.issues)
    && value.issues.every(isHunterIssue)
    && (value.requiresDefender === true || value.requiresDefender === false)
    && (value.recommendedVerdict === "accepted" || value.recommendedVerdict === "revise");
}

function isDefenderInput(value: unknown): value is DefenderInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator", "hunter"], ["reviewInstruction"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator)
    && isHunterOutput(value.hunter)
    && (value.reviewInstruction === undefined || isNonEmptyString(value.reviewInstruction));
}

function isDefenderIssueAssessment(value: unknown): value is DefenderIssueAssessment {
  return isRecord(value)
    && hasOnlyKeys(value, ["issueId", "position", "rationale", "sourceAnchorIds", "residualRisk"])
    && isNonEmptyString(value.issueId)
    && (value.position === "rebutted" || value.position === "conceded")
    && isNonEmptyString(value.rationale)
    && isNonEmptyStringArray(value.sourceAnchorIds)
    && (value.residualRisk === null || isNonEmptyString(value.residualRisk));
}

function isDefenderOutput(value: unknown): value is DefenderOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["defenseSummary", "issueAssessments"])
    && isNonEmptyString(value.defenseSummary)
    && Array.isArray(value.issueAssessments)
    && value.issueAssessments.length > 0
    && value.issueAssessments.every(isDefenderIssueAssessment);
}

function isJudgeInput(value: unknown): value is JudgeInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator", "hunter"], ["defender", "reviewInstruction"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator)
    && isHunterOutput(value.hunter)
    && (value.defender === undefined || isDefenderOutput(value.defender))
    && (value.reviewInstruction === undefined || isNonEmptyString(value.reviewInstruction));
}

function isJudgeIssueDecision(value: unknown): value is JudgeIssueDecision {
  return isRecord(value)
    && hasOnlyKeys(value, ["issueId", "decision", "rationale", "sourceAnchorIds"])
    && isNonEmptyString(value.issueId)
    && (value.decision === "upheld" || value.decision === "overruled")
    && isNonEmptyString(value.rationale)
    && isNonEmptyStringArray(value.sourceAnchorIds);
}

function isJudgeAdditionalIssue(value: unknown): value is JudgeAdditionalIssue {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "issueId",
      "severity",
      "category",
      "candidateField",
      "message",
      "evidenceSummary",
      "sourceAnchorIds",
    ])
    && isNonEmptyString(value.issueId)
    && (value.severity === "low" || value.severity === "medium" || value.severity === "high")
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.candidateField)
    && isNonEmptyString(value.message)
    && isNonEmptyString(value.evidenceSummary)
    && isNonEmptyStringArray(value.sourceAnchorIds);
}

function isJudgeOutput(value: unknown): value is JudgeOutput {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "verdict",
      "finalSafeFeedback",
      "summary",
      "issueDecisions",
      "additionalIssues",
      "blockedIssueIds",
    ])
    && (value.verdict === "accepted" || value.verdict === "revise" || value.verdict === "rejected")
    && isNonEmptyString(value.finalSafeFeedback)
    && isNonEmptyString(value.summary)
    && Array.isArray(value.issueDecisions)
    && value.issueDecisions.every(isJudgeIssueDecision)
    && Array.isArray(value.additionalIssues)
    && value.additionalIssues.every(isJudgeAdditionalIssue)
    && isStringArray(value.blockedIssueIds);
}

const GENERATOR_QUIZ_EXAMPLE = JSON.stringify({
  artifactId: "quiz-read-csv",
  candidateFeedback: {
    artifactKind: "quiz",
    riskLevel: "low",
    questions: Array.from({ length: 4 }, (_, index) => ({
      questionId: `quiz-read-csv-${index + 1}`,
      kind: "single_choice",
      prompt: `中文题干${index + 1}`,
      options: Array.from({ length: 4 }, (_item, optionIndex) => optionIndex === index
        ? `正确选项${index + 1}`
        : `干扰选项${index + 1}-${optionIndex + 1}`),
      correctAnswer: `正确选项${index + 1}`,
      explanation: `中文解析${index + 1}，并回扣教学正文。`,
      sourceAnchorIds: ["exact-public-source-id"],
    })),
  },
  rationale: "四道题分别覆盖正文中的不同明确考点。",
  citedSourceIds: ["exact-public-source-id"],
  riskFlags: [],
});

const GENERATOR_CARD_EXAMPLE = JSON.stringify({
  artifactId: "tip-read-csv",
  candidateFeedback: {
    artifactKind: "card",
    riskLevel: "low",
    card: {
      cardId: "tip-read-csv-guided",
      knowledgePointId: "pandas.clean.read-csv",
      title: "读取 CSV 前的课前导学",
      objective: "这是六节数据清洗链的起点：先把原始 CSV 可靠地读成 DataFrame，为后续结构检查和清洗建立可信输入。",
      explanation: [
        "这是第一节，没有需要承接的 Pandas 清洗章节；先把文件、解析参数和表格对象的边界分清。",
        "学习时抓住『找到输入 → 正确读取 → 确认得到 DataFrame』这条主线，不要在读取阶段提前修值。",
        "完成本节后，下一节会检查列名、数据类型和缺失概况，判断这张表是否真的符合后续清洗要求。",
      ],
      example: "面对一份刚读入的表格，为什么仅仅能够打开文件，还不足以证明数据可以直接用于后续清洗？",
      commonMistake: "重点关注路径、编码、表头和分隔符；每看完一个示例，都问自己它解决的是『读进来』还是『改数据』。",
      sourceAnchorIds: ["exact-public-source-id"],
      estimatedMinutes: 8,
    },
  },
  rationale: "依据当前正文版本和章节旅程生成承前启后的课前导学，不替换正式教材。",
  citedSourceIds: ["exact-public-source-id"],
  riskFlags: [],
});

function generatorPrompt(input: GeneratorInput): string {
  const context = input.context;
  const isCard = context.activity.kind === "explain";
  return [
    `你是 Generator（${isCard ? "个性化提醒" : "动态题"}生成智能体），负责根据当前章节已选中的中文教学正文生成候选内容。`,
    `你必须先阅读并理解 teachingContent，再生成${isCard ? "提醒" : "题目"}；不能凭标题、常识或模型记忆补写教学内容中没有的规则。`,
    "输入中的 sourceSummary 只是来源登记信息，allowedSourceIds 是唯一可引用的公开来源 ID；候选内容和外层 citedSourceIds 都只能逐字复制 allowedSourceIds 中的字符串。",
    ...(isCard ? [
      "当前活动 kind=explain，只允许生成 artifactKind=card 的个性化辅助提醒，禁止生成题目、评分、路径或学习状态。",
      "card 必须且只能包含 cardId、knowledgePointId、title、objective、explanation、example、commonMistake、sourceAnchorIds、estimatedMinutes。",
      `knowledgePointId 必须逐字等于 ${context.activity.primaryKnowledgePointId}；estimatedMinutes 必须逐字等于输入要求；cardId 使用新的短 ASCII 标识符，不能复用固定正文卡片 ID。`,
      "title、objective、explanation、example 和 commonMistake 必须是简洁中文，直接帮助用户阅读当前正式正文；不得声称改变正文、路径、掌握状态或判分。",
      "如果 personalizationContext.journey 存在，必须把它作为权威章节顺序使用：objective 用 1 至 2 句说明本节在整条路径中的位置和要解决的问题；explanation 必须恰好包含 3 条，依次为『承接前文』『本节学习主线』『引向下一节』。第一节要明确它是起点，最后一节要明确它负责收束验证，不能虚构不存在的前后章节。",
      "commonMistake 不再只写一个错误名，而要写成可执行的学习建议：指出重点关注什么、用什么顺序理解、如何自检。",
      "example 必须是一个可贯穿本节全部正文的总领问题：先用日常语言交代问题对象和情境，再追问本节要解决的核心矛盾，让从未读过本节的学生也能立刻理解。",
      "example 不得依赖正文尚未介绍的样例、具体数字、固定列数、裸变量名、代码表达式或『这张表、上述示例、这里』等悬空指代；不得考查某一个局部细节，也不得写成代码作业。只输出问题本身，不要重复『带着这个问题进入正文』标签。",
      "当前 teachingContent 已经绑定所选正文版本，表达方式还必须服从 lessonVariantId 与 explanationPreference：guided 更耐心分步，concise 更聚焦主线，practice 更强调带着案例观察；不得混入其他版本正文。",
      "必须使用 personalizationContext 决定提醒重点：证据不足时提示先建立直觉和验证步骤；需要支持时优先指出易错点；已较熟练时强调边界或自检。讲解偏好决定表达方式，但不能改变正文事实。",
      "objective 或 explanation 中至少一处必须体现上述个性化重点；不得直接展示掌握度、置信度或证据计数，不得声称模型重新诊断了用户。",
      "candidateFeedback 必须严格是 {artifactKind,riskLevel,card}，不能包含 selectedLesson、personalizedTip、答案或其他字段。",
      "下面是完整结构示例。只能模仿结构，知识点、时间、内容和 source ID 必须来自本次输入：",
      GENERATOR_CARD_EXAMPLE,
    ] : [
      "当前活动只允许生成 artifactKind=quiz 的客观题，禁止生成卡片、主观题、评分、路径或学习状态。",
      "必须生成 4 至 6 道彼此不同的中文单选题；每题必须覆盖正文中的一个明确概念、代码行为、反例或修正方法，不能重复换句或脱离正文。",
      "每题必须包含且只能包含 questionId、kind、prompt、options、correctAnswer、explanation、sourceAnchorIds；kind 固定为 single_choice。",
      "options 必须是 2 至 6 个不重复的中文字符串；correctAnswer 必须逐字等于 options 中的一个选项；explanation 必须解释为什么正确并回扣正文；sourceAnchorIds 必须非空。",
      "必须主动打散整组题的正确答案位置，不能把正确项都放在第一个选项。按题目可用选项数尽量均匀覆盖 A、B、C、D 等位置；4 道且均为至少 4 个选项时应覆盖 A/B/C/D，5 至 6 道时各可用位置出现次数之差不超过 1。不要在题干或解析中透露位置规律。",
      "每道题必须独立作答。生成完成后逐题扫描 prompt、options 和 explanation：不得引用上一题、下一题、第几题或第几问，也不得出现『前题已给出答案』『参照另一题结论』『直接保留另一题答案』等跨题提示。",
      "questionId 使用短 ASCII 标识符（例如 quiz-read-csv-1），不得包含空格、路径、答案、Evidence 或私有信息。",
      "candidateFeedback 必须严格是 {artifactKind,riskLevel,questions}，不能加字段。",
      "下面是包含四道题的完整结构示例。只能模仿结构，内容和 source ID 必须来自本次输入：",
      GENERATOR_QUIZ_EXAMPLE,
    ]),
    "最外层必须只包含 artifactId、candidateFeedback、rationale、citedSourceIds、riskFlags 五个字段。artifactId 是短 ASCII 标识符；rationale 说明题组覆盖了哪些正文模块；低风险题 riskFlags 必须为 []。",
    "riskLevel=high 仅用于答案唯一性依赖多步推理、版本敏感行为、题干假设可能歧义，或你对候选答案仍有不确定性的题组；此时 riskFlags 必须列出具体风险。riskLevel=low 时 riskFlags 必须为空。不得为了触发更多 Agent 随意标高风险，也不得隐藏真实风险。",
    "candidateFeedback 必须直接输出为 JSON 对象，而不是转义后的 JSON 字符串；不要输出 Markdown、代码围栏、解释文字或第二个 JSON。",
    "不要把 correctAnswer、explanation、Evidence、KnowledgeState、mastery、路径、hidden tests、Rubric、reference solution、主机路径、密钥或 token 放到任何不该出现的位置；题目答案只允许存在 candidateFeedback 内部，后端会在对外 DTO 中移除答案。",
    "如果 teachingContent 不足以支持 4 道独立题，仍只能从正文已有内容拆分不同考点；不要编造事实，宁可让候选被后端拒绝。",
    `allowedSourceIds=${JSON.stringify(context.allowedSourceIds ?? context.sourceIds)}`,
    `sourceSummary=${input.allowedSourcesSummary}`,
    `teachingContent=${context.teachingContent ?? context.sourceSummary}`,
    ...(isCard && context.personalizationContext !== undefined
      ? [`personalizationContext=${JSON.stringify(context.personalizationContext)}`]
      : []),
    ...(context.retryContext === undefined ? [] : [
      "这是重做题组。retryContext.missedQuestions 是上一轮答错题目的安全复盘事实，learnerProfileSummary 是学情画像的辅助说明。",
      "新题必须同时以 teachingContent 为权威依据，并逐个重复考察 missedQuestions 暴露的薄弱知识；不得只生成泛化基础题。",
      "每个 missedQuestions 项至少要由一道新题覆盖。可以改变场景、代码片段、问法和干扰项，但不得改变正文中的正确知识。",
      "严禁逐字复用旧题 prompt，严禁复用 excludedQuestionIds 中任何 questionId。新 questionId 应包含本轮重做标识，例如 r1、r2。",
      "学情画像只能帮助确定练习重点，不能修改正文事实、答案、判分、路径或掌握状态。",
      `retryContext=${JSON.stringify(context.retryContext)}`,
    ]),
    ...(input.repairInstruction === undefined ? [] : [
      `REPAIR_ATTEMPT=${input.repairInstruction}`,
      "这是一次修复尝试。必须逐字执行失败类别对应的具体修复要求，重新输出完整五字段外层 JSON，不要解释修复过程。",
    ]),
  ].join("\n");
}

function hunterPrompt(input: HunterInput): string {
  const isCard = input.context.activity.kind === "explain";
  return [
    `你是 Hunter（猎手智能体），负责对 Generator 产出的${isCard ? "个性化提醒" : "候选题"}做反向找错。`,
    ...(isCard ? [
      "逐项对照 teachingContent 检查 card 的 objective、explanation、example 和 commonMistake 是否有正文依据，knowledgePointId、estimatedMinutes 和 sourceAnchorIds 是否与输入严格一致。",
      "若 personalizationContext.journey 存在，检查 explanation 是否恰好按『承接前文、本节主线、引向下一节』排列，前后章节关系是否与 journey 的顺序、标题和目标一致；遗漏承前启后、编造章节关系或把学习建议写成空泛口号都必须建议 revise。",
      "检查 commonMistake 是否给出可执行的学习建议，objective 是否让学生看懂本节在全局清洗链中的作用。",
      "重点检查 example：它必须先交代日常可懂的问题对象，再提出贯穿本节全文的核心问题；从未读过正文的学生应能独立看懂。若依赖具体数字、固定列数、样例值、裸变量名、代码表达式或悬空的『这张表、上述示例、这里』，必须报告非争议 issue 并建议 revise。",
      "检查 objective 或 explanation 是否真正根据 personalizationContext 调整阅读重点，并确认没有直接泄露掌握度、置信度或证据计数；完全泛化、与画像无关的提醒必须建议 revise。",
      "提醒不得替换正式正文，不得声称改变路径、掌握状态或判分；出现越权、正文外事实、错误示例或来源不足时必须报告非争议 issue 并建议 revise。",
    ] : [
      "candidateFeedback 是只供审核链使用的私有候选视图。你必须逐题读取 prompt、options、correctAnswer 和 explanation，并逐项对照 teachingContent；不能只检查题目样式或来源 ID。",
      "重点检查：题干是否清楚；选项是否互斥且只有一个正确项；correctAnswer 是否在语义上确实正确；explanation 是否与候选答案、题干和正文一致；概念、代码行为、反例与修正方法是否都有正文依据；sourceAnchorIds 是否来自 allowedSourceIds。",
      "还要逐项检查题目独立性：任一题干、选项或解析引用上一题、下一题、第一问、其他第几问的答案或结论，都属于跨题答案提示，必须报告非争议 issue 并建议 revise。",
    ]),
    ...(input.context.retryContext === undefined ? [] : [
      "这是重做题组。还必须检查：所有 questionId 均未出现在 excludedQuestionIds；没有逐字复用旧题 prompt；每个 missedQuestions 暴露的薄弱知识都至少被一道新题再次考察。",
      "若只是换了ID却复用旧题面，或遗漏任一错题知识点，必须报告非争议 issue 并建议 revise。",
    ]),
    ...(input.context.safetySummary === undefined ? [] : [
      `Safety已完成确定性检查：normalization=${input.context.safetySummary.normalization}，inputSha256=${input.context.safetySummary.inputCandidateSha256}，outputSha256=${input.context.safetySummary.outputCandidateSha256}。`,
      "你审核的是Safety输出候选。若normalization=quiz_option_order_balanced，只表示程序按固定算法调整了选项顺序；题干、答案文本、解析和来源均未由Safety修改。",
    ]),
    "服务端只会确定性检查 correctAnswer 是否属于 options，这不代表答案在知识上正确。若正文不能唯一支持候选答案、题目存在多解、答案或解析与正文冲突，必须报告具体 issue 并给出 recommendedVerdict=revise；事实错误不得标成可直接接受。",
    "不得重写题目、替换答案、补充正文没有的事实，也不得在 message、evidenceSummary 或其他输出字段中复述正确答案、解析原文、Evidence、KnowledgeState、路径或隐藏资产。",
    "每个 issue 必须且只能包含 issueId、severity、category、candidateField、message、evidenceSummary、sourceAnchorIds、disputed。category 使用简短稳定的问题类别；candidateField 指向具体候选字段或字段路径；message 描述可公开的问题；evidenceSummary 概括正文如何支持该指控但不得复述私有答案；sourceAnchorIds 至少包含一个 allowedSourceIds 中的原始ID。禁止只写『需要复核』『可能有问题』而不给候选位置和正文依据。",
    "只返回 issues、requiresDefender、recommendedVerdict；issueId 必须唯一。你只负责找错和举证，无权命令Generator返修、否决发布或决定是否调用Defender。requiresDefender仅保留为你的审查建议，程序路由器会按预设规则独立决定后续工位。只要 issues 非空，recommendedVerdict 必须为 revise；没有问题时 issues=[]、requiresDefender=false、recommendedVerdict=accepted。",
    "如果候选标记riskLevel=high，你必须把Generator给出的具体高风险逐项转化为可核查的issue，但不得编造正文中不存在的事实；程序路由器会根据高风险标记独立触发Defender。",
    ...(input.reviewInstruction === undefined ? [] : [
      `REVIEW_REPAIR=${input.reviewInstruction}`,
      "这是Hunter审查合同修复：保持对同一候选独立复核，但必须纠正失败类别对应的结构或条件关系；不得为了通过校验而隐瞒真实问题。",
    ]),
    `candidateArtifactId=${input.generator.artifactId}`,
  ].join("\n");
}

function defenderPrompt(input: DefenderInput): string {
  return [
    "你是 Defender（辩护智能体），只为程序路由器交付的 Hunter 语义问题或高风险问题提供基于正文的反证或承认。",
    "逐个处理且只能处理 Hunter 的 issueId。issueAssessments 必须与输入问题一一对应，不能遗漏、重复或新增。每项必须包含 issueId、position、rationale、sourceAnchorIds、residualRisk。",
    "position=rebutted 表示正文中存在足以反驳Hunter指控的证据；position=conceded 表示Hunter指控有事实依据，应如实承认。rationale 必须说明正文依据，sourceAnchorIds 至少包含一个输入允许的来源ID；仍有风险时写入 residualRisk，否则必须为 null。",
    "只能引用 teachingContent 和 allowedSourceIds；可以核对私有候选中的答案与解析，但不能修改或在输出中复述它们，不能发明正文没有的事实，也不能把模型意见伪装成权威判分。",
    "没有语义问题且候选不是高风险时不应被调用；若被调用，defenseSummary 只能给出可公开的整体审查概述。Defender无权决定发布、返修或拒绝。",
    ...(input.reviewInstruction === undefined ? [] : [
      `REVIEW_REPAIR=${input.reviewInstruction}`,
      "这是Defender输出合同修复。必须继续如实承认或反驳每个问题，不能为了通过校验而把成立的问题改成已反驳。",
    ]),
    `reviewIssueCount=${input.hunter.issues.length}`,
  ].join("\n");
}

function judgePrompt(input: JudgeInput): string {
  const isCard = input.context.activity.kind === "explain";
  return [
    "你是 Judge（裁判智能体），负责依据正文、Generator 候选、Hunter 问题和必要的 Defender 辩护作最终裁决。",
    ...(isCard ? [
      "你必须复核个性化提醒的每个字段均由 teachingContent 支持，并确认它不替换正式正文、不改变路径、掌握状态或判分。",
      "你必须确认提醒确实响应 personalizationContext 的学习状态或讲解偏好，同时没有展示原始画像数值或冒充新的诊断结论。",
      "若 journey 存在，你必须最终确认候选完整覆盖本节定位、承接前文、本节主线、引向下一节、学习建议和导学问题，并且章节关系与顺序真实一致；任何一项缺失或空泛都不得 accepted。",
      "你还必须确认导学问题无需任何样例上下文即可理解，并能贯穿本节全文；依赖具体数字、固定列数、裸变量名、代码表达式或悬空指代的问题不得 accepted。",
      "提醒包含正文外事实、错误示例、来源不足或越权表述时必须 revise 或 rejected。",
    ] : [
      "你必须确认 Hunter 已逐题审核 prompt、options、correctAnswer 和 explanation，并结合 Hunter 问题对私有候选作最终复核；不能只检查 JSON 结构或引用格式。",
      "accepted 只表示候选通过内容与安全审查，不表示改变权威判分；候选答案无法由正文唯一支持、答案或解析存在事实错误、题目多解，或存在其他未解决的高风险时，必须 revise 或 rejected。",
      "你必须复核每道题能否脱离其他题独立作答；题干、选项或解析一旦借用上一题、下一题或第几问已经给出的答案或结论，不得 accepted。",
      "答案位置分布、字段结构、题量、ID唯一性和来源ID允许列表已由Safety确定性程序检查；不要重复承担这些可由代码直接验证的规则。你只裁决正文一致性、唯一答案、语义歧义和安全边界。",
    ]),
    ...(input.context.retryContext === undefined ? [] : [
      "这是重做题组。你必须最终确认新旧题ID不同、题面未逐字复用，并且上一轮每个错题知识都在新题组中得到重复考察；任一条件不满足都不得 accepted。",
    ]),
    ...(input.context.safetySummary === undefined ? [] : [
      `Safety确定性摘要：normalization=${input.context.safetySummary.normalization}，inputSha256=${input.context.safetySummary.inputCandidateSha256}，outputSha256=${input.context.safetySummary.outputCandidateSha256}。`,
      "当前候选是Safety输出版本；选项顺序标准化不代表Generator原始输出已满足分布要求，也不改变答案语义。",
    ]),
    "issueDecisions 必须逐项且仅覆盖 Hunter 的全部 issueId。每项包含 issueId、decision=upheld|overruled、rationale、sourceAnchorIds；你必须依据正文独立判断，不得把Hunter或Defender意见当成既定事实。",
    "如果独立复核发现Hunter遗漏的问题，写入additionalIssues；每项必须包含新的issueId、severity、category、candidateField、message、evidenceSummary、sourceAnchorIds，且不得与Hunter问题ID重复。没有遗漏时返回空数组。",
    "blockedIssueIds只能引用decision=upheld的Hunter问题或additionalIssues中的问题；verdict=accepted时必须为空，verdict=revise或rejected时必须列出至少一个阻塞问题。Hunter和Defender只提供审查意见：即使Defender为conceded，你仍可依据正文overruled；即使Defender为rebutted，你仍可upheld。问题成立但可通过改写候选闭合时返回revise，安全或权威问题无法闭合时返回rejected。你是唯一有权决定accepted、revise或rejected的工位。不能改写题目、答案、Rubric、hidden tests、reference solution、Evidence、KnowledgeState或路径。",
    "Hunter 输出代表它已经执行了逐题审核，不要求 Hunter 在 issues 为空时复述检查过程。若 Hunter 返回 issues=[]、requiresDefender=false、recommendedVerdict=accepted，且你复核候选后没有发现新的正文、唯一答案、安全或来源问题，则必须返回 verdict=accepted、blockedIssueIds=[]。不得因为缺少额外审计说明而凭空拒绝。",
    "只返回verdict、finalSafeFeedback、summary、issueDecisions、additionalIssues、blockedIssueIds六个字段。所有理由只能是可公开的简短审查结论，不得复述正确答案、解析原文、私有评测内容、主机路径、密钥或token。",
    "若修复要求指出 authority_violation，只清理 finalSafeFeedback 和 summary 中对受限资产或权威状态的复述；不得改变 verdict、blockedIssueIds 或候选题，也不要复述受限名称来说明没有泄漏。",
    `hunterRecommended=${input.hunter.recommendedVerdict}`,
    `defenderPresent=${input.defender ? "yes" : "no"}`,
    ...(input.reviewInstruction === undefined ? [] : [`修复要求=${input.reviewInstruction}`]),
  ].join("\n");
}

export interface StudyReviewGraphs {
  generator: ReviewRoleDefinition<GeneratorInput, GeneratorOutput>;
  hunter: ReviewRoleDefinition<HunterInput, HunterOutput>;
  defender: ReviewRoleDefinition<DefenderInput, DefenderOutput>;
  judge: ReviewRoleDefinition<JudgeInput, JudgeOutput>;
}

export function createStudyReviewGraphs(): StudyReviewGraphs {
  return {
    generator: {
      graphId: "generator",
      validateInput: isGeneratorInput,
      validateOutput: isGeneratorOutput,
      buildSystemPrompt: generatorPrompt,
    },
    hunter: {
      graphId: "hunter",
      validateInput: isHunterInput,
      validateOutput: isHunterOutput,
      buildSystemPrompt: hunterPrompt,
    },
    defender: {
      graphId: "defender",
      validateInput: isDefenderInput,
      validateOutput: isDefenderOutput,
      buildSystemPrompt: defenderPrompt,
    },
    judge: {
      graphId: "judge",
      validateInput: isJudgeInput,
      validateOutput: isJudgeOutput,
      buildSystemPrompt: judgePrompt,
    },
  };
}
