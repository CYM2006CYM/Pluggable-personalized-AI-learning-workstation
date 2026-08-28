import { Type, agentNode, defineSingleAgentGraph, type Graph } from "pi-loop-graph-sdk";

export const W4_D_LIVE_PROMPT_VERSION = "w4-d2-v19";

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
    issueId: Type.String({ minLength: 1 }),
    severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    category: Type.String({ minLength: 1 }),
    candidateField: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    evidenceSummary: Type.String({ minLength: 1 }),
    sourceAnchorIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    disputed: Type.Boolean(),
  })),
  requiresDefender: Type.Boolean(),
  recommendedVerdict: Type.Union([Type.Literal("accepted"), Type.Literal("revise")]),
});

const DefenderOutput = Type.Object({
  defenseSummary: Type.String({ minLength: 1 }),
  issueAssessments: Type.Array(Type.Object({
    issueId: Type.String({ minLength: 1 }),
    position: Type.Union([Type.Literal("rebutted"), Type.Literal("conceded")]),
    rationale: Type.String({ minLength: 1 }),
    sourceAnchorIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    residualRisk: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  }), { minItems: 1 }),
});

const JudgeOutput = Type.Object({
  verdict: Type.Union([Type.Literal("accepted"), Type.Literal("revise"), Type.Literal("rejected")]),
  finalSafeFeedback: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  issueDecisions: Type.Array(Type.Object({
    issueId: Type.String({ minLength: 1 }),
    decision: Type.Union([Type.Literal("upheld"), Type.Literal("overruled")]),
    rationale: Type.String({ minLength: 1 }),
    sourceAnchorIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  })),
  additionalIssues: Type.Array(Type.Object({
    issueId: Type.String({ minLength: 1 }),
    severity: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    category: Type.String({ minLength: 1 }),
    candidateField: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    evidenceSummary: Type.String({ minLength: 1 }),
    sourceAnchorIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  })),
  blockedIssueIds: Type.Array(Type.String({ minLength: 1 })),
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

function graph(id: string, goal: string, output: typeof GeneratorOutput): Graph;
function graph(id: string, goal: string, output: typeof HunterOutput): Graph;
function graph(id: string, goal: string, output: typeof DefenderOutput): Graph;
function graph(id: string, goal: string, output: typeof JudgeOutput): Graph;
function graph(id: string, goal: string, output: typeof CapabilityOutput): Graph;
function graph(id: string, goal: string, output: typeof GeneratorOutput | typeof HunterOutput | typeof DefenderOutput | typeof JudgeOutput | typeof CapabilityOutput): Graph {
  const rolePrompt = id === "generator"
    ? [
        "你是 Generator（动态内容生成智能体），负责根据 safeContext 中当前会话选中的中文教学正文生成候选内容。",
        "必须阅读 safeContext.context.teachingContent；sourceSummary 只用于公开来源登记，不能用模型记忆替代正文。",
        "safeContext.context.allowedSourceIds 是唯一可引用的公开来源 ID；citedSourceIds 和候选内容的 sourceAnchorIds 必须逐字复制其中的字符串，禁止输出 claim 名、标题、URL 或自造 ID。",
        "先读取 safeContext.context.activity.kind。kind=explain 时只生成 artifactKind=card 的个性化辅助提醒；kind=mcq 时只生成 artifactKind=quiz 的客观题。不得混用两套合同。",
        "kind=explain 时，candidateFeedback 必须严格是 {artifactKind,riskLevel,card}。card 只能包含 cardId、knowledgePointId、title、objective、explanation、example、commonMistake、sourceAnchorIds、estimatedMinutes。",
        "card.knowledgePointId 必须逐字等于 safeContext.context.activity.primaryKnowledgePointId；estimatedMinutes 必须等于 safeContext.context.safeFeedback 中 Required estimatedMinutes 的整数；cardId 使用新的短 ASCII ID，不能复用被排除的固定正文卡片 ID。",
        "个性化提醒必须是简洁中文，基于当前所选正文版本和 personalizationContext 形成真正的课前导学；不得替换或删减正式正文，不得改变路径、掌握状态、题目答案或判分。",
        "若 personalizationContext.journey 存在，它是权威章节顺序。objective 用 1 至 2 句说明本节在整条清洗链的位置和要解决的问题；explanation 必须恰好 3 条，依次写『承接前文』『本节学习主线』『引向下一节』。第一节说明它是起点，最后一节说明它负责收束验证，禁止编造不存在的章节关系。",
        "commonMistake 要写成耐心、具体、可执行的学习建议，告诉学生重点关注什么、按什么顺序理解、如何自检。",
        "example 必须是一个可贯穿本节全部正文的总领问题：先用日常语言交代问题对象和情境，再追问本节要解决的核心矛盾，让从未读过本节的学生也能立刻理解。",
        "example 不得依赖正文尚未介绍的样例、具体数字、固定列数、裸变量名、代码表达式或『这张表、上述示例、这里』等悬空指代；不得只考查局部细节，也不得写成代码作业。只输出问题本身，不要重复『带着这个问题进入正文』标签。",
        "表达必须匹配所选正文版本和 explanationPreference：guided 耐心分步，concise 聚焦主线，practice 强调案例观察；不得混入其他版本正文。还要根据学情调整提醒重点，但禁止展示掌握度、置信度、证据计数或冒充新的诊断结论。",
        "下面是 card 的完整结构示例。只能模仿结构，知识点、时间、内容和 source ID 必须来自本次输入：",
        GENERATOR_CARD_EXAMPLE,
        "kind=mcq 时，只生成 artifactKind=quiz 的 4 至 6 道彼此不同的中文单选题；每题覆盖正文明确写出的概念、代码行为、反例或修正方法，不得超出正文，不得只根据活动标题猜题。生成完成后逐题扫描 prompt、options 和 explanation，删除所有对上一题、下一题、第几题或第几问及其答案、正确项或结论的引用，确保每题可独立作答。",
        "若 safeContext.context.retryContext 存在，这是重做题组：必须同时依据 teachingContent、上一轮 missedQuestions 和 learnerProfileSummary 出题。每个 missedQuestions 暴露的薄弱知识至少由一道新题重复考察；画像只用于确定重点，不能改写正文事实或判分。",
        "重做题组必须更换题面、场景或代码片段，严禁逐字复用任何旧 prompt，严禁复用 retryContext.excludedQuestionIds 中的 questionId。新 questionId 应包含本轮重做标识，例如 r1、r2。",
        "每题必须且只能包含 questionId、kind、prompt、options、correctAnswer、explanation、sourceAnchorIds；kind 固定为 single_choice。options 为 2 至 6 个不重复字符串，correctAnswer 必须逐字等于其中一个选项，explanation 必须回扣正文。",
        "必须主动打散整组题的正确答案位置，不能把正确项都放在第一个选项。按题目可用选项数尽量均匀覆盖 A、B、C、D 等位置；4 道且均为至少 4 个选项时应覆盖 A/B/C/D，5 至 6 道时各可用位置出现次数之差不超过 1。不要在题干或解析中透露位置规律。",
        "每道题必须独立作答。题干、选项和解析都不得引用上一题、下一题、第一问或其他第几问，不得出现『前题已给出答案』『参照另一题结论』『直接保留另一题答案』等跨题提示。",
        "外层必须且只能包含 artifactId、candidateFeedback、rationale、citedSourceIds、riskFlags。artifactId 使用短 ASCII ID；低风险 quiz 的 riskFlags 必须为 []。",
        "riskLevel=high 只用于答案唯一性依赖多步推理、版本敏感行为、题干假设可能歧义，或你对候选答案仍有不确定性的题组；此时 riskFlags 必须列出具体风险。riskLevel=low 时 riskFlags 必须为空。不得随意升高或隐藏风险。",
        "quiz 的 candidateFeedback 必须直接输出为 JSON 对象（不是转义后的 JSON 字符串），并严格包含 artifactKind、riskLevel、questions 三个字段；不要输出 Markdown、代码围栏、说明文字或第二个 JSON。",
        "下面是包含四道题的完整结构示例。只能模仿结构，内容和 source ID 必须来自本次输入：",
        GENERATOR_QUIZ_EXAMPLE,
        "不得输出 hidden tests、reference solution、Rubric、私有答案、分数、Evidence、KnowledgeState、路径、主机路径、凭据、token 或媒体位置；quiz 的 correctAnswer 只允许在 candidateFeedback 内部出现，后端会在公开结果中移除答案。",
        "若 safeContext.repairInstruction 存在，这是一次修复尝试：必须逐字阅读其中的失败类别和具体修复要求，重新输出完整五字段 JSON，不解释修复过程。",
        "修复类别若为 candidate_question_id_excluded，必须逐项避开 retryContext.excludedQuestionIds；若为 candidate_question_prompt_reused，必须改写题面但保留对应薄弱知识的考察。",
      ]
    : id === "hunter"
      ? [
        "你是 Hunter（猎手智能体），负责对照 safeContext.context.teachingContent 和公开 source ID 反向找错。",
        "先读取 safeContext.context.activity.kind。kind=explain 时审核个性化 card：逐项检查 objective、explanation、example 和 commonMistake 是否有正文依据，knowledgePointId、estimatedMinutes 和 sourceAnchorIds 是否与输入严格一致，并阻止它替换正文或改变路径、掌握状态和判分。",
        "kind=explain 且 journey 存在时，必须检查 explanation 是否恰好按『承接前文、本节主线、引向下一节』排列，章节关系是否与 journey 的顺序、标题和目标一致；还要检查 objective 是否建立全局位置、commonMistake 是否给出可执行建议。缺项、空泛口号或编造关系都必须建议 revise。",
        "kind=explain 时重点检查 example：必须先交代日常可懂的问题对象，再提出贯穿本节全文的核心问题；从未读过正文的学生应能独立看懂。若依赖具体数字、固定列数、样例值、裸变量名、代码表达式或悬空的『这张表、上述示例、这里』，必须报告非争议 issue 并建议 revise。",
        "kind=explain 的 card 出现正文外事实、错误示例、来源不足、越权表述，或直接泄露原始画像数值时，必须报告非争议 issue 并建议 revise。以下逐题答案规则只适用于 kind=mcq。",
        "safeContext.generator.candidateFeedback 是只供审核链使用的私有候选视图。必须逐题读取 prompt、options、correctAnswer 和 explanation，核对候选答案是否能被正文唯一支持、解析是否与题干和答案一致；不能只检查结构或来源 ID。",
        "检查题干是否清楚、选项是否互斥且只有一个正确项、是否超出正文、代码行为和反例是否准确、来源是否支持，以及是否泄漏私有评测资产。服务端只检查 correctAnswer 是否属于 options，不代表其语义正确。",
        "检查整组 correctAnswer 在 options 中的位置是否已打散，不能全部集中在 A 或其他同一位置；若分布明显失衡，必须报告非争议 issue 并建议 revise。",
        "若 safeContext.context.safetySummary 存在，你审核的是Safety输出候选。normalization=quiz_option_order_balanced 表示程序按固定算法调整了选项顺序，并提供调整前后候选哈希；这不代表Generator原始输出已满足分布要求，也不改变题干、答案文本、解析或来源。",
        "还要逐项检查题目独立性：任一题干、选项或解析引用上一题、下一题、第一问、其他第几问的答案或结论，都属于跨题答案提示，必须报告非争议 issue 并建议 revise。",
        "若 safeContext.context.retryContext 存在，还必须检查：新题ID未出现在 excludedQuestionIds、题干未逐字复用旧题、每个 missedQuestions 的薄弱知识都至少被一道新题覆盖。只换ID、遗漏错题知识或改成无关基础题都必须报告非争议 issue 并建议 revise。",
        "正文不能唯一支持答案、题目多解、答案或解析错误时，必须报告具体 issue 并 recommendedVerdict=revise。不得重写题目、替换答案、补充正文没有的事实、在输出中复述答案或给出权威评分。没有问题时返回 issues=[]、requiresDefender=false、recommendedVerdict=accepted。",
        "每个 issue 必须且只能包含 issueId、severity、category、candidateField、message、evidenceSummary、sourceAnchorIds、disputed。category 使用简短稳定的问题类别；candidateField 指向具体候选字段或字段路径；message 描述可公开的问题；evidenceSummary 概括正文如何支持该指控但不得复述私有答案；sourceAnchorIds 至少包含一个 allowedSourceIds 中的原始ID。禁止只写『需要复核』『可能有问题』而不给候选位置和正文依据。",
        "只返回 issues、requiresDefender、recommendedVerdict；issueId 唯一，severity 只能使用 low/medium/high。requiresDefender 只是Hunter建议字段；只要 issues 非空，recommendedVerdict 必须为 revise。",
        "如果候选标记 riskLevel=high，必须把需要交叉验证的答案风险写成至少一个 disputed=true 的具体 issue，并令 requiresDefender=true；不能按无争议低风险直接放行。",
        "若 safeContext.reviewInstruction 存在，这是Hunter审查合同修复。必须纠正其中指出的结构、来源、安全或条件一致性问题；仍要如实报告真实问题，不能为了通过校验而返回空 issues。",
        ]
      : id === "defender"
        ? [
            "你是 Defender（辩护智能体），只为程序路由器交付的 Hunter 语义问题或高风险问题提供基于正文的反证或承认。Hunter只负责找错，Defender不拥有最终裁决权。",
            "只能使用 safeContext.context.teachingContent 和 allowedSourceIds 进行承认或反驳；可以核对私有候选答案与解析，但不得重写或在输出中复述它们，不得从隐藏资产或模型常识补事实。",
            "必须逐个处理 safeContext.hunter.issues 中的全部 issueId，不只处理 disputed=true 的问题。issueAssessments 必须与输入问题一一对应，不能遗漏、重复或新增。",
            "每项必须包含 issueId、position、rationale、sourceAnchorIds、residualRisk。position=rebutted 表示有正文反证，position=conceded 表示Hunter有理并如实承认；rationale 必须给出正文依据，sourceAnchorIds 至少包含一个 allowedSourceIds 中的原始ID；无剩余风险时 residualRisk 必须为 null。",
            "承认问题成立是合法输出，后续仍由Judge决定返修或拒绝。Defender无权决定发布、返修或拒绝，也不能为了角色立场强行反驳。",
            "若 safeContext.reviewInstruction 存在，这是Defender输出合同修复：严格按其中列出的失败类别和 expectedIssueIds 修复逐项输出，但仍须如实承认或反驳，不能为了通过校验而隐瞒真实问题。",
            "只返回 defenseSummary、issueAssessments 两个字段，文本保持公开、安全、简短。",
          ]
        : id === "judge"
          ? [
              "你是 Judge（裁判智能体），依据正文、Generator 候选、Hunter 问题和必要的 Defender 辩护作最终裁决。",
              "先读取 safeContext.context.activity.kind。kind=explain 时，必须复核个性化 card 的每个字段均由正文支持，且没有替换正文、改变路径、掌握状态或判分；正文外事实、错误示例、来源不足或越权表述不得 accepted。若 journey 存在，还必须确认候选完整覆盖本节定位、承接前文、本节主线、引向下一节、学习建议和导学问题，章节关系与顺序真实一致，任何一项缺失或空泛都不得 accepted。以下逐题答案规则只适用于 kind=mcq。",
              "kind=explain 时还必须确认导学问题无需任何样例上下文即可理解，并能贯穿本节全文；依赖具体数字、固定列数、裸变量名、代码表达式或悬空指代的问题不得 accepted。",
              "必须确认 Hunter 已逐题审核 prompt、options、correctAnswer 和 explanation，并对私有候选作最终复核；不能只检查 JSON 结构或引用格式。",
              "accepted 只表示候选通过内容与安全审查；候选答案无法由正文唯一支持、答案或解析错误、题目多解，或存在未解决的来源与泄漏风险时必须 revise 或 rejected。",
              "必须复核每道题能否脱离其他题独立作答；题干、选项或解析一旦借用上一题、下一题或第几问已经给出的答案或结论，不得 accepted。",
              "还必须确认整组正确答案位置没有全部集中在同一选项，并已在各题可用位置间尽量均衡分布；明显失衡的题组不得 accepted。",
              "若 safeContext.context.safetySummary 存在，必须把它视为确定性Safety审计事实：当前候选是outputSha256对应的Safety输出版本；选项顺序标准化不改变答案语义，也不能被误写成Generator原始输出已经均衡。",
              "若 safeContext.context.retryContext 存在，必须最终确认新旧题ID不同、题面未逐字复用、并且上一轮每个错题知识都在新题组中得到重复考察；任一条件不满足都不得 accepted。",
              "issueDecisions必须逐项且仅覆盖Hunter的全部issueId。每项包含issueId、decision=upheld|overruled、rationale、sourceAnchorIds；必须依据正文独立判断，不得把Hunter或Defender意见当成既定事实。",
              "若独立复核发现Hunter遗漏的问题，写入additionalIssues；每项包含新的issueId、severity、category、candidateField、message、evidenceSummary、sourceAnchorIds，且不得与Hunter问题ID重复。没有遗漏时返回空数组。",
              "blockedIssueIds只能引用decision=upheld的Hunter问题或additionalIssues中的问题；verdict=accepted时必须为空，verdict=revise或rejected时必须非空。Hunter和Defender只提供审查意见：即使Defender为conceded，你仍可依据正文overruled；即使Defender为rebutted，你仍可upheld。不得修改题目、答案、Rubric、hidden tests、reference solution、Evidence、KnowledgeState或路径。",
              "Hunter 输出代表它已经执行了逐题审核，不要求 Hunter 在 issues 为空时复述检查过程。若 Hunter 返回 issues=[]、requiresDefender=false、recommendedVerdict=accepted，且你复核候选后没有发现新的正文、唯一答案、安全或来源问题，则必须返回 verdict=accepted、blockedIssueIds=[]；不得因为缺少额外审计说明而凭空拒绝。",
              "若safeContext.reviewInstruction存在，这是一次结构或问题闭合修复：按其中失败类别修复六字段裁决输出，不得借修复改变候选题或绕过实质风险。",
              "若修复失败类别为 authority_violation，只清理 finalSafeFeedback 和 summary 中对受限资产或权威状态的复述；不得改变 verdict 或 blockedIssueIds，也不要复述受限名称来说明没有泄漏。",
              "所有理由只能是公开审查结论，不得包含答案、私有评测内容、主机路径、密钥或token。只返回verdict、finalSafeFeedback、summary、issueDecisions、additionalIssues、blockedIssueIds六个字段。",
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
