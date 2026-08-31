下面内容可以直接发送给岗位 A。

---

你现在处理第四周 `W4-D1-A` 候选的一次性整改。请先完整重读：

- `第一周任务/20-第一周开发前负责人决策冻结清单.md`中的 D48-D60
- `第四周任务/42-第四周公共合同总册.md`
- `第四周任务/41-第四周总任务布置与权限边界.md`
- `第四周任务/43-岗位A第四周任务书.md`

当前事实：

```text
合同：W4-C2 / W4-R1
W4_START_COMMIT：ac6e307e17cf84450845dfc5ffa467063dd3ae4c
整改基线HEAD：dc23504c3f353883d4f665e64a47cee9afb5723a
原审计包：W4-D1-A-audit-dc23504.zip
原包SHA-256：
7f6a2f231f617872647c3e1a363cb94b65b934f9716f4dbb0a76969146cada6f

当前结论：BLOCKED / UPLOAD_LOCK_NOT_GRANTED
```

这次只允许基于现有候选做最小整改。不构成 `commit`、`push`、上传锁或W4 GO授权。

## 一、已经通过并必须保持不变

以下能力已独立复验，不得重写或扩大范围：

1. 原审计ZIP、manifest、41项候选文件的SHA-256和字节数闭合。
2. 未发现修改Web、HTTP、B正式资产、gold、SDK、依赖、锁文件、真实Key或私有答案。
3. 原A定向测试 `17 files / 131 tests`通过。
4. 题组4/5/6题阈值、整组Evidence、一次不重题重试、`insufficient`不产生Evidence、seal复算和候选事务主体已经通过定向验证。
5. 在批准环境 `Node v22.23.1 / Python 3.13.7 / Pandas 3.0.5 / win32-x64`下，评测器相关三组测试已独立复验为 `35/35 PASS`。
6. 不修改revision 2冻结资产、正式环境锁、TaskBundle、Rubric、hidden tests、reference solutions和gold。
7. 不修改 `package.json`、`package-lock.json`、SDK、依赖版本或 `allowScripts`。

## 二、必须一次性整改的问题

### 【A-W4-D1-01】诊断CAS及完成事务错误

【级别】`CONFIRMED_BLOCKER`

【证据位置】

- `src/contracts/facade.ts`
- `src/application/diagnostic-runtime.ts`
- `src/repositories/file-learning-session-repository.ts`
- `tests/diagnostic-runtime.test.ts`

【实际问题】

- `saveDiagnosticDraft`、`submitDiagnosticAnswer`、fixed `completeDiagnostic`允许省略`diagnosticDraftVersion`。
- 运行时缺省后使用服务端当前版本，绕过客户端CAS。
- `background_only`仅写诊断草稿，再由读取逻辑临时投影为`stage=path`。
- 它没有通过正式会话事务递增`sessionVersion`。
- 现有测试错误地断言完成后`sessionVersion`仍为1。

【必须修改】

1. 三个写入口的`diagnosticDraftVersion`必须为必填字段，不得使用服务端当前值自动补齐。
2. 缺字段必须在类型或输入校验阶段拒绝；陈旧版本必须返回版本冲突，不写任何状态。
3. `saveDiagnosticDraft`和`submitDiagnosticAnswer`只递增`diagnosticDraftVersion`，不得递增`sessionVersion`。
4. fixed与`background_only`完成诊断都必须通过正式会话事务进入`path`阶段并递增`sessionVersion`。
5. `background_only`不得新增Evidence，不得伪造0分、`diagnosticId`或KnowledgeState。
6. `background_only`必须保持原`evidenceVersion`，返回现有或空KnowledgeState以及正确的`insufficientKnowledgePointIds`。
7. 删除“读取草稿时根据`completedMode`临时把stage投影为path”的伪正式状态。
8. 相同`requestId`和相同输入重复完成必须返回同一正式结果；同一`requestId`不同输入必须幂等冲突。

【强制测试】

- 缺少`diagnosticDraftVersion`不能调用成功。
- 草稿版本陈旧时，正式快照、两个版本、Evidence和stage均不变化。
- 保存草稿只增加草稿版本。
- fixed完成后`sessionVersion + 1`且stage为path。
- `background_only`完成后`sessionVersion + 1`且stage为path，但Evidence集合和版本不变。
- 重启仓储后恢复结果必须与完成事务后的正式快照一致。

### 【A-W4-D1-02】活动公共DTO不是判别联合

【级别】`CONFIRMED_BLOCKER`

【证据位置】`src/contracts/facade.ts`

【必须修改】

