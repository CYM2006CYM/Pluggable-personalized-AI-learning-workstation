import type { StudyFlowView } from "../flow/study-flow.js";
import { lessonCounterLabel } from "./ui-copy.js";

/*
 * ActivityPage 专属文案（活动页：客观题组 / 代码题 / 综合实操）。
 *
 * 规则与 ui-copy.ts 完全一致：
 * 1. 兜底值必须是中文通称，任何情况下不得回落英文原值。
 * 2. 内部标识符（activityId / attemptId / nodeId / 各类版本号）一律不向用户展示。
 * 3. 页面代码里不再出现任何用户可见字符串，全部经由此模块输出。
 *
 * 反馈状态口径（统一调用点，动效本体在 ticket 15 落地）：
 * 页面上所有「正确 / 错误 / 进行中 / 通过 / 未通过 / 未运行 / 改善 / 退步 /
 * 未变化 / 成功 / 警告 / 失败 / 中性」状态节点统一带 data-state 属性，取值见
 * FEEDBACK_STATE；状态节点统一使用 feedback-status 类。ticket 15 只在这组
 * 调用点上附加动画，不再逐个元素点名。
 */

/** 反馈状态的受控词表。新增状态只改这一处映射，再在 CSS 里补一个分支。 */
export const FEEDBACK_STATE = {
  correct: "correct",
  wrong: "wrong",
  passed: "passed",
  failed: "failed",
  notRun: "not_run",
  improved: "improved",
  regressed: "regressed",
  unchanged: "unchanged",
  pending: "pending",
  success: "success",
  warning: "warning",
  error: "error",
  neutral: "neutral",
} as const;
export type FeedbackState = (typeof FEEDBACK_STATE)[keyof typeof FEEDBACK_STATE];

/** 进行中状态文案的统一定时后缀，与 useAsyncActionProgress.text 的格式一致。 */
export function pendingStatusLabel(label: string, seconds: number): string {
  return `${label}（已处理 ${seconds} 秒）`;
}

/* ---------- 页面头 ---------- */

/** 三类活动的环节眉题。kind 取值见 CodeActivitySafeView / QuizActivitySafeView。 */
export function activityEyebrowLabel(kind: string | undefined): string {
  if (kind === "mcq" || kind === "quiz") return "客观题组";
  if (kind === "code_completion") return "代码补全题";
  if (kind === "coding_practical") return "综合代码实操";
  return "主观代码题";
}

export const ACTIVITY_TITLE_FALLBACK = "活动恢复";
export const ACTIVITY_SUMMARY_FALLBACK = "从服务端 Attempt 安全视图恢复当前活动。";
export const BACK_TO_LESSON_LABEL = "返回教学内容";

export const HEADER_BADGE_LOADING = "加载中";
export const HEADER_BADGE_NODE_PYTHON = "Node/Python权威评测";

/** 题组来源的中文标签。英文原值不向用户展示。 */
export function questionSourceLabel(source: string | undefined): string {
  switch (source) {
    case "ai_recorded": return "AI录制响应题组";
    case "ai_live": return "AI个性化生成题组";
    case "ai_supplemented": return "AI生成 + 固定补位";
    case "profile_fixed": return "固定题保障";
    case "insufficient": return "题量不足";
    default: return "题组来源待确认";
  }
}

/* ---------- 异步动作状态文案（经 useAsyncActionProgress 追加「（已处理 N 秒）」） ---------- */

export const PENDING_ACTION_COPY = {
  submittingQuiz: "正在提交并评测客观题",
  submittingCode: "正在提交并评测代码",
  confirmingRetry: "正在确认重试条件",
  preparingNext: "正在准备下一步",
  generatingNewQuizSet: "正在生成并审核新题组",
  preparingQuizSet: "正在准备题组",
  preparingCodeActivity: "正在准备代码活动",
  recordingGap: "正在记录未掌握状态",
} as const;

export const AGENT_DISCOVERY_PENDING = "正在等待服务端响应";

/* ---------- 侧栏信息卡 ---------- */

export const INFO_CARD_KNOWLEDGE_POINT = "知识点";
/** 信息卡默认折叠，summary 文案即卡片标题。 */
export const INFO_CARD_SUMMARY = "活动信息";

/** 客观题作答阶段的信息提示。 */
export const QUIZ_INFO_NOTICE = "提交前不显示答案；提交后只展示本题组的安全复盘。";
/** 代码题作答阶段的信息提示。 */
export const CODE_INFO_NOTICE = "题面、公开样例和验收点可以查看；隐藏测试与参考答案始终留在服务端。";

