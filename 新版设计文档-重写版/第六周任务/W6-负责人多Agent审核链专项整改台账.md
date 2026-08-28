# W6 负责人多Agent审核链专项整改台账

> 创建时间：2026-08-28  
> 设计基准：`最终提交材料制作/09-多Agent审计链路逻辑与可视化说明.md`  
> 作用：记录本轮多Agent链路的待修问题、实施顺序、当前状态和验证证据。发生上下文压缩或任务恢复时，必须先完整阅读本文，再继续修改。  
> 边界：不修改教学正文、活动题面、固定题、代码任务、Gold、Rubric、hidden tests、reference solution、路径规则或正式判分。

## 1. 状态说明

| 状态 | 含义 |
|---|---|
| `TODO` | 尚未开始 |
| `IN_PROGRESS` | 正在修改，尚未完成验证 |
| `CODE_DONE` | 代码已修改，定向测试尚未全部通过 |
| `VERIFIED` | 代码、定向测试和文档已完成 |
| `BLOCKED` | 存在明确外部阻塞，已记录原因 |

## 2. 冻结后的目标链路

```text
正文 + 安全学情上下文
→ Generator生成候选
→ Safety确定性检查
→ Hunter逐项找错并提交正文证据
→ 仅当Hunter存在severity=high问题时触发Defender
→ Defender仅处理high问题，依据正文逐项rebutted或conceded
→ Judge综合正文、候选、Safety、Hunter和必要的Defender辩护独立裁决
   ├─ accepted：Hunter指控不成立或问题已闭合，发布
   ├─ revise：Judge确认问题真实且可修复，返回Generator完整重生成并完整重审
   └─ rejected：安全/权威问题不可修复，或返修预算耗尽，固定保障
```

冻结原则：

1. Hunter和Defender只提交审查意见，不拥有发布、返修或拒绝权。
2. Defender带有辩护立场，但必须服从正文事实；Hunter有理时必须承认。
3. Judge可以维持或推翻Hunter、Defender的判断，也可以报告Hunter遗漏的问题。
4. 只有Judge确认成立的问题才能进入Generator返修指令。
5. 程序只校验结构、引用、权限、预算和状态机闭合，不能冒充Judge作语义裁决。
6. 只有带有可验证Judge接受证明的候选才能进入缓存和发布。

## 3. 当前问题清单