1. `openActivity`输出必须使用外层`kind: "code" | "quiz"`判别联合。
2. 代码打开分支只返回代码字段；题组分支不得返回`draftVersion/userText`等代码草稿字段。
3. `SubmitActivityInput`两个分支的`kind`均必须为必填字面量。
4. 提交输出必须按外层kind收窄：code对应W3 `ActivityResult`，quiz对应`QuizActivityResult`。
5. Attempt安全视图必须有外层kind，`result`必须随kind收窄。
6. `ComposedLearningRuntimeFacade`必须按判别字段穷尽分发，不得依赖字段猜测、`as never`或运行时强转。
7. C/E只需导入contracts，不得复制DTO或导入`src/application`内部类型。

【强制测试】

- 使用`expectTypeOf`或穷尽`switch`证明两个分支可以编译期收窄。
- code输入缺kind、quiz输入缺kind均不能通过类型检查。
- 两种打开响应不得混入另一分支专属字段。
- Attempt的kind与result不匹配时必须被类型或运行时校验拒绝。

### 【A-W4-D1-03】Bootstrap及恢复安全DTO不符合合同

【级别】`CONFIRMED_BLOCKER`

【证据位置】

- `src/contracts/index.ts`
- `src/contracts/facade.ts`
- `src/application/app-bootstrap-facade.ts`
- `tests/app-bootstrap-facade.test.ts`

【必须修改】

1. `AppBootstrapSafeView.diagnostic`必须是合同定义的结构化`DiagnosticSafeEnvelope`，不得是数组或`envelope?: unknown`。
2. 诊断题必须逐字段白名单投影，不能通过递归删除若干黑名单字段后返回任意JSON。
3. 非法诊断资产必须明确失败，不能静默透传未知结构。
4. `SessionRecoverySafeView.currentAttempt`必须包含：
   - `activityId`
   - `attemptId`
   - `status: draft | submitted | evaluator_error`
   - 代码草稿恢复所需的`draftVersion`
5. 安全的额外`retryNumber`可以保留，但不能代替必填字段。
6. `PathNodeSafeView`的`difficulty/scaffold/required/positionLocked`在W4必须为必填。
7. Bootstrap返回的诊断、草稿、路径、进度和Attempt不得包含hidden tests、Rubric、答案键、参考实现、宿主绝对路径或任意内部事务字段。

【强制测试】

- 合法诊断资产得到精确`DiagnosticSafeEnvelope`。
- 在资产中增加未知敏感字段、嵌套答案字段和内部路径，Bootstrap输出均零命中。
- 代码草稿、submitted和evaluator_error三种Attempt均能在重启后恢复。
- 对Bootstrap、recover以及其他返回同类DTO的出口使用同一字段白名单断言。
- 四个路径字段缺失时测试必须失败，不能以`undefined`通过。

### 【A-W4-D1-04】revision 3错误强制辅助知识点闭合题组

【级别】`CONFIRMED_BLOCKER`

【证据位置】`src/domain/profile-v2-schema.ts`

【必须修改】

1. revision 2仍缺省`select_one`，保持原字节和行为兼容。
2. revision 3只要求六个核心目标知识点具备：
   - `all_in_order`
   - `contentEstimatedMinutes`
   - 唯一固定卡片
   - mcq活动
   - 完整fixed组
   - 1至2道supplemental题
3. `basic-python`等辅助知识点可以保持辅助语义，不得被强制要求完整卡片和题组。
4. 不得硬编码`basic-python`或六个Pandas知识点ID。
5. 使用现有Profile目标关系识别目标核心集合，不新增公共字段或第二套Schema。
6. 卡片数量和题组闭合校验应针对核心目标集合，不应简单等于全部知识点数量。
7. 最终综合实操仍必须保留为目标必做活动。

【强制测试】

- 合成revision 3包含“六个核心目标点 + 一个辅助先修点”时必须通过。
- 六个核心点任一点缺卡片、题组或`all_in_order`时必须失败。
- 辅助点没有卡片或题组时仍应通过。
- 不存在的知识点引用、重复卡片、错误估时和题组引用仍必须失败。
- revision 2回归继续通过。

### 【A-W4-D1-05】原生typecheck和Web类型边界回归

【级别】`CONFIRMED_BLOCKER`

【实际问题】

- 正式HEAD原生typecheck可通过，候选叠加后失败。
- 公共contracts反向导入`path-engine.ts`和`profile-revision-seal.ts`等运行时模块。
- Web类型闭包因此拖入`node:crypto`、`node:fs`、`node:path`、`Buffer/process`。
- 显式引用SDK嵌套私有`@types/node`不能代替正式门禁。

【必须修改】

