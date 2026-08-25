import type { ActivitySafeView } from "../application/learning-runtime-facade.js";

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
  message: string;
  disputed: boolean;
}

export interface HunterInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
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
}

export interface DefenderOutput {
  defenseSummary: string;
  acceptedIssueIds: string[];
  rebuttedIssueIds: string[];
  residualRisks: string[];
}

export interface JudgeInput {
  context: ReviewSafeContext;
  generator: GeneratorOutput;
  hunter: HunterOutput;
  defender?: DefenderOutput;
  /** Present only when the first Judge response failed structural closure checks. */
  reviewInstruction?: string;
}

export interface JudgeOutput {
  verdict: "accepted" | "revise" | "rejected";
  finalSafeFeedback: string;
  summary: string;
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
  ], ["allowedSourceIds", "teachingContent", "retryContext"])
    && isActivityContext(value.activity)
    && isNonEmptyString(value.safeFeedback)
    && isStringArray(sourceIds)
    && isNonEmptyString(value.sourceSummary)
    && (value.allowedSourceIds === undefined || (isStringArray(value.allowedSourceIds)
      && value.allowedSourceIds.length === sourceIds.length
      && value.allowedSourceIds.every((sourceId, index) => sourceId === sourceIds[index])))
    && (value.teachingContent === undefined || isNonEmptyString(value.teachingContent))
    && (value.retryContext === undefined || isRetryContext(value.retryContext, sourceIds));
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
    && hasOnlyKeys(value, ["issueId", "severity", "message", "disputed"])
    && isNonEmptyString(value.issueId)
    && (value.severity === "low" || value.severity === "medium" || value.severity === "high")
    && isNonEmptyString(value.message)
    && (value.disputed === true || value.disputed === false);
}

function isHunterInput(value: unknown): value is HunterInput {
  return isRecord(value)
    && hasOnlyKeys(value, ["context", "generator"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator);
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
    && hasOnlyKeys(value, ["context", "generator", "hunter"])
    && isReviewSafeContext(value.context)
    && isGeneratorOutput(value.generator)
    && isHunterOutput(value.hunter);
}

function isDefenderOutput(value: unknown): value is DefenderOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["defenseSummary", "acceptedIssueIds", "rebuttedIssueIds", "residualRisks"])
    && isNonEmptyString(value.defenseSummary)
    && isStringArray(value.acceptedIssueIds)
    && isStringArray(value.rebuttedIssueIds)
    && isStringArray(value.residualRisks);
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

function isJudgeOutput(value: unknown): value is JudgeOutput {
  return isRecord(value)
    && hasOnlyKeys(value, ["verdict", "finalSafeFeedback", "summary", "blockedIssueIds"])
    && (value.verdict === "accepted" || value.verdict === "revise" || value.verdict === "rejected")
    && isNonEmptyString(value.finalSafeFeedback)
    && isNonEmptyString(value.summary)
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
      options: [`正确选项${index + 1}`, `干扰选项${index + 1}`],
      correctAnswer: `正确选项${index + 1}`,
      explanation: `中文解析${index + 1}，并回扣教学正文。`,
      sourceAnchorIds: ["exact-public-source-id"],
    })),
  },
  rationale: "四道题分别覆盖正文中的不同明确考点。",
  citedSourceIds: ["exact-public-source-id"],
  riskFlags: [],
});