| ID | 优先级 | 问题 | 当前证据 | 目标 | 状态 |
|---|---|---|---|---|---|
| MA-01 | P1 | Hunter合同缺少问题类别、候选字段、正文证据和来源锚点 | `v2-learning-graphs.ts` 的 `HunterIssue` 只有ID、严重度、message、disputed | 增加结构化证据字段，并同步TypeBox、验证器、提示词和fixture | VERIFIED |
| MA-02 | P1 | Defender合同只有承认/反驳ID数组，不能逐项说明理由 | `DefenderOutput` 只有summary、两个ID数组和residualRisks | 改为逐项 `rebutted/conceded`、理由、来源和残余风险 | VERIFIED |
| MA-03 | P1 | Judge合同不能逐项维持/推翻Hunter，也不能报告遗漏问题 | `JudgeOutput` 只有verdict、summary、blockedIssueIds | 增加 `issueDecisions`、`additionalIssues` 和逐项正文理由 | VERIFIED |
| MA-04 | P1 | Defender路由过宽，low/medium问题也会触发 | `defenderRoute()` 只判断 `issues.length > 0` | 仅存在 `severity=high` 时触发，只向Defender传high问题 | VERIFIED |
| MA-05 | P1 | Judge接受受到Defender承认结果硬限制，不能独立推翻错误指控 | `judgeIsClosed()` 和Judge提示词要求全部反驳才可accepted | 程序只验证Judge逐项裁决闭合，不预设语义结果 | VERIFIED |
| MA-06 | P1 | Judge合同失败会被程序包装成“Judge拒绝” | `substantiveIssueRemains` 分支直接写rejected | 合同失败重试或标记合同失败；只有正式verdict=rejected才显示Judge拒绝 | VERIFIED |
| MA-07 | P1 | Generator返修依据来自Hunter原始message，而不是Judge确认理由 | `judgeRepairInstruction()` 读取Hunter和Defender数组 | 只使用Judge upheld/additional问题生成受控修复指令 | VERIFIED |
| MA-08 | P1 | 缓存和accepted checkpoint缺少Judge接受证明 | 缓存只保存artifact；恢复只检查stage=accepted和候选结构 | 保存并验证Judge verdict、候选哈希、审核绑定和完整阶段 | VERIFIED |
| MA-09 | P2 | Safety会静默重排选项，且Judge没有结构化Safety结果 | `balanceQuizAnswerPositions()` 在解析阶段修改候选 | 明确采用“确定性标准化”或返回Generator；记录输入/输出哈希并传递Safety摘要 | VERIFIED |
| MA-10 | P2 | Agent引用验证只是复制输入允许列表，不是逐项证据 | `sourceRefs` 来自 `safeContext` | Hunter/Defender/Judge逐项携带并校验 `sourceAnchorIds` | VERIFIED |
| MA-11 | P2 | 115/120秒后台窗口与终态Agent run存在竞态，取消未传到底层host | 前台可先完成fallback，后台继续append；AbortSignal未进入`host.execute` | 统一时限和所有权，终态后不追加；底层支持真实取消或明确隔离晚到缓存 | VERIFIED |
| MA-12 | P2 | 产品与旧 `ReviewOrchestrator` 存在两套状态机 | 网页使用`AdaptiveContentService`，旧编排器仍有不同revise语义 | 确立单一生产状态机；旧实现降级为兼容适配或复用公共规则 | VERIFIED |
| MA-13 | P3 | 公开时间线只显示数量和严重度，不能解释问题、辩护和裁决 | Hunter/Defender/Judge事件缺少脱敏逐项信息和来源 | 增加安全的问题摘要、逐项立场、Judge裁决和返修依据 | VERIFIED |
| MA-14 | P3 | 最后一次Safety修复可能显示“将修复”但循环已无下一次机会 | Generator三轮循环与candidateRepairs预算存在组合边界 | 状态文案必须与剩余执行槽一致，并补组合预算测试 | VERIFIED |

## 4. 分阶段实施顺序

### 阶段1：角色合同和提示词

范围：`MA-01`、`MA-02`、`MA-03`、`MA-10`。

完成定义：

- TypeScript接口、TypeBox Schema、运行时验证器和实时提示词使用同一字段；
- fixture和录制响应同步迁移；
- Hunter每个问题都有类别、候选字段、证据摘要和来源；
- Defender只输出逐项辩护或承认；
- Judge可逐项upheld/overruled并增加遗漏问题；
- 不向公共DTO泄漏答案或私有评测资产。

### 阶段2：路由、独立裁决和返修

范围：`MA-04`、`MA-05`、`MA-06`、`MA-07`。

完成定义：

- low/medium问题跳过Defender；
- 至少一个high问题才触发Defender，且Defender只接收high问题；
- Judge能在Hunter或Defender判断错误时accepted；
- Judge确认问题时revise，并基于Judge结论返回Generator；
- Judge合同失败与正式rejected严格区分；
- 返修后完整重审，预算耗尽才固定保障。

### 阶段3：审核绑定、Safety和超时

范围：`MA-08`、`MA-09`、`MA-11`、`MA-14`。

完成定义：

- 缓存和checkpoint恢复必须验证Judge accepted及候选哈希；
- Safety是否允许确定性重排形成明确且可审计的唯一规则；
- 115/120秒窗口不再向终态run追加事件；
- 晚到结果要么安全缓存，要么真实取消，不能悬挂；
- 所有预算组合的页面状态与实际下一步一致。

### 阶段4：公开审计、重复实现和总验证

范围：`MA-12`、`MA-13`以及全部回归。

完成定义：

- 公开Agent run可解释每个阶段为什么通过、返修、跳过或拒绝；
- 公开信息经过脱敏，不出现答案、密钥、隐藏测试和主机路径；
- 生产链只保留一套权威路由和裁决规则；
- typecheck、多Agent定向测试、Web测试和全量可运行门禁完成；
- 无法在当前环境完成的非多Agent门禁单独记录，不伪造通过。

## 5. 测试矩阵

