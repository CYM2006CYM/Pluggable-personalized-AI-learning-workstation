# W6 负责人 AI 个性化提醒真实性查验与最终阻塞分阶段修复计划

状态：执行中；阶段0与阶段1事实查验已完成，阶段2代码和离线门禁已完成，等待实时服务加载 2026-08-26 02:01 新构建后完成页面复验；未提交、未上传

适用范围：

- 真实查验学习页面是否能够生成、绑定并展示 AI 个性化提醒；
- 如果真实链路不能形成可见提醒，修正实现，但不得让它替换六节三版本静态正文；
- 收口截图所反映的最终交付阻塞；
- 为上下文压缩后的续作提供事实、阶段出口和证据位置。

本计划不授权 Git commit、push 或上传，不修改 revision 2、gold、hidden tests、Rubric、reference solution、正式判分合同或 API Key 配置。

## 一、先固定概念

### 1. 静态正式正文

六个 Pandas 核心章节的 `guided`、`concise`、`practice` 是权威教学内容。开始页讲解偏好选择其中一个版本，Session 绑定后，正文必须保持稳定。

Generator 不得改写、删减或替换以下内容：

- 学习目标；
- 六个教学模块；
- 正文中文讲解；
- 代码示例、反例和修正；
- 术语、规则和来源。

### 2. AI 个性化提醒

AI 个性化提醒是可选的短提示，来源是 Generator 的安全候选经过确定性校验后的投影。它只能作为静态正文旁边的辅助阅读信息，不参与：

- 路径章节、顺序、跳过和预计时长决定；
- 客观题或主观题判分；
- 正式答案生成；
- 最终掌握状态写入。

提醒可以显示在学习页的“学习目标”和“教学模块”之间。没有形成合格提醒时，正文仍必须完整显示，并明确显示“本次未生成，继续使用正式正文”，不能静默让负责人猜测。

### 3. 截图中的最终阻塞

截图对应的交付状态不能直接改成完成，当前需要保留并逐项复验：

1. 最终综合实操此前出现 `4/5`，仍需复现并处理未通过测试点；
2. 第二组完整案例尚未完成从诊断到总结的全链证据；
3. `W6-真实AI六节客观题本地运行记录.md` 仍为 `REOPENED / ANSWER_SEMANTIC_REVIEW_NOT_CLOSED`，第5节语义问题不能被旧版 `ai_live` 记录覆盖；
4. 问题清单与冲刺计划的 `ISSUE_3`、`ISSUE_21`、`LIVE_MODEL` 和阶段出口仍需同步；
5. 最终安全审计、部署复现、版本统一、案例材料和视频只能使用同一候选版本的真实证据。

最终状态在全部出口通过前保持：

```text
FINAL_CANDIDATE_STATUS=NOT_READY
```

## 二、执行总顺序

```text
阶段0 事实查验与证据冻结
  -> 阶段1 AI个性化提醒真实链路修正
  -> 阶段2 静态正文优先与路径确认解耦
  -> 阶段3 截图中的技术阻塞逐项收口
  -> 阶段4 第二案例、全链复验与材料状态同步
  -> 阶段5 最终安全、部署、版本和提交前审计
```

上一阶段没有形成出口证据时，不把下一阶段写成已完成。任何未执行项目登记 `NOT_RUN`，不得填写推测的 PASS 数字。

## 三、阶段0：事实查验与证据冻结

目标：先确认“提醒没有显示”到底是没有调用、调用失败、没有通过审核、没有绑定，还是页面没有渲染。

### 0.1 运行模式确认

分别记录：

- `npm run demo`：录制响应/本地保障模式，不得宣称真实实时模型；
- `npm run demo:live`：只有显式配置并成功读取模型配置时，才允许登记真实 API 请求；
- 当前 `LIVE_MODEL`、模型 ID、Prompt 版本和 Profile revision；
- 不读取、打印或写入 API Key。

### 0.2 端到端查验点

使用新的临时 Demo 数据目录，创建新 Session，选择一个有 RichLesson 的 Pandas 章节，记录：

1. 确认路径请求是否调用 `confirmPath`；
2. 服务端是否创建 Agent run 或命中已有缓存；
3. Generator 是否执行、返回什么安全状态；
4. Hunter、Defender、Judge 是否执行或明确跳过；
5. 最终 `learningCards[].card.personalizedTip` 是否存在；
6. 学习页 DOM 是否出现“个性化学习提示”；
7. 提示内容是否来自当前正文来源，是否没有答案、hidden tests、私有路径或系统提示词；
8. 动态失败时是否仍绑定并展示完整静态正文；
9. 刷新和从服务端恢复后，提醒状态是否保持一致。

### 0.3 阶段0证据

必须保存：

- 脱敏的请求/响应字段摘要；
- Agent run 公共安全投影或明确的缓存/回退原因；
- Session、Profile revision、正文版本和题组/卡片来源；
- 学习页截图或 DOM 断言；
- 提醒文本的来源 ID 和哈希；
- 未运行项的 `NOT_RUN` 记录。

阶段0出口：

```text
PERSONALIZED_TIP_FACT_STATUS=GENERATED_AND_VISIBLE
或
PERSONALIZED_TIP_FACT_STATUS=NOT_GENERATED_WITH_EXPLICIT_FALLBACK
或
PERSONALIZED_TIP_FACT_STATUS=BLOCKED_WITH_REPRODUCTION
```

没有阶段0事实，不得直接声称“AI 个性化提醒功能已经实现”或“只是页面漏显示”。

## 四、阶段1：AI 个性化提醒真实链路修正

进入条件：阶段0已经明确提醒在哪一层消失。

### 1.1 Generator 和审核合同

如果 Generator 没有形成候选：

- 检查它收到的 `teachingContent` 是否为当前选中的静态正文；
- 检查候选是否包含有效标题、目标、解释、示例、常见误区和来源 ID；
- 检查来源 ID 是否属于当前章节；
- 检查输出是否被安全合同或 Schema 拒绝；
- 检查录制响应是否与当前 Prompt、正文版本和 Profile revision 绑定。

如果候选形成但没有提醒：

- 检查 `projectPersonalizedTip` 是否从候选安全投影；
- 检查 Session 快照是否保存 `personalizedTip`；
- 检查 Web DTO 是否保留该白名单字段；
- 检查学习页是否只在字段存在时渲染。

### 1.2 可见状态合同

学习页必须明确显示以下三种之一：

```text
AI 个性化提醒 · 已生成
AI 个性化提醒 · 本次未生成，继续使用正式正文
AI 个性化提醒 · 正在生成
```

其中“未生成”不能阻塞正文学习；“已生成”必须带安全来源或 Agent run 绑定；“正在生成”不能用静态文字无限等待。

### 1.3 阶段1验收

至少完成三条案例：

1. 真实 API 成功：页面看到实际生成的中文提醒，来源和 Agent run 可复核；
2. Generator 或审核失败：页面明确显示未生成/回退，静态正文完整；
3. 刷新恢复：提醒文本和状态与服务端 Session 快照一致。

阶段1出口：

```text
PERSONALIZED_TIP_FEATURE=VERIFIED_LIVE_AND_VISIBLE
```

如果真实 API 不可用，必须登记：

```text
PERSONALIZED_TIP_FEATURE=BLOCKED_LIVE_API
```

同时仍需完成失败回退和明确页面状态，不得用录制响应冒充实时成功。

## 五、阶段2：静态正文优先与路径确认解耦

目标：确认路径不应因为可选提醒阻塞正式教材。

### 2.1 正确顺序

确认路径时优先完成：

```text
PathEngine 确定性计算
→ 绑定选定版本的静态 RichLesson
→ 页面允许进入第一节
```

动态提醒应当：

- 作为异步可选任务；或
- 在进入具体章节后准备；或
- 失败时立即显示明确回退，不延迟静态正文。

### 2.2 不变量

