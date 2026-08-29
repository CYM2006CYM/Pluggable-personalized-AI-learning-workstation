import { difficultyLabel, knowledgePointLabel } from "../learning-labels.js";
import { experienceLabel, knowledgeStatusLabel, masteryLabel } from "./ui-copy.js";

/*
 * 案例页（ShowcasePage）的全部用户可见文案与英文直出的中文映射。
 *
 * 规则与 ui-copy.ts 保持一致：
 * 1. 兜底值必须是中文通称，任何情况下不得回落英文原值。
 * 2. 内部标识符一律不向用户展示：节点 ID、活动 ID、路径版本、
 *    画像修订号等在这里都没有对应的中文说法。
 * 3. 唯一保留的英文原值是校验哈希与案例编号（caseId）：
 *    - 哈希是案例数据「可复验证据」，与完成归档哈希同性质，受既有测试锁定；
 *    - caseId 是案例的公开稳定标识，评审核对 JSON 证据时需要它，
 *      以技术角标形式挂在中文画像名旁边，不作为主文案。
 */

const FALLBACK_GENERIC = "暂未标注";

/** 页头、工具栏等结构性文案。 */
export const PAGE_COPY = {
  eyebrow: "演示案例",
  title: "三类画像的学习路径",
  summary: "同一份教材、三种学习者画像：路径引擎按画像生成不同的学习安排。这里展示三次实际运算的完整结果与彼此差异，可对照核验。",
  actionBadge: "3 个案例",
  pickerLabel: "展示案例",
  pickerDescription: "选择一个学习者画像，查看对应的学习安排",
  pathKicker: "学习路径",
  facts: {
    summary: "案例关键数据",
  },
  hash: {
    summary: "校验与归档信息",
    note: "下方的摘要用于核验你看到的案例数据与生成结果未被改动，评审可据此复现。",
    seal: "内容归档校验码",
    input: "输入摘要",
    path: "路径摘要",
    output: "输出摘要",
  },
  diff: {
    summary: "案例差异对比",
    countSuffix: "处差异",
  },
  metrics: {
    nextNode: "下一节点",
    nextPractice: "待办练习",
    diagnosticGap: "诊断缺口",
    pythonExperience: "Python 经验",
    pandasExperience: "Pandas 经验",
    explanationPreference: "讲解偏好",
  },
} as const;

/** 三种学习者画像的中文名。英文原值（personaType）不向用户展示。 */
const PERSONA_LABELS: Readonly<Record<string, string>> = {
  high_foundation: "基础扎实型",
  non_computer_beginner: "零基础初学者",
  practice_oriented: "动手实操型",
};

export function personaLabel(personaType: string | undefined): string {
  return (personaType === undefined ? undefined : PERSONA_LABELS[personaType]) ?? "学习案例";
}

/** 路径生成状态。 */
const PATH_STATUS_LABELS: Readonly<Record<string, string>> = {
  candidate: "候选路径",
};

export function pathStatusLabel(status: string | undefined): string {
  return (status === undefined ? undefined : PATH_STATUS_LABELS[status]) ?? "路径待确认";
}

/** 路径节点的可用状态。与路径确认页的说法保持一致。 */
const NODE_STATUS_LABELS: Readonly<Record<string, string>> = {
  available: "可以开始",
  locked: "等待先修",
};

export function nodeStatusLabel(status: string | undefined): string {
  return (status === undefined ? undefined : NODE_STATUS_LABELS[status]) ?? "状态待确认";
}

/** 安排原因。英文原值（reasonCodes）不向用户展示。 */
const REASON_CODE_LABELS: Readonly<Record<string, string>> = {
  goal_required: "属于本次学习目标",
  prerequisite_gap: "需要先补齐前置知识",
  low_mastery: "诊断显示当前掌握不足",
};

const NO_REASON_FALLBACK = "按先修顺序安排";

export function reasonCodesText(codes: readonly string[] | undefined): string {
  if (codes === undefined || codes.length === 0) return NO_REASON_FALLBACK;
  return codes.map((code) => REASON_CODE_LABELS[code] ?? FALLBACK_GENERIC).join("、");
}

/** 脚手架（辅助方式）。英文原值不向用户展示。 */
const SCAFFOLD_LABELS: Readonly<Record<string, string>> = {
  none: "独立完成",
  hint: "提示辅助",
  worked_example: "示例带练",
};

export function scaffoldLabel(scaffold: string | undefined): string {
  return (scaffold === undefined ? undefined : SCAFFOLD_LABELS[scaffold]) ?? "辅助方式待确认";
}

/** 讲解偏好。与开始页问卷四档的翻译保持一致。 */
const PREFERENCE_LABELS: Readonly<Record<string, string>> = {
  concise: "重点速览",
  step_by_step: "逐步讲解",
  example_first: "案例优先",
};

