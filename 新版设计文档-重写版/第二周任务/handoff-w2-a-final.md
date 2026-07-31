# handoff-w2-a：岗位A第二周D1-D3最终交接清单

状态：`V2-4_PASS / V2-5_PASS / UPLOAD_LOCK_GRANTED / NOT_COMMITTED / NOT_PUSHED`

本记录是岗位A第二周唯一最终交接清单，覆盖D1基线、D2-D3实现、作者验证和E复验结论。E已对修复包重新出具V2-4/V2-5 PASS；负责人于2026-08-01授予岗位A条件补传上传锁。本记录更新时尚未提交、尚未推送。

## 1. 基线与合同版本

```text
岗位：A（领域与架构）
分支：main
当前HEAD：f16399089938f79d07ff6a4dafacb8442cdb91d5
当前工作基线：f16399089938f79d07ff6a4dafacb8442cdb91d5
现行合同版本：W2-C2 / W2-R5
W2_START_COMMIT：f343a6c1c630f362f4686e6f6b0f50c6577d5562（负责人已登记）
工作树：D1检查时干净
提交状态：NOT_COMMITTED
推送状态：NOT_PUSHED
上传锁：UPLOAD_LOCK_GRANTED（负责人于2026-08-01授予条件补传上传锁）
```

基线验证结果：

- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：D1基线为32个测试文件、356项；D3修复后由A重新运行并记录最新项数。
- 固定周起点仍为`W2_START_COMMIT=f343a6c1c630f362f4686e6f6b0f50c6577d5562`；当前拉取后的实际HEAD为`f16399089938f79d07ff6a4dafacb8442cdb91d5`，二者语义不同。
- 第一周门禁已经由`E岗位第六天Go-No-Go清单.md`中的负责人最终`GO`关闭。
- D1时点未执行commit、push或上传锁流程；该条仅描述D1历史状态。

## 2. 当前源码事实

### 2.1 已有可运行能力

- `src/extension/index.ts`注册`/study`、`/study-recover`、`/study-profile`、`/study-build`和`/study-revise`。
- 旧版学习流程通过`StudySessionController`、`PrivateMemoryRepository`和Loop Graph walking skeleton运行。
- `ProfileFamilyRepository`负责Profile目录、draft/active/archived和Profile修订。
- `src/domain/profile-v2-schema.ts`已有第一周Profile v2严格Schema、引用闭合和坏包拒绝骨架。

### 2.2 D1时点尚未实现的能力（已由D2-D3完成）

以下内容仅记录D1基线时的源码事实，不代表当前实现状态；对应交付已在第9节完成并登记。

- `src/domain/v2-types.ts`仍是第一周精简Evidence/KnowledgeState模型，尚未迁移到11号完整模型。
- `src/application/learning-runtime-facade.ts`目前主要提供17个Facade方法和DTO类型，没有新版诊断运行时实现。
- `src/repositories/learning-session-repository.ts`目前是四方法端口，没有文件持久化、事务提交和恢复实现。
- 当前旧版`PrivateMemoryRepository`不能替代新版`LearningSessionRepository`。
- 当前Pandas候选诊断资产仍使用旧字段形状，属于B负责迁移范围，A不修改其正文。

## 3. D2-D3文件清单

### 3.1 A允许修改的实现目录

```text
pi-study-helper/src/domain/
pi-study-helper/src/application/
pi-study-helper/src/repositories/learning-session-repository.ts
pi-study-helper/tests/（A拥有的作者测试）
pi-study-helper/tests/fixtures/（非Pandas v2 smoke、非法和恢复fixture）
```

### 3.2 预计修改或新增的A文件

- `src/domain/v2-types.ts`：完整Evidence、KnowledgeState、LearnerDiagnostic及相关枚举。
- `src/application/learning-runtime-facade.ts`：诊断DTO和诊断完成安全返回字段同步。
- `src/repositories/learning-session-repository.ts`：批量Evidence、诊断候选、最新诊断和已提交ID字段同步，并增加文件事务实现所需端口适配。
- `src/domain/knowledge-state.ts`：Evidence过滤、加权掌握度、置信度和状态计算实现（如实现阶段采用其他A-owned领域文件，需在D3补充登记）。
- `src/application/diagnostic-runtime.ts`：保存草稿、逐题确定性判定、幂等/冲突和完成聚合（如实现阶段采用Facade实现文件内聚合，需在D3补充登记）。
- `src/repositories/file-learning-session-repository.ts`：新版会话目录、临时候选、原子`latest.json`、版本比较和恢复（如与端口合并实现，需在D3补充登记）。
- A作者测试文件及非Pandas v2 fixture。