- PathEngine 仍是路径、顺序、跳过和时长唯一权威；
- 静态正文不依赖 Generator 成功；
- AI 提醒不能改变正文模块、题目合同或判分；
- 旧 Session 不被静默替换教材；
- 请求超时后页面不能显示空白教学内容；
- 运行中状态显示实际阶段和秒数，完成后显示服务端正式耗时。

### 2.3 阶段2验收

- 录制模式确认路径在合理时间内完成；
- 实时模式确认路径不会等待可选提醒到页面不可用；
- 提醒慢、失败和拒绝时仍能打开完整静态正文；
- 页面明确区分路径计算、静态正文绑定和 AI 提醒状态；
- 组件、API 和恢复测试通过。

## 六、阶段3：截图中的技术阻塞收口

### 3.1 最终综合实操测试点

1. 在匹配合同的 Node/Python/pandas 环境中复现 `4/5`；
2. 区分候选代码语法/运行错误、评测环境错误和测试点逻辑失败；
3. 只依据公开合同修复，不读取或泄漏 hidden test、gold、Rubric、reference solution；
4. 重新运行五个测试点，保存每点状态和环境哈希；
5. 测试适配器超时不能伪装成代码通过。

出口：

```text
FINAL_PRACTICAL_TEST_POINTS=PASS_WITH_REPRODUCIBLE_EVIDENCE
```

若未执行或环境阻塞，登记 `NOT_RUN` 或 `BLOCKED`。

### 3.2 六节真实 AI 客观题语义复核

1. 使用新建 Session 和当前 Prompt/正文版本重新运行六节；
2. 每节确认 `questionSource=ai_live`、题组哈希和 Agent run；
3. 低风险题也必须有 Hunter、Judge 记录，争议时才触发 Defender；
4. 重点复核第5节“非法金额文本”的语义，不得把 `abc12` 当成正文认可的数值；
5. 记录题干、选项、来源和审核结论，不记录正确答案、hidden tests 或私有答案；
6. API 失败时单独验证固定保障，不把 fallback 写成 AI 成功。

出口：

```text
W6_LIVE_QUIZ_SEMANTIC_REVIEW=VERIFIED
```

### 3.3 第二组完整案例

第二组必须完整跑完：

```text
输入画像
→ 诊断
→ 路径
→ 跳过选择（如满足条件）
→ 六节正文
→ 六组客观题
→ 六组代码活动
→ 最终综合实操
→ 学情画像总结
```

必须同时保存：输入、Evidence、路径版本、Agent 安全轨迹、题组来源、代码逐点结果、最终总结、恢复证据和哈希。

### 3.4 文档状态同步

完成实际复验后，统一以下文件中的状态：

- 问题清单；
- 最终冲刺计划；
- 真实 AI 六节题运行记录；
- 案例证据索引；
- README 和部署复现记录。

在证据完成前，保留 `OPEN`、`REOPENED`、`LIVE_MODEL=LIVE_NOT_RUN` 或 `NOT_READY`，不为了文档好看提前改成完成。

## 七、阶段4：案例、全链复验和最终材料

只有阶段1至阶段3出口通过后执行：

1. 至少两组完整案例使用同一 Profile revision、环境和源码候选；
2. 正常 AI 审核、争议处理、固定保障和刷新恢复各有证据；
3. 运行关键测试，未运行项目明确写 `NOT_RUN`；
4. 完成 DOM、网络、日志、bundle、导出 JSON 和压缩包安全扫描；
5. 完成部署复现、版本统一、案例截图、PPT、视频和提交材料；
6. 对提交目录执行文档链接检查、`git diff --check`、release 检查和最终哈希复算。

最终出口：

```text
PERSONALIZED_TIP_FEATURE=VERIFIED_LIVE_AND_VISIBLE
FINAL_PRACTICAL_TEST_POINTS=PASS_WITH_REPRODUCIBLE_EVIDENCE
W6_LIVE_QUIZ_SEMANTIC_REVIEW=VERIFIED
CASE_SHOWCASE_STATUS=PASS
DEPLOYMENT_REPRO_STATUS=PASS
FINAL_SECURITY_AUDIT=PASS
FINAL_CANDIDATE_STATUS=PASS
```

任何一项缺证据时，最终状态保持：

```text
FINAL_CANDIDATE_STATUS=NOT_READY
```

## 八、上下文压缩后的续作规则

继续本任务前必须先阅读本文件，并按以下顺序检查：

1. 当前阶段和阶段出口；
2. `PERSONALIZED_TIP_FACT_STATUS`；
3. `PERSONALIZED_TIP_FEATURE`；
4. `FINAL_PRACTICAL_TEST_POINTS`；
5. `W6_LIVE_QUIZ_SEMANTIC_REVIEW`；
6. 第二组案例和安全审计状态；
7. 现有问题清单与冲刺计划是否同步。

每完成一个阶段，在本文件末尾追加“实际执行记录”，包括日期、命令、输入、输出、证据路径、未运行项和下一阶段动作。不得删除历史记录，不得把录制、fixture 或预计结果改写成实时 PASS。

## 九、实际执行记录

### 阶段0

状态：`COMPLETED_FACT_CHECK / RECORDED_MODE_NO_TIP`

记录时间：2026-08-26。

实际查验：

1. 访问 `http://127.0.0.1:5173/`，页面标记为“本地演示模式 / 本地服务模式”，因此本次不是实时模型验收。
2. 使用已有 Session `session-1cc69e88073e32d430a036ad` 的服务端 Bootstrap 安全快照，确认 Profile revision 为 `3`、路径版本为 `3`、当前阶段为 `activity`。
3. 六个 Pandas 学习卡均存在 `selectedLesson`，说明静态正文已经绑定；六个卡片的 `personalizedTip` 均不存在。
4. 打开 `node-pandas.clean.inspect-dataframe` 学习页，DOM 存在“学习目标”和“共 6 个教学模块”，不存在“个性化学习提示”。
5. 本次只能确认“当前录制/本地运行没有形成可见提醒”，不能据此宣称实时 API 失败，也不能宣称实时提醒已通过。

阶段0事实状态：

```text
PERSONALIZED_TIP_FACT_STATUS=NOT_GENERATED_WITHOUT_VISIBLE_REASON
LIVE_MODEL=NOT_VERIFIED_IN_THIS_CHECK
STATIC_RICH_LESSON=VISIBLE_AND_BOUND
```

下一动作：检查录制响应/缓存是否存在合格的 card 候选及其绑定路径；随后在不读取或记录 API Key 的前提下，用显式实时模式查验真实 Generator 候选、审核状态、Session 快照和页面展示。

### 阶段1（第一轮：根因修正与离线门禁）

状态：`CODE_FIXED / LIVE_RESTART_REQUIRED`

记录时间：2026-08-26。

实际查验到的根因：

1. 当前运行数据中，六个 `guided` 卡片请求并非都没有调用模型：`pandas.clean.missing-values` 和 `pandas.clean.type-format` 已留下 `accepted` 的实时卡片缓存；其余请求出现 `invalid_schema_or_authority` 或 `discard_after_90s`。
2. Generator 的运行时系统提示只描述了 `artifactKind=quiz` 合同，但 `prepareCard` 实际要求 `artifactKind=card`。模型面对相互冲突的任务和 Schema，导致多数提醒卡在修复重试后仍被确定性合同拒绝。
3. `confirmPath` 同时并发准备多个章节，并只等待 15 秒；实时卡片审核通常超过该时间。Session 会先保存不带提醒的静态卡片，后台迟到缓存没有补写到已保存的 Session。
4. `prepareCard` 没有绑定公共 Agent run，异常又统一压缩成 `unavailable`。因此页面无法区分未调用、超时、合同拒绝、审核拒绝和迟到缓存。
5. 学习页只在 `personalizedTip` 存在时渲染，字段不存在时整块静默隐藏，造成负责人无法查验真实状态。

