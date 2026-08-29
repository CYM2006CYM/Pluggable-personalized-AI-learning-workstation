import type { StepStatus, StudyStepId } from "../flow/study-flow.js";

/*
 * 面向学习者的全部中文文案。
 *
 * 两条硬规则：
 * 1. 兜底值必须是中文通称，任何情况下不得回落英文原值。
 * 2. 内部标识符一律不向用户展示。
 *
 * 关于第 2 条的唯一豁免：**完成归档 SHA-256 保留展示**。它不是内部状态外泄，
 * 而是「可复验完成归档」的组成部分，是评审核对可复现性时要看的证据。另有测试
 * 保护它。除此之外，会话 ID、节点 ID、活动 ID、各类版本号都不许出现在界面上。
 */

/** 五个环节的中文名。 */
const STEP_LABELS: Readonly<Record<StudyStepId, string>> = {
  prepare: "准备",
  diagnostic: "诊断",
  analysis: "分析",
  lesson: "学习",
  activity: "测试",
  summary: "总结",
};

/**
 * 环节状态。注意「跳过」有两个值，不是笔误：
 * - skipped：整节跳过，没有遗留活动，计入进度。
 * - teaching-skipped：只跳过教材正文，最终综合实操仍必做，**不计入进度**，
 *   也不阻塞后续，但必须提示用户还有未完成的实操。
 *
 * 后端用「带诊断跳过标记但节点状态不是 skipped」来表达后者，两者语义不同，
 * 合并会让用户以为已经结束。
 */
export type LessonStatusLabel =
  | "completed"
  | "current"
  | "locked"
  | "skipped"
  | "teaching-skipped";

const LESSON_STATUS_LABELS: Readonly<Record<LessonStatusLabel, string>> = {
  completed: "已完成",
  current: "正在学习",
  locked: "尚未解锁",
  skipped: "已跳过",
  "teaching-skipped": "已跳过教学，保留实操",
};

/**
 * 环节状态。只有三态——「已跳过」是节的状态，不是环节的状态。
 * 环节层面造不出「本环节已跳过」这种说法。
 */
const STEP_STATUS_LABELS: Readonly<Record<StepStatus, string>> = {
  completed: "已完成",
  current: "进行中",
  locked: "尚未解锁",
};

/** 步骤条自身的中文标签。它也是用户可见字符串，因此归语义层所有。 */
export const STEPPER_LABELS = {
  nav: "学习流程",
  lessons: "各节进度",
  /** hover/点开后浮层卡片的标题。 */
  progress: "学习进度",
  expand: "展开各节进度",
  collapse: "收起各节进度",
} as const;

/**
 * 骨架自身的中文标签。
 * 侧栏可折叠：收起后只留圆点，标签交给 hover 浮层。
 */
export const SHELL_LABELS = {
  /** 折叠按钮的无障碍名称。收起/展开是同一个按钮，靠 aria-expanded 区分。 */
  collapseSidebar: "收起侧边栏",
  expandSidebar: "展开侧边栏",
} as const;

/**
 * 主流程之外的辅助导航。
 * 「案例」不进学习动线——它是展示材料，不是学习环节。
 */
export const AUX_NAV_LABELS = {
  start: "开始",
  showcases: "案例",
} as const;

/** 掌握程度数值的中文分档。数值本身不向用户展示。 */
const MASTERY_LABELS: readonly { min: number; label: string }[] = [
  { min: 0.8, label: "已掌握" },
  { min: 0.5, label: "基本会" },
  { min: 0, label: "还需练" },
];

/** 问卷四档。英文原值 none / basic / comfortable / uncertain 不向用户展示。 */
const EXPERIENCE_LABELS: Readonly<Record<string, string>> = {
  none: "没接触过",
  basic: "会一点",
  comfortable: "比较熟",
  uncertain: "说不清",
};

/** 讲解偏好三档。英文原值与「经验四档」语义不同,不能复用 EXPERIENCE_LABELS。 */
const EXPLANATION_PREFERENCE_LABELS: Readonly<Record<string, string>> = {
  step_by_step: "逐步讲解",
  concise: "重点速览",
  example_first: "案例优先",
};