权威设计文档、其他岗位目录、依赖和SDK文件不在A修改范围内。

## 4. DTO与公共类型清单

### 4.1 `src/domain/v2-types.ts`

D2-D3需要按21号和11号合同迁移或补齐：

- `Evidence`
- `EvidenceSource`
- `EvidenceImpact`
- `EvidenceForm`
- `KnowledgeStatus`
- `KnowledgeState`完整字段
- `LearnerDiagnostic`
- `mastery: number | null`
- `evidenceVersion`
- `profileRevision`
- `aggregationVersion`
- `validEvidenceCount`
- `evidenceFormCount`
- `evidenceIds`
- `consideredEvidenceIds`
- `asOf`
- `skipEligible`
- `lastUpdatedAt`

不保留第二套旧精简`EvidenceResult`或`KnowledgeStateValue`兼容公共类型。

### 4.2 `src/application/learning-runtime-facade.ts`

重点核对：

- `SaveDiagnosticDraftInput/Output`
- `SubmitDiagnosticAnswerInput/Output`
- `CompleteDiagnosticInput/Output`
- `DiagnosticCompleteOutput.knowledgeStates`
- `DiagnosticCompleteOutput.evidenceVersion`
- `DiagnosticCompleteOutput.insufficientKnowledgePointIds`

逐题提交响应不得把候选Evidence误报为正式Evidence；正式Evidence只在`commit`成功后公开。

### 4.3 `src/repositories/learning-session-repository.ts`

重点核对：

- `SessionSnapshot.latestDiagnostic`
- `SessionCommitCandidate.evidenceCandidate`
- `SessionCommitCandidate.evidenceCandidates`
- `SessionCommitCandidate.diagnosticCandidate`
- `CommittedSessionSnapshot.committedEvidenceIds`
- `CommittedSessionSnapshot.committedDiagnosticId`
- 批量Evidence与单项Evidence互斥规则
- 诊断候选与活动候选互斥规则

## 5. 持久化清单

新版会话根目录固定为：

```text
<dataRoot>/profile_families/<subjectId>/_user/learning_sessions/<sessionId>/
├─ session.json
├─ diagnostic/
│  ├─ background.json
│  ├─ draft.json
│  ├─ answers/<questionId>.json
│  └─ result.json
├─ evidence/<evidenceId>.json
├─ knowledge_state.json
├─ checkpoints/latest.json
└─ 临时候选文件
```

D2-D3实现必须覆盖：

- `create`只创建初始会话草稿，不公开正式Evidence。
- `getSnapshot`只读取不超过`latest.json`提交标记的安全事实。
- `commit`在一个临时候选中校验并原子公开Evidence、KnowledgeState、诊断快照、版本和提交标记。
- `recover`补提交完整且requestId匹配的候选；不完整候选必须隔离。
- 版本冲突统一使用`session_version_conflict`。
- 重试同一`requestId`返回首次提交结果，不重复计分。
- 存储失败时不留下部分正式Evidence、KnowledgeState、诊断快照或版本递增。

## 6. A作者测试清单

- v2类型字段、可选性和闭合枚举。
- Facade诊断DTO字段和安全边界。
- Repository批量Evidence、诊断候选、最新诊断和已提交ID合同。
- Evidence来源权重、独立性权重和时间权重。
- 最近7条证据、attempt幂等去重和非法分数拒绝。
- 11号五个手算示例原样复算。
- 无有效直接Evidence：`mastery=null`、`confidence=0`、`unverified`。
- 全跳过：不创建Evidence、不写0分、不递增`evidenceVersion`，且不足知识点去重。
- 部分跳过：已答Evidence正常计算，被跳过知识点进入不足列表。
- 已有直接Evidence后跳过：跳过不参与计算，已有Evidence仍正常计算。
- 同一题同一`requestId`幂等返回首次结果。
- 同一题不同`requestId`重复提交返回诊断答案冲突，首次结果不可覆盖。
- 诊断未完成时拒绝完成。
- 版本冲突、临时文件、原子`latest.json`、失败隔离和恢复。
- 非Pandas v2 smoke fixture，证明公共Schema不依赖Pandas字段。
- 安全DTO、普通日志和恢复输出不泄漏答案、密钥、私有路径、隐藏测试和参考实现。

## 7. 合同勘误与责任边界

### 7.1 显式跳过合同已补齐

负责人已在`f16399089938f79d07ff6a4dafacb8442cdb91d5`对应合同勘误中固定：

```ts
type SubmitDiagnosticAnswerInput =
  | (SubmitDiagnosticAnswerBase & { action: "answer"; answer: string | boolean })
  | (SubmitDiagnosticAnswerBase & { action: "skip"; answer?: never });
```