本轮已经完成的代码修正：

1. 实时 Prompt 版本由 `w4-d2-v10` 提升为 `w4-d2-v11`，避免旧审核缓存冒充新合同结果。
2. Generator 根据 `activity.kind` 使用互斥合同：`explain` 生成个性化 `card`，`mcq` 生成 4 至 6 道客观题。
3. 为 `card` 增加完整字段示例、当前知识点、预计时间、公开来源、静态正文不变量和越权边界要求。
4. Hunter 与 Judge 增加个性化提醒专用审核：核对 objective、explanation、example、commonMistake、知识点、时间和来源；阻止提醒替换正文或修改路径、画像和判分。
5. `LearningCardSafeView` 增加公开状态投影；有合格提醒时标记 `generated / agent_reviewed`，没有时标记 `unavailable / not_generated`。
6. 学习页始终显示“AI 个性化提醒”区域：成功时显示“已生成”，失败时显示“本次未生成，继续使用完整正式正文”。

本轮验证：

```text
NODE_VERSION=v22.23.1
TYPECHECK=PASS
TARGETED_TESTS=89_PASS / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
GIT_DIFF_CHECK=PASS
```

尚未完成的真实验收：

1. 当前 `127.0.0.1:4311` 实时 API 进程仍加载修改前的构建和 `w4-d2-v10`，不能用它验证 `v11`。
2. API Key 仅存在于负责人启动服务的 PowerShell 进程中；本轮没有读取、打印、复制或写入密钥。
3. 必须由负责人按原实时方式重启后，新建 Session，用 `w4-d2-v11` 完成至少一个全新 card 的 Generator → Hunter → Judge 链路，再检查服务端提醒投影和学习页 DOM。
4. 路径确认与可选提醒生成的解耦属于阶段2，本轮尚未提前改动。

当前状态：

```text
PERSONALIZED_TIP_FEATURE=CODE_FIXED_LIVE_NOT_YET_VERIFIED
PERSONALIZED_TIP_UI_FALLBACK=VERIFIED_BY_TEST
LIVE_MODEL=RESTART_REQUIRED_FOR_V11
FINAL_CANDIDATE_STATUS=NOT_READY
```

下一动作：负责人重启实时服务后立即执行阶段1真实 API 复验；通过后才进入阶段2解耦，失败则依据新 checkpoint 的明确 `reasonCode` 继续修正，不得用旧缓存或录制响应冒充通过。

### 阶段1（第二轮：真实 API 事实复验）

状态：`REAL_AI_CHAIN_VERIFIED / LATE_RESULT_NOT_SESSION_BOUND`

记录时间：2026-08-26。

实际事实：

1. 负责人以 `live_model` 和 `w4-d2-v11` 重启后，新建 Session `session-0503398280b47eccd15b7669` 进行复验。
2. 后台 checkpoint 证明真实模型已经执行，不能归类为录制响应：`basic-python`、`inspect-dataframe`、`missing-values`、`type-format`、`validate-result` 形成 `accepted`；`read-csv` 与 `duplicate-orders` 被 Hunter/Judge 拒绝。
3. 两个拒绝是审核链真实发现正文冲突：一处把“合格”误写为“合计”，一处对 O013 的错误归因与正文冲突。
4. 当时页面仍没有提醒，因为路径确认先保存了不带提醒的 Session，迟到的已审核缓存没有补写回该 Session。

事实状态：

```text
REAL_AI_CARD_GENERATION=VERIFIED
GENERATOR_HUNTER_JUDGE=VERIFIED
SESSION_BINDING_OF_LATE_RESULT=NOT_IMPLEMENTED_AT_THIS_POINT
PAGE_VISIBLE_LIVE_TIP=NOT_YET_VERIFIED
```

### 阶段2（代码实现与离线门禁）

状态：`CODE_AND_BUILD_PASS / LIVE_RESTART_REQUIRED`

记录时间：2026-08-26。

本阶段完成：

1. 路径确认只绑定六节静态 RichLesson，不再并发生成六节可选提醒；非 RichLesson 旧节点保留旧行为。
2. 新增按当前章节触发的 `PersonalizedTipService` 和 HTTP 接口：

```text
POST /api/sessions/:sessionId/learning-cards/:nodeId/personalized-tip
```

3. 学习页进入当前章节后自动生成当前一节提醒，显示“正在生成”，并以同一 requestId 展示 source、profile、Generator、安全检查、Hunter、Defender、Judge、publish 流水线。
4. 审核通过后使用 Session CAS 保存提醒；失败时保留完整静态正文并显示明确回退；刷新后以服务端 Session 快照为准。
5. 提醒生成输入现已包含当前章节的 `knowledgeStatus`、`mastery`、`confidence`、证据数量和讲解偏好。Prompt 要求提醒真正响应画像事实，但不得在提醒中直接展示画像数值或冒充新的诊断结论。
6. 个性化上下文哈希已纳入 checkpoint、cache、恢复匹配和 cache key，不同学情不能错误复用同一提醒。
7. 流水线文案已区分个性化提醒与题组，不再把提醒工位错误显示成“Generator生成题组”。

离线验证：

```text
NODE_VERSION=v22.23.1
TYPECHECK=PASS
TARGETED_TEST_FILES=5_PASS
TARGETED_TESTS=111_PASS / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
GIT_DIFF_CHECK=PASS_WITH_EXISTING_LINE_ENDING_WARNING
DEMO_BUILD_TIMESTAMP=2026-08-26T02:01_LOCAL
```

运行进程核对：

1. 当时监听端口为 API `4310`、Web `5173`，进程命令确实带 `--live`。
2. 但运行中的 Node 进程加载的是 01:36 的旧 `.demo-build`；该构建不存在 `personalized-tip-service.js` 和新 HTTP 路由。
3. 02:01 已重新生成运行包，并确认新构建包含 `PersonalizedTipService`、个性化上下文、HTTP 路由和新 Prompt。
4. 已运行进程不会自动热加载 `.demo-build`，因此必须再次停止旧进程并运行 `npm run demo:live`，才可执行最终页面验收。

当前状态：

```text
PERSONALIZED_TIP_FEATURE=CODE_COMPLETE_LIVE_PAGE_NOT_YET_VERIFIED
STATIC_LESSON_PATH_CONFIRM_DECOUPLING=VERIFIED_BY_TEST
LIVE_PROCESS=OLD_BUILD_RESTART_REQUIRED
FINAL_CANDIDATE_STATUS=NOT_READY
```

重启后的阶段2页面出口：

1. 新建 Session，确认路径不等待六节提醒；
2. 进入第一节后只启动当前一节提醒；
3. 页面实时显示 Agent 流水线；
4. 成功时 Session 和 DOM 同时出现 `personalizedTip` 与 `generated`；
5. 刷新后提醒仍存在；
6. 拒绝或超时时显示明确回退且正文完整。

### 阶段2（真实页面验收）

状态：`VERIFIED_LIVE_AND_VISIBLE`

记录时间：2026-08-26。

真实验收输入：

```text
MODE=live_model
PROMPT_VERSION=w4-d2-v11
API_PORT=4310
SESSION_ID=session-cc214e9bae68b0bb7d253406
LESSON_NODE=node-pandas.clean.read-csv
LESSON_VARIANT=guided
```

真实验收结果：

1. 新接口在重启后的进程中已存在；空探针从旧进程的 `404` 变为新进程的合同校验 `400`，证明新路由已加载。
2. 新建 Session 后完成 13 道全客观诊断、生成并确认路径。路径确认只绑定静态正文，不调用六节提醒；进入学习后六节 RichLesson 已可用。
3. 第一节 Pandas 正文页面先显示：

```text
AI 个性化提醒 · 正在生成
```

