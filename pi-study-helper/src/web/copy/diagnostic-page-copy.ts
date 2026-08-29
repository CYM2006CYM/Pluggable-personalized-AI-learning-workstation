/*
 * DiagnosticPage 专属中文文案。
 *
 * 两条硬规则与共享语义层(copy/ui-copy.ts)一致:
 * 1. 兜底值必须是中文通称,任何情况下不得回落英文原值。
 * 2. 内部标识符(会话版本、草稿版本、题目 id、知识点 id 等)一律不上屏。
 *
 * 本文件只服务诊断页;全站共享文案归 copy/ui-copy.ts,页面不得自行复制。
 */
export const DIAGNOSTIC_PAGE_COPY = {
  /** PageFrame 眉题:按会话模式区分。 */
  eyebrowChapter: "背景问卷",
  eyebrowRecommended: "摸底问卷",
  title: "确认当前学习起点",
  summary: "可返回检查并修改答案；只有完成摸底后，最新草稿才会生成正式学习画像。",
  backLabel: "返回主菜单",

  /** 「摸底不是考试」定位提示区。这一页是摸底,不是考试——页面必须让用户先看见这句话。 */
  orientation: {
    title: "这是一次摸底，不是考试",
    body: "这一页不评分、不排名，回答没有对错之分。你的回答只用来确定学习起点；已经保存的答案，随时可以返回修改。",
  },

  /** 章节模式:只有背景问卷,不生成诊断证据。 */
  chapter: {
    sectionKicker: "背景问卷",
    title: "章节模式不生成诊断证据",
    lead: "按你的背景问卷直接生成学习路径，不再逐题摸底。",
    infoSummary: "查看我的背景问卷",
    infoIntro: "以下三项只用于选择讲解方式，不影响学习内容。",
    pythonLabel: "Python 经验",
    pandasLabel: "Pandas 经验",
    explanationLabel: "讲解偏好",
    secondary: "返回修改问卷",
    primary: "完成问卷并生成路径",
  },

  /** 客观诊断完成:确认跳过资格。跳过的语义是「已有基础并主动选择跳过」,不是「已掌握」。 */
  skip: {
    sectionKicker: "诊断完成 · 跳过资格确认",
    title: "选择要跳过的教学章节",
    lead: "已有基础、同时答对“概念理解”与“代码/应用辨析”的模块，可以选择主动跳过。默认继续学习；选择跳过只省略对应章节的教学与普通练习，最终综合实操仍然保留。",
    optionHint: "两类客观诊断证据均已通过，可根据已有基础主动选择跳过",
    noneHint: "本次没有模块同时通过两类客观诊断证据，系统将保留全部章节。",
    alreadyBuilt: "路径已经生成，可以返回路径页继续确认。",
    selectedCount: (count: number) => `已选择跳过 ${count} 个章节`,
    primary: "按选择生成学习路径",
    backToPath: "返回学习路径",
    legend: "可选择跳过的章节",
  },

  /** 全部题目已处理:生成学习画像前的最终确认。 */
  confirm: {
    sectionKicker: "诊断题已处理",
    title: "请确认答案后生成学习画像",
    lead: "你可以返回上一题检查或修改，系统只会采用每道题最后保存的答案。",
    secondary: "← 返回上一题",
    primary: "完成诊断并选择学习章节",
  },

  /** 逐题作答。进度形态保留:进度条 + 计数,不新增第二套进度可视化。 */
  answer: {
    progressAria: (answered: number, total: number) => `已保存诊断进度 ${answered}/${total}`,
    counter: (index: number, total: number) => `第 ${index} 题 / 共 ${total} 题`,
    conceptEvidence: "概念理解",
    codeEvidence: "代码/应用辨析",
    savedEditable: "已保存，可修改",
    notSaved: "尚未保存",
    judgmentTrue: "正确",
    judgmentFalse: "错误",
    legend: "请选择答案",
    prev: "← 上一题",
    next: "下一题 →",
    skip: "跳过本题",
    save: "保存并继续",
    saving: "保存中…",
    saveEdit: "保存修改并继续",
  },
} as const;