/* ---------- 回流动线提示卡 ---------- */

export const FLOW_RETURN_TITLE = "回流动线";
export const FLOW_RETURN_STEP = "当前环节";
export const FLOW_RETURN_BACK = "回到";
export const FLOW_RETURN_NEXT = "下一步";
/** 活动不属于任何教材节（例如准备节点）时，回到循环体本身。 */
export const FLOW_RETURN_BACK_CYCLE = "「学习 ⇄ 测试」循环体";
export const FLOW_RETURN_NEXT_SUMMARY = "生成学习总结";
export const FLOW_RETURN_NEXT_LESSON = "继续下一节正文";

/** 回到第几节的措辞。counter 来自 lessonCounterLabel，如「第 3 节 / 共 6 节」。 */
export function flowReturnBackLesson(counter: string, knowledgePoint: string): string {
  return `「学习」${counter} · ${knowledgePoint}`;
}

/** 当前动线里「下一步」应该去哪：全部节完成且无遗留实操作 → 总结，否则回学习正文。 */
export function flowReturnNextLabel(flow: StudyFlowView): string {
  const allLessonsDone = flow.totalLessons > 0
    && flow.completedLessons >= flow.totalLessons
    && flow.pendingPractical === 0;
  return allLessonsDone ? FLOW_RETURN_NEXT_SUMMARY : FLOW_RETURN_NEXT_LESSON;
}

/** 回到哪一节的完整措辞。活动挂在有教材的节上时给出节次与知识点。 */
export function flowReturnBackLabel(flow: StudyFlowView, activeNodeId: string | undefined): string {
  const cycle = flow.cycles.find((item) => item.nodeId === activeNodeId);
  if (cycle === undefined) return FLOW_RETURN_BACK_CYCLE;
  const counter = lessonCounterLabel(cycle.index, cycle.total);
  return flowReturnBackLesson(counter, cycle.knowledgePointId);
}

/* ---------- 客观题作答 ---------- */

export function quizPagerAriaLabel(current: number, total: number): string {
  return `第 ${current} 题，共 ${total} 题`;
}
export function quizPagerLabel(current: number, total: number): string {
  return `第 ${current} / ${total} 题`;
}
export function quizAnsweredLabel(count: number): string {
  return `${count} 题已作答`;
}
export const QUIZ_LEGEND = "当前题目答案";
export const JUDGMENT_TRUE_LABEL = "正确";
export const JUDGMENT_FALSE_LABEL = "错误";
export const QUIZ_PREV_BUTTON = "← 上一题";
export const QUIZ_NEXT_BUTTON = "下一题 →";
export const QUIZ_SUBMIT_BUTTON = "提交完整题组";

/* ---------- 代码题作答（含综合实操的封闭态） ---------- */

export const CODE_DRAFT_LABEL = "代码草稿";
export const CODE_SAVE_DRAFT_BUTTON = "保存草稿";
export const CODE_SUBMIT_BUTTON = "提交正式评测";
/** 代码评测封闭态的机器码照常展示（有专属测试锁定，见 ticket），不做翻译。 */
export const PYODIDE_CLOSED_CODE = "PYODIDE_DISABLED_WITH_NODE_FALLBACK";
export const PYODIDE_CLOSED_NOTICE = "浏览器预览未启用；正式评测由本地 Node/Python 执行。";
export const CODE_RETRY_EVALUATION_BUTTON = "恢复草稿并重试评测";
export const CODE_RETRY_MODIFIED_BUTTON = "修改代码后重试";
export const CODE_ABANDON_GAP_BUTTON = "放弃并进入下一环节";
export const QUIZ_SKIP_GAP_BUTTON = "暂时跳过，进入下一环节";
export const QUIZ_RETRY_NEW_SET_BUTTON = "使用新题组重试";
export const CONTINUE_NEXT_BUTTON = "继续下一步";
export const RETRY_MODIFY_BUTTON = "修改并重新评测";

/* ---------- 服务端进度恢复面板（已恢复服务端进度） ---------- */

export const RECOVERED_STATE_CODE = "已恢复服务端进度";
export const RECOVERED_RETRY_HEADING = "上次结果需要修改后重试";
export const RECOVERED_DONE_HEADING = "该活动已经完成";
export function recoveredBodyLabel(progress: string, result: string): string {
  return `服务端记录：${progress} / ${result}。系统不会重复创建已完成的提交。`;
}

