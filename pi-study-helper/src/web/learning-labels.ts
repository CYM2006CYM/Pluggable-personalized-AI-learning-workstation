const KNOWLEDGE_POINT_LABELS: Readonly<Record<string, string>> = {
  "basic-python": "Python基础准备",
  "pandas.clean.read-csv": "读取CSV数据",
  "pandas.clean.inspect-dataframe": "检查DataFrame结构",
  "pandas.clean.missing-values": "处理缺失值",
  "pandas.clean.duplicate-orders": "处理重复订单",
  "pandas.clean.type-format": "规范字段类型与格式",
  "pandas.clean.validate-result": "验证清洗结果",
};

const DIFFICULTY_LABELS: Readonly<Record<string, string>> = {
  "S-R": "基础回顾",
  "S-U": "基础理解",
  "M-U": "进阶理解",
  "M-A": "进阶应用",
  "C-A": "综合应用",
};

const KNOWLEDGE_STATUS_LABELS: Readonly<Record<string, string>> = {
  unverified: "尚未验证",
  ready: "已具备基础",
  mastered: "已掌握",
  support_needed: "需要帮助",
};

export function knowledgePointLabel(knowledgePointId: string): string {
  return KNOWLEDGE_POINT_LABELS[knowledgePointId] ?? knowledgePointId;
}

export function difficultyLabel(difficulty: string): string {
  return DIFFICULTY_LABELS[difficulty] ?? difficulty;
}

export function knowledgeStatusLabel(status: string): string {
  return KNOWLEDGE_STATUS_LABELS[status] ?? status;
}

export function contentReadinessLabel(readiness: string | undefined): string {
  if (readiness === "ready") return "内容已就绪";
  if (readiness === "fallback") return "使用安全基础内容";
  if (readiness === "preparing") return "内容准备中";
  return "内容状态待确认";
}

export function activityKindLabel(kind: string | undefined): string {
  if (kind === "mcq" || kind === "quiz") return "客观题组";
  if (kind === "code_completion" || kind === "code") return "代码补全题";
  if (kind === "practical_engineering") return "综合代码实操";
  return "正式学习活动";
}
