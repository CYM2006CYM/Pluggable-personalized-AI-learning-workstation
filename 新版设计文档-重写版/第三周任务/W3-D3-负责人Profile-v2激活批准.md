# W3-D3负责人Profile v2激活批准

状态：`[负责人已签署；以本文件首次进入origin/main的提交为生效锚点]`。执行记录标识：`W3-D36-PROFILE-ACTIVATION-1`。签署时间：`2026-08-09T02:33:42+08:00`。现行合同保持`W3-C4/W3-R2`；本文执行20号D36，不新增决策编号，不修改公共类型、Profile资产或上传顺序。

## 1. 审计结论

负责人对当前Git候选中的B正式TaskBundle、C正式环境锁及其绑定关系完成D3激活前复核，结论为`PASS`。自本文生效后，允许A拉取批准提交，并通过Profile仓储事务激活`pandas-cleaning` revision 2。

本批准只解除A开始Profile v2事务激活的输入门禁，不表示Profile已被负责人手工设为active，不代替A的候选重验、旧active归档、新active发布、失败回滚、D3作者证据、上传锁或负责人后续验收。

## 2. Git与合同绑定

```text
contract = W3-C4/W3-R2
decision = D36
auditRecord = W3-D36-PROFILE-ACTIVATION-1
W3_START_COMMIT = f190326a4a906b46e4001484ffa30a7839b82ed2
auditHead = 6773d99fc1f4c87dc816e44a48d9fac624a9b2b9
bFormalCommit = 277805b4dc612548f4dcdf4f91189abb4ef5c8e3
cFormalCommit = 8f8e2c71dfd6128307fb7bcdcaf04c7c99a5c9cd
cBindingFixCommit = 8648620213463701319d089a5ab088e62e243af0
```

审计时本地`HEAD`与本地远端跟踪引用`origin/main`均为`6773d99fc1f4c87dc816e44a48d9fac624a9b2b9`，且W3起点、B正式提交、C正式提交和C绑定修复提交均为该HEAD的祖先。两次实时`git fetch origin main`因GitHub连接失败未完成；因此本文不把本地跟踪引用冒充新的远端网络证明。该限制由生效机制和A的拉取门禁关闭：本文只有首次进入`origin/main`后生效，A必须拉取包含本文的最新main并再次确认上述提交祖先关系和冻结哈希。

## 3. Profile候选

候选目录固定为：

```text
pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft
```

负责人核对结果：

- `subjectId=pandas-cleaning`、`schemaVersion=2`、`revision=2`、`revisionOf=1`；
- 激活前保持`status=draft`、`version=0.2.0-draft`和`x-candidateApproval=pending_owner_decision`；
- `profile.json`声明的14个路径全部存在；Profile v2 Schema、知识点/目标/活动交叉引用和revision绑定测试通过；
- B正式提交后，TaskBundle及活动资产至审计HEAD无后续差异；C绑定修复提交后，C适配器、证据和测试至审计HEAD无后续差异；
- A不得把`pending_owner_decision`手工改写为批准事实，不得手工移动目录或直接编辑active；激活状态只能由事务结果产生。

## 4. B正式输入

W3正式代码任务范围仍严格只有两个：

| activityId | profileRevision | environmentRef | 复算后的`assetBundleHash` |
|---|---:|---|---|
| `act-inspect-dataframe` | 2 | `env-python-pandas-candidate` | `bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c` |
| `act-practical` | 2 | `env-python-pandas-candidate` | `3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c` |

仓库继承保留的其他三个代码Bundle不扩大D38规定的W3正式任务范围。资产测试按冻结的`utf8-json-keys-sorted-arrays-preserved-no-whitespace-v1`口径排除`assetBundleHash`自身并解析关联fixture后复算，两个正式值与TaskBundle、C绑定证据和负责人审计记录一致。

## 5. C正式输入

正式环境锁：

```text
file = pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/environments/environment-lock.json
fileSha256 = 59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43
environmentHash = sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76
status = measured_node_submit
```

负责人按`W3-D40-ENV-1`复核Node `v22.23.1`、Python `3.13.7`、Pandas `3.0.5`、平台`win32-10.0.26100-x64`、执行器、依赖白名单、五项限制及三项能力标志。排除`environmentHash`自身后的规范化复算值与锁内值一致，原始文件SHA-256与C正式绑定证据一致；两个B Bundle哈希也与C证据一致。

C上传前封存材料中的`candidateHead=c8b4aac...`和`formalUpload=not_authorized`是当时的历史状态，不改写为当前Git事实。C的正式实现及后续绑定修复现已分别通过`8f8e2c71dfd6128307fb7bcdcaf04c7c99a5c9cd`和`8648620213463701319d089a5ab088e62e243af0`进入当前祖先链。

## 6. 验证记录与限制

当前审计环境执行：

| 检查 | 结果 |
|---|---|
| Profile v2、B资产、公共端口、Rubric、revision resolver及仓储生命周期定向测试 | `70/70 PASS` |
| `npm.cmd run typecheck` | `PASS` |
| `npm.cmd run check:docs` | `PASS`，49个项目Markdown链接有效 |
| `git diff --check` | `PASS` |
| 环境锁规范化哈希复算、原始文件SHA-256、提交祖先关系及输入未变检查 | `PASS` |

当前审计机为Node `v24.15.0`、Python `3.13.14`、Pandas `2.3.3`、Windows `10.0.26200.0`，不等于批准环境。环境依赖测试在预检阶段按设计返回`environment_mismatch`，本次不得写成PASS，也不以当前机器覆盖C在批准环境形成的封存证据。D36要求的是B/C正式输入已经入库、绑定稳定并经负责人核对；重新测量或变更D40环境不属于D3激活前置。

## 7. 对A的授权与禁止

A仅获准执行以下工作：

1. 拉取包含本文的最新`origin/main`，再次核对本文绑定的B/C提交、两个Bundle哈希、环境锁文件SHA-256和`environmentHash`；
2. 使用Profile仓储事务重验revision 2候选；
3. 在同一生命周期操作中归档旧active、发布新active，并证明任何校验、归档或发布失败时旧active仍可用且候选不被半发布；
4. 继续完成36号D3规定的正式提交事务、Attempt/Evidence、KnowledgeState、路径未完成后缀、checkpoint、幂等和故障恢复；
5. 形成V3-4/V3-5/V3-6作者证据和完整交接清单后，另行申请A-D3上传锁。

A不得：

- 修改B的Profile、TaskBundle、Rubric、fixture、测试资产或哈希；
- 修改C的环境锁、执行器、Rubric协议或封存证据；
- 手工编辑active、latest指针或manifest状态来冒充事务成功；
- 把本批准解释为提交、push、上传锁、正式gold或W3 GO授权；
- 让正式resolver或新会话读取draft；
- 在正式60例gold冻结前运行正式60例系统路径或输出。

若A拉取后任一绑定哈希、提交祖先关系或候选校验发生变化，本批准自动停止适用，A只能报告`BLOCKED`并交负责人复核，不得自行选择新输入。
