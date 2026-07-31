# 岗位 E｜第二周 D2-D3 A r2 修复包追加独立复验报告

执行日期：2026-08-01
审计人：岗位 E
结论性质：D2-D3 候选修复包滚动预检；不是负责人最终 Go/No-Go，不替 A 修改、提交或上传实现。
适用合同：`W2-C2 / W2-R5`，执行边界以 27、28、33 号和 06 号 V2-4/V2-5 为准。

## 0. 历史报告失效说明

此前报告绑定的旧包 SHA-256 为：

```text
088b8667a86f698520697fb6ee511eabd334b325f3362c6a7c59fb7309385770
```

负责人独立复核后发现旧包没有覆盖并发首次提交和 JSON 合法但语义损坏候选恢复两类合同反例。旧包的 V2-4/V2-5 PASS 不得继续作为上传依据，也不得替代本报告对 r2 包的复验。

本报告唯一绑定的 r2 包 SHA-256 为：

```text
c27073b5c71929cc1f799d2ed60e220e049e669964298ed55745fc60a2b4922b
```

## 1. 审计对象、基线和完整性

| 检查项 | 结果 | E 独立证据 |
|---|---|---|
| 固定周起点 | PASS | `W2_START_COMMIT=f343a6c1c630f362f4686e6f6b0f50c6577d5562`。 |
| 实际审计基线 | PASS | `HEAD == origin/main == f16399089938f79d07ff6a4dafacb8442cdb91d5`，固定周起点是该 HEAD 的祖先。 |
| r2 外层包 | PASS | 本地文件 `A-W2-D1-D3-E-audit-package-f163990-r2(1).zip` 实测 SHA-256 为 `c27073b5c71929cc1f799d2ed60e220e049e669964298ed55745fc60a2b4922b`。文件名中的 `(1)` 是本地重复下载后缀，不参与身份判断。 |
| sidecar | PASS | `A-W2-D1-D3-E-audit-package-f163990-r2.zip.sha256`记录的规范包名和 SHA-256 与实测内容一致。 |
| 包内 Manifest | PASS | `MANIFEST.sha256`共 25 项，逐文件 SHA-256 复算为 25/25 一致。 |
| 隔离方式 | PASS | 在仓库外新建独立克隆，以 `f163990...` 为基线，只覆盖 Manifest 中的 A 候选文件；未覆盖主工作区。 |
| 文件所有权 | PASS | 候选只包含 A 获准的 domain/application/仓储文件、A 作者测试、非 Pandas fixture、A 交接单和仓库外审计说明；未包含 B/C/D/E 业务产物。 |
| 候选文本完整性 | PASS | 在临时索引纳入全部拟提交文件后，`git diff --cached --check`退出码为 0。 |

## 2. 独立环境和命令结果

执行目录为仓库外独立克隆的 `pi-study-helper/`。E没有修改A候选、依赖声明、锁文件或验收标准。

| 命令或检查 | 结果 | 真实结果 |
|---|---|---|
| `npm.cmd ci` | PASS | 按现有锁文件安装 181 个包并审计 182 个包；保留 1 个 moderate、1 个 high 间接依赖告警；未运行`npm audit fix`。 |
| `npm.cmd run typecheck` | PASS | `tsc --noEmit && tsc -p tsconfig.test.json`通过。 |
| 6 个 V2 重点测试 | PASS | 6 个文件、45/45 通过。 |
| E 独立反例 | PASS | 2/2 通过：同题不同请求并发只允许首次成功；嵌套 KnowledgeState 语义损坏候选被隔离。 |
| E V2-4 端到端矩阵 | PASS | 4/4 通过：全对、全错、退出后新运行时继续、完成事务中断后旧快照不变且同请求重试成功。 |
| `npm.cmd test -- --maxWorkers=1` | PASS | 候选原始测试 36 个文件、387/387 通过。 |
| `npm.cmd run verify` | PASS（有环境噪音记录） | 使用隔离工作树专用`TEMP/TMP`后一次性通过：类型检查、36 文件/387 测试、30 个 Markdown 链接、扩展冒烟和发布扫描全部通过。 |
| `git diff --cached --check` | PASS | 全部拟提交候选文件无空白错误。 |

