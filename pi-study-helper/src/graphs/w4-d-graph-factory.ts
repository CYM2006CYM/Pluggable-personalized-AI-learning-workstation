import { Type, agentNode, defineSingleAgentGraph, type Graph } from "pi-loop-graph-sdk";

export const W4_D_LIVE_PROMPT_VERSION = "w4-d2-v8";

const ContextInput = Type.Object({
  runId: Type.String(),
  profileRevision: Type.Number(),
  promptVersion: Type.String(),
  safeContext: Type.Record(Type.String(), Type.Unknown()),
  budget: Type.Object({ timeoutMs: Type.Number(), maxTokens: Type.Optional(Type.Number()) }),
});

const GeneratorQuizQuestion = Type.Object({
  questionId: Type.String(),
  kind: Type.Literal("single_choice"),
  prompt: Type.String(),
  options: Type.Array(Type.String()),
  correctAnswer: Type.String(),
  explanation: Type.String(),
  sourceAnchorIds: Type.Array(Type.String()),
});

const GeneratorQuizCandidate = Type.Object({
  artifactKind: Type.Literal("quiz"),
  riskLevel: Type.Union([Type.Literal("low"), Type.Literal("high")]),
  questions: Type.Array(GeneratorQuizQuestion),
});

const GeneratorCardCandidate = Type.Object({
  artifactKind: Type.Literal("card"),
  riskLevel: Type.Union([Type.Literal("low"), Type.Literal("high")]),
  card: Type.Object({
    cardId: Type.String(),
    knowledgePointId: Type.String(),
    title: Type.String(),
    objective: Type.String(),
    explanation: Type.Array(Type.String()),
    example: Type.String(),
    commonMistake: Type.String(),
    sourceAnchorIds: Type.Array(Type.String()),
    estimatedMinutes: Type.Number(),
  }),
});

const GeneratorOutput = Type.Object({
  artifactId: Type.String(),
  // Object output avoids asking the model to escape a second JSON document.
  // Type.String keeps existing recorded fixtures replayable.
  candidateFeedback: Type.Union([
    GeneratorQuizCandidate,
    GeneratorCardCandidate,
    Type.String(),
  ]),
  rationale: Type.String(),
  citedSourceIds: Type.Array(Type.String()),
  riskFlags: Type.Array(Type.String()),
});

const HunterOutput = Type.Object({
  issues: Type.Array(Type.Object({
    issueId: Type.String(),
    severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    message: Type.String(),
    disputed: Type.Boolean(),
  })),
  requiresDefender: Type.Boolean(),
  recommendedVerdict: Type.Union([Type.Literal("accepted"), Type.Literal("revise")]),
});

const DefenderOutput = Type.Object({
  defenseSummary: Type.String(),
  acceptedIssueIds: Type.Array(Type.String()),
  rebuttedIssueIds: Type.Array(Type.String()),
  residualRisks: Type.Array(Type.String()),
});

const JudgeOutput = Type.Object({
  verdict: Type.Union([Type.Literal("accepted"), Type.Literal("revise"), Type.Literal("rejected")]),
  finalSafeFeedback: Type.String(),
  summary: Type.String(),
  blockedIssueIds: Type.Array(Type.String()),
});

const CapabilityOutput = Type.Object({
  dimensions: Type.Array(Type.Object({
    id: Type.Union([
      Type.Literal("syntax_api"),
      Type.Literal("data_abstraction"),
      Type.Literal("cleaning_reasoning"),
      Type.Literal("validation_debugging"),
      Type.Literal("engineering_independence"),
    ]),
    score: Type.Number(),
    confidence: Type.Number(),
    rationale: Type.String(),
    evidenceRefs: Type.Array(Type.String()),
  })),
});

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