静态六模块正文同时完整可读，没有等待 AI 才展示正文。
4. 页面实时观察到 Agent run 逐步更新：source、profile、Generator、安全检查、Hunter、Defender 条件跳过、Judge、publish。运行中按钮和工作台持续显示状态与耗时。
5. 本轮不是录制或固定保障：运行终态为 `实时AI`，发布工位公开指标为 `提醒来源=ai_live`，总耗时约 `16.5秒`。
6. 本轮 Generator、Hunter、Judge 均实际执行；Hunter 没有发现争议，Defender 按条件明确未触发，Judge 接受后才发布。
7. 页面生成的中文提醒确实来自当前第一节正文，强调读取边界、结构检查以及“读取不等于清洗”，没有替换正文或修改路径和判分。
8. 服务端 Bootstrap 安全快照核对：

```text
SESSION_VERSION=7
PATH_VERSION=2
TIP_STATE=generated
TIP_REASON=agent_reviewed
TIP_SOURCE_COUNT=1
OTHER_LESSON_VARIANTS_IN_PUBLIC_CARD=0
```

9. 刷新页面后：提醒标题、已生成状态、提醒正文和六模块正式正文仍存在；没有再次显示“正在生成”，说明 Session 持久化和恢复有效。
10. 页面复验发现提醒流水线的通用组件仍把节点名称显示成“Generator生成题组/发布题组”。该问题不影响真实调用，但语义误导，已在本轮尾部按 `resourceKind=tip|quiz` 修正，并新增前端测试。

最终门禁：

```text
TYPECHECK=PASS
CORE_TARGETED_TESTS=111_PASS / 0_FAIL
UI_FOLLOWUP_TESTS=85_PASS / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
GIT_DIFF_CHECK=PASS_WITH_EXISTING_LINE_ENDING_WARNING
```

阶段2出口：

```text
PERSONALIZED_TIP_FACT_STATUS=GENERATED_AND_VISIBLE
PERSONALIZED_TIP_FEATURE=VERIFIED_LIVE_AND_VISIBLE
STATIC_LESSON_PATH_CONFIRM_DECOUPLING=VERIFIED
SESSION_REFRESH_RECOVERY=VERIFIED
PUBLIC_OTHER_VARIANTS_EXPOSURE=0
FINAL_CANDIDATE_STATUS=NOT_READY
```

说明：流水线“个性化提醒”专用名称的前端修正已完成构建，但当前 Vite preview 进程不会热加载新 `dist-web`。下一次正常重启后生效；已生成提醒和真实 AI 链路不受影响。

下一阶段：按计划进入阶段3，先处理最终综合实操测试点和六节真实 AI 客观题语义复核；在这些阻塞闭合前不得把最终候选写成 PASS。

### 阶段3（第一轮：六节题与最终综合实操）

状态：`FINAL_PRACTICAL_PASS / LIVE_QUIZ_5_OF_6 / V12_RESTART_REQUIRED`

记录时间：2026-08-26。

合同环境：

```text
NODE_VERSION=v22.23.1
PYTHON_VERSION=3.13.7
PANDAS_VERSION=3.0.5
ENVIRONMENT_HASH=sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76
SESSION_ID=session-cc214e9bae68b0bb7d253406
PROFILE_REVISION=3
```

公开评测与环境门禁：

1. 第一轮测试误命中 WindowsApps 的占位 Python，导致环境不匹配和 pandas 缺失；这不是业务测试失败。
2. 把合同 Python 和 Node 目录置于测试进程 Path 首位后，公开评测、环境兼容和五测试点装配测试全部通过。

```text
PUBLIC_EVALUATION_TARGETED=26_PASS / 0_FAIL
TYPECHECK=PASS
STAGE3_TARGETED_TEST_FILES=5_PASS / 0_FAIL
STAGE3_TARGETED_TESTS=70_PASS / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
```

六节首轮实时题结果：

| 章节 | Activity | 来源 | Agent run | 题组哈希 | 结论 |
|---|---|---|---|---|---|
| 读取 CSV | `act-read-csv` | `ai_live` | `agent-039de42385287d46503f5972a4c288f8` | `f1ddeaa3d38d2c8ded3e15c02703f36ea3b2cfed6e68609e4ea7afbdc0ecfc9a` | Generator、Hunter、Judge完成，Defender明确跳过 |
| 检查 DataFrame | `act-quiz-inspect-dataframe` | `ai_live` | `agent-c2a90b705550ea595dd5cf26643e85d3` | `a5c5c929e54dd0fc13993f1e7b197b5b32563dcba75e2a36ce498055fdac5cf8` | Generator、Hunter、Judge完成；Judge执行一次结构修复 |
| 处理缺失值 | `act-quiz-missing-values` | `ai_live` | `agent-6d7dae7321cc4b21a73bcda1a797f218` | `2b60594d75085c7e7ed56b9aa7d606821d5cb0e2e517660bcc8e7aae0bd11efc` | Generator、Hunter、Judge完成，Defender明确跳过 |
| 处理重复订单 | `act-quiz-duplicate-orders` | `profile_fixed` | `agent-d0411376f8d5001faf8bb92af89f647b` | `44297734196cba87cfbe998bd56154e7f0bfe9d59a765135f1bb35b3330fdbd6` | AI候选未发布；确定性安检连续发现跨题答案提示后正确固定保障 |
| 类型与格式 | `act-quiz-type-format` | `ai_live` | `agent-35182e2b219cc466522612e1bf674e53` | `7d2a8dee8bfad5f127c6a8e905e0cbdcb24b0d1765c85de0c09f2d567c4b087b` | `abc12`明确按正文规则转为缺失，旧语义错误未复现 |
| 验证结果 | `act-quiz-validate-result` | `ai_live` | `agent-239233be0fb431600bee59b2b8ca32ad` | `747eef129ff5edf6c98b60e61c0f9b0f63d32fcd0ed8e86d18ac5841603e4ae2` | Generator、Hunter、Judge完成，Defender明确跳过 |

第四节根因与修正：

1. 失败类别为 `candidate_question_cross_answer_hint_3`，模型确实返回候选，但候选未通过确定性安全合同，因此系统没有把失败候选展示给用户。
2. 原实现只允许一次候选定向修复；第二版仍有同类问题时立即固定保障。
3. 现已把确定性候选修复预算改为最多两次，并加强 Generator 基础提示和修复提示，要求逐题扫描 `prompt/options/explanation`，删除所有跨题答案或结论引用。
4. 新增“连续两次跨题泄露、第三次修复成功”测试；修复后相关定向测试 `44/44` 通过。
5. Prompt 合同已经变化，运行版本由 `w4-d2-v11` 提升为 `w4-d2-v12`，避免旧缓存冒充新合同结果。
6. 新 `.demo-build` 已生成，但当前负责人启动的 API 进程仍加载旧内存代码；必须用原实时 API Key 方式重启后，新建 Session 复验第四节，才能把六节写成全部实时通过。

代码活动与最终综合实操：

1. 六个代码活动均实际调用 Node/Python 权威评测，并按页面逐点显示结果。
2. 第一节错误使用 `keep_default_na=False` 时为 `0/5`；按公开测试合同改为 `pd.read_csv(..., dtype="string")` 后为 `5/5`。
3. 第四节第一次因完整程序缺少 `import pandas as pd` 为 `0/5`；补齐公开依赖后为 `5/5`。这证明此前 `0/5` 是候选程序运行错误，不是评测器没有执行。
4. 最终综合实操只依据公开题面和公开测试编写，不读取 hidden tests、gold、Rubric 或 reference solution；正式页面结果为五个测试点全部通过。
5. 最终实操通过后进入总结页，画像事务在数秒内把 Session 从 `v40` 完成为 `v41`；页面展示七个知识状态、28 条正式 Evidence、学习前后状态、仍需支持点、带缺口活动和返回主菜单入口。