| 场景 | 必须结果 | 状态 |
|---|---|---|
| Hunter无问题 | Defender skipped，Judge accepted | VERIFIED |
| Hunter只有low/medium问题 | Defender skipped，Judge独立accepted或revise | VERIFIED |
| Hunter含high问题 | Defender只收到high问题，逐项rebutted/conceded | VERIFIED |
| Hunter胡乱指控 | Judge overruled并允许发布 | VERIFIED |
| Defender错误承认 | Judge仍可overruled并允许发布 | VERIFIED |
| Defender错误反驳 | Judge仍可upheld并要求revise/rejected | VERIFIED |
| Judge发现Hunter遗漏问题 | additionalIssues进入返修指令 | VERIFIED |
| Judge revise | Generator重生成，完整重审后发布或耗尽 | VERIFIED |
| Judge合同错误 | 重试/合同失败，不得显示正式拒绝 | VERIFIED |
| 伪造accepted checkpoint | 拒绝缓存复用并重新审核 | VERIFIED |
| 115秒前台fallback后后台返回 | 不写终态run；按规则缓存或丢弃 | VERIFIED |
| 公开时间线 | 可解释且无私有答案/评测资产 | VERIFIED |
| Generator三轮失败边界 | 最后一轮Safety失败不得承诺继续返修，实际调用恰好3次 | VERIFIED |

## 6. 执行记录

### 2026-08-28 基线审查

- `npm run typecheck`：通过。
- 多Agent相关7个测试文件：211/211通过。
- 现有测试仍把medium问题经过Defender作为正确行为，不能作为09号新标准的验收依据。
- 全量测试受Python评测环境和生成资产问题影响未完成；不得把这些非多Agent失败混入本专项结论。
- 本轮开始前，`adaptive-content-service.ts`、`v2-learning-graphs.ts`、`w4-d-graph-factory.ts`和相关测试已有用户/前序修改，后续必须在当前内容上增量修改，不得回退。

### 2026-08-28 MA-01 开始

- 已确认生产网页由 `AdaptiveContentService` 执行审核链，合同定义同时分布在 `v2-learning-graphs.ts`、`adaptive-content-service.ts` 和 `w4-d-graph-factory.ts`。
- 本项将增量补齐 Hunter 的 `category`、`candidateField`、`evidenceSummary`、`sourceAnchorIds`，并同步实时提示词、录制响应与测试夹具；不在本项提前改变 Defender 路由或 Judge 裁决语义。

### 2026-08-28 MA-01 完成

- `HunterIssue`、运行时验证器和实时TypeBox Schema已统一要求 `category`、`candidateField`、`evidenceSummary`、非空 `sourceAnchorIds`。
- V2提示词和W4-D实时提示词已禁止无定位、无正文证据的泛化问题；实时提示词版本提升为 `w4-d2-v18`。
- 当前运行夹具、W2兼容夹具、审核编排测试夹具均已迁移；`w4/recorded-responses.json` 属于 `w4-d2-v1` 历史封存证据，保持原样且封存SHA未改写。
- 验证：`npm run typecheck`通过；核心合同与审核链测试 `184/184` 通过；录制响应加载、W4封存审计和W6动态题录制测试 `31/31` 通过。

### 2026-08-28 MA-02 开始

- 目标合同采用 `issueAssessments[]`：每项包含 `issueId`、`position=rebutted|conceded`、`rationale`、`sourceAnchorIds`、`residualRisk`，由一条记录完整表达Defender对一个问题的立场和依据。
- 本项只升级Defender表达和闭合校验；是否只向Defender传递high问题将在 `MA-04` 处理，Judge独立推翻语义将在 `MA-05` 处理。

### 2026-08-28 MA-02 完成

- `DefenderOutput` 已改为 `defenseSummary + issueAssessments[]`；每项强制包含 `issueId`、`position=rebutted|conceded`、`rationale`、非空 `sourceAnchorIds`、`residualRisk`。
- `AdaptiveContentService` 与兼容 `ReviewOrchestrator` 的问题闭合检查均已按逐项记录迁移；公开指标由逐项记录派生，不再依赖三个可能互相矛盾的数组。
- 当前运行夹具、录制响应和角色矩阵已迁移；旧 `w4-d2-v1` 历史封存录制继续保持原合同和SHA。
- 验证：`npm run typecheck`通过；合同、生产审核链、兼容编排器和W6录制回放测试 `186/186` 通过。