function graph(id: string, goal: string, output: typeof GeneratorOutput): Graph;
function graph(id: string, goal: string, output: typeof HunterOutput): Graph;
function graph(id: string, goal: string, output: typeof DefenderOutput): Graph;
function graph(id: string, goal: string, output: typeof JudgeOutput): Graph;
function graph(id: string, goal: string, output: typeof CapabilityOutput): Graph;
function graph(id: string, goal: string, output: typeof GeneratorOutput | typeof HunterOutput | typeof DefenderOutput | typeof JudgeOutput | typeof CapabilityOutput): Graph {
  const rolePrompt = id === "generator"
    ? [
        "你是 Generator（动态题生成智能体），负责根据 safeContext 中当前会话选中的中文教学正文生成候选题。",
        "必须阅读 safeContext.context.teachingContent；sourceSummary 只用于公开来源登记，不能用模型记忆替代正文。",
        "safeContext.context.allowedSourceIds 是唯一可引用的公开来源 ID；citedSourceIds 和每道题的 sourceAnchorIds 必须逐字复制其中的字符串，禁止输出 claim 名、标题、URL 或自造 ID。",
        "当前请求为 quiz 时，只生成 artifactKind=quiz 的 4 至 6 道彼此不同的中文单选题；每题覆盖正文明确写出的概念、代码行为、反例或修正方法，不得超出正文，不得只根据活动标题猜题。",
        "每题必须且只能包含 questionId、kind、prompt、options、correctAnswer、explanation、sourceAnchorIds；kind 固定为 single_choice。options 为 2 至 6 个不重复字符串，correctAnswer 必须逐字等于其中一个选项，explanation 必须回扣正文。",
        "外层必须且只能包含 artifactId、candidateFeedback、rationale、citedSourceIds、riskFlags。artifactId 使用短 ASCII ID；低风险 quiz 的 riskFlags 必须为 []。",
        "riskLevel=high 只用于答案唯一性依赖多步推理、版本敏感行为、题干假设可能歧义，或你对候选答案仍有不确定性的题组；此时 riskFlags 必须列出具体风险。riskLevel=low 时 riskFlags 必须为空。不得随意升高或隐藏风险。",
        "candidateFeedback 必须直接输出为 JSON 对象（不是转义后的 JSON 字符串），并严格包含 artifactKind、riskLevel、questions 三个字段；不要输出 Markdown、代码围栏、说明文字或第二个 JSON。",
        "下面是包含四道题的完整结构示例。只能模仿结构，内容和 source ID 必须来自本次输入：",
        GENERATOR_QUIZ_EXAMPLE,
        "不得输出 hidden tests、reference solution、Rubric、私有答案、分数、Evidence、KnowledgeState、路径、主机路径、凭据、token 或媒体位置；correctAnswer 只允许在 candidateFeedback 内部出现，后端会在公开结果中移除答案。",
        "若 safeContext.repairInstruction 存在，这是一次修复尝试：必须逐字阅读其中的失败类别和具体修复要求，重新输出完整五字段 JSON，不解释修复过程。",
      ]
    : id === "hunter"
      ? [
        "你是 Hunter（猎手智能体），负责逐题对照 safeContext.context.teachingContent 和公开 source ID 反向找错。",
        "safeContext.generator.candidateFeedback 是只供审核链使用的私有候选视图。必须逐题读取 prompt、options、correctAnswer 和 explanation，核对候选答案是否能被正文唯一支持、解析是否与题干和答案一致；不能只检查结构或来源 ID。",
        "检查题干是否清楚、选项是否互斥且只有一个正确项、是否超出正文、代码行为和反例是否准确、来源是否支持，以及是否泄漏私有评测资产。服务端只检查 correctAnswer 是否属于 options，不代表其语义正确。",
        "正文不能唯一支持答案、题目多解、答案或解析错误时，必须报告具体 issue 并 recommendedVerdict=revise。不得重写题目、替换答案、补充正文没有的事实、在输出中复述答案或给出权威评分。没有问题时返回 issues=[]、requiresDefender=false、recommendedVerdict=accepted。",
        "只返回 issues、requiresDefender、recommendedVerdict；issueId 唯一，每个 issue 只能使用 low/medium/high、具体 message 和 disputed 布尔值。requiresDefender 必须严格等于是否存在 disputed=true 的 issue；只要 issues 非空，recommendedVerdict 必须为 revise。",
        "如果候选标记 riskLevel=high，必须把需要交叉验证的答案风险写成至少一个 disputed=true 的具体 issue，并令 requiresDefender=true；不能按无争议低风险直接放行。",
        ]
      : id === "defender"
        ? [
            "你是 Defender（辩护智能体），只处理 Hunter 标记 disputed=true 的 issue。",
            "只能使用 safeContext.context.teachingContent 和 allowedSourceIds 进行承认或反驳；可以核对私有候选答案与解析，但不得重写或在输出中复述它们，不得从隐藏资产或模型常识补事实。",
            "acceptedIssueIds 与 rebuttedIssueIds 合并后必须恰好覆盖每个 disputed issueId 一次，不能遗漏、重复或新增；没有争议时不应被调用。",
            "只返回 defenseSummary、acceptedIssueIds、rebuttedIssueIds、residualRisks 四个字段，文本保持公开、安全、简短。",
          ]
        : id === "judge"
          ? [
              "你是 Judge（裁判智能体），依据正文、Generator 候选、Hunter 问题和必要的 Defender 辩护作最终裁决。",
              "必须确认 Hunter 已逐题审核 prompt、options、correctAnswer 和 explanation，并对私有候选作最终复核；不能只检查 JSON 结构或引用格式。",
              "accepted 只表示候选通过内容与安全审查；候选答案无法由正文唯一支持、答案或解析错误、题目多解，或存在未解决的来源与泄漏风险时必须 revise 或 rejected。",
              "blockedIssueIds 只能引用 Hunter 已报告的 issueId；verdict=accepted 时必须为空。存在非争议 issue 时不能 accepted；若 Hunter 存在 disputed=true，必须有 Defender 输入，且只有全部争议均被反驳并无 residualRisks 时才可 accepted。不得修改题目、答案、Rubric、hidden tests、reference solution、Evidence、KnowledgeState 或路径。",
              "Hunter 输出代表它已经执行了逐题审核，不要求 Hunter 在 issues 为空时复述检查过程。若 Hunter 返回 issues=[]、requiresDefender=false、recommendedVerdict=accepted，且你复核候选后没有发现新的正文、唯一答案、安全或来源问题，则必须返回 verdict=accepted、blockedIssueIds=[]；不得因为缺少额外审计说明而凭空拒绝。",
              "若 safeContext.reviewInstruction 存在，这是一次结构或问题闭合修复：按其中失败类别修复四字段裁决输出，不得借修复改变候选题或绕过实质风险。",
              "若修复失败类别为 authority_violation，只清理 finalSafeFeedback 和 summary 中对受限资产或权威状态的复述；不得改变 verdict 或 blockedIssueIds，也不要复述受限名称来说明没有泄漏。",
              "finalSafeFeedback 和 summary 只能是公开审查结论，不得包含答案、私有评测内容、主机路径、密钥或 token。只返回 verdict、finalSafeFeedback、summary、blockedIssueIds。",
            ]
          : [
              "You are the capability scorer.",
              "Return only the requested JSON schema and cite only supplied formal Evidence.",
            ];
  return defineSingleAgentGraph({
    id,
    // Prompt semantics changed with the explicit lesson/source contract and repair path.
    version: W4_D_LIVE_PROMPT_VERSION,
    goal,
    input: ContextInput,
    output,
    context: { background: { select: "none" } },
    node: agentNode({
      subGoal: goal,
      input: ContextInput,
      output,
      tools: [],
      prompt: [
        ...rolePrompt,
        "Use only the supplied safeContext.",
        "Return only the requested JSON schema.",
        ...(id === "generator"
          ? ["题目答案只能作为 candidateFeedback 内部字段输出，不能出现在 rationale、来源摘要或其他外层字段。"]
          : id === "capability-scorer"
            ? ["每个 rationale 必须使用简体中文，只引用输入中提供的正式 Evidence。"]
            : ["不得修改候选答案、分数、Evidence、KnowledgeState、路径、Rubric 或隐藏资产；只能提交本角色的审查结果。"]),
      ].join("\n"),
    }),
  });
}

/** D-owned graph registry factory for C's PiGraphModelExecutionAdapter binding. */
export function createW4DModelGraphs(): readonly Graph[] {
  return Object.freeze([
    graph("generator", "Generate a safe adaptive card or quiz candidate.", GeneratorOutput),
    graph("hunter", "Review an adaptive candidate for support, leakage, and boundary issues.", HunterOutput),
    graph("defender", "Respond to disputed Hunter issues using only safe context.", DefenderOutput),
    graph("judge", "Make the final review decision without changing authoritative facts.", JudgeOutput),
    graph("capability-scorer", "Score observable Pandas capability dimensions from safe Evidence projections.", CapabilityOutput),
  ]);
}