```text
FINAL_PRACTICAL_TEST_POINTS=PASS_WITH_REPRODUCIBLE_EVIDENCE
FINAL_PRACTICAL_PUBLIC_POINT=PASS
FINAL_PRACTICAL_SEALED_POINTS=4_PASS
FIRST_FULL_CHAIN_SESSION=COMPLETED_V41
LEARNER_PROFILE_SUMMARY=VISIBLE_WITH_AGENT_FACTS
W6_LIVE_QUIZ_SEMANTIC_REVIEW=PARTIAL_5_OF_6
W6_LIVE_QUIZ_TYPE_FORMAT_ABC12=VERIFIED_AS_MISSING
PROMPT_VERSION_BUILT=w4-d2-v12
LIVE_PROCESS_VERSION=w4-d2-v11_RESTART_REQUIRED
FINAL_CANDIDATE_STATUS=NOT_READY
```

下一动作：负责人按现有真实模式重启 API/Web 后，新建 Session，用 `w4-d2-v12` 至少重跑第四节；若第四节得到 `ai_live` 且 Hunter/Judge 完成，则再用新 Session 完成六节统一版本复核，并同步六节运行记录。第二组完整案例和最终安全审计仍为 `NOT_RUN`。

### 阶段3（第二轮：v12 第四节真实回归复验）

状态：`V12_DUPLICATE_ORDERS_AI_LIVE_VERIFIED`

记录时间：2026-08-26。

重启与版本事实：

```text
API_PORT=4310
WEB_PORT=5173
API_MODE=--api --live
PROMPT_VERSION=w4-d2-v12
CANDIDATE_REPAIR_BUDGET=2
SESSION_ID=session-2aa76e45ff4473b7810fa4fb
PROFILE_REVISION=3
```

实际复验过程：

1. 重启后独立确认 API 进程带 `--api --live`，运行构建中的 Prompt 版本为 `w4-d2-v12`，候选定向修复条件为 `candidateRepairs < 2`。
2. 从首页新建独立 Session，完成 13 道全客观诊断；六个 Pandas 模块均取得“两类客观诊断证据通过”的可选跳过资格。
3. 只选择跳过前三节，保留第4节“处理重复订单”完整正文、个性化提醒、客观题和后续代码活动；没有伪造或直接改写 Session 状态。
4. 第4节个性化提醒先完成真实多 Agent 审核并发布，来源为 `ai_live`；Generator、安全检查、Hunter、Judge均完成，Defender因无争议明确未触发。
5. 点击“进入正式活动”后，第4节客观题重新执行完整流水线。页面终态显示“已发布 / 实时AI”，没有进入固定题保障。
6. 本轮发布6道审核通过的AI客观题；Generator、安全检查、Hunter和Judge全部完成，Defender因无争议明确未触发。
7. 页面只检查题干、选项、来源、题量和Agent状态；没有记录正确答案，也没有读取 hidden tests、gold、Rubric 或 reference solution。

安全运行证据：

```text
TIP_AGENT_RUN=agent-80222f6457da7ae792248406d1b5cf82
TIP_ORIGIN=ai_live
TIP_ARTIFACT_SHA256=63fc5761502cc58192e3ab921849977f2c4b28044b0a6572f553a2351c4ad95a
TIP_DURATION_MS=51698

QUIZ_ACTIVITY=act-quiz-duplicate-orders
QUIZ_AGENT_RUN=agent-97fbe3624bb0282d0b8cb1eea687556d
QUIZ_ORIGIN=ai_live
QUIZ_QUESTION_COUNT=6
QUIZ_ARTIFACT_SHA256=2da299c011ce9f9e8006d99b0640c530e484d94fbc83c044bc9afde48aa4e8ca
QUIZ_DURATION_MS=57149
```

阶段3出口：

```text
W6_LIVE_QUIZ_SEMANTIC_REVIEW=VERIFIED
W6_LIVE_QUIZ_DUPLICATE_ORDERS=VERIFIED_AI_LIVE
W6_LIVE_QUIZ_TYPE_FORMAT_ABC12=VERIFIED_AS_MISSING
PROMPT_VERSION=w4-d2-v12
FINAL_PRACTICAL_TEST_POINTS=PASS_WITH_REPRODUCIBLE_EVIDENCE
FINAL_CANDIDATE_STATUS=NOT_READY
```

说明：六节客观题语义复核由第一轮5节实时通过证据与本轮第4节 `v12` 定向真实回归共同闭合；本轮没有把旧固定题结果改写为实时成功。第二组完整案例、部署复现和最终安全审计仍未完成，因此最终候选继续保持 `NOT_READY`。

下一动作：继续阶段3.3“第二组完整案例”，随后进入阶段4的安全审计、部署复现、版本统一和最终材料。

### 阶段3（第三轮：第二组完整案例与画像语义阻塞）

状态：`CASE_FLOW_COMPLETED / PROFILE_V1_SEMANTIC_CONFLICT_FIXED_IN_V2 / LIVE_RESTART_REQUIRED`

记录时间：2026-08-26。

第二组案例输入与路径：

```text
SESSION_ID=session-2aa76e45ff4473b7810fa4fb
PROFILE_REVISION=3
LESSON_VARIANT=guided
DIAGNOSTIC=13/13_ANSWERED
DIAGNOSTIC_SKIP_ELIGIBLE=6
DIAGNOSTIC_SKIP_SELECTED=3
SKIPPED_LESSONS=read-csv,inspect-dataframe,missing-values
REMAINING_LESSONS=duplicate-orders,type-format,validate-result
```

完整页面流程结果：

1. 从首页新建独立Session，完成13道全客观诊断，系统给出六节可选跳过资格。
2. 用户路径选择只跳过前三节；Python基础节点完成固定客观题 `1/1`，随后进入第4至第6节。
3. 第4节“处理重复订单”：个性化提醒 `ai_live`；客观题 `ai_live`、`6/6`；代码活动真实执行五个测试点并得到 `5/5`。
4. 第5节“规范字段类型与格式”：个性化提醒 `ai_live`；客观题 `ai_live`、`6/6`；代码活动真实执行五个测试点并得到 `5/5`。题组继续把 `Infinity` 和非法金额转为缺失，没有恢复旧的错误语义。
5. 第6节“验证清洗结果”：个性化提醒 `ai_live`；客观题 `ai_live`、`6/6`；其后直接进入最终综合实操，没有多余的重复中间代码题。
6. 最终综合实操只依据公开七列合同编写通用清洗函数，没有读取hidden tests、gold、Rubric或reference solution；正式页面五个测试点全部通过，结果为 `5/5`。
7. 完成事务把Session推进到 `v22`，归档记录20条正式Evidence、13条活动记录、3个诊断主动跳过、0个未解决确定性结果。
8. 刷新总结页后仍恢复 `Session v22`、20条Evidence、3个主动跳过和返回主菜单入口，证明完成归档与刷新恢复有效。

本组实时Agent安全证据：

```text
TIP_DUPLICATE_RUN=agent-80222f6457da7ae792248406d1b5cf82
TIP_DUPLICATE_SHA256=63fc5761502cc58192e3ab921849977f2c4b28044b0a6572f553a2351c4ad95a
QUIZ_DUPLICATE_RUN=agent-97fbe3624bb0282d0b8cb1eea687556d
QUIZ_DUPLICATE_SHA256=2da299c011ce9f9e8006d99b0640c530e484d94fbc83c044bc9afde48aa4e8ca

TIP_TYPE_FORMAT_RUN=agent-365465a0ed7749cf2779f2575e8a0742
TIP_TYPE_FORMAT_SHA256=0c59d758014843c1b5bebbd5ef6503c75309abcca5411abb6f61bf13b675c48f
QUIZ_TYPE_FORMAT_RUN=agent-3fa2b014d2e04022b2aa0a47bcd4dc98
QUIZ_TYPE_FORMAT_SHA256=70f50f93c4d28adb5d52219184a724b44668eb31b20526d3045266dbcf5a0cdb

TIP_VALIDATE_RUN=agent-5d66e4dcdde1eb59f4900ae867387765
TIP_VALIDATE_SHA256=4f600804390775f80633d0ae05028b79b050e4f4ef4732139001b7d585b786bb
QUIZ_VALIDATE_RUN=agent-dbb2125c3732d9135dde72164934c4fc
QUIZ_VALIDATE_SHA256=d64a9124549066129f7ee3ea0a99b6a57c8a71e89417571392544bcb207fa3ab

COMPLETION_ARCHIVE_SHA256=13475e7c82cd1d266b776c3b028a11517d3c60cc14260c8a25eb3e727feb4938
COMPLETION_UNRESOLVED_FACTS=0
COMPLETION_AGENT_RUN_COUNT=6
```

