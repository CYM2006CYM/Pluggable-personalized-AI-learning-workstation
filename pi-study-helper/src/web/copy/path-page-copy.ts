import type { KnowledgeState, PathNodeSafeView } from "../../contracts/index.js";
import { lessonStatusLabel } from "./ui-copy.js";

/*
 * PathPage 页面文案。
 *
 * 页面自身的全部用户可见中文收在这里：任务卡、证据卡、按钮、节点状态与安排理由。
 * 跨页面共享的语义文案（masteryLabel / knowledgeStatusLabel / lessonStatusLabel
 * 等）仍归 ui-copy.ts 所有，这里只按需引用，不重复定义。
 *
 * 与 ui-copy.ts 相同的两条硬规则：
 * 1. 兜底值必须是中文通称，任何情况下不得回落英文原值。
 * 2. 内部标识符（路径版本、会话版本、修订号、节点/知识点 id 等）一律不向用户展示。
 */

const FALLBACK_STATUS = "状态待确认";
const FALLBACK_REASON = "其他安排原因";
const FALLBACK_SCAFFOLD = "辅助方式待标注";

/** 页框与任务卡文案。任务卡承载「这是依据你的诊断算出来的路径」与主确认操作。 */
export const PATH_PAGE_COPY = {
  eyebrow: "路径确认",
  title: "查看并确认学习路径",
  summary: "系统根据诊断证据、先修关系和必做评测计算章节、辅助方式与预计时长。",
  backLabel: "返回诊断",
  headerBadge: (estimatedMinutes: number) => `系统预计 ${estimatedMinutes} 分钟`,
  taskTitle: "这是依据你的诊断算出来的路径",
  taskBody: "系统结合诊断证据、先修关系与必做评测，为你安排了章节顺序、辅助方式和预计时长。确认后即可开始学习；下方明细保留这份安排的证据，可展开逐节核对。",
  confirmedTag: "已确认",
  pendingTag: "待确认",
  taskSummary: (infeasible: boolean, nodeCount: number, estimatedMinutes: number) =>
    infeasible ? "当前路径不可行" : `${nodeCount} 个章节 · 预计 ${estimatedMinutes} 分钟`,
  confirmButton: "确认学习路径",
  enterButton: "进入学习",
  replanButton: "按最新诊断重算",
  confirmProgress: "正在确认学习路径",
  replanProgress: "正在按最新诊断重算路径",
  enterProgress: "正在准备学习内容",
  emptyDetail: "当前安全快照没有可展示的路径。",
} as const;

/** 证据卡标题（信息卡默认折叠，标题即 <summary>）。 */
export const PATH_PANEL_COPY = {
  detailTitle: "路径明细",
  basisTitle: "时间与诊断依据",
  profileTitle: "诊断画像",
  noKnowledgeStates: "本次没有形成可展示的知识状态，系统按未验证处理。",
  estimatedLabel: "预计学习时长",
  minimumLabel: "最低需要",
  minimumSatisfied: "已满足",
  missingPrerequisitesLabel: "缺失先修",
  countUnit: "项",
  replanTitle: "重算结果",
  replanChanged: "路径变化",
  replanFallback: "沿用旧路径",
  yes: "是",
  no: "否",
  noChange: "学习安排没有变化",
} as const;

/**
 * 路径节点状态的中文标签。
 *
 * 「跳过」保持两态，不得合并：
 * - skipped：整节跳过，没有遗留活动。后端节点状态即 skipped。
 * - teaching-skipped：只跳过教学，最终综合实操仍必做。后端用「带诊断跳过标记
 *   但节点状态不是 skipped」表达，即 reasonCodes 含 diagnostic_skip_selected。
 *   该态复用语义层的 lessonStatusLabel("teaching-skipped")，与步骤条措辞一致。
 */
const NODE_STATUS_LABELS: Readonly<Record<PathNodeSafeView["status"], string>> = {
  locked: "等待先修",
  available: "可以开始",
  in_progress: "正在学习",
  completed: "已完成",
  skipped: "已跳过",
};

function hasDiagnosticSkip(node: PathNodeSafeView): boolean {
  return node.reasonCodes.includes("diagnostic_skip_selected");
}

