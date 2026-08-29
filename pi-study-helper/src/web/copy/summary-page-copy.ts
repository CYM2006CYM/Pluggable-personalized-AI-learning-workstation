/*
 * 总结页（SummaryPage）专属文案。
 *
 * 与 ui-copy.ts 同两条硬规则：
 * 1. 兜底值必须是中文通称，任何情况下不得回落英文原值。
 * 2. 内部标识符一律不向用户展示。唯一豁免是完成归档 SHA-256——
 *    它是「可复验完成归档」的组成部分，用中文标签（归档指纹（SHA-256））包裹后
 *    收进折叠区展示，详见 ui-copy.ts 顶部说明。
 * 跨页通用词（环节名、环节状态、掌握分档、画像状态等）归 ui-copy.ts，
 * 本文件只放总结页自己的说法。
 */

/** 页头（PageFrame）文案。 */
export const SUMMARY_PAGE = {
  eyebrow: "会话总结",
  title: "本次学习进度",
  /** 总结尚未生成或归档缺失时，标题下方的占位说明。 */
  pageSummaryFallback: "学习总结生成后会完整呈现，先在这里回顾已经走过的环节。",
  backToMenu: "返回主菜单",
} as const;

/** 生成中 / 冲突 / 归档缺失等状态的页面级文案。 */
export const SUMMARY_STATE_COPY = {
  generating: "学情画像 Agent 正在生成总结",
  generatingElapsedFallback: "学情画像 Agent 正在生成总结（已处理 0 秒）",
  conflictDetail: "只有最终综合实操产生正式学习者判定后才能结束会话。",
  archiveMissingDetail: "会话已完成，但这次的总结归档缺失；系统不会凭空补造一份历史总结。",
} as const;

/** 顶部指标条（会话指标）的标签。值一律运行时给，不写死。 */
export const SUMMARY_STATS = {
  metricsLabel: "会话指标",
  path: { label: "路径已规划", unit: "节", hint: "按摸底结果排定的学习顺序" },
  activity: { label: "测试记录", unit: "次", hint: "学习与测试两个环节的作答记录" },
  unresolved: { label: "未解决结果", unit: "项", hint: "未通过、部分完成或尚未尝试" },
  skip: { label: "主动跳过", unit: "节", hint: "由你确认的路径选择" },
} as const;

/** 按动线环节汇总的卡片标题。 */
export const SUMMARY_JOURNEY = {
  diagnostic: { kicker: "诊断", heading: "摸底结论" },
  path: { kicker: "路径", heading: "学习路径" },
  learning: { kicker: "学习与测试", heading: "学与练的收获" },
  summary: { kicker: "总结", heading: "本次学习总结" },
} as const;

/** 诊断环节正文。有初始画像时给出分档人数，否则只报覆盖数。 */
export function diagnosticOutcomeLabel(
  total: number,
  readyCount: number | undefined,
  supportCount: number | undefined,
): string {
  if (readyCount !== undefined && supportCount !== undefined) {
    return `摸底共覆盖 ${total} 个知识点，其中 ${readyCount} 个已具备基础、${supportCount} 个需要帮助。`;
  }
  if (total > 0) return `摸底共覆盖 ${total} 个知识点，据此安排后续学习。`;
  return "摸底确定了本次学习的学习起点。";
}

/** 路径环节正文。 */
export function pathPlannedLabel(count: number): string {
  return count > 0
    ? `为你规划了 ${count} 节学习内容，从摸底结论出发，一节一节走到综合实操。`
    : "路径里暂时没有章节。";
}

/** 学后掌握分区。 */
export const MASTERY_GAINS = {
  heading: "学后掌握",
  improved: "有进步",
  notImproved: "暂无状态提升",
  masteryAffix: "掌握程度",
  /** 已有基础或掌握 N 个 · 仍需帮助 M 个 */
  balanceLabel: (strengths: number, support: number) => `已有基础或掌握 ${strengths} 个 · 仍需帮助 ${support} 个`,
} as const;

/** 「N 条依据」——不做中英混排。 */
export function evidenceCountLabel(count: number): string {
  return `${count} 条依据`;
}

/** 主动跳过的章节分区。reasonTag 用学习者语言，不再出现「诊断双证据」等措辞。 */
export const DIAGNOSTIC_SKIPS = {
  heading: "主动跳过的章节",
  intro: "以下章节因两类摸底证据都答对了，由你选择跳过：表示你已有基础并主动跳过，不等于经过本轮教学后再次掌握。",
  teachingRetained: "已跳过章节教学；最终综合实操仍保留",
  fullySkipped: "已跳过章节教学和普通练习",
  reasonTag: "摸底已确认基础",
} as const;

/** 仍需处理分区的结果措辞。 */
export const UNRESOLVED = {
  heading: "仍需处理",
  empty: "暂无未解决项。",
  reviewLink: "复习本节",
  continuedWithGap: "暂时跳过 / 未掌握",
  fail: "未通过",
  partial: "部分完成",
  insufficient: "证据不足",
  unverified: "尚未验证",
  bestResult: "最佳结果",
  notFormed: "尚未形成",
  passed: "通过",
} as const;

export type UnresolvedResultKind = "fail" | "partial" | "insufficient" | "unverified";
export type BestResultKind = UnresolvedResultKind | "pass";

/** 未解决结果的主措辞。 */
export function unresolvedResultLabel(result: UnresolvedResultKind): string {
  return result === "fail"
    ? UNRESOLVED.fail
    : result === "partial"
      ? UNRESOLVED.partial
      : result === "insufficient"
        ? UNRESOLVED.insufficient
        : UNRESOLVED.unverified;
}

/** 最佳结果的措辞；尚未形成时给中文通称。 */
export function bestResultLabel(result: BestResultKind | undefined): string {
  return result === undefined ? UNRESOLVED.notFormed : result === "pass" ? UNRESOLVED.passed : unresolvedResultLabel(result);
}

/** 「作答 N 次」。 */
export function attemptsLabel(count: number): string {
  return `作答 ${count} 次`;
}

/** 总结环节。 */
export const SUMMARY_OUTCOME = {
  nextRecommendation: "下一步建议",
  noRecommendation: "当前没有额外建议。",
} as const;

/** 完成归档折叠区。SHA-256 是唯一豁免的内部字段，标签用中文包裹。 */
export const ARCHIVE_CARD = {
  summaryLabel: "完成归档（可复验）",
  heading: "总结已冻结并可恢复",
  completedAt: "完成时间",
  notRecorded: "未登记",
  runs: "协同运行",
  runsUnit: "轮",
  shaLabel: "归档指纹（SHA-256）",
} as const;

/** 「N 轮」。 */
export function runsLabel(count: number): string {
  return `${count} ${ARCHIVE_CARD.runsUnit}`;
}

/** 学情画像详情折叠区。 */
export const PROFILE_DETAIL = {
  summaryLabel: "学情画像详情",
  heading: "学情画像",
  agentStatus: "画像状态",
  formalEvidence: "正式依据",
  agentNotePrefix: "补充解读",
} as const;

/** 任务卡（唯一任务卡）文案。 */
export const NEXT_TASK = {
  kicker: "后续动作",
  heading: "下一步去哪里",
  reviewFirst: "复习第一个未掌握章节",
  backToMenu: "返回主菜单",
  backToMenuNote: "保留本次会话记录，稍后仍可恢复",
  newSession: "开始新会话",
  newSessionNote: "重新完成问卷和诊断，建立新的独立会话",
} as const;

/** 既没有学习卡标题、也没有知识点中文名时的兜底名称。 */
export const FALLBACK_LESSON_TITLE = "本次学习项";