1. contracts必须成为浏览器可消费的纯类型叶子边界。
2. contracts不得反向依赖Node-only运行时实现模块。
3. 共享公共类型只保留一个权威定义；运行时模块应依赖公共类型，不能复制第二套类型。
4. 不得通过给Web工程增加Node全局类型掩盖边界问题。
5. 不得引用`node_modules`中某个依赖的私有安装路径。
6. 不得修改依赖、锁文件或SDK。

【强制门禁】

以下三条必须分别运行并记录退出码，不能只报告聚合命令首个失败：

```powershell
tsc --noEmit
tsc -p tsconfig.test.json
tsc -p tsconfig.web.json
```

三项都必须通过，然后再运行`npm.cmd run typecheck`。

### 【A-W4-D1-06】卡片确认链被无条件绕过

【级别】`CONFIRMED_BLOCKER`

【证据位置】

- `src/contracts/facade.ts`
- `src/application/code-activity-facade-adapter.ts`
- `src/application/quiz-activity-runtime.ts`
- `src/application/path-learning-facade.ts`

【实际问题】

- `OpenActivityInput`没有`acknowledgedCardId`。
- code和quiz打开活动时，只要卡片为pending就自动改成acknowledged。
- 没有校验用户确认的是当前服务端返回的真实卡片ID。
- 无法实现错误ID生命周期冲突和重复确认幂等。
- 当前路径初始化还存在根据知识点拼接卡片ID的风险。

【必须修改】

1. `OpenActivityInput`按合同支持`acknowledgedCardId`。
2. 卡片ID必须来自实际卡片资产或服务端当前返回的卡片，不得假定为`card-${knowledgePointId}`。
3. 当前节点有pending卡片时，缺少确认ID不得直接打开活动。
4. 正确ID必须在同一会话事务中确认卡片并打开首个活动。
5. 错误ID必须返回生命周期冲突，且不创建Attempt、不推进活动、不修改卡片状态。
6. 重复确认同一卡片必须幂等，不重复创建Attempt或增加版本事实。
7. 卡片确认不得产生ActivityResult、Evidence或第三种提交结果。
8. revision 2或无卡片节点仍按兼容路径打开活动。

【强制测试】

- 正确卡片ID确认并打开code和quiz各一例。
- 缺ID、错误ID、上一节点ID和陌生ID均被拒绝且正式状态不变。
- 相同请求重复确认返回同一结果。
- 已确认卡片刷新后可继续打开活动，不重复产生Attempt。
- 只确认卡片不产生Evidence。

### 【A-W4-D1-07】背景问卷保存与恢复形状不一致

【级别】`CONFIRMED_BLOCKER`

【证据位置】

- `src/contracts/facade.ts`
- `src/contracts/index.ts`
- `src/application/diagnostic-runtime.ts`
- `src/repositories/file-learning-session-repository.ts`

【实际问题】

- 保存入口使用`DiagnosticDraftField[]`。
- 恢复入口只接受对象形状的`BackgroundQuestionnaire`。
- 数组保存后不能通过`isRecord`恢复。
- 现有测试保存空数组后直接传入另一个对象完成诊断，绕开了刷新恢复主链。

【必须修改】

1. W4背景问卷在公共输入、内部持久化和安全恢复中统一使用同一个结构化`BackgroundQuestionnaire`对象。
2. 不得一边保存字段数组、一边只恢复对象。
3. 保存时按三个冻结字段进行白名单校验，拒绝缺字段、非法枚举和额外敏感字段。
4. `background_only`完成前必须存在由`saveDiagnosticDraft`保存的最新背景问卷，不得绕过草稿保存。
5. 完成输入与最新草稿不一致时返回明确冲突，不能静默覆盖。
6. 重启后恢复的对象必须与保存对象字段相同。

【强制测试】

完整执行以下真实流程：

```text
startSession
→ saveDiagnosticDraft(BackgroundQuestionnaire)
→ 重建仓储/Facade模拟刷新
→ Bootstrap或recover恢复
→ completeDiagnostic(background_only)
```

断言背景对象完整、草稿版本连续、正式完成版本正确、无Evidence产生。

### 【A-W4-D1-08】审计证据和报告不自洽

【级别】`CONFIRMED_REQUIRED`

【必须修改】

1. 不再把Python/Pandas测试写成`ENVIRONMENT_BLOCKED`。
2. 在批准环境中复跑并记录：
   - Node `v22.23.1`
   - Python `3.13.7`
   - Pandas `3.0.5`
   - 实际`node.exe/python.exe`路径
3. 原生typecheck及verify必须记录真实结果，不能用私有Node类型替代命令覆盖。
4. `tracked-changes.patch`重新生成为LF、无BOM，并通过普通`git apply --check`。
5. 若该补丁只包含已跟踪文件，文件名和报告必须明确其范围；新增文件仍由candidate-files、manifest和逐文件哈希完整覆盖，不得声称该patch代表全部41项。
6. 报告统一写明：
   - 已生成负责人审计ZIP；
   - 尚未生成或上传正式提交包；
   - `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`。
