/*
 * LearnPage(学习页)的全部面向用户文案。
 *
 * 与 ui-copy.ts 相同的两条硬规则:
 * 1. 兜底值必须是中文通称,任何情况下不得回落英文原值。
 * 2. 内部标识符(sessionId / nodeId / activityId / pathVersion /
 *    sessionVersion / profileRevision / reasonCodes / sourceAnchorIds /
 *    各类 claimId / ruleId 等)一律不向用户展示。
 *
 * 页面结构(三段式卡片模型):
 * - 任务卡:本节目标 + 主操作(进入正式活动 / 重新学习本节),全页唯一主操作卡。
 * - 正文阅读区:结构化教学正文,衬线字体、不限高、不包卡壳,像教材的一页。
 * - 折叠信息卡:误区与术语依据,默认折叠,并列卡同组样式一致。
 */

/** Agent 流水线在页面中等待服务端时的兜底状态文案(管线组件自身文案不动)。 */
export const AGENT_PIPELINE_STATUS_FALLBACK = "正在等待服务端响应";

/** 请求错误码的中文名。未知码不回落到英文原值。 */
const REQUEST_ERROR_LABELS: Readonly<Record<string, string>> = {
  next_step_failed: "下一步读取失败",
  activity_open_failed: "正式活动打开失败",
  tip_unavailable: "个性化提醒暂不可用",
  session_version_conflict: "会话版本冲突",
  bootstrap_failed: "会话快照读取失败",
  request_failed: "请求未完成",
  invalid_response_shape: "服务端响应异常",
};

/** 把内部错误码转成中文通称;未知码一律回落「请求未完成」。 */
export function requestErrorLabel(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  return REQUEST_ERROR_LABELS[code] ?? "请求未完成";
}

/** 页面级文案。 */
export const LEARN_PAGE_COPY = {
  /** PageFrame 眉标、标题与摘要。 */
  eyebrow: "数据清洗实验手册",
  frameTitleFallback: "学习内容",
  frameSummaryFallback: "从服务端读取当前会话绑定的权威教学正文。",
  backLabel: "返回学习路径",

  /** 顶栏徽章。 */
  relearnBadge: "可重新学习",
  reviewBadge: "回看模式",

  /* ---------- 任务卡:本节目标 + 主操作 ---------- */
  taskKicker: "本节目标",
  taskTitle: "开始前，先明确这一节要学会什么",
  understandHeading: "你将了解",
  masterHeading: "你将掌握",

  /** 辅助节点(不扩写独立教材)。节数为运行时未知,一律去数字化表述。 */
  helperKicker: "基础辅助节点",
  helperTitle: "本节点不扩写独立教材",
  helperBody: "它只用于确认进入 Pandas 学习前所需的基础 Python 操作。完成正式活动后，将进入结构化中文教学正文。",

  /** 正文不可用(不冒充教材)。 */
  blockedKicker: "正文不可用",
  blockedTitle: "当前会话没有绑定可验证的教学正文",
  blockedBody: "请重新读取会话；若问题仍存在，需要修复 Profile 正文或 Schema 后新建会话。本页不会使用空白内容冒充教材。",
  reloadSession: "重新读取会话",

  /** 任务卡底部主操作区。 */
  reviewNote: "回看正文不会改变进度；重新作答后才会形成新的学习证据",
  backToCurrent: "返回当前学习进度",
  relearnSection: "重新学习本节",
  retryRead: "重新读取内容",
  enterActivity: "进入正式活动",
  generatingReminderFallback: "提醒生成中（已处理 0 秒）",

  /** 异步动作状态文案(与 useAsyncActionProgress 的「（已处理 N 秒）」拼接)。 */
  progressQuiz: "正在生成并审核题组",
  progressActivity: "正在准备正式活动",
  progressTip: "正在生成并审核个性化提醒",

  /* ---------- 个性化课前导学 ---------- */
  tipTitle: "AI 个性化课前导学",
  tipGenerating: "正在生成并审核个性化提醒（已处理 0 秒）",
  tipUnavailableStatus: "本次未生成",
  tipStructuredStatus: "已生成",
  tipLegacyStatus: "旧版提醒",
  tipLoadingBody: "Agent 正在读取本节正式正文、章节关系和学情信息，并执行 Generator、Hunter 与 Judge 审核；正文已可正常阅读。",
  /** 导学未生成时右页的便签占位：标题 + 含义 + 下一步，不冒充正文。 */
  tipEmptyTitle: "导学未生成",
  tipEmptyBody: "AI 导学这次没有形成通过审核的内容；本节正文不受影响，可以直接开始学习。",
  tipEmptyNext: "可以先完成本节学习并作答正式活动；导学由 AI 在诊断后生成，之后回到简报即可查看。",
  tipRegenerate: "重新生成提醒",
  tipUpgrade: "升级课前导学",

  /** 结构化导学的四区块与引导问题。 */
  guidePrior: "承接前文",
  guideFocus: "本节主线",
  guideNext: "下一步去哪里",
  guideAdvice: "学习建议",
  guideQuestion: "带着这个问题进入正文",

  /* ---------- 正文阅读区与折叠信息卡 ---------- */
  readingAriaLabel: "结构化教学正文",
  factsAriaLabel: "误区与术语",
  codeAriaLabel: "代码示例",
  termsHeading: "术语解释",
  sourcesHeading: "本节依据",

  /* ---------- 旧版卡片(未绑定结构化正文)的阅读区 ---------- */
  stepByStepHeading: "分步理解",
  exampleHeading: "示例",
  mistakeHeading: "常见误区",

  /* ---------- 正文页生成等待提示 ---------- */
  /** 正文页等待生成时,指引去简报界面展开流水线状态带;中性措辞,不暗示会中断或重启生成。 */
  generationHint: "实时多 Agent 任务链正在状态带运行：返回简报界面即可展开「AI 学习资源流水线」查看工作台，不影响生成。",
} as const;