### 2026-08-28 MA-03 开始

- Judge新增 `issueDecisions[]`，必须逐项覆盖Hunter问题并返回 `upheld|overruled`、正文理由和来源锚点。
- Judge新增 `additionalIssues[]` 报告Hunter遗漏的问题；`blockedIssueIds` 只能引用 `upheld` 的Hunter问题或Judge新增问题。
- 本项建立结构化独立裁决合同；去除程序对Judge语义结论的硬限制将在 `MA-05` 完成。

### 2026-08-28 MA-03 完成

- `JudgeOutput` 已新增 `issueDecisions[]` 和 `additionalIssues[]`；两类记录均强制携带正文理由与非空来源锚点。
- 两套编排器均验证：逐项裁决恰好覆盖Hunter问题；新增问题ID不与Hunter重复；阻塞ID只能引用 `upheld` 或Judge新增问题。
- Judge发现Hunter遗漏问题时，该问题已能进入Generator返修指令，并在返修后重新经过完整审核链。
- 验证：`npm run typecheck`通过；合同、生产审核链、兼容编排器和W6录制回放测试 `188/188` 通过。

### 2026-08-28 MA-10 开始

- 在现有响应外层 `sourceRefs` 校验之外，增加角色输出内部逐项来源校验。
- Hunter问题、Defender逐项评估、Judge逐项裁决和Judge新增问题中的每个 `sourceAnchorIds` 都必须属于当前章节允许来源；任一越界来源均触发该角色合同重试/失败，不得进入发布。

### 2026-08-28 MA-10 完成暨阶段1结束

- `AdaptiveContentService` 已同时校验模型响应外层 `sourceRefs` 和Hunter/Defender/Judge逐项证据锚点。
- 兼容 `ReviewOrchestrator` 的实时结果与checkpoint恢复路径采用相同逐项来源校验；结构校验先于来源校验，损坏checkpoint不会再被误报为provider错误。
- 新增生产链和兼容链测试，覆盖三个Agent内部伪造未注册来源的拒绝路径。
- 验证：`npm run typecheck`通过；合同、两套编排器、模型适配器、W6录制回放和W4封存审计测试 `223/223` 通过。

### 2026-08-28 MA-04 开始

- 路由依据固定为 `hunter.issues.some(severity === "high")`，不再采信 `requiresDefender`，也不因候选 `riskLevel=high` 在Hunter未报告high问题时强制调用Defender。
- Defender只接收Hunter high问题的投影；Judge仍接收完整Hunter输出和Defender对high问题的逐项意见。

### 2026-08-28 MA-04/MA-05 联动说明

- high-only路由完成代码修改后，medium问题会直接进入Judge；旧 `judgeIsClosed()` 仍要求“无Hunter问题”或“Defender全部反驳”才允许accepted，导致Judge合法推翻medium指控时被程序拒绝。
- 因此 `MA-04` 暂不单独标记完成，与 `MA-05` 联动验收：程序只检查逐项裁决、来源、阻塞引用和verdict结构闭合，不再根据Hunter/Defender立场预设Judge必须怎么判。

### 2026-08-28 MA-04/MA-05 完成

- 两套编排器均改为仅在Hunter存在 `severity=high` 问题时触发Defender；候选 `riskLevel=high` 或Hunter兼容字段 `requiresDefender` 均不能替代具体high问题。
- Defender输入只包含high问题投影，Judge输入继续包含完整Hunter问题和Defender对high问题的意见。
- `judgeIsClosed()` 已移除“Hunter无问题/Defender全部反驳”的语义硬限制，只验证逐项裁决、来源、阻塞引用和verdict闭合。
- 已验证：medium问题跳过Defender；混合问题只向Defender发送high项；Defender承认时Judge可overruled并accepted；Defender反驳时Judge仍可upheld并revise。
- 验证：`npm run typecheck`通过；生产链与兼容编排器定向测试 `186/186` 通过，阶段联合回归 `195/195` 通过。

### 2026-08-28 MA-06 开始