function generatorPrompt(input: GeneratorInput): string {
  const context = input.context;
  return [
    "你是 Generator（动态题生成智能体），负责根据当前章节已选中的中文教学正文生成候选题。",
    "你必须先阅读并理解 teachingContent，再出题；不能凭标题、常识或模型记忆补写教学内容中没有的规则。",
    "输入中的 sourceSummary 只是来源登记信息，allowedSourceIds 是唯一可引用的公开来源 ID；每道题和外层 citedSourceIds 都只能逐字复制 allowedSourceIds 中的字符串。",
    "当前活动只允许生成 artifactKind=quiz 的客观题，禁止生成卡片、主观题、评分、路径或学习状态。",
    "必须生成 4 至 6 道彼此不同的中文单选题；每题必须覆盖正文中的一个明确概念、代码行为、反例或修正方法，不能重复换句或脱离正文。",
    "每题必须包含且只能包含 questionId、kind、prompt、options、correctAnswer、explanation、sourceAnchorIds；kind 固定为 single_choice。",
    "options 必须是 2 至 6 个不重复的中文字符串；correctAnswer 必须逐字等于 options 中的一个选项；explanation 必须解释为什么正确并回扣正文；sourceAnchorIds 必须非空。",
    "questionId 使用短 ASCII 标识符（例如 quiz-read-csv-1），不得包含空格、路径、答案、Evidence 或私有信息。",
    "最外层必须只包含 artifactId、candidateFeedback、rationale、citedSourceIds、riskFlags 五个字段。artifactId 是短 ASCII 标识符；rationale 说明题组覆盖了哪些正文模块；低风险题 riskFlags 必须为 []。",
    "riskLevel=high 仅用于答案唯一性依赖多步推理、版本敏感行为、题干假设可能歧义，或你对候选答案仍有不确定性的题组；此时 riskFlags 必须列出具体风险。riskLevel=low 时 riskFlags 必须为空。不得为了触发更多 Agent 随意标高风险，也不得隐藏真实风险。",
    "candidateFeedback 必须直接输出为 JSON 对象，而不是转义后的 JSON 字符串；对象必须严格是 {artifactKind,riskLevel,questions}，不能加字段。不要输出 Markdown、代码围栏、解释文字或第二个 JSON。",
    "下面是包含四道题的完整结构示例。只能模仿结构，内容和 source ID 必须来自本次输入：",
    GENERATOR_QUIZ_EXAMPLE,
    "不要把 correctAnswer、explanation、Evidence、KnowledgeState、mastery、路径、hidden tests、Rubric、reference solution、主机路径、密钥或 token 放到任何不该出现的位置；题目答案只允许存在 candidateFeedback 内部，后端会在对外 DTO 中移除答案。",
    "如果 teachingContent 不足以支持 4 道独立题，仍只能从正文已有内容拆分不同考点；不要编造事实，宁可让候选被后端拒绝。",
    `allowedSourceIds=${JSON.stringify(context.allowedSourceIds ?? context.sourceIds)}`,
    `sourceSummary=${input.allowedSourcesSummary}`,
    `teachingContent=${context.teachingContent ?? context.sourceSummary}`,
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
  return [
    "你是 Hunter（猎手智能体），负责对 Generator 产出的候选题做反向找错。",
    "candidateFeedback 是只供审核链使用的私有候选视图。你必须逐题读取 prompt、options、correctAnswer 和 explanation，并逐项对照 teachingContent；不能只检查题目样式或来源 ID。",
    "重点检查：题干是否清楚；选项是否互斥且只有一个正确项；correctAnswer 是否在语义上确实正确；explanation 是否与候选答案、题干和正文一致；概念、代码行为、反例与修正方法是否都有正文依据；sourceAnchorIds 是否来自 allowedSourceIds。",
    ...(input.context.retryContext === undefined ? [] : [
      "这是重做题组。还必须检查：所有 questionId 均未出现在 excludedQuestionIds；没有逐字复用旧题 prompt；每个 missedQuestions 暴露的薄弱知识都至少被一道新题再次考察。",
      "若只是换了ID却复用旧题面，或遗漏任一错题知识点，必须报告非争议 issue 并建议 revise。",
    ]),
    "服务端只会确定性检查 correctAnswer 是否属于 options，这不代表答案在知识上正确。若正文不能唯一支持候选答案、题目存在多解、答案或解析与正文冲突，必须报告具体 issue 并给出 recommendedVerdict=revise；事实错误不得标成可直接接受。",
    "不得重写题目、替换答案、补充正文没有的事实，也不得在 message 或其他输出字段中复述正确答案、解析原文、Evidence、KnowledgeState、路径或隐藏资产。",
    "只返回 issues、requiresDefender、recommendedVerdict；issueId 必须唯一。requiresDefender 必须严格等于是否存在 disputed=true 的 issue：有争议必须为 true，没有争议必须为 false。只要 issues 非空，recommendedVerdict 必须为 revise；没有问题时 issues=[]、requiresDefender=false、recommendedVerdict=accepted。",
    "如果候选标记 riskLevel=high，你必须把需要交叉验证的答案风险写成至少一个 disputed=true 的具体 issue，并令 requiresDefender=true；不能把高风险候选按无争议低风险直接放行。",
    `candidateArtifactId=${input.generator.artifactId}`,
  ].join("\n");
}

function defenderPrompt(input: DefenderInput): string {
  return [
    "你是 Defender（辩护智能体），只为 Hunter 标记 disputed=true 的问题提供基于正文的反证或承认。",
    "逐个处理且只能处理这些争议 issueId：acceptedIssueIds 与 rebuttedIssueIds 合并后必须恰好覆盖每个争议 ID 一次，不能遗漏、重复或新增。",
    "只能引用 teachingContent 和 allowedSourceIds；可以核对私有候选中的答案与解析，但不能修改或在输出中复述它们，不能发明正文没有的事实，也不能把模型意见伪装成权威判分。",
    "没有争议时不应被调用；若被调用，defenseSummary 只说明正文依据，residualRisks 只写仍存在的安全风险短语。",
    `disputedIssueCount=${input.hunter.issues.filter((issue) => issue.disputed).length}`,
  ].join("\n");
}

function judgePrompt(input: JudgeInput): string {
  return [
    "你是 Judge（裁判智能体），负责依据正文、Generator 候选、Hunter 问题和必要的 Defender 辩护作最终裁决。",
    "你必须确认 Hunter 已逐题审核 prompt、options、correctAnswer 和 explanation，并结合 Hunter 问题对私有候选作最终复核；不能只检查 JSON 结构或引用格式。",
    "accepted 只表示候选通过内容与安全审查，不表示改变权威判分；候选答案无法由正文唯一支持、答案或解析存在事实错误、题目多解，或存在其他未解决的高风险时，必须 revise 或 rejected。",
    ...(input.context.retryContext === undefined ? [] : [
      "这是重做题组。你必须最终确认新旧题ID不同、题面未逐字复用，并且上一轮每个错题知识都在新题组中得到重复考察；任一条件不满足都不得 accepted。",
    ]),
    "blockedIssueIds 只能引用 Hunter 已报告的 issueId；verdict=accepted 时必须为空。存在非争议 issue 时不能 accepted；若存在 disputed=true，必须使用 Defender 的逐项结论，只有全部争议均被反驳且没有 residualRisks 时才可 accepted。不能改写题目、答案、Rubric、hidden tests、reference solution、Evidence、KnowledgeState 或路径。",
    "Hunter 输出代表它已经执行了逐题审核，不要求 Hunter 在 issues 为空时复述检查过程。若 Hunter 返回 issues=[]、requiresDefender=false、recommendedVerdict=accepted，且你复核候选后没有发现新的正文、唯一答案、安全或来源问题，则必须返回 verdict=accepted、blockedIssueIds=[]。不得因为缺少额外审计说明而凭空拒绝。",
    "finalSafeFeedback 和 summary 只能是可公开的简短审查结论，不得复述正确答案、解析原文、私有评测内容、主机路径、密钥或 token。",
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