- `action`为必填判别字段；`answer`分支必须携带合法答案，`skip`分支禁止携带`answer`。
- 缺失/未知`action`、非法组合或答案不匹配题型统一返回`diagnostic_answer_invalid`。
- 同一`requestId`相同内容幂等返回首次结果；内容不同返回`idempotency_conflict`；同题使用新`requestId`再次提交返回`diagnostic_answer_conflict`。
- 跳过返回`skipped`，不创建Evidence、不写0分；不新增Facade方法，不保留缺少`action`的兼容输入。

### 7.2 Pandas诊断资产字段迁移

当前候选资产仍使用旧的`diagnosticId/type/correctOptionIndex`等字段；第二周W2-A合同要求新的严格蓝图和答案键字段。该迁移属于B的Profile资产范围，A只做Schema/消费字段只读复核，不修改资产正文。

### 7.3 W2起始提交

负责人已登记`W2_START_COMMIT=f343a6c1c630f362f4686e6f6b0f50c6577d5562`。A候选包由E在该正式起始提交的独立工作树中只读覆盖复验；此前记录的`50834a7...`只表示A开始本地覆盖开发时的HEAD，不替代正式起始提交。

### 7.4 Pandas输入责任边界

- 当前Pandas revision 1及旧字段属于B负责迁移的输入，不是A实现缺陷。
- A不修改B资产正文，不把revision 1当作正式revision 2输入；继续以28号严格Schema和非Pandas smoke进行开发与验证。

## 8. D1边界声明

- 未修改20、21、27、28号权威文档。
- 未修改B/C/D/E负责文件。
- D2-D3已修改A负责的业务代码、公共DTO和作者测试；未修改B/C/D/E负责文件。
- 未修改依赖、SDK、`package.json`或锁文件。
- D1阶段未执行commit、push或上传锁流程；D3收口时已获得负责人授予的条件补传上传锁。
- 本记录同时承载D1基线、D2-D3实现、测试、限制和E复验结论。

## 9. D2-D3实现交付

### 9.1 公共类型与合同迁移

- `src/domain/v2-types.ts`已迁移到11号完整Evidence模型：来源、形式、影响、结果、独立性、可选分数、版本和时间字段齐全。
- 已删除旧精简Evidence结果和四状态KnowledgeState公共模型，v2唯一使用`KnowledgeStatus`五状态和`mastery: number | null`。
- 已加入完整`KnowledgeState`和`LearnerDiagnostic`可复算字段。
- `LearningRuntimeErrorCode`补齐`diagnostic_answer_invalid`和`diagnostic_answer_conflict`。
- `learning-runtime-facade.ts`已同步严格`action: "answer" | "skip"`判别联合，不保留旧的缺少`action`输入。
- `KnowledgePointDefinition`和Profile Schema支持可选`requiresCodeEvidence`，默认不启用代码门禁。
- `learning-session-repository.ts`已同步批量Evidence、诊断候选、最新诊断及已提交ID字段。

### 9.2 KnowledgeState确定性聚合

新增`src/domain/knowledge-state.ts`，实现`knowledge-state-v1`：

- 固定Evidence来源权重、独立性权重和30/90天时间折扣。
- 过滤资料包revision、mastery影响、合法分数、有效时间和正权重证据。
- 按时间和Evidence ID稳定排序，按attemptId去重，只取最近7条参与聚合。
- 实现加权掌握度、置信度一致性奖励/冲突惩罚。
- 实现`unverified/support_needed/learning/ready/mastered`五状态。
- 实现`skipEligible`及`requiresCodeEvidence`门禁。
- 无直接证据返回`mastery=null/confidence=0/unverified`。
- 非法分数、未来时间戳和损坏证据抛出`evidence_invalid`，不静默修正。

### 9.3 固定诊断运行

新增：

- `src/domain/diagnostic.ts`
- `src/application/diagnostic-runtime.ts`

已实现：

- 严格诊断蓝图和私有答案键解析。
- 单选/判断确定性判分。
- 逐题答案不可变保存。
- 同一题同一requestId幂等返回首次结果。
- 同一题不同requestId返回`diagnostic_answer_conflict`。
- 同一会话诊断提交采用会话级互斥；同题不同requestId并发时仅首次成功，后续请求不能覆盖首次结果。
- 同一requestId相同内容并发返回同一首次结果；跨题requestId内容绑定也在同一互斥范围内检查。
- 显式跳过不创建Evidence、不写0分。
- 完成前检查所有题均已答或跳过。
- 完成时一次计算KnowledgeState并通过一次Repository commit提交。
- 诊断完成后保存不可变`LearnerDiagnostic`。
- 同一完成requestId重试返回原诊断结果。