总结页发现的新阻塞：

1. 确定性摘要和页面指标均显示“已有基础或掌握7个、仍需支持0个”。
2. 旧 `w6-profile-v1` 画像Agent却把 `basic-python=ready` 描述成“仍需支持的薄弱点”，与权威分类矛盾。
3. Agent还把用户依据双证据主动跳过的前三节描述成“尚未开始的活动”，混淆了“主动跳过”和“未覆盖”。
4. 根因是旧画像安全上下文没有直接提供 `strengths`、`supportNeeded` 和诊断主动跳过集合，服务端也没有语义冲突防线。

已完成的代码修正：

1. 画像Prompt升级为 `w6-profile-v2`，明确 `ready` 属于已有基础，不属于仍需支持。
2. 安全上下文新增确定性摘要、strengths、supportNeeded、带缺口活动和诊断主动跳过知识点集合。
3. 明确诊断主动跳过不得描述成尚未开始、未覆盖、薄弱或建议继续完成。
4. 新增确定性语义检查：Agent若仍与权威support、主动跳过或带缺口事实冲突，则以 `semantic_conflict` 拒绝解释，页面使用确定性画像，不允许错误文本进入Session归档。
5. 新字段保持向后兼容：旧画像历史可缺省，新生成画像始终提供该集合。

修正后门禁：

```text
TYPESCRIPT_TYPECHECK=PASS
PROFILE_TARGETED_TEST_FILES=5_PASS
PROFILE_TARGETED_TESTS=17_PASS / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
GIT_DIFF_CHECK=PASS
```

全量测试第一次运行没有绑定合同Python：

```text
FULL_TEST_FILES=112_PASS / 11_FAIL / 1_SKIP
FULL_TESTS=935_PASS / 37_FAIL / 3_SKIP
PRIMARY_FAILURE=environment_mismatch
OTHER_FAILURE_1=W6_STAGE4_GENERATED_ASSETS_STALE
OTHER_FAILURE_2=W4_FIXED_FALLBACK_INTEGRATION
FULL_SUITE_STATUS=NOT_PASS
```

说明：`environment_mismatch` 是当前Codex测试进程没有绑定负责人本机的合同Python，不代表刚才网页内由已配置实时服务执行的正式代码评测失败；但在使用合同环境重跑前，全量门禁必须保持 `NOT_PASS`。阶段4生成资产和固定卡片集成失败也必须后续分别核查，不能隐藏。

当前出口：

```text
SECOND_CASE_FLOW=COMPLETED
SECOND_CASE_LIVE_TIPS=3_OF_3_AI_LIVE
SECOND_CASE_LIVE_QUIZZES=3_OF_3_AI_LIVE
SECOND_CASE_CODE_POINTS=15_PASS / 15
SECOND_CASE_FINAL_PRACTICAL=5_PASS / 5
SECOND_CASE_REFRESH_RECOVERY=VERIFIED
SECOND_CASE_PROFILE_V1=SEMANTIC_CONFLICT_FOUND
SECOND_CASE_PROFILE_V2=CODE_FIXED_LIVE_NOT_YET_VERIFIED
FINAL_CANDIDATE_STATUS=NOT_READY
```

下一动作：使用合同Node/Python/pandas环境重跑全量测试；负责人以原API Key方式重启实时服务后，用新Session复验 `w6-profile-v2` 总结语义。两项通过后再把第二组案例状态提升为完整PASS，并进入阶段4安全审计与部署复现。

### 阶段3（第四轮：画像v2首次真实复验与确定性防线补强）

状态：`PROFILE_V2_LIVE_CONFLICT_REPRODUCED / DETERMINISTIC_GUARD_V2_CODE_FIXED / SECOND_RESTART_REQUIRED`

记录时间：2026-08-26。

合同环境全量门禁复跑：

```text
NODE_VERSION=v22.23.1
PYTHON_VERSION=3.13.7
PANDAS_VERSION=3.0.5
ENVIRONMENT_HASH=sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76
FIRST_FULL_TEST_FILES=122_PASS / 1_FAIL / 1_SKIP
FIRST_FULL_TESTS=971_PASS / 1_FAIL / 3_SKIP
```

第一轮全量测试结论：

1. 原有 `environment_mismatch` 全部消失，证明测试进程已正确绑定合同Python。
2. `W6_STAGE4_GENERATED_ASSETS_STALE` 不再出现。
3. 唯一失败为 `W4_FIXED_FALLBACK_INTEGRATION`：RichLesson投影新增公开字段 `personalizedTipStatus` 后，固定卡片白名单未同步，导致合法固定卡片被误判为 `unavailable`。
4. 已仅把该类型化公开字段加入卡片白名单，没有放宽知识点、时长、来源或正文安全校验；定向回归 `5/5` 通过。

首次 `w6-profile-v2` 真实案例：

```text
SESSION_ID=session-8230966250d0b06babece6d4
DIAGNOSTIC=13/13_ANSWERED
DIAGNOSTIC_SKIP_ELIGIBLE=6
DIAGNOSTIC_SKIP_SELECTED=6
BASIC_PYTHON=1_PASS / 1
FINAL_PRACTICAL=5_PASS / 5
FINAL_PRACTICAL_PUBLIC_POINT=1_PASS
FINAL_PRACTICAL_SEALED_POINTS=4_PASS
SESSION_VERSION_AFTER_COMPLETION=9
PROFILE_AGENT_RUN=w6-profile-80792c0a6b5bd1e5bf564095
PROFILE_PROMPT_VERSION=w6-profile-v2
```

本轮只依据页面公开题面、公开七列合同和公开输入输出样例完成综合实操，没有读取hidden tests、gold、Rubric或reference solution。评测器公开返回五个测试点全部通过。

首次真实复验发现 `w6-profile-v2` 仍不能批准：

1. 确定性事实为 `strengths=7`、`supportNeeded=0`，但模型仍输出“仍需支持点：basic-python”，把 `ready` 误写成需要继续强化。
2. 路径安全快照明确保留六个 `diagnostic_skip_selected` 原因码，但画像输入得到的主动跳过集合为0。
3. 模型因此把主动跳过活动描述成 `pending`、尚未执行、无证据支撑和后续继续推进。
4. 根因一：主动跳过提取同时要求节点终态必须为 `skipped`；节点投影与完成事务中的状态变化使该条件不可靠，尤其同一节点仍含不可跳过最终实操时更明显。
5. 根因二：旧语义检查只覆盖“属于仍需支持的薄弱点”等少量句式，没有覆盖真实模型使用的“仍需支持点：...”以及“待处理、尚未执行、后续继续推进”等表达。

第二轮代码修正：

1. 新增统一函数 `diagnosticSkippedKnowledgePointIdsFromPath`，只依据不可伪造的 `diagnostic_skip_selected` 原因码提取主动跳过事实，不再依赖节点终态。
2. Session完成、Bootstrap恢复、画像历史和补救题上下文四个入口统一使用该函数，消除重复筛选逻辑。
3. 当 `supportNeeded=0` 时，非空“仍需支持点/薄弱点”段落一律按 `semantic_conflict` 拒绝。
4. 存在诊断主动跳过时，把活动写成待处理、pending、尚未执行、无证据支撑或后续继续推进，一律按 `semantic_conflict` 拒绝。
5. “仍需支持点：无”“带缺口活动：无”和正确描述主动跳过的中文总结继续允许通过。
6. 新增本次真实模型原话级负例、合法总结正例，以及“节点已完成但仍保留主动跳过原因码”的回归测试。

