# 「教学手账本」材质与视觉升级实施计划

## 目标（已拍板）
C 折中牛皮纸底 + 噪点粗糙感 + 白色便签卡暖光影 + 灰蓝便签开口 + 极简手账密度（每卡至多 1 件手账元素）。subagent 实施，我做监工与集成验证；可并行部分并行。

## 设计规范（所有工作包共用，写入票据与 agent 指令）
- **底色 C**：`--paper` 从 #f7f4ee 调至牛皮纸中间调（候选 #ecdec3 一带，截图后微调）；`--card-soft`/`--rule` 同步调暖；`--text-soft` 压深保证背景上对比度 ≥4.5（正文）/≥3（辅助）。
- **暖棕阴影**：`--shadow-1..5` 换暖棕基色 rgba(101,78,48,…) 并略提强度，白便签在牛皮上有「放上去」的浮起感。
- **噪点**：SVG feTurbulence data-URI（`--noise` token，160px 平铺，烤入 ~5% 不透明度），body 背景一层铺满。零外部资源，离线可用。
- **格线（草稿纸）**：`--grid-line`(~rgba(150,120,70,0.10)) + 24px 间距 token，只铺两处：学习页简报带、诊断页「摸底不是考试」横幅。
- **新 token**：`--ref-blue` #5a7a8c + `--ref-blue-soft`（术语便签）、`--note-cream`（米黄导学便签）、`--note-orange-soft`（误区便签，暖色系）、`--highlighter`（荧光笔黄绿）、`--tape`（半透明暖白胶带）。
- **手账词汇→五态**：completed=印章（实心绿+内环）、current=荧光笔划线、locked=虚线（已有）、skipped=便签盖住（删除线+纸片底）、teaching-skipped=暖色角标（已有 flag，精修）。
- **hover 抬起**：卡片 translateY(-2px)+阴影升档，transition 只碰 transform/box-shadow，reduced-motion 降级（全工程目前无此效果，属新增）。
- **纪律**：每卡至多 1 件手账元素；不用手写字体（手绘感=微旋+SVG 线条）；页面 CSS 禁止新 hex（一律新 token）；每页手账元素总量 ≤5。

## 工作包与并行调度

### 第 0 轮（串行，先行落地）— WP1 材质底座
**拥有文件：`design/tokens.css` + `styles.css`（仅此二者）**
- tokens.css：新增上述 token + 调整 --paper/--card-soft/--rule/--text-soft/--shadow-*/--glass 值（文件头注释同步更新）。
- styles.css：:root/body 背景换 var(--paper)+噪点层；topbar 换暖白半透明；按探索清单把硬编码背景/边框/文字色批量映射到最近 token（agent-pipeline/summary-generation 灰绿系面→暖等价 token；深色代码区保留）；.button 家族、.header-badge/.status-tag、.state-panel 换 token。不做全量票 16 清理（删旧变量仍留给票 16）。
- 完成后我集中验证：build + 1280/390 截图 + 对比度抽查，token 值定稿后才放行第 1 轮。

### 第 1 轮（3 个 subagent 并行，文件互不相交）
- **WP2 学习页手账**：只动 `pages/LearnPage.css`。简报对页两枚胶带（spread-page::before）+ 简报带淡格线；导学卡→米黄便签；误区卡 .lesson-callout 暖橙便签（从零新建）；.learn-fact→灰蓝便签；本节位置圆点五态手账化；任务卡/对页/站点卡 hover 抬起。纯 CSS，不改 TSX。
- **WP3 五态词汇扩散**：只动 `components/StudyStepper.css` + `pages/PathPage.css` + `pages/ShowcasePage.css`。lesson-item 与 path-evidence-node 五态按词汇表改造，页面五态首次补状态 transition（transform/opacity、reduced-motion 降级）；路径节点卡 hover 抬起；Showcase 两态对齐。
- **WP4 其余页点缀**：只动 `pages/ActivityPage.css` + `pages/DiagnosticPage.css` + `pages/StartPage.css` + `pages/SummaryPage.css`。活动页 CSV 下载别回形针（scoped ::before+SVG data-URI，不碰 styles.css 的 .button.compact）；notice-line 便签条化；选项卡 hover；诊断横幅格线；开始页信息卡一枚胶带；总结页只继承材质不加戏。

### 第 2 轮（串行，收尾结构件）— WP5 侧栏索引页签
WP1-4 合入验证通过后实施：`components/StudyStepper.css`（此时已空闲）+ `styles.css` 侧栏块。竖排步骤条从「圆点+连线」改为手账索引页签（当前环节页签外凸+荧光笔），桌面轨道/横滚条/毛玻璃面板三种形态都要适配。

### 第 3 轮 — 我的集成验证（不并行）
typecheck + 全量 web 测试 + build；1280/768/390 三断点截图矩阵（shoot-with-action，CDP 端口独占故由我统一拍，agent 一律禁拍）；发现问题派修复或自行修；回写新票据 `.scratch/web-refactor/issues/18-材质与手账视觉.md`（记录决策/纪律/验收），不提交 git。

## 监工协议
- 每个 agent 指令含：设计规范、文件白名单（越界即打回）、硬约束（只增 token、transform/opacity 动效、reduced-motion、每卡 1 件、页面 CSS 零 hex）、自验步骤（build 过 + git diff 摘要回报）；禁止跑截图（9333 端口冲突）。
- 每轮合入我逐 diff 审查 + 中央构建 + 截图，不过关打回该包，不阻塞其他包。

## 风险与对策
- 次要文字在牛皮底上的对比度：WP1 用对比度抽查定稿 token 值，宁深勿浅。
- styles.css 硬编码换装的遗漏死角：探索清单已逐块列明，第 3 轮截图矩阵兜底。
- 类名跨文件同名（.task-*、.notice-line 等）：探索已标明，各包严守 scope 前缀。
- 回滚：纯 CSS/token 层改动，git 工作树未提交，随时可弃。