/* ---------- 站点纸张堆叠导航 ----------
 *
 * 正文各站像一叠纸:一次只翻到一站,翻动时渐入渐出。
 * 导航条提供上一站/下一站和站点刻度,可以按站跳转。
 */
export const STATION_STACK = {
  navAria: "教学站点导航",
  prev: "上一站",
  next: "下一站",
  count: (index: number, total: number) => `第 ${index} 站 · 共 ${total} 站`,
  jumpAria: (label: string) => `跳到${label}`,
} as const;

/* ---------- 学习页两幕:引入 → 学习 ----------
 *
 * 引入幕回答「你在哪 / 学什么 / 怎么学」;学习幕是正文纸叠。
 * 同一路由内切换,地址 #study 对应学习幕,浏览器后退可回简报。
 */
export const LESSON_ACTS = {
  openStudy: "翻开正文",
  skipToActivity: "直接进入活动",
  backToBriefing: "返回简报",
} as const;

/* ---------- AI 工作台收纳条 ----------
 *
 * 流水线是比赛的核心证据,但它是「机房」,不该压过正文。
 * 默认收纳成一条状态带,展开后仍是完整的八工位工作台;
 * 运行失败时自动展开,保证随时可查。
 */
export const PIPELINE_DRAWER = {
  title: "AI 学习资源流水线",
  view: "查看工作台",
  collapse: "收起工作台",
  toggleAria: "展开或收起 AI 学习资源流水线工作台",
} as const;

/** 任务卡上的「本节位置」:一排小圆点 + 节次文案,与侧栏大动线同一套视觉语言。 */
export function lessonPositionAriaLabel(
  index: number | undefined,
  total: number,
  lessonName: string | undefined,
): string {
  const counter = index === undefined ? `共 ${total} 节` : `第 ${index} 节，共 ${total} 节`;
  return lessonName === undefined
    ? `本节位置：${counter}`
    : `本节位置：${counter}，本节是${lessonName}`;
}

/**
 * 正文动线各站点的动作短语。
 *
 * 一节正文在视觉上是一条小动线:先问为什么学,再拆解要学什么,
 * 然后看一遍示范,最后轮到学习者自己做——和左侧栏的大动线
 * (准备 → 诊断 → 分析 → 学习 → 总结)是同一套「站点」语言。
 * 误区与术语依据是附录,不占站点。
 */
const STATION_LABELS: Readonly<Record<string, string>> = {
  intuition: "为什么学",
  concepts: "学什么",
  walkthrough: "看示范",
  "final-task": "该你做",
};

const FALLBACK_STATION = "学习站";

export function stationLabel(moduleId: string): string {
  return STATION_LABELS[moduleId] ?? FALLBACK_STATION;
}