- Judge响应的Schema错误、逐项闭合错误、来源越界、权限文本错误属于“裁决合同失败”，允许一次合同修复；失败后标记 `judge_invalid`，不得显示Judge正式拒绝。
- 只有通过全部确定性合同校验且明确返回 `verdict=rejected` 的Judge结果，才能写入“Judge拒绝”和 `judge_rejected/verdict_rejected`。

### 2026-08-28 MA-06 完成

- 生产链已删除程序根据Hunter/Defender意见自行判定“实质问题未解决”并冒充Judge拒绝的分支；程序现在只校验Judge响应的Schema、来源、权限文本和问题闭合合同。
- Judge首次合同失败记录为 `revised` 并按失败类别执行一次合同修复；连续失败记录为 `failed` 和 `judge_invalid`。只有合法Judge响应明确返回 `verdict=rejected` 时，才记录 `judge_rejected/verdict_rejected` 和“Judge最终拒绝”。
- 新增回归测试模拟真实公开run前置顺序，验证Judge工位事件为 `running → revised → running → failed`，失败类别为 `status_invalid_output_invalid_json`，checkpoint为 `stage=unavailable/reasonCode=judge_invalid`，且公开记录不含“Judge最终拒绝”。
- 验证：`npm run typecheck`通过；生产链与兼容编排器定向测试 `187/187` 通过。

### 2026-08-28 MA-07 开始

- 已确认当前 `judgeRepairInstruction()` 虽然按 `blockedIssueIds` 过滤，但仍复制Hunter原始 `message`，并附加Defender承认ID；这会把审查意见混入最终返修事实。
- 本项将把返修合同收敛为Judge唯一来源：Hunter问题只有在Judge `issueDecisions.decision=upheld` 且列入 `blockedIssueIds` 时，才以Judge自己的 `rationale/sourceAnchorIds` 进入返修；Judge遗漏发现只从 `additionalIssues` 进入返修；Defender意见不直接传给Generator。

### 2026-08-28 MA-07 完成暨阶段2结束

- `judgeRepairInstruction()` 已移除Hunter和Defender参数。对Hunter问题的返修信息只来自Judge `issueDecisions` 中同时满足 `decision=upheld` 且被 `blockedIssueIds` 引用的记录，传递字段仅为 `issueId/rationale/sourceAnchorIds`。
- Judge独立发现的问题继续只从 `additionalIssues` 进入返修；Hunter原始 `message`、Defender逐项立场和承认ID不再直接传给Generator。
- 回归测试验证返修指令包含Judge理由，不包含Hunter原始指控文本、Defender承认字段或Defender理由；返修候选仍从Safety开始经过完整Hunter、必要Defender和Judge复审。
- 验证：`npm run typecheck`通过；合同、生产链与兼容编排器阶段2联合回归 `194/194` 通过。

### 2026-08-28 MA-08 开始

- accepted checkpoint和cache将增加同一份私有审核证明，最小字段为：`generationRunId`、完整候选SHA-256、实际 `stageOrder`、核心完成工位、Hunter输出、必要的Defender输出和Judge输出。
- 复用前必须重新验证当前键绑定的运行ID、候选哈希、Hunter/Defender/Judge合同、逐项来源、high-only Defender路由、Judge `verdict=accepted`、问题闭合和最终阶段顺序；缺失或篡改证明时不得复用。

### 2026-08-28 MA-08 完成

- `AdaptiveCheckpoint` 与 `AdaptiveCacheRecord` 已保存 `acceptedReviewProof`；证明绑定当前 `generationRunId`、候选SHA-256、实际阶段顺序、核心工位集合及完整Hunter/必要Defender/Judge审查输出。
- cache和accepted checkpoint复用前会重新执行合同、来源、权威边界、high-only Defender路由、Judge accepted、问题闭合、候选哈希和阶段顺序校验；未完成的普通checkpoint仍可按原规则恢复。
- `adaptive-trace` 的accepted记录新增候选哈希和Judge verdict，便于私有审计；公共DTO未增加Hunter、答案或私有证明字段。
- 新增篡改测试：修改accepted checkpoint候选但保留旧证明、修改cache候选哈希时，系统均拒绝命中并完整重跑 `Generator → Hunter → Judge`。
- 验证：`npm run typecheck`通过；合同、生产链与兼容编排器联合回归 `196/196` 通过。