/** 活动在服务端的进度状态。 */
export function activityProgressLabel(status: string): string {
  return status === "completed" ? "已完成"
    : status === "in_progress" ? "等待重做"
    : status === "insufficient" ? "证据不足"
    : "尚未开始";
}

/** 活动在服务端的结果状态。 */
export function activityResultLabel(result: string | undefined): string {
  return result === "pass" ? "通过"
    : result === "partial" ? "部分通过"
    : result === "fail" ? "未通过"
    : result === "insufficient" ? "证据不足"
    : "尚未判定";
}

/* ---------- 活动恢复失败面板 ---------- */

/** 恢复失败的大类措辞。内部错误码不直接展示，先归入稳定的大类。 */
export function recoveryCategoryLabel(error: { status?: number; message?: string }): string {
  if (error.status === 409) return "服务端版本已经变化";
  if (error.status === 404) return "原活动或作答记录不存在";
  if (error.status !== undefined) return "服务连接暂时失败";
  const message = error.message;
  if (message === "activity_safe_view_incomplete" || message === "ACTIVITY_SAFE_VIEW_INCOMPLETE") return "活动安全内容不完整";
  return "活动恢复失败";
}
export const RECOVERY_BODY = "服务端保留原 Attempt，页面没有创建替代作答，也没有生成新的 Evidence。";
export const RECOVERY_LIMIT_REACHED = "已达到本页恢复上限，自动恢复现已停止。";
export const RECOVERY_CAN_TRY_AGAIN = "你可以再尝试一次恢复。";
export const DRAFT_STATE_PREFIX = "草稿状态：";
export const DRAFT_KEPT_NOTICE = "浏览器中的代码草稿仍然保留；服务端是否收到最后一次保存尚未确认。";
export const DRAFT_ABSENT_NOTICE = "当前没有可确认的浏览器代码草稿；未提交的题目答案不会被冒充为已保存。";
export const RECOVERY_RETRY_BUTTON = "再次尝试恢复";
export const BACK_TO_PATH_LABEL = "返回学习路径";

/* ---------- 评测结果 ---------- */

/** 代码评测错误的稳定中文大类和兜底。 */
export function errorKindLabel(code: string | undefined): string {
  const labels: Record<string, string> = {
    syntax_error: "语法错误",
    test_failed: "验收项未通过",
    timeout: "运行超时",
    output_limit: "输出过多",
    evaluator_timeout: "评测服务超时",
    evaluator_error: "评测服务错误",
    submission_contract_error: "提交内容不符合题目合同",
  };
  return code === undefined ? "无" : (labels[code] ?? code);
}

export const EVALUATOR_UNAVAILABLE_HEADING = "评测服务暂时不可用";
export const EVALUATOR_UNAVAILABLE_BODY = "本次没有评分，也没有推进学习状态。代码草稿仍然保留。";
export const CODE_RESULT_TITLE = "权威评测结果";
export const QUIZ_RESULT_TITLE = "确定性判分结果";

/** 判分结论的中文通称。 */
export function verdictLabel(verdict: string | undefined): string {
  return verdict === "pass" ? "通过"
    : verdict === "partial" ? "部分通过，需要修改"
    : verdict === "fail" ? "未通过，需要重做"
    : "本次未评分";
}

export const NO_POINT_DETAIL = "无逐点明细";
export const QUIZ_SCORE_NONE = "未形成";
export const PASSED_POINTS_LABEL = "通过测试点";
export const METRIC_EXECUTION = "执行状态";
export const EXECUTION_COMPLETED = "执行完成";
export const EXECUTION_FAILED = "执行失败";
export const METRIC_PROBLEM_TYPE = "问题类型";
export const LEGACY_TEST_POINTS_NOTICE = "该历史评测结果生成时尚未记录逐测试点状态，请修改代码后重新评测。";

/** 确定性反馈的面向用户兜底翻译（英文原值不回落到界面）。 */
export function safeFeedbackLabel(feedback: string, errorCode: string | undefined): string {
  if (feedback === "One or more deterministic checks did not pass.") {
    return "公开验收项尚未全部通过。请对照题目要求检查函数返回值、字段规则和允许编辑范围，修改后重新提交。";
  }
  if (feedback === "All deterministic checks passed.") return "全部确定性验收项已通过。";
  return feedback;
}

export const METRIC_CORRECT_COUNT = "正确题数";
export const METRIC_PASS_REQUIREMENT = "通过要求";
export function passRequirementLabel(required: number): string {
  return `至少答对 ${required} 题`;
}
export const METRIC_EVIDENCE = "学习证据";
export const EVIDENCE_NOT_GENERATED = "未生成";
export const EVIDENCE_RECORDED = "已记录";