export function preferenceLabel(preference: string | undefined): string {
  return (preference === undefined ? undefined : PREFERENCE_LABELS[preference]) ?? "偏好待确认";
}

/* ---------- 数量与单位的整句说法 ---------- */

export function minutesText(minutes: number): string {
  return `${minutes} 分钟`;
}

export function activitiesText(count: number): string {
  return `${count} 项练习`;
}

export function pendingPracticesText(count: number): string {
  return `${count} 项待完成`;
}

export function gapText(count: number): string {
  return `${count} 个知识点`;
}

export function chapterCountText(count: number): string {
  return `${count} 个章节`;
}

export function estimatedTotalText(minutes: number): string {
  return `预计 ${minutes} 分钟`;
}

export function differenceCountText(count: number): string {
  return `${count} ${PAGE_COPY.diff.countSuffix}`;
}

/* ---------- 下一步（下一节点 / 待办练习） ---------- */

export const PATH_COMPLETED_TEXT = "学习路径已全部完成";
const NEXT_NODE_FALLBACK = "路径节点待确认";

export function nextNodeText(nodeLabel: string | undefined, completed: boolean): string {
  if (completed) return PATH_COMPLETED_TEXT;
  return nodeLabel ?? NEXT_NODE_FALLBACK;
}

export function nextPracticeText(count: number | undefined): string {
  return count === undefined ? "无待办练习" : pendingPracticesText(count);
}

/* ---------- 差异对比区 ---------- */

/** 差异所属区块。英文原值不向用户展示。 */
const OBSERVABLE_LABELS: Readonly<Record<string, string>> = {
  background: "背景",
  diagnostic: "诊断",
  knowledge_state: "知识点状态",
  path_node: "路径节点",
};

export function observableLabel(observable: string | undefined): string {
  return (observable === undefined ? undefined : OBSERVABLE_LABELS[observable]) ?? FALLBACK_GENERIC;
}

/** 差异字段名。英文原值不向用户展示。 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  explanation_preference: "讲解偏好",
  insufficientKnowledgePointIds: "缺失知识点",
  mastery: "掌握度",
  status: "状态",
  confidence: "置信度",
  validEvidenceCount: "有效证据数",
  scaffold: "辅助方式",
  reasonCodes: "安排原因",
};

export function fieldLabel(field: string | undefined): string {
  return (field === undefined ? undefined : FIELD_LABELS[field]) ?? "其他差异";
}

/** 取「知识点.字段」键里的字段后缀；没有点时整个键就是字段。 */
function fieldOf(key: string): string | undefined {
  const separator = key.lastIndexOf(".");
  if (separator <= 0) return key.length === 0 ? undefined : key;
  return key.slice(separator + 1);
}

/** 把「知识点.字段」形态的差异键转成中文，如「读取CSV数据 · 掌握度」。 */
export function differenceFieldLabel(key: string): string {
  const separator = key.lastIndexOf(".");
  if (separator <= 0 || separator === key.length - 1) return fieldLabel(fieldOf(key));
  return `${knowledgePointLabel(key.slice(0, separator))} · ${fieldLabel(key.slice(separator + 1))}`;
}

/** 差异值的通用兜底。空数组与 null 都收敛为「无」。 */
function genericValueText(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? "无" : value.map(genericValueText).join("、");
  if (value === null || value === undefined) return "无";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 差异值转中文。字段按已知域映射，未知域走通用兜底（不回落英文原值以外的猜测）。 */
export function differenceValueLabel(key: string, value: unknown): string {
  switch (fieldOf(key)) {
    case "explanation_preference":
      return preferenceLabel(typeof value === "string" ? value : undefined);
    case "insufficientKnowledgePointIds":
      return Array.isArray(value)
        ? (value.length === 0 ? "无" : value.map((id) => knowledgePointLabel(String(id))).join("、"))
        : FALLBACK_GENERIC;
    case "mastery":
      return masteryLabel(typeof value === "number" ? value : null);
    case "status":
      return knowledgeStatusLabel(typeof value === "string" ? value : undefined);
    case "confidence":
      return typeof value === "number" ? value.toFixed(2) : FALLBACK_GENERIC;
    case "validEvidenceCount":
      return String(value);
    case "scaffold":
      return scaffoldLabel(typeof value === "string" ? value : undefined);
    case "reasonCodes":
      return reasonCodesText(Array.isArray(value) ? value.map(String) : undefined);
    default:
      return genericValueText(value);
  }
}

export function differencePairTitle(leftPersona: string, rightPersona: string): string {
  return `${leftPersona} 与 ${rightPersona}`;
}

export const DIFF_ARROW = " → ";