显式跳过现通过公共Facade的严格判别联合表达；运行时拒绝缺失/未知`action`、`skip`携带答案和`answer`缺少答案等非法组合，并覆盖跨题相同requestId的内容冲突。

### 9.4 文件事务仓储

新增`src/repositories/file-learning-session-repository.ts`，实现：

- `create/getSnapshot/commit/recover`。
- `<dataRoot>/profile_families/<subjectId>/_user/learning_sessions/<sessionId>/`目录布局。
- 临时候选事务和`checkpoints/latest.json`唯一发布标记。
- Evidence批量提交共享一次新`evidenceVersion`。
- 全部跳过时不新增Evidence且不递增`evidenceVersion`。
- 诊断快照、KnowledgeState、Evidence和sessionVersion原子发布。
- 同requestId幂等；不同内容返回`idempotency_conflict`。
- 陈旧sessionVersion返回`session_version_conflict`。
- 发布前中断的完整候选可由`recover`补提交。
- 临时候选保存格式版本、原始提交输入和可复算`inputHash`；`commit`重试与`recover`发布前使用同一套完整事务校验。
- 恢复校验重新闭合Evidence、KnowledgeState、LearnerDiagnostic、session/evidence/profile版本、响应、提交标记、哈希和路径安全。
- JSON合法但语义损坏、缺少原始输入或哈希无法闭合的旧候选进入`quarantine`，不污染正式快照。
- 失败不会通过`latest.json`提前暴露未提交事实。

### 9.5 非Pandas smoke与作者测试

新增非Pandas v2 fixture：

```text
tests/fixtures/profile-v2/non-pandas-diagnostic/
```

覆盖JavaScript变量主题、Profile revision 2、诊断蓝图和私有答案键，证明公共诊断Schema没有写死Pandas字段。

新增A测试：

- `tests/knowledge-state.test.ts`
- `tests/diagnostic-runtime.test.ts`
- `tests/file-learning-session-repository.test.ts`
- `tests/non-pandas-v2-smoke.test.ts`
- `tests/learning-runtime-facade.test.ts`
- 更新`tests/v2-types.test.ts`到W2完整公共类型。

覆盖五个手算示例、最近7条、attempt幂等、跳过去重、已有Evidence后跳过、全跳过、并发首次写入、版本冲突、合法事务恢复、8类语义损坏候选隔离和非Pandas加载。

## 10. D3验证结果

最终验证命令：

```text
npm.cmd run verify
git diff --check
```

结果：

- `typecheck`：PASS。
- 聚焦作者测试：PASS，6个测试文件、45项测试。
- 全量测试：PASS，36个测试文件、387项测试。
- `check:docs`：PASS，30个Markdown项目链接有效。
- `smoke:extension`：PASS，Pi成功解析并初始化扩展。
- `check:release`：PASS，未发现私有数据或密钥。
- `git diff --check`：PASS。

## 11. D3限制、审计和上传状态

- `PathEngine/buildPath`未实现、未调用、未统计路径合法率。
- 未接入真实模型、React、外部评测器或第三周能力。
- 未修改B的Pandas正文、答案键或gold资产。
- 未修改D的模型配置、提示词或响应材料。
- E已按修复包`A-W2-D1-D3-E-audit-package-f163990-r2.zip`的新SHA-256 `c27073b5c71929cc1f799d2ed60e220e049e669964298ed55745fc60a2b4922b`完成独立复验；25/25清单哈希一致，V2-4、V2-5均为PASS。
- E复验结果：六个重点测试文件45/45、E独立反例2/2、E端到端矩阵4/4、全量36个测试文件387/387；`typecheck`、`verify`和`git diff --cached --check`均通过，无需A继续修复。
- 正式上传资料包括E审核报告`E岗位第二周D2-A最新逐项预检报告.md`、E已绑定哈希的r2审计包及其sidecar；不重新生成或改写已审核审计包。
- 因常规D3窗口已过，负责人已于2026-08-01明确授予岗位A条件补传上传锁。
- 正式`W2_START_COMMIT`为`f343a6c1c630f362f4686e6f6b0f50c6577d5562`；本次拉取后的实际HEAD为`f16399089938f79d07ff6a4dafacb8442cdb91d5`。
- 当前状态：`V2-4_PASS / V2-5_PASS / UPLOAD_LOCK_GRANTED / NOT_COMMITTED / NOT_PUSHED`。
- 上传锁已获得；本记录更新时尚未执行commit或push，正式提交号由上传结果回执登记。
