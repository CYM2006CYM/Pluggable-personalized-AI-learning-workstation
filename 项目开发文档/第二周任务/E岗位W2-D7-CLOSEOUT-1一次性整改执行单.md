# E岗位W2-D7-CLOSEOUT-1一次性整改执行单

状态：`[负责人正式整改指令，待E执行]`

适用范围：第二周`final-001`至`final-020`收口，不扩展到第三周。

合同身份：`W2-C2/W2-R5 + W2-V2-3-ENV-1 + W2-GOLD-AUTH-CORR-1 + W2-D7-CLOSEOUT-1`。
最低生效祖先：`e7136b320f2ce28edc0185dcf52c9d0e67288f7c`。E执行前必须拉取最新`origin/main`，实际HEAD必须包含该提交以及本执行单进入`main`后的提交。

## 1. 权威依据与阅读位置

E不得只根据聊天记录、旧ZIP或旧版`W2-验证记录.md`整改。执行前必须按下表逐项阅读：

| 顺序 | 权威位置 | 本次必须消费的内容 |
|---|---|---|
| 1 | [20号决策清单：`W2-D7-CLOSEOUT-1`](../第一周任务/20-第一周开发前负责人决策冻结清单.md#w2-d7-closeout-1-第二周e交付一次性收口补充) | B声明沿用、V2-3负责人不降标确认、V2-7六输入、E时间证据、跳过协商 |
| 2 | [28号合同：第8.2节](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充) | 普通日志和安全导出的固定结构、原两输入哈希、新六输入证据、V2-8状态 |
| 3 | [06号：第7.5节“验证性测试清单”](../06-六周MVP范围与验收.md#75-验证性测试清单) | V2-1至V2-8最终硬标准 |
| 4 | [27号：第6、7、9节](./27-第二周总任务布置与权限边界.md) | D7顺序、六输入审计关系、上传锁报告字段 |
| 5 | [33号E任务书：任务4、9、11及交付物](./33-岗位E第二周任务书.md) | E可改范围、状态改写、机械差异清单和最终交付 |
| 6 | 本执行单 | 当前交付缺口、准确文件路径、命令和一次性交付清单 |

如果旧草案与上述条款冲突，以20号、28号和本执行单为准；不得继续等待已经被负责人裁决免除的C确认，也不得把已授权E构造的测试视图写成“待材料所有者提供”。

## 2. 本轮审计已经确认的事实

负责人已独立读取`W2-D7-E-2`四个ZIP，确认以下内容无需重做：

1. `e-first-20.jsonl`共20行，覆盖`final-001`至`final-020`，每行严格使用合同六字段，`annotatorRole`均为`E`，SHA-256为`36c82c20e891d15b797a32415c365c55bf27adc4748142d782eb2ab80888545d`。
2. E封存声明保留了真实时间链，没有伪造精确开始时间；冻结JCS使用`6e99fc788037c7f9bda72f5d7eeffcc51b1c0a35ee216e635447543882bf2504`。
3. B独立性声明已经存在。旧JCS`7d80d2fe78299326e624c10cf75301191119fe061a48ab6f1d2a5d7a84191672`只按授权元数据勘误为新JCS，不要求B重做声明或标注。
4. 原V2-7 canary和两输入结果原件已经补交，目标SHA-256分别匹配`59018cc6734d09eddbb0271bac0ab9e9de9f2823b77f4eafc9554d58735f38e1`和`3ee729099433c8c396f538e0d3f14a638c1adbd8c88ff924431b01e67bf2a1fd`。这只关闭“历史原件缺失”，不能替代六输入完整V2-7。
5. 七件E工具已出现于交付包，但最终交接仍必须给出规范路径和逐文件SHA-256。

以下旧结论立即作废：

- `V2-3=BLOCKED，等待C不降标确认`；
- `ordinary log/safe export等待材料所有者提供`；
- `C/D verification report范围未冻结或尚未提供`；
- `本批仍需B/E协商`；
- 以`6a76d96813516251950de443920102ca48a3b83d`作为最终复验HEAD。

## 3. 执行顺序

### 3.1 拉取并确认合同基线

> **对应合同索引**
>
> - [28号第0.2节“不可变周起点与工作HEAD”](./28-第二周公共合同总册.md#02-不可变周起点与工作head)：区分固定`W2_START_COMMIT`和实际工作HEAD。
> - [28号第8.3节第1项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：最终HEAD必须包含`e7136b3`和本执行单。
> - [27号第5节“单仓库上传规则”](./27-第二周总任务布置与权限边界.md#5-单仓库上传规则)及[第9节“统一交付格式”](./27-第二周总任务布置与权限边界.md#9-统一交付格式)：拉取、祖先关系、实际HEAD和上传锁报告字段。
> - [33号“D7一次性整改检查表”第1项](./33-岗位E第二周任务书.md#d7一次性整改检查表)：E执行前的强制拉取检查。

```powershell
git fetch origin main
git pull origin main
git merge-base --is-ancestor e7136b320f2ce28edc0185dcf52c9d0e67288f7c HEAD
git rev-parse HEAD
```

要求：祖先检查退出码为0。E在所有最终记录中同时登记：

```text
W2_START_COMMIT=f343a6c1c630f362f4686e6f6b0f50c6577d5562
W2_D7_CLOSEOUT_MIN_COMMIT=e7136b320f2ce28edc0185dcf52c9d0e67288f7c
ACTUAL_VERIFICATION_HEAD=<拉取后的完整HEAD>
```

不得把`e7136b3`写成`W2_START_COMMIT`，也不得继续使用`6a76d968...`作为最终复验HEAD。

### 3.2 改正V2-3状态

> **对应合同索引**
>
> - [20号`W2-D7-CLOSEOUT-1`补充中V2-3负责人确认条款](../第一周任务/20-第一周开发前负责人决策冻结清单.md#w2-d7-closeout-1-第二周e交付一次性收口补充)：负责人替代C完成不降标确认。
> - [28号第8.2节第4项](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充)及[第8.3节第2项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：固定`OWNER_NO_LOWERING_CONFIRMATION / V2-3=PASS`。
> - [06号第7.5节V2-3行](../06-六周MVP范围与验收.md#75-验证性测试清单)：本批不要求C重复确认或重跑完整V2-3。
> - [33号“本周任务”第9项](./33-岗位E第二周任务书.md#本周任务)及[D7检查表第2项](./33-岗位E第二周任务书.md#d7一次性整改检查表)：E必须消费负责人确认，不再等待C。

负责人已经完成旧新工具差异核查，正式结论固定为：

```text
OWNER_NO_LOWERING_CONFIRMATION
V2-3=PASS
真实六输入作者测试=26/26 PASS
```

E必须在`W2-验证记录.md`、`handoff-w2-e.md`和状态汇总中删除“等待C确认”“E不得代写，因此BLOCKED”等旧文字，改为消费上述负责人确认。E不需要C补材料，也不得重复要求C运行完整V2-3。

### 3.3 构造V2-7仓库外测试视图

> **对应合同索引**
>
> - [20号`W2-D7-CLOSEOUT-1`补充中V2-7六输入授权条款](../第一周任务/20-第一周开发前负责人决策冻结清单.md#w2-d7-closeout-1-第二周e交付一次性收口补充)：授权E仓库外构造ordinary log和safe export。
> - [28号第8.2节第1、2项](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充)：两类视图固定JSON结构、六输入manifest和C/D报告只读边界。
> - [28号第8.3节第3项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：明确不存在“等待材料所有者提供”的分支。
> - [27号第7节“审计关系”V2-7行](./27-第二周总任务布置与权限边界.md#7-审计关系)及[33号“本周任务”第4项](./33-岗位E第二周任务书.md#本周任务)：六输入、五类表面、不得扫描全仓和不得修改C/D报告。

本次六个输入的来源和表面固定如下：

| 序号 | 输入 | 来源或构造规则 | `surface` | 建议规范化位置 |
|---:|---|---|---|---|
| 1 | safe DTO | `pi-study-helper/fixtures/safe-views/start-session-safe-response.json` | `safe_dto` | `safe-dto/start-session-safe-response.json` |
| 2 | 普通日志 | 从输入1确定性构造 | `ordinary_log` | `ordinary-log/start-session-safe-response.jsonl` |
| 3 | D录制响应 | `pi-study-helper/fixtures/model-responses/w2/recorded-responses.json` | `d_recording` | `d-recording/w2/recorded-responses.json` |
| 4 | 安全导出 | 从输入1确定性构造 | `safe_export` | `safe-export/start-session-safe-response.json` |
| 5 | C报告 | `pi-study-helper/scripts/w2-data-validation/v2-3-final-report.md` | `verification_report` | `verification-report/c/v2-3-final-report.md` |
| 6 | D报告 | `pi-study-helper/fixtures/model-responses/w2/d4-validation-report.md` | `verification_report` | `verification-report/d/d4-validation-report.md` |

输入2固定为单行JSONL：

```json
{"event":"start_session_safe_response","payload":<原safe DTO>}
```

输入4固定为：

```json
{"exportVersion":"w2-safe-export-v1","items":[<原safe DTO>]}
```

要求：从真实safe DTO解析后构造，UTF-8编码；不得手工删除、增加或重命名DTO字段，不得形成生产接口，不得修改C/D报告。上述源文件均来自Git，E不得再登记为“等待负责人或材料所有者提供”。

### 3.4 生成manifest并完整运行V2-7

> **对应合同索引**
>
> - [28号第8.2节第2、3项](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充)：manifest字段、原两输入哈希、新六输入结果与sidecar必须分开登记。
> - [28号第8.3节第3项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：机器结果必须为`inputCount=6`。
> - [06号第7.5节V2-7行](../06-六周MVP范围与验收.md#75-验证性测试清单)：五类表面逐输入六类canary零命中。
> - [27号第7节V2-7审计行](./27-第二周总任务布置与权限边界.md#7-审计关系)、[33号“交付物”](./33-岗位E第二周任务书.md#交付物)及[“验收”第4项](./33-岗位E第二周任务书.md#验收)：仓库外机器证据、哈希、命令和计数的留痕要求。

仓库外生成`v2-7-six-input-manifest.json`，每个输入至少登记：

```text
position
name
surface
normalizedLocation
sourcePath或constructionRule
sha256
```

使用同一份六类非空canary扫描六个输入。运行结果必须单独保存为`v2-7-six-input-result.json`，不得覆盖或冒充原两输入结果。完整V2-7只有同时满足以下条件才能记为PASS：

```text
inputCount=6
surface集合=safe_dto,ordinary_log,d_recording,safe_export,verification_report
六个inputResults全部存在
每个输入的六类canary计数全部为0
汇总六类计数全部为0
status=PASS
进程退出码=0
```

必须提供以下仓库外证据及sidecar：

```text
v2-7-canaries.json
v2-7-canaries.json.sha256
v2-7-available-surfaces-result.json
v2-7-available-surfaces-result.json.sha256
ordinary-log.jsonl
ordinary-log.jsonl.sha256
safe-export.json
safe-export.json.sha256
v2-7-six-input-manifest.json
v2-7-six-input-manifest.json.sha256
v2-7-six-input-result.json
v2-7-six-input-result.json.sha256
```

Git中的`W2-验证记录.md`只登记命令、输入数量、表面、规范化位置、SHA-256、退出码、逐输入和汇总计数、结论及限制；不得写入canary正文，不递归扫描验证记录自身。

### 3.5 负责人双封存资格签署

> **对应合同索引**
>
> - [20号D32条款](../第一周任务/20-第一周开发前负责人决策冻结清单.md#d32-d2d6负载候选冻结和v2-8状态)：覆盖、Schema、冻结绑定、哈希和独立性四项资格条件。
> - [20号`W2-D7-CLOSEOUT-1`时间与B声明条款](../第一周任务/20-第一周开发前负责人决策冻结清单.md#w2-d7-closeout-1-第二周e交付一次性收口补充)：B声明沿用及E时间证据例外。
> - [28号第6.2.2节“原始标注封存与终裁”](./28-第二周公共合同总册.md#622-原始标注封存与终裁)及[第8.2节第5项](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充)：负责人签署前后V2-8状态。
> - [06号第7.5节V2-8行](../06-六周MVP范围与验收.md#75-验证性测试清单)及[33号“本周任务”第8、9项](./33-岗位E第二周任务书.md#本周任务)：签署前`BLOCKED`，签署后`PENDING_OWNER_ADJUDICATION`。

负责人已经独立预核以下事实：B/E均为20行、覆盖`final-001`至`final-020`、使用合同六字段、绑定相同冻结输入、哈希未变，且两份独立性声明均存在。正式状态仍以负责人填写签署栏和确认时间为准。

负责人签署前：

```text
V2-8=BLOCKED
```

负责人四项均签署PASS后：

```text
V2-8=PENDING_OWNER_ADJUDICATION
```

E不得使用`PENDING_OWNER_QUALIFICATION`等合同外状态，也不得在负责人生成三份正式gold前写`V2-8=PASS`。

### 3.6 生成20例机械差异清单

> **对应合同索引**
>
> - [20号`W2-D7-CLOSEOUT-1`最后一项](../第一周任务/20-第一周开发前负责人决策冻结清单.md#w2-d7-closeout-1-第二周e交付一次性收口补充)：取消本批B/E协商，E只生成机械差异，负责人直接终裁。
> - [28号第6.2.2节](./28-第二周公共合同总册.md#622-原始标注封存与终裁)及[第8.2节第5项](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充)：不得覆盖原始标注，不得由E生成正式gold。
> - [06号第7.5节V2-8行](../06-六周MVP范围与验收.md#75-验证性测试清单)：正式gold和哈希登记完成后V2-8才能PASS。
> - [33号“本周任务”第11项](./33-岗位E第二周任务书.md#本周任务)及[“交付物”机械差异项](./33-岗位E第二周任务书.md#交付物)：20例差异清单的岗位边界。

仅在负责人签署双封存资格后执行。文件名固定为`w2-first-20-mechanical-differences.jsonl`，仓库外提交负责人，按`final-001`至`final-020`排序，恰好20行。

比较时忽略`annotatorRole`，只比较：

```text
nodeConstraints
requiredRemediationKnowledgePointIds
forbiddenActions
notes
```

每行固定字段：

```json
{
  "caseId": "final-001",
  "comparisonStatus": "MATCH或DIFFERENT",
  "differingFields": [],
  "bValues": {},
  "eValues": {},
  "negotiationStatus": "SKIPPED_BY_W2-D7-CLOSEOUT-1"
}
```

`bValues/eValues`只包含`differingFields`列出的字段；`MATCH`时三者均为空。E只做机械深比较，不评价哪一方正确、不提出终裁建议、不修改两份原始标注、不生成正式gold。

### 3.7 在最新HEAD执行最终验证

> **对应合同索引**
>
> - [28号第0.2节](./28-第二周公共合同总册.md#02-不可变周起点与工作head)及[第8.3节第1、5项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：实际HEAD、最新`origin/main`和最终五项交付。
> - [06号第7.5节V2-1行](../06-六周MVP范围与验收.md#75-验证性测试清单)：最新HEAD重跑typecheck、全量测试、smoke和`verify`。
> - [27号第9节“统一交付格式”](./27-第二周总任务布置与权限边界.md#9-统一交付格式)：命令、真实项数、已知限制和实际HEAD必须进入报告。
> - [33号“本周任务”第9项](./33-岗位E第二周任务书.md#本周任务)及[D7检查表第10项](./33-岗位E第二周任务书.md#d7一次性整改检查表)：不得复用旧HEAD结果。

在`pi-study-helper/`执行：

```powershell
npm.cmd run verify
```

必须记录实际HEAD、命令、退出码、测试文件数、通过/跳过项数、文档检查数、typecheck、extension smoke和release check真实结果。不得继续复用`6a76d968...`上的39文件/417项旧结果冒充最终结果；若实际结果变化，按新运行如实登记。

## 4. 必须更新的正式文件

### 4.1 `W2-验证记录.md`

> **对应合同索引**
>
> - [06号第7.5节](../06-六周MVP范围与验收.md#75-验证性测试清单)：V2-1至V2-8名称、执行人和硬标准。
> - [28号第9节“W2验证编号”](./28-第二周公共合同总册.md#9-w2验证编号)及[第8.3节第5项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：状态值和最终验证记录要求。
> - [33号“交付物”](./33-岗位E第二周任务书.md#交付物)及[“验收”](./33-岗位E第二周任务书.md#验收)：正式路径、真实命令、哈希和负责人签署边界。

状态必须更新为：

```text
V2-1=PASS（基于拉取后的最新HEAD和新verify）
V2-2=PASS
V2-3=PASS（OWNER_NO_LOWERING_CONFIRMATION）
V2-4=PASS
V2-5=PASS
V2-6=PASS
V2-7=PASS（inputCount=6）
V2-8=PENDING_OWNER_ADJUDICATION（仅在负责人签署后）
```

如果新运行出现真实失败，对应项如实写`BLOCKED`并提供证据，不得为了匹配本表修改断言或结果。

### 4.2 `handoff-w2-e.md`

> **对应合同索引**
>
> - [28号第8.3节第2至5项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：必须删除的旧阻塞和当前状态。
> - [27号第9节“统一交付格式”](./27-第二周总任务布置与权限边界.md#9-统一交付格式)：只保留一份最终交接清单并报告合同标识、HEAD和限制。
> - [33号“交付物”最后一项](./33-岗位E第二周任务书.md#交付物)及[“验收”](./33-岗位E第二周任务书.md#验收)：PASS、BLOCKED、环境噪音和未越权声明。

必须删除下列过期阻塞：等待C不降标确认、等待普通日志、等待安全导出、等待C/D报告、等待B声明、需要B/E协商。交接清单必须改为当前真实状态，并明确E未生成正式gold、Profile仍为`draft`。

### 4.3 七件工具SHA-256清单

> **对应合同索引**
>
> - [27号第9节“统一交付格式”](./27-第二周总任务布置与权限边界.md#9-统一交付格式)：文件清单、作者测试和哈希报告要求。
> - [33号“本周任务”第3、11项](./33-岗位E第二周任务书.md#本周任务)：D3工具基线及D7修复前后哈希。
> - [33号“交付物”](./33-岗位E第二周任务书.md#交付物)及[“验收”第3项](./33-岗位E第二周任务书.md#验收)：七件工具必须可由规范路径和逐文件SHA-256追溯。

逐文件登记规范路径和SHA-256，不能只登记其中三件：

```text
evaluation/claims/claim-split-template.md
pi-study-helper/scripts/evaluation-metrics.mjs
pi-study-helper/scripts/w2-verification/v2-6-preconditions.mjs
pi-study-helper/scripts/w2-verification/v2-6-preconditions.test.mjs
pi-study-helper/scripts/w2-verification/v2-7-asset-isolation.mjs
pi-study-helper/scripts/w2-verification/v2-comprehensive-verification.mjs
pi-study-helper/scripts/w2-verification/v2-comprehensive-verification.test.mjs
```

## 5. E一次性最终交付

> **对应合同索引**
>
> - [28号第8.3节第5项](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：机械差异、验证记录、交接、七件工具哈希和最新`verify`五项交付。
> - [27号第9节“统一交付格式”](./27-第二周总任务布置与权限边界.md#9-统一交付格式)：上传锁申请和最终归档格式。
> - [33号“交付物”](./33-岗位E第二周任务书.md#交付物)及[D7检查表](./33-岗位E第二周任务书.md#d7一次性整改检查表)：E完整交付边界和逐项完成条件。

E向负责人一次性交付以下五组内容：

1. `w2-first-20-mechanical-differences.jsonl`及SHA-256；
2. 更新为V2-3 PASS、V2-7 PASS、V2-8待终裁的`W2-验证记录.md`；
3. 删除全部过期阻塞后的`handoff-w2-e.md`；
4. 七件工具规范路径、逐文件SHA-256和精确文件清单；
5. 基于最新`origin/main`实际HEAD重新执行的`verify`原始结果摘要和SHA-256。

同时保留并随审计包提供：哈希不变的`e-first-20.jsonl`、E封存声明、原V2-7 canary/两输入结果、新六输入manifest/机器结果及全部sidecar。交付目录和ZIP分包方式不作要求，但文件名、内容身份和哈希必须无歧义。

## 6. 禁止事项

> **对应合同索引**
>
> - [27号第3节“统一红线”](./27-第二周总任务布置与权限边界.md#3-统一红线)及[第4节“文件所有权”](./27-第二周总任务布置与权限边界.md#4-文件所有权)：不得越权修改其他岗位文件或敏感资产边界。
> - [28号第8.2节](./28-第二周公共合同总册.md#82-w2-d7-closeout-1证据与执行补充)：仓库外证据、C/D只读报告和E不得生成正式gold。
> - [33号“执行边界”](./33-岗位E第二周任务书.md#执行边界)及[“验收”](./33-岗位E第二周任务书.md#验收)：不得降标、扩大排除、安装依赖或擅自提交推送。

- 不修改B/E原始标注；
- 不要求B或C重做已经被负责人豁免的工作；
- 不修改A/B/C/D源码或报告来使E测试通过；
- 不扫描整个源码仓库，不回显canary或敏感正文；
- 不生成`difficulty-gold.jsonl`、`path-constraints.jsonl`或`adjudication-log.jsonl`；
- 不把V2-8提前写成PASS；
- 不安装依赖、不修改`package.json/package-lock.json`、SDK哈希或`allowScripts`；
- 不提交、不推送，直至负责人复核并授予上传锁。

## 7. E回报模板

> **对应合同索引**
>
> - [27号第9节“统一交付格式”](./27-第二周总任务布置与权限边界.md#9-统一交付格式)：固定周起点、实际HEAD、补充裁决、测试、限制和提交状态。
> - [28号第8.3节](./28-第二周公共合同总册.md#83-e岗位d7整改的唯一执行入口)：V2-3、V2-7、V2-8和最终五项交付的准确口径。
> - [33号D7检查表](./33-岗位E第二周任务书.md#d7一次性整改检查表)及[“验收”](./33-岗位E第二周任务书.md#验收)：E提交前的最终自检和负责人复核边界。

```text
ACTUAL_VERIFICATION_HEAD:
e7136b3祖先检查:

V2-3:
OWNER_NO_LOWERING_CONFIRMATION / PASS

V2-7:
inputCount=6
surfaceCount=5
逐输入六类计数=全部0
汇总计数=全部0
exit=0
结果SHA-256=
manifest SHA-256=

双封存资格:
负责人签署状态=
V2-8=PENDING_OWNER_ADJUDICATION或BLOCKED

机械差异清单:
20行
MATCH数量=
DIFFERENT数量=
SHA-256=

七件工具:
清单=7/7
逐文件SHA-256=已附

verify:
exit=
测试文件数=
passed/skipped=
typecheck=
docs=
smoke=
release=

提交状态=NOT_COMMITTED
推送状态=NOT_PUSHED
```