第二轮门禁：

```text
PROFILE_TARGETED_TEST_FILES=6_PASS
PROFILE_TARGETED_TESTS=31_PASS / 0_FAIL
TYPESCRIPT_TYPECHECK=PASS
FINAL_FULL_TEST_FILES=123_PASS / 1_SKIP / 0_FAIL
FINAL_FULL_TESTS=975_PASS / 3_SKIP / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
GIT_DIFF_CHECK=PASS
```

当前出口：

```text
CONTRACT_ENVIRONMENT=VERIFIED
W4_FIXED_FALLBACK_INTEGRATION=FIXED_AND_VERIFIED
W6_STAGE4_GENERATED_ASSETS=VERIFIED_CURRENT
PROFILE_V2_FIRST_LIVE_RUN=SEMANTIC_CONFLICT_REPRODUCED
PROFILE_V2_DETERMINISTIC_GUARD=CODE_COMPLETE_FULL_SUITE_PASS
PROFILE_V2_SECOND_LIVE_RUN=RESTART_REQUIRED
SECOND_CASE_PROFILE_V2=NOT_YET_VERIFIED
FINAL_CANDIDATE_STATUS=NOT_READY
```

下一动作：负责人使用原API Key方式再次重启API/Web，使进程加载本轮新 `.demo-build`；随后必须新建Session复验。若模型说对，应展示Agent总结且主动跳过集合非空；若模型仍说错，应显示确定性总结、`agentStatus=deterministic_fallback`，不得把矛盾文本写入完成归档。完成该复验后才能把第二组案例提升为PASS并进入阶段4。

### 阶段3（第五轮：画像v2第二次真实复验通过）

状态：`SECOND_CASE_PROFILE_V2=VERIFIED / SECOND_CASE_STATUS=PASS`

记录时间：2026-08-26。

重启事实：

```text
API_STARTED_AT=2026-08-26T09:55:10+08:00
WEB_STARTED_AT=2026-08-26T09:55:12+08:00
API_MODE=.demo-build/demo/launcher.js --api --live
PROFILE_REVISION=3
PROFILE_PROMPT_VERSION=w6-profile-v2
```

第二次独立真实案例：

```text
SESSION_ID=session-1c59ed45e5938dc6510968b3
DIAGNOSTIC=13/13_ANSWERED
DIAGNOSTIC_SKIP_ELIGIBLE=6
DIAGNOSTIC_SKIP_SELECTED=6
PATH_DIAGNOSTIC_SKIP_REASON_COUNT=6
BASIC_PYTHON=1_PASS / 1
FINAL_PRACTICAL=5_PASS / 5
FINAL_PRACTICAL_ENVIRONMENT_HASH=sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76
SESSION_VERSION=9
EVIDENCE_COUNT=15
PROFILE_AGENT_RUN=w6-profile-863d0693067968a5051478cc
COMPLETION_ARCHIVE_SHA256=8588fd9bc5ee2a7d07b8576849a4baf250e1c837ed40347b78c05efcc803bc34
```

真实画像结果：

1. 完成事务正确返回 `strengths=7`、`supportNeeded=0`、`diagnosticSkippedKnowledgePointIds=6`。
2. 六个主动跳过知识点均来自路径中的 `diagnostic_skip_selected` 原因码；其中最终校验节点完成不可跳过的综合实操后，主动跳过事实仍未丢失。
3. 本轮模型正确把 `basic-python=ready` 描述成已有基础，没有写入仍需支持。
4. 本轮模型明确写出“暂无仍需支持点”“6个诊断性章节在客观诊断证据通过后被主动跳过，属于已覆盖章节”。
5. 完成归档画像状态为 `agent_complete`，Agent文本引用正式Evidence且与确定性事实一致，因此无需触发语义回退。
6. 刷新总结页后仍显示 Session v9、7个已有基础或掌握、0个仍需支持、15条正式Evidence、6个主动跳过和“Agent已引用事实”。
7. 页面逐节列出六个主动跳过章节；第六节明确区分“章节教学已跳过、最终综合实操仍保留”。
8. 页面控制台错误数量为0，返回主菜单和开始新会话入口均存在。

恢复边界说明：

1. 不可变 `completedSummary.learningProfile` 为本次完成时冻结的 `agent_complete` 结果，页面总结以该归档为权威事实。
2. Bootstrap同时维护异步“最新画像历史”；该异步调用若模型不可用或触发语义防线，可独立显示 `deterministic_fallback`，但不得覆盖或改写已经冻结的正确完成归档。
3. 本轮刷新页面实际展示仍与完成归档一致，没有把后续非确定性调用结果冒充或覆盖正式总结。

阶段3最终出口：

```text
PERSONALIZED_TIP_FEATURE=VERIFIED_LIVE_AND_VISIBLE
W6_LIVE_QUIZZES=VERIFIED_AI_LIVE
FINAL_PRACTICAL_TEST_POINTS=VERIFIED_5_OF_5
SECOND_FULL_CASE=PASS
SECOND_CASE_PROFILE_V2=VERIFIED
DIAGNOSTIC_SKIP_FACT_RECOVERY=VERIFIED_6_OF_6
PROFILE_SEMANTIC_CONFLICT_GUARD=VERIFIED
REFRESH_RECOVERY=VERIFIED
BROWSER_CONSOLE_ERRORS=0
STAGE3_STATUS=PASS
FINAL_CANDIDATE_STATUS=NOT_READY_STAGE4_REQUIRED
```

下一动作：进入阶段4，执行最终安全审计、部署复现、版本信息统一和最终材料一致性检查。在阶段4完成前，不把整个项目写成最终候选PASS。

### 阶段4（第一轮：发布边界与安全审计）

状态：`PACKAGE_LEAK_FIXED / FULL_VERIFY_PASS / DEPENDENCY_AUDIT_BLOCKED`

记录时间：2026-08-26。

本轮重启确认：

```text
API_PROCESS=.demo-build/demo/launcher.js --api --live
API_STARTED_AT=2026-08-26T09:55:10+08:00
WEB_PROCESS=vite preview --host 127.0.0.1 --port 5173 --strictPort
WEB_STARTED_AT=2026-08-26T09:55:12+08:00
NODE_VERSION=v22.23.1
API_BOOTSTRAP=HTTP_200
WEB_HOME=HTTP_200
```

阶段4首轮实际发现：

1. `check:docs`、`smoke:extension`、`check:release`和`check:history`通过。
2. 修复前 `npm pack --dry-run` 共330项，错误夹带答案、hidden tests、Rubric、reference solution、私有样例和Web缓存；这是真实高风险阻塞，不能批准原包。
3. npm发布白名单已收紧为 `src`、公开 `demo-review` Profile、LICENSE和README；新增Web缓存排除与release白名单防线。
4. 修复后dry-run包为138项，私有类别命中为0，revision 2和revision 3正式评测Profile均未进入npm包。
5. 当前5173和4310旧进程没有安全响应头；已为Vite preview、开发服务、API JSON和SSE加入CSP或基础安全头。
6. 新Web构建在独立5174端口真实返回CSP、`nosniff`、`DENY`、`no-referrer`和权限策略；20项安全头定向测试通过。
7. 当前4310仍是修复前进程，API新安全头需下次正常重启后运行态复核；本轮未擅自读取或迁移API Key。
8. bundle、Bootstrap、本地会话目录、活动页DOM、总结页DOM和两份真实Agent导出未发现API Key或密封评测资产。
9. 浏览器总结页恢复了7个已有基础或掌握、0个仍需支持、15条Evidence、6个诊断主动跳过和Agent事实总结；活动页和总结页控制台错误/警告均为0。
10. `npm audit`仍失败：生产依赖5高危、2中危；全量依赖7高危、3中危。依赖升级需要负责人明确确认，当前保持真实阻塞。