### 2026-08-28 MA-09 开始

- 采用唯一规则“确定性标准化”：Safety允许按固定可复现算法调整单选题 `options` 顺序以分散正确答案位置，但不得修改题干、正确答案文本、解析或来源；card和无需调整的quiz保持原样。
- 每次通过Safety时记录输入候选SHA-256、输出候选SHA-256和标准化类型，并把只读、无答案的 `safetySummary` 传给Hunter与Judge。

### 2026-08-28 MA-09 完成

- `parseGeneratorArtifact()` 现在显式返回 `DeterministicSafetyAudit`；标准化类型只有 `none` 和 `quiz_option_order_balanced`，输入/输出候选均使用完整SHA-256绑定。
- checkpoint与accepted审核证明保存Safety审计；候选恢复时必须存在Safety输出哈希且与当前候选一致，否则拒绝恢复。
- Hunter和Judge输入新增只读 `safetySummary`，两套提示词明确说明当前审核对象是Safety输出版本，选项顺序调整不代表Generator原始输出已经均衡，也不改变答案语义。
- 公开Safety工位显示标准化类型及前后哈希短摘要；私有checkpoint保留完整哈希。实时提示词版本由 `w4-d2-v18` 提升为 `w4-d2-v19`。
- 验证：`npm run typecheck`通过；生产链、合同、兼容编排器、实时图工厂和六节live条件测试 `197/197` 通过，另有 `2` 项真实live环境条件测试按既有条件跳过。

### 2026-08-28 MA-11 开始

- 已确认生产live配置为Adaptive内部 `115s fallback / 120s discard`，Quiz外层再以 `120s` 封存Agent run；115秒后内部后台仍可能追加工位，和外层终态发生竞态。
- `PiGraphModelExecutionAdapter` 虽接收AbortSignal，但没有传给 `IsolatedGraphExecutor`；live executor调用 `host.execute()` 时也没有传本次操作信号，因此controller.abort不能真实取消当前模型Host。
- 本项采用单一所有权：live Adaptive在120秒到点时记录当前工位超时、关闭该run的内部追加权限、向Host传递取消信号并停止晚到缓存；Quiz外层只保留125秒异常兜底。

### 2026-08-28 MA-11 完成

- Adaptive内容链已取消“前台先返回、后台继续到第二截止点并尝试late cache”的双窗口。当前所有者截止时间到达后立即：标记signal已丢弃、关闭该Agent run的内部追加权限、abort模型执行、为当前运行工位补写一次timeout失败事件、将checkpoint标记discarded并返回固定保障。
- `PiGraphModelExecutionAdapter` 已把本次操作AbortSignal传入 `IsolatedGraphExecutor`；通用隔离执行器合并命令上下文和本次操作信号，live executor也把信号传给 `host.execute()`，取消不再只停留在服务层。
- live Adaptive时限统一为 `120s/120s`；Quiz外层异常兜底调整为125秒，只在内容端或存储端异常悬挂时接管，不再与正常120秒终止竞争。
- 新增回归验证：15秒测试截止即signal.aborted、checkpoint=`discard_after_15s`、晚到结果不缓存；上层封存fallback后，晚到模型结果不会向终态run追加事件；自定义60/90配置只使用60秒所有权窗口，不再创建第二后台窗口。
- 验证：`npm run typecheck`通过；Adaptive生命周期、Quiz、个性化提醒、模型适配器、live端口和隔离Host测试 `103/103` 通过。

### 2026-08-28 MA-14 开始

- 已确认Generator最多执行3轮，但外层合同失败分支和Safety失败分支只检查各自修复计数；当第三轮失败时，可能错误显示“将按预算重试”或“将返回Generator定向修复”，随后循环实际直接结束并切换固定保障。
- 本项要求所有“可重试/可修复”判断先确认仍存在下一次执行槽，再检查provider重试或候选修复预算；没有下一槽时必须直接记录失败，不得向页面承诺不存在的下一步。

### 2026-08-28 MA-14 完成