### 2.1 Windows 系统临时目录噪音

在默认系统临时目录执行完整`verify`时，三次运行分别在A未修改的既有Profile测试中出现随机`rename ... EPERM`：

- `profile-family-repository.test.ts`的一项原子修订测试；
- `profile-revision-controller.test.ts`的active转draft测试；
- `profile-revision-controller.test.ts`的连续修订抵消测试。

失败目标文件和测试项每次不同；对应测试单独复跑通过，完整`npm test`随后 387/387 通过。保持代码、依赖和断言不变，仅把`TEMP/TMP`切换为独立工作树内专用临时目录后，完整`verify`一次性通过。因此本报告把它登记为Windows文件系统/安全软件环境噪音，不归为A的V2-4或V2-5缺陷，也不删除失败证据。

## 3. V2-4：诊断与学情

| 合同检查项 | 结果 | E 独立证据 |
|---|---|---|
| 完整 Evidence/KnowledgeState/LearnerDiagnostic | PASS | 完整Evidence、nullable mastery、五种状态、可复算字段和不可变诊断快照测试通过。 |
| 五个 KnowledgeState 手算示例 | PASS | 无证据、单条固定诊断、两种一致证据、冲突证据和`evaluator_error`五例均通过。 |
| 无证据语义 | PASS | `mastery=null`、`confidence=0`、`status=unverified`，未用0伪装掌握度。 |
| 全对 | PASS | E端到端补测完成两题并提交，两个KnowledgeState的mastery均为1。 |
| 全错 | PASS | E端到端补测完成两题并提交，两个KnowledgeState的mastery均为0，未伪装成skip。 |
| 显式跳过 | PASS | `skip`返回`skipped`，不创建Evidence、不写0分；部分跳过、全部跳过、不足知识点去重和已有Evidence后跳过均通过。 |
| 退出恢复 | PASS | 保存draft后构造新运行时实例，使用同一持久化会话继续答题并完成诊断。 |
| 同请求重放 | PASS | 相同请求、相同内容返回同一首次结果；并发重放也保持稳定。 |
| 不同请求冲突 | PASS | 同题新`requestId`返回`diagnostic_answer_conflict`；跨题复用同一`requestId`且内容不同返回`idempotency_conflict`。 |
| 并发首次提交 | PASS | E复跑旧包失败反例：同题两个不同请求并发时仅一个成功，首次结果未被覆盖。 |
| 严格`answer/skip`联合 | PASS | 缺失/未知action、`skip`携带answer、`answer`缺answer均返回`diagnostic_answer_invalid`。 |
| 完成事务失败 | PASS | `beforePublish`注入中断后，正式快照仍为旧版本且无Evidence；同一完成请求重试后只提交一次。 |
| 批量版本 | PASS | 有答题Evidence时整批共享一个新`evidenceVersion`；全跳过时Evidence版本不变、session版本只加一次。 |
| 非 Pandas 扩展性 | PASS | JavaScript主题revision 2 fixture可按同一公共Schema加载。 |
| 逐题安全输出 | PASS（本轮范围） | 逐题输出不公开`evidenceId`或正确答案；正式V2-7仍按D4/D6范围单独执行。 |

V2-4结论：`PASS`。

## 4. V2-5：仓储事务骨架