export const REMEDIATION_TITLE = "本轮补救变化";
export const REMEDIATION_IMPROVED = "错题减少，有改善";
export const REMEDIATION_REGRESSED = "错题增加，需要继续巩固";
export const REMEDIATION_UNCHANGED = "错题数量未变化";
export function remediationBodyLabel(previous: number, current: number, weakKnowledgePoints: readonly string[]): string {
  const countPart = `错题由 ${previous} 道变为 ${current} 道。`;
  return weakKnowledgePoints.length === 0
    ? `${countPart}本轮未留下待巩固知识标签。`
    : `${countPart}仍需巩固：${weakKnowledgePoints.join("、")}。`;
}

export const ANSWER_REVIEW_TITLE = "提交后安全复盘";
export const ANSWER_REVIEW_ORIGINAL = "原题";
export const ANSWER_REVIEW_LEGACY_PROMPT = "旧版作答记录未保存原题题干";
export function answerReviewIndexLabel(index: number): string {
  return `第 ${index + 1} 题 · `;
}
/** 统一反馈状态文案：答对与答错。 */
export const FEEDBACK_ANSWER_CORRECT = "回答正确";
export const FEEDBACK_ANSWER_WRONG = "需要复习";
export function correctAnswerLabel(value: string | boolean): string {
  return `正确答案：${String(value)}`;
}
export function explanationLabel(text: string): string {
  return `正文解释：${text}`;
}

/* ---------- 逐测试点明细 ---------- */

export const TEST_POINT_KICKER = "逐点结果";
export const TEST_POINT_HEADING = "测试点明细";
export const TEST_POINT_NOTE = "公开测试使用题面样例；密封测试只显示结论，不公开输入、预期输出和判定规则。";
export const TEST_POINT_COL_TEST = "测试点";
export const TEST_POINT_COL_TYPE = "类型";
export const TEST_POINT_COL_STATUS = "状态";
export const TEST_POINT_SCOPE_PUBLIC = "公开测试点";
export const TEST_POINT_SCOPE_SEALED = "密封测试点";
/** 逐测试点的统一状态文案。 */
export function testPointStatusLabel(status: string): string {
  return status === "passed" ? "通过"
    : status === "failed" ? "未通过"
    : "未运行";
}
export const TEST_POINT_GLYPH: Record<"passed" | "failed" | "not_run", string> = {
  passed: "✓",
  failed: "×",
  not_run: "−",
};

/* ---------- 代码题完整题面 ---------- */

export const CONTRACT_TITLE = "完整题面";
export const CONTRACT_MISSING_ALERT = "该代码题缺少正式题面，当前不能提交。请返回教学内容后重试。";
export const CONTRACT_BACKGROUND = "任务背景";
export const CONTRACT_INPUT = "输入说明";
export const CONTRACT_OUTPUT = "输出说明";
export const CONTRACT_IMPLEMENT = "需要实现";
export const CONTRACT_RETURN = "返回要求";
export const CONTRACT_LIBRARIES = "可用库";
export const CONTRACT_EDITABLE = "编辑范围";
export function editableRegionsLabel(regions: ReadonlyArray<{ startMarker: string; endMarker: string; maxCharacters: number }>): string {
  return regions.map((region) => `${region.startMarker} 到 ${region.endMarker}（最多 ${region.maxCharacters} 字符）`).join("；");
}
export const CONTRACT_RULES = "处理规则";
export const CONTRACT_PROHIBITED = "禁止事项";
export const CONTRACT_ACCEPTANCE_CRITERIA = "公开验收要点";

export const SAMPLE_KICKER = "可复验公开样例";
export const SAMPLE_HEADING = "完整输入与期望输出 CSV";
export const SAMPLE_NOTE = "页面显示的是完整样例文件，不是截断预览；下载后可直接用表格软件或 pandas 打开。";
export const SAMPLE_INPUT_TITLE = "处理前 CSV";
export const SAMPLE_OUTPUT_TITLE = "期望输出 CSV";
export function sampleRowsLabel(rows: number): string {
  return `${rows} 行数据 · UTF-8 CSV`;
}
export const SAMPLE_DOWNLOAD_BUTTON = "下载完整 CSV";
export function sampleCsvAriaLabel(title: string): string {
  return `${title}完整内容`;
}
export const SAMPLE_FILE_NAME_PREFIX = "文件名：";
export function sampleExplanationLabel(text: string): string {
  return `样例解释：${text}`;
}