本轮合同环境完整门禁：

```text
TEST_FILES=123_PASS / 1_SKIP / 0_FAIL
TESTS=975_PASS / 3_SKIP / 0_FAIL
TYPECHECK=PASS
CHECK_DOCS=PASS_137_MARKDOWN
SMOKE_EXTENSION=PASS
CHECK_RELEASE=PASS_744_TRACKED_FILES
PACK_DRY_RUN=PASS_138_ENTRIES_0_FORBIDDEN
AUDIT_PROD=FAIL_5_HIGH_2_MODERATE
AUDIT_ALL=FAIL_7_HIGH_3_MODERATE
```

材料和版本盘点：

1. package版本为`0.1.0`，Profile revision为3，合同环境为Node `v22.23.1`、Python `3.13.7`、pandas `3.0.5`，提示词为`w4-d2-v12`和`w6-profile-v2`。
2. Profile元数据仍为`0.3.0-draft / draft`；最终材料目录5份文件仍存在待填字段。
3. 当前工作树未冻结为最终提交，PPT和视频也未绑定同一提交号，因此不能提前填写最终版本或宣称材料一致性通过。

详细安全报告：`W6-负责人阶段4最终安全审计报告.md`。

当前出口：

```text
PACKAGE_PRIVATE_ASSET_LEAK=FIXED_AND_VERIFIED
WEB_SECURITY_HEADERS=VERIFIED_ON_NEW_BUILD
API_SECURITY_HEADERS=CODE_AND_TEST_PASS_RUNTIME_RESTART_REQUIRED
BUNDLE_AND_PUBLIC_RESPONSE_LEAK_SCAN=PASS
DEPENDENCY_SECURITY_AUDIT=BLOCKED
DEPLOYMENT_REPRO_STATUS=NOT_RUN_AFTER_FINAL_DEPENDENCY_SET
FINAL_SECURITY_AUDIT=IN_PROGRESS
FINAL_CANDIDATE_STATUS=NOT_READY
```

下一动作：负责人确认依赖安全升级后，使用兼容性受控的同主版本补丁更新依赖并重跑 `verify`、`audit:prod`、`audit:all`和dry-run包审计；随后在新的临时目录完成部署复现。不得使用 `npm audit fix --force`。

## 十一、AI客观题答案位置均衡补充记录（2026-08-26）

状态：`CURRENT_CODE=w4-d2-v16 / ANSWER_BALANCE_AUTOMATED_PASS / LIVE_RETEST_PENDING`

现场发现实时AI客观题的正确答案集中在A。根因不只在模型随机性：Generator原完整示例也是全A，且旧合同没有要求Hunter和Judge检查答案位置分布。

已完成：

1. Generator示例改为A/B/C/D分布，并增加题组内答案位置均衡约束。
2. Hunter和Judge增加分布复核要求，高风险题的Defender流程保持不变。
3. 服务端增加确定性选项重排，且重排发生在审核、缓存、哈希和判分绑定前，确保页面选项、正确答案和服务端判分使用同一个最终题组事实。
4. 定向测试、三套类型检查、Demo构建和Web构建通过；合同环境失败集复跑后，合并覆盖为123个测试文件通过、1个条件跳过，999项测试通过、3项条件跳过、0项代码失败。

仍需负责人重启当前实时服务并新建Session，确认启动标志为`promptVersion=w4-d2-v16`后完成一次浏览器真实生成复验。在该证据完成前，不登记`LIVE_MODEL_PASS`，也不把旧版本缓存题组当作v16结果。

### 阶段4（第二轮：依赖安全升级）

状态：`DEPENDENCY_SECURITY_AUDIT=PASS / FULL_VERIFY=PASS / DEPLOYMENT_REPRO_PENDING`

记录时间：2026-08-26。

负责人明确确认依赖升级后完成以下受控变更：

1. React Router从`6.30.1`升级到`7.18.2`，清除6.x修复线仍残留的开放重定向与SSR反序列化中危公告；项目只使用基础路由API，三套TypeScript检查和Web路由回归均通过。
2. Vite从`7.1.7`升级到同主版本`7.3.6`，清除Windows路径绕过、优化依赖map路径遍历和开发服务WebSocket任意文件读取公告。
3. 使用npm `overrides`把`brace-expansion`、`nanoid`、`postcss`、`protobufjs`和`undici`固定到安全补丁版本；没有使用`npm audit fix --force`，没有跨0.x版本升级`pi-coding-agent`主体。
4. 首次真实代码链定向测试因测试进程未设置`PI_PYTHON_EXECUTABLE`得到`environment_mismatch`；注入既有合同Python后同一测试通过。该环境配置失败未被改写成代码回归。
5. npm包dry-run仍为138项；粗关键词唯一命中为公开源码`src/infrastructure/activity-rubric.ts`文件名，实际fixture仍只有公开`demo-review`，私有评测Profile、hidden tests、参考答案和gold均未进入包。

升级后的合同环境门禁：

```text
NODE=v22.23.1
PYTHON=3.13.7
PANDAS=3.0.5
REACT_ROUTER_DOM=7.18.2
VITE=7.3.6
TYPECHECK=PASS
TEST_FILES=123_PASS / 1_SKIP / 0_FAIL
TESTS=975_PASS / 3_SKIP / 0_FAIL
BUILD_DEMO=PASS
BUILD_WEB=PASS
CHECK_DOCS=PASS_137_MARKDOWN
SMOKE_EXTENSION=PASS
CHECK_RELEASE=PASS_744_TRACKED_FILES
PACK_DRY_RUN=PASS_138_ENTRIES_PRIVATE_PROFILE_0
AUDIT_PROD=PASS_0_VULNERABILITIES
AUDIT_ALL=PASS_0_VULNERABILITIES
DEPENDENCY_SECURITY_AUDIT=PASS
FINAL_CANDIDATE_STATUS=NOT_READY_DEPLOYMENT_AND_MATERIALS_PENDING
```

下一动作：使用新构建重启API并复核4310安全响应头；随后在新的临时目录按README完成部署复现。最终提交压缩包、PPT、视频、截图和提交文档尚未冻结到同一提交号，因此整个最终候选仍不能登记为PASS。

#### 阶段4第二轮重启后运行态复验

负责人完成重启后实际确认：

```text
API_PROCESS=.demo-build/demo/launcher.js --api --live
API_STARTED_AT=2026-08-26T13:49:41+08:00
WEB_PROCESS=vite preview --host 127.0.0.1 --port 5173 --strictPort
WEB_STARTED_AT=2026-08-26T13:49:44+08:00
API_BOOTSTRAP=HTTP_200
WEB_HOME=HTTP_200
API_CSP=PASS_DEFAULT_NONE_FRAME_ANCESTORS_NONE
WEB_CSP=PASS_NO_UNSAFE_INLINE_NO_UNSAFE_EVAL
NOSNIFF=PASS_API_AND_WEB
CLICKJACKING_PROTECTION=PASS_API_AND_WEB
REFERRER_POLICY=PASS_API_AND_WEB
PERMISSIONS_POLICY=PASS_API_AND_WEB
SESSION_REFRESH_RECOVERY=PASS
VISIBLE_QUIZ_SOURCE=AI_LIVE
BROWSER_CONSOLE_ERRORS_OR_WARNINGS=0
API_SECURITY_HEADERS=VERIFIED_RUNTIME
```

浏览器刷新后仍恢复到原Session客观题活动页，显示审核通过的`ai_live`题组、完整多Agent工位、第1/5题和0题已作答；没有出现空白页、CSP拦截或会话丢失。依赖升级和响应头阻塞均已关闭，下一步只进入最终依赖集合的全新目录部署复现与材料收尾。