| 合同检查项 | 结果 | E 独立证据 |
|---|---|---|
| 四类仓储能力 | PASS | `create/getSnapshot/commit/recover`接口和文件实现存在并通过测试。 |
| 正式状态唯一发布者 | PASS | `create`只初始化，`getSnapshot`只读，只有`commit`发布正式Evidence、KnowledgeState、诊断快照和版本。 |
| `latest.json`发布边界 | PASS | 提交标记最后写入；标记发布前读取者仍看到旧快照。 |
| 单项/批量约束 | PASS | 单项与批量Evidence互斥；空批量拒绝；诊断批量必须携带诊断候选。 |
| 版本和幂等 | PASS | 陈旧版本、同请求不同内容和已处理题的新请求均返回合同错误。 |
| 正常中断恢复 | PASS | 发布前中断留下的完整候选可由`recover`补提交，版本只推进一次。 |
| 候选语义闭合 | PASS | 候选保存格式版本、原始提交输入和可复算`inputHash`；恢复前重新构建完整预期事务。 |
| JSON合法但语义损坏 | PASS | input hash、缺失原始输入、Evidence路径、KnowledgeState、Diagnostic、session版本、snapshot Evidence尾部和response闭合共8类损坏均进入`quarantine`。 |
| 独立语义反例 | PASS | E另外把嵌套`KnowledgeState.profileRevision`改为999，候选被隔离且正式session版本保持不变。 |
| 失败无正式半写入 | PASS | 无效候选和发布中断均未推进`latest.json`，正式Evidence、KnowledgeState和诊断快照未对读取者公开。 |

V2-5结论：`PASS`。

## 5. 越权和敏感边界

| 检查项 | 结果 | E 独立证据 |
|---|---|---|
| 不修改A文件 | PASS | E只在仓库外临时副本运行测试并更新本报告，没有修补A实现。 |
| 不提前实现路径 | PASS | 候选没有新增`PathEngine`或调用`buildPath`。Facade已有声明不等于本轮实现或调用。 |
| 不修改依赖/SDK | PASS | 包内没有`package.json`、锁文件、SDK源码或SDK哈希修改。 |
| 不接后续能力 | PASS | 未发现React、Monaco、真实模型、Agent提示词或第三周路径实现。 |
| 私有答案边界 | PASS（本轮范围） | 答案键只用于服务端确定性判分；普通逐题输出没有答案或Evidence ID。 |
| 正式V2-7 | 未执行 | 本报告只覆盖A的D2-D3 V2-4/V2-5修复包。D录制响应、安全导出、普通日志和完整安全DTO的canary扫描仍按D4/D6执行。 |

## 6. E结论和后续动作

```text
审计人：岗位E
审计基线：f16399089938f79d07ff6a4dafacb8442cdb91d5
W2_START_COMMIT：f343a6c1c630f362f4686e6f6b0f50c6577d5562（当前HEAD祖先）
审计包：A-W2-D1-D3-E-audit-package-f163990-r2.zip
审计包SHA-256：c27073b5c71929cc1f799d2ed60e220e049e669964298ed55745fc60a2b4922b
MANIFEST.sha256：PASS，25/25

V2-4：PASS
V2-5：PASS
V2重点测试：6文件，45/45 PASS
E独立旧缺陷反例：2/2 PASS
E端到端诊断矩阵：4/4 PASS
全量回归：36文件，387/387 PASS
typecheck：PASS
verify：PASS（专用TEMP/TMP；默认系统临时目录EPERM噪音已留痕）
git diff --check：PASS

公共合同缺口：NONE（仅指本报告覆盖的V2-4/V2-5）
需要A继续修复的文件：NONE（本轮审计范围）
是否因V2-4/V2-5阻止A申请上传锁：NO
```

本报告只解除r2包在V2-4/V2-5上的技术阻塞，不代表V2-2、V2-3、V2-6、V2-7、V2-8或第二周总门禁通过，也不授予上传锁。

当前日期为2026-08-01，27号规定的A正常D3上传时段已经过去。E无权把本报告改写成D6补传授权。负责人应根据当前上传锁、B/C/D/E实际提交状态和下游候选绑定情况，书面决定A是否进入条件补传流程；若A提交发生变化，E必须基于正式提交重新执行受影响的V2-4/V2-5，B/C/D/E所有绑定旧A基线的候选和报告也必须按合同复核。