- `adaptive-content-service.ts` 的Generator循环统一使用 `hasNextAttempt = attempt + 1 < 3`；provider retry、Generator合同修复和Safety定向修复只有在仍有下一轮时才标记为 `revised` 并继续。
- 第三轮失败现在直接标记当前工位 `failed`，文案为“Generator未形成可审核候选”或“候选重复违反确定性合同，已停止发布”，不会再出现“将返回Generator”或“将按预算重试”的虚假承诺。
- 新增回归测试覆盖Safety连续三次失败：Generator实际调用恰好3次，最后一次Safety为失败，公开失败文案不含继续修复承诺，最终追踪为 `invalid_schema_or_authority` 固定保障。
- 验证：`npm run typecheck`通过；`tests/adaptive-content-service.test.ts` 定向测试 `53/53` 通过。

### 2026-08-28 阶段3联合回归完成

- 联合覆盖Adaptive内容链、模型执行端口、实时模型端口、隔离Host、Quiz运行时、个性化提醒、固定保障集成和六节live条件测试。
- 验证结果：`7` 个测试文件通过，`107` 个测试通过；另有 `1` 个测试文件中的 `2` 项真实live环境条件测试按既有条件跳过。未发现MA-08、MA-09、MA-11、MA-14回归。
- 当前阶段3已完成；随后按计划进入阶段4处理 `MA-12`（生产与兼容状态机收敛）和 `MA-13`（公开时间线逐项解释）。

### 2026-08-28 MA-12 完成暨阶段4开始

- 已确认网页与 `demo/live` 组合根只实例化 `AdaptiveContentService`；旧 `ReviewOrchestrator` 没有生产调用点，仅服务历史W2/W3 checkpoint兼容审查和回归测试。
- 新增共享 `review-decision-policy.ts`，统一 high-risk Defender路由、Defender逐项闭合和Judge问题闭合规则；两套实现不再各自复制这些核心策略。
- 旧 `ReviewOrchestrator` 增加兼容范围标识和弃用说明；其 `revise → fallback` 仅是历史审查结果适配，不代表产品动态候选返修。生产候选返修、缓存和发布仍由 `AdaptiveContentService` 唯一负责。
- 验证：`npm run typecheck`通过；兼容编排器、生产链和组合根测试通过。

### 2026-08-28 MA-13 完成

- Hunter公开事件新增问题类别和来源锚点；Defender公开事件新增承认/反驳/剩余风险计数和来源锚点；Judge公开事件新增阻塞、推翻Hunter指控、补充问题计数、裁决和来源锚点。
- Web `AgentPipeline` 的完整安全时间线逐条展示脱敏指标、问题类别和裁决；来源锚点保留在选中工位的审计详情中，不再挤在时间下方的小字行。
- Web回归测试已同步验证时间线不展示来源小字，同时保留工位详情中的来源查看能力。

### 2026-08-28 阶段4公开审计增量完成

- MA-12和MA-13均已验证；当前专项问题清单中无 `TODO` 项。剩余工作仅为全量门禁、真实live环境演示和非多Agent提交材料检查，不能以本专项回归替代。

### 2026-08-28 全量门禁结果（非专项阻塞单独记录）

- `npm run build:web`：通过。
- `npm test -- --maxWorkers=1`：`113` 个测试文件通过、`1` 个跳过；`987` 个测试通过、`3` 个跳过、`37` 个失败。
- 失败主要集中在既有 Node/Python 正式评测环境不匹配（`environment_mismatch`）、W6 代码样例资产过期、公共包评测链和依赖版本断言；不属于 MA-01 至 MA-14 的多Agent审核链合同或路由回归，未将其伪装为专项通过。
- 后续提交前仍需在负责人匹配的 Node/Python/pandas 环境中单独处理这些非专项门禁；本台账只负责保存多Agent整改状态。

### 2026-08-28 合同环境定向评测复核