7. 保留首次失败事实并登记整改后复跑结果，不得删除失败记录制造整洁PASS。
8. 更新文件清单、manifest、逐文件SHA-256、ZIP SHA-256和交接单，所有数量必须与新包一致。

## 三、横向闭合要求

修复后逐项检查：

- 公共输入进入内部时不丢字段、不自动补CAS、不越权造状态。
- 内部快照通过Bootstrap、recover、commit和Attempt出口时使用一致安全白名单。
- 所有失败路径均保持正式版本、Evidence、路径、卡片和Attempt不变。
- 类型声明必须真实对应运行时行为，禁止`as never`、`unknown`透传或具体仓储强转掩盖能力。
- revision 2兼容、题组判分、重试、seal和路径后缀不得因整改回归。
- 更新`public-exports.md`、事务故障矩阵、验证报告及`handoff-w4-a-d1.md`。

## 四、允许和禁止修改范围

允许修改：

```text
pi-study-helper/src/contracts/
pi-study-helper/src/application/ 中A所有模块
pi-study-helper/src/domain/ 中A所有模块
pi-study-helper/src/repositories/ 中A所有模块
pi-study-helper/tests/ 中对应A测试
pi-study-helper/scripts/w4-a-validation/
新版设计文档-重写版/第四周任务/handoff-w4-a-d1.md
```

禁止修改：

```text
src/web/
HTTP服务器和启动器
B的Profile正式内容和私有答案
模型提示词、录制响应和Agent实现
W3环境锁
TaskBundle、Rubric、hidden tests、reference solutions
gold和负责人只读材料
SDK、package.json、package-lock.json、依赖版本和allowScripts
其他岗位文件和本地历史审计材料
```

不得为了修复问题做无关重构、生产级扩展或新增公共合同。

## 五、必须运行并如实报告

先在当前进程临时绑定批准环境，不修改系统环境变量：

```powershell
$env:PATH="<批准Python虚拟环境Scripts>;<批准Node v22.23.1目录>;$env:PATH"
where.exe node
where.exe python
node --version
python -c "import platform,pandas; print(platform.python_version()); print(pandas.__version__)"
```

然后运行：

```powershell
npm.cmd test -- --run <本次问题对应定向测试> --maxWorkers=1
npm.cmd test -- --run tests/python-process-evaluation.test.ts tests/python-process-evaluation-r2.test.ts tests/w3-b-d1-delivery.test.ts --maxWorkers=1
npm.cmd test -- --run --maxWorkers=1
tsc --noEmit
tsc -p tsconfig.test.json
tsc -p tsconfig.web.json
npm.cmd run typecheck
npm.cmd run check:docs
npm.cmd run smoke:extension
npm.cmd run verify
git diff --check
git status --short
git apply --check "<新包中的tracked-changes.patch>"
```

若全量测试仅出现既有W2 `V2-6`外层30秒预算超时，不得改W2测试或把它写成PASS；应同时直接运行V2-6实际验证命令，分别记录聚合超时和实际验证结果。瞬时Windows `rename EPERM`必须隔离复跑后再归因。

## 六、重新交付

重新提交负责人审计包，至少包含：

- 修改后的源码和测试；
- `A-W4-D1-01`至`08`与测试用例的映射表；
- 更新后的`public-exports.md`；
- 更新后的事务故障矩阵；
- 完整命令、工作目录、时间、退出码和实际测试统计；
- 更新后的W4-A验证报告；
- 更新后的`handoff-w4-a-d1.md`；
- candidate-files完整文件；
- manifest、逐文件SHA-256及新ZIP SHA-256；
- 实际HEAD、`git status --short`和拟提交路径清单。

ZIP不得包含旧ZIP、`node_modules`、`.demo-data`、真实Key、私有运行数据、整库副本、其他岗位文件或Git元数据。

## 七、停止条件

遇到以下任一情况立即停止并报告负责人，不得自行选择新语义：

- 需要修改SDK、依赖、锁文件、Web、HTTP或B正式内容才能完成；
- 现行合同无法确定核心知识点识别方式；
- 发现其他active revision或不同seal，需要迁移；
- HEAD或正式上游发生变化；
- 必须新增公共字段或改变其他岗位接口才能修复；
- 批准Node/Python/Pandas环境确实不可用。

整改完成后保持：

```text
NOT_COMMITTED
NOT_PUSHED
uploadLock=NOT_GRANTED
```

只提交新的候选审计包申请负责人复核。负责人明确授予上传锁前，不得commit或push。