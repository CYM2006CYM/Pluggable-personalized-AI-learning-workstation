/*
 * StartPage(学习入口页)的全部面向用户文案。
 *
 * 与 ui-copy.ts 相同的两条硬规则:
 * 1. 兜底值必须是中文通称,任何情况下不得回落英文原值。
 * 2. 内部标识符(sessionId / nodeId / activityId / pathVersion /
 *    sessionVersion / profileRevision / reasonCodes 等)一律不向用户展示。
 *
 * 问卷四档与会话阶段的中文映射不在此重复,直接复用语义层 ui-copy.ts 的
 * experienceLabel / stageLabel。
 */

/** 资料包支持的学习方式。schema 只允许这四个值(见 contracts/domain.ts 的 ProfileModality),未知值兜底中文通称。 */
const MODALITY_LABELS: Readonly<Record<string, string>> = {
  reading: "阅读理解",
  quiz: "客观练习",
  code: "代码实践",
  practice: "综合实操",
};

/** 未知学习方式的中文通称,不回落到英文原值。 */
const FALLBACK_LABEL = "暂未标注";

/** 学习方式的中文名。 */
export function modalityLabel(modality: string): string {
  return MODALITY_LABELS[modality] ?? FALLBACK_LABEL;
}

/** 讲解偏好。value 是内部枚举,展示文案全部中文。 */
export const EXPLANATION_PREFERENCES = [
  { value: "step_by_step", label: "逐步讲解" },
  { value: "concise", label: "重点速览" },
  { value: "example_first", label: "案例优先" },
] as const;

/** 学习入口两种模式的中文名。 */
const MODE_LABELS: Readonly<Record<string, string>> = {
  recommended: "系统推荐",
  chapter: "按章节学习",
};

/** 学习入口的中文名。未知模式兜底「系统推荐」。 */
export function entryModeLabel(mode: string | undefined): string {
  return (mode === undefined ? undefined : MODE_LABELS[mode]) ?? "系统推荐";
}

/**
 * 页面级文案。
 *
 * 分区分工(扉页视觉升级后):
 * - 扉页主标题:三段拼接,荧光笔只圈住 titlePhrase,tsx 不作字面拼接。
 * - 三问三卡(会话设置):「你想学什么 / 从哪里开始 / 你的底子怎样」三张索引卡,
 *   承载全部表单控件与「开始学习」主按钮。
 * - 信息卡(当前教材):默认折叠,只在需要确认材料信息时展开。
 * - 书签夹页:有可恢复会话时以织带书签呈现,复用 resume* 文案。
 */
export const START_PAGE_COPY = {
  /** PageFrame 眉标与标题。 */
  eyebrow: "学习入口",
  title: "开始一次新的学习会话",
  summary: "选好资料包与入口,再回答三个问卷问题,就能开始。所有正式进度由本地服务保存,随时可以接着学。",

  /** 扉页主标题三段:荧光笔圈住 titlePhrase,tsx 不拼字。 */
  titleLead: "开始一次",
  titlePhrase: "新的学习",
  titleTail: "会话",

  /** 扉页三问的卡标题。 */
  question1Title: "你想学什么",
  question2Title: "从哪里开始",
  question3Title: "你的底子怎样",

  /** 书签夹页(可恢复会话):小字「上次读到」+ 衬线资料包名。 */
  bookmarkKicker: "上次读到",

  /** 任务卡(会话设置)。 */
  taskKicker: "现在要做什么",
  taskTitle: "会话设置",
  taskLede: "选好资料包、入口与目标,回答三个问卷问题,然后开始。",

  /** 信息卡(当前教材)。 */
  materialTitle: "当前教材",
  materialCapabilityLabel: "支持的学习方式",
  materialGoalLabel: "当前学习目标",
  materialModeLabel: "学习入口",

  /** 表单控件。aria 与可见标签一致,读屏与自动化都用它。 */
  formPackageLabel: "学习资料包",
  formModeLabel: "学习入口",
  formModeRecommended: "系统推荐",
  formModeChapter: "按章节学习",
  formGoalLabel: "学习目标",
  formChapterLabel: "起始章节",
  formPythonLabel: "Python经验",
  formPandasLabel: "Pandas经验",
  formPreferenceLabel: "讲解偏好",

  /** 时长提示。 */
  timeNoteTitle: "时长由系统估算",
  timeNoteBody: "完成摸底后,系统会按你的目标与章节给出预计用时,不需要手动填写。",

  /** 页脚与主操作。 */
  taskFooterNote: "新的学习会从摸底问卷开始。",
  ctaStart: "开始学习",
  ctaBusy: "正在创建",

  /** 可恢复会话(最多展示 2 条)。 */
  resumeTitle: "接着上次的学习",
  resumeLede: "上次的会话还保留着,选一条继续。",
  resumeCta: "继续学习",

  /** 兜底中文通称。 */
  fallbackLabel: FALLBACK_LABEL,

  /** 拼贴信纸(可恢复会话信息卡):阶段前缀,与 stageLabel 拼接成「进行到:学习中」。 */
  letterStagePrefix: "进行到",
} as const;