- 按合同环境显式设置 `PI_PYTHON_EXECUTABLE=C:/Users/win11/anaconda3/envs/pi-study-py313/python.exe` 和 `PYTHONNOUSERSITE=1` 后重跑评测相关测试；Node 使用 `v22.23.1`，Python 使用 `3.13.7`，pandas 使用 `3.0.5`。
- 覆盖 `python-process-evaluation`、R2 评测、W5-C-D3 故障证据/矩阵、公开输入、进程树、公共评测包、正式包版本绑定、W6 代码夹具和 Web 真实代码链共 `10` 个测试文件。
- 结果：`10` 个测试文件通过，`51/51` 个测试通过；未再出现 `environment_mismatch` 或合同 Python/pandas 版本不匹配失败。
- 结论：此前相关失败由测试进程误用 WindowsApps Python 解释器导致，不是多Agent审核链代码回归。后续运行正式评测必须沿用上述显式环境变量，不能依赖系统默认 `python` 命令。

### 2026-08-28 全量门禁复核完成

- 使用同一合同 Python 环境完成全量 `npm test -- --maxWorkers=1`：`125` 个测试文件中 `124` 个通过、`1` 个按条件跳过；`1027` 个测试中 `1024` 个通过、`3` 个按条件跳过。
- 初次全量运行唯一失败是旧 `tests/skeleton.test.ts` 仍断言历史的 `github:` 依赖写法，而交付启动器测试要求无 SSH 凭据机器可用的 HTTPS 完整提交号；已将骨架断言与现行 HTTPS 依赖合同统一。
- 复核 `tests/skeleton.test.ts`、`tests/competition-launcher.test.ts`：`13/13` 通过；`npm run check:release` 通过；`git diff --check` 通过。
- 结论：当前合同环境下，多Agent专项和全量测试没有未解释的失败；剩余 `3` 项为既有真实live条件测试跳过，不代表失败。未执行提交、推送或上传。

### 2026-08-28 流水线半截运行与时间线展示修复

- 修复 `AgentPipeline` 时间线把 `依据：src-...` 追加到时间下方小字的问题；来源仍可在当前工位的“安全审计详情”中查看，避免移动端窄布局被长来源标识撑乱。
- 修复客观题打开时只检查 `run.stages.length===0` 的恢复漏洞：同一请求复用只写完“依据”工位的半截run时，服务端现在逐项确认“依据”和“画像”均已成功；缺失工位会补写后再进入Generator，不会永久停在第一步。
- 新增半截run回归测试；`tests/quiz-activity-runtime.test.ts` 与 `tests/web/agent-pipeline.test.tsx` 共 `22/22` 通过，`npm run typecheck` 通过。
- 截图中的具体记录属于此前中途终止后留下的 `status=running` 历史run；更新代码并重新打开/重试同一活动后会补齐并继续，超过120秒的真正未收束run仍按前端超时状态显示，不会伪装成完成。
- 复核：`npm run build:web` 通过；时间线与半截run回归 `22/22` 通过；未使用独立 Playwright 截图，因为当前环境未安装 `playwright` Python 模块，视觉验证以既有 React 测试、CSS构建和DOM合同为依据。

### 2026-08-28 诊断跳过后的路径可开始状态修复

- 问题：诊断跳过部分知识点后，路径引擎可能同时返回多个 `status=available` 节点，路径页将它们全部显示为“可以开始”；用户会误以为后续章节可以绕过前置学习直接进入。
- 修复：`PathPage` 增加顺序展示投影。跳过/已完成节点不占用开始位；第一个未完成节点保留“可以开始”；之后所有未完成节点显示“等待先修”。服务端原始路径和 `getNextStep` 合同不改写，实际进入学习仍由服务端按当前最早未完成节点决定。
- 新增 Web 回归测试，覆盖“1个可开始 + 1个已跳过 + 2个后续可用”的场景，断言状态依次为“可以开始、已跳过、等待先修、等待先修”。
- 验证：路径页、路径引擎和路径运行时定向测试 `77/77` 通过；`npm run typecheck`、`npm run build:web`、`git diff --check` 通过。

## 7. 上下文恢复规则

每次恢复任务或发生上下文压缩后：

1. 完整阅读本文和09号设计文档。
2. 查看第3节问题状态，只处理第一个未完成且依赖已满足的问题。
3. 查看第6节最后一条执行记录，确认上次修改文件和测试结果。
4. 修改前检查工作区，不覆盖无关改动。
5. 每完成一个问题，立即更新问题状态、测试矩阵和执行记录。
6. 未验证的问题不得标记为 `VERIFIED`。