export function pathNodeStatusLabel(node: PathNodeSafeView): string {
  if (hasDiagnosticSkip(node) && node.status !== "skipped") return lessonStatusLabel("teaching-skipped");
  return NODE_STATUS_LABELS[node.status] ?? FALLBACK_STATUS;
}

/**
 * 节点的视觉状态键（写进 data-status，不上屏）。它决定证据行与状态徽章的
 * 配色：整节跳过与跳过教学保留实操必须视觉可分。
 */
export function pathNodeTone(node: PathNodeSafeView): string {
  if (hasDiagnosticSkip(node) && node.status !== "skipped") return "teaching-skipped";
  return node.status;
}

/** 辅助方式。英文原值 none / hint / worked_example 不向用户展示。 */
const SCAFFOLD_LABELS: Readonly<Record<string, string>> = {
  none: "独立完成",
  hint: "提示辅助",
  worked_example: "示例带练",
};

export function scaffoldLabel(level: string): string {
  return SCAFFOLD_LABELS[level] ?? FALLBACK_SCAFFOLD;
}

export function requirementLabel(required: boolean): string {
  return required ? "本次目标要求" : "可选巩固";
}

/** 安排理由。英文原值不向用户展示。 */
const REASON_LABELS: Readonly<Record<string, string>> = {
  prerequisite_required: "本节是后续学习的必要基础",
  prerequisite_gap: "需要先补齐前置知识",
  low_mastery: "诊断显示当前掌握不足",
  goal_required: "属于本次学习目标",
  review_due: "需要复习巩固",
  user_selected: "由你指定学习",
  error_remediation: "根据错误安排重做",
  time_compressed: "已压缩为必要活动",
  evidence_insufficient: "现有证据不足以安全跳过",
  diagnostic_skip_selected: "你选择依据两类诊断证据跳过本节教学",
  available_minutes_changed: "可用时间限制发生变化",
  candidate_infeasible: "候选路径不可行",
};

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? FALLBACK_REASON;
}

/** 每个节点为什么这样安排的说明。 */
export function arrangementText(node: PathNodeSafeView, states: readonly KnowledgeState[]): string {
  if (node.status === "skipped" && hasDiagnosticSkip(node)) return "你已选择跳过本节教学和普通练习；系统保留这项诊断事实。";
  if (hasDiagnosticSkip(node)) return "你已选择跳过本节教学；本节点只保留不可跳过的最终综合实操。";
  if (node.status === "skipped") return "多种正式学习证据已满足自动跳过条件，本节不重复安排。";
  const state = states.find((item) => item.knowledgePointId === node.knowledgePointId);
  if (state?.status === "ready" || state?.status === "mastered") {
    return "当前掌握度较高，但还没有满足安全跳过条件；系统保留必要验证，并减少脚手架。";
  }
  return node.reasonCodes.map((code) => reasonLabel(code)).join("；") || "按知识先修顺序安排。";
}

/** 诊断形成的知识状态汇总，作为「路径由诊断算出」的证据说明。 */
export function diagnosticPathNotice(states: readonly KnowledgeState[], nodes: readonly PathNodeSafeView[]): string {
  if (states.length === 0) return "本次没有形成诊断知识状态，系统按未验证处理。";
  const supportNeeded = states.filter((state) => state.status === "support_needed" || state.status === "learning" || state.status === "unverified").length;
  const ready = states.filter((state) => state.status === "ready").length;
  const mastered = states.filter((state) => state.status === "mastered").length;
  // A diagnostic skip can retain the mandatory final practical activity. Such
  // a node is intentionally not `status: skipped`, but its teaching content
  // is still skipped and must be counted in the learner-facing summary.
  const skipped = nodes.filter((node) => node.reasonCodes.includes("diagnostic_skip_selected")).length;
  const optional = states.filter((state) => state.diagnosticSkipEligible === true).length;
  return `本次诊断形成 ${states.length} 个知识状态：${supportNeeded} 个需要支持，${ready} 个已有基础，${mastered} 个已充分掌握；${optional} 个模块通过两类客观诊断证据，可由你决定是否跳过；当前路径已选择跳过 ${skipped} 个章节教学。`;
}