/** 知识状态。英文原值同样不向用户展示。 */
const KNOWLEDGE_STATUS_LABELS: Readonly<Record<string, string>> = {
  unverified: "尚未验证",
  ready: "已具备基础",
  mastered: "已掌握",
  support_needed: "需要帮助",
  learning: "正在学习",
};

/** 学情画像的生成方式。英文原值不向用户展示。 */
const PROFILE_STATUS_LABELS: Readonly<Record<string, string>> = {
  deterministic_fallback: "确定性事实摘要",
  agent_referenced: "Agent 已引用事实",
};

/**
 * 英文分区标签的中文替换。值为空串表示这一项根本不该出现在界面上，
 * 由调用方直接不渲染，而不是渲染成空白。
 */
const SECTION_LABELS: Readonly<Record<string, string>> = {
  "ACTIVE PROFILE": "当前教材",
  SESSION: "会话设置",
  "SERVER SNAPSHOT": "",
};

/** 会话阶段。原始阶段值不向用户展示。 */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  created: "刚创建",
  diagnostic: "诊断中",
  path: "规划路径中",
  learning: "学习中",
  activity: "做练习中",
  completed: "已完成",
};

/** 每个环节的主操作文案。 */
const STEP_CTA_LABELS: Readonly<Record<StudyStepId, string>> = {
  prepare: "开始准备",
  diagnostic: "开始摸底",
  analysis: "查看为我算出的路径",
  lesson: "进入本节测试",
  activity: "提交并查看结果",
  summary: "生成学习总结",
};

/** 未覆盖环节的兜底说法。 */
const FALLBACK_STEP = "学习";
const FALLBACK_STATUS = "状态待确认";
const FALLBACK_MASTERY = "还需练";
const FALLBACK_GENERIC = "暂未标注";

export function stepLabel(step: StudyStepId): string {
  return STEP_LABELS[step] ?? FALLBACK_STEP;
}

export function lessonStatusLabel(status: LessonStatusLabel): string {
  return LESSON_STATUS_LABELS[status] ?? FALLBACK_STATUS;
}

export function stepCtaLabel(step: StudyStepId): string {
  return STEP_CTA_LABELS[step] ?? FALLBACK_STEP;
}

export function stepStatusLabel(status: StepStatus): string {
  return STEP_STATUS_LABELS[status] ?? FALLBACK_STATUS;
}

/**
 * 跳过教学但保留实操的提示。这类节不计入进度，也不阻塞后续，
 * 但必须让用户知道还有没做的实操，否则他以为整节已经结束。
 */
export function pendingPracticalLabel(count: number): string {
  if (count <= 0) return "";
  return `还有 ${count} 节的综合实操等着你做`;
}

/** 把掌握度数值转成中文分档。空值表示尚未验证，不是 0 分。 */
export function masteryLabel(mastery: number | null | undefined): string {
  if (mastery === null || mastery === undefined) return "尚未验证";
  return MASTERY_LABELS.find((band) => mastery >= band.min)?.label ?? FALLBACK_MASTERY;
}

export function experienceLabel(value: string | undefined): string {
  return (value === undefined ? undefined : EXPERIENCE_LABELS[value]) ?? FALLBACK_GENERIC;
}

export function explanationPreferenceLabel(value: string | undefined): string {
  return (value === undefined ? undefined : EXPLANATION_PREFERENCE_LABELS[value]) ?? FALLBACK_GENERIC;
}

export function knowledgeStatusLabel(status: string | undefined): string {
  return (status === undefined ? undefined : KNOWLEDGE_STATUS_LABELS[status]) ?? FALLBACK_GENERIC;
}

export function stageLabel(stage: string | undefined): string {
  return (stage === undefined ? undefined : STAGE_LABELS[stage]) ?? FALLBACK_GENERIC;
}

export function profileStatusLabel(status: string | undefined): string {
  return (status === undefined ? undefined : PROFILE_STATUS_LABELS[status]) ?? FALLBACK_GENERIC;
}

/**
 * 状态面板的错误码翻译。服务端/框架错误码是内部标识符,不上界面:
 * 翻成稳定的中文大类,未知码一律回落通称;原始码保留在面板的
 * data-error-code 属性里,排查问题时开发者工具仍能看到。
 */
const STATE_CODE_LABELS: Readonly<Record<string, string>> = {
  request_failed: "请求未完成",
  session_version_conflict: "会话版本已变化",
  "PREREQUISITE VIOLATION": "尚未满足结束条件",
  prerequisite_violation: "尚未满足结束条件",
  ACTIVITY_SAFE_VIEW_INCOMPLETE: "活动安全内容不完整",
  activity_safe_view_incomplete: "活动安全内容不完整",
  COMPLETED_SUMMARY_ARCHIVE_MISSING: "总结归档缺失",
  RECOVERY_BLOCKED: "恢复受阻",
};

const FALLBACK_STATE_CODE = "状态待确认";

export function statePanelCodeLabel(code: string | undefined): string {
  if (code === undefined || code === "") return FALLBACK_STATE_CODE;
  if (code.startsWith("deep_link_")) return "深链核对未通过";
  return STATE_CODE_LABELS[code] ?? FALLBACK_STATE_CODE;
}

/**
 * 分区标签。返回空串表示这项不该显示——调用方必须直接不渲染,
 * 不能渲染成空白标签占位。
 */
export function sectionLabel(section: string | undefined): string {
  return (section === undefined ? undefined : SECTION_LABELS[section]) ?? FALLBACK_GENERIC;
}

/**
 * 节次进度。总数运行时给出，界面上不允许出现写死的节数。
 * 没有节次信息时返回空串，由调用方决定不渲染，而不是显示「第 0 节」。
 */
export function lessonCounterLabel(index: number | undefined, total: number | undefined): string {
  if (index === undefined || total === undefined || total <= 0) return "";
  return `第 ${index} 节 / 共 ${total} 节`;
}

/** 进度百分比。调用方不需要知道分子分母怎么算。 */
export function progressLabel(completed: number, total: number): string {
  if (total <= 0) return "";
  return `已完成 ${Math.round((completed / total) * 100)}%`;
}

/**
 * 供自检使用：把所有映射摊平，方便在 demo 页里检查覆盖率。
 * 生产代码不需要调用它。
 */
export function copyTablesForAudit(): ReadonlyArray<{
  table: string;
  entries: ReadonlyArray<[string, string]>;
}> {
  return [
    { table: "环节", entries: Object.entries(STEP_LABELS) },
    { table: "环节状态", entries: Object.entries(STEP_STATUS_LABELS) },
    { table: "节状态", entries: Object.entries(LESSON_STATUS_LABELS) },
    { table: "问卷档位", entries: Object.entries(EXPERIENCE_LABELS) },
    { table: "知识状态", entries: Object.entries(KNOWLEDGE_STATUS_LABELS) },
    { table: "会话阶段", entries: Object.entries(STAGE_LABELS) },
    { table: "画像状态", entries: Object.entries(PROFILE_STATUS_LABELS) },
    { table: "分区标签", entries: Object.entries(SECTION_LABELS) },
    { table: "环节主操作", entries: Object.entries(STEP_CTA_LABELS) },
  ];
}

/**
 * 内部标识符清单。这些字段一律不向用户展示，也没有对应的中文说法——
 * 它们不是「还没翻译」，而是「不该出现」。
 *
 * 唯一的例外是完成归档 SHA-256，见本文件顶部说明。
 */
export const INTERNAL_FIELD_IDS: readonly string[] = [
  "sessionId",
  "nodeId",
  "activityId",
  "attemptId",
  "sessionVersion",
  "pathVersion",
  "profileRevision",
  "diagnosticDraftVersion",
  "activityVersion",
  "evidenceVersion",
  "revision",
];

/** 明确允许展示的内部字段，以及允许它的理由。 */
export const DISPLAY_EXEMPTIONS: readonly { field: string; reason: string }[] = [
  {
    field: "completionArchiveSha256",
    reason: "完成归档的可复验哈希，属于评审要核对的可复现性证据，不是内部状态。收进折叠区展示。",
  },
];
