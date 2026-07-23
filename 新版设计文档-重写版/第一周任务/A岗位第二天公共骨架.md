# handoff-w1-a：W1-C3公共骨架最终交接记录

## 1. 基线与状态

```text
岗位：A领域与架构
合同修订：W1-C3
实现基线：7a0ccf66fa71f755a529b74c86d7d5804703df92
分支：main
实现开始时HEAD/origin/main：一致，领先/落后0/0
W1-C3修改前verify：PASS（25个测试文件，140项测试）
当前交付状态：PASS / SPEC-A-04_CLOSED_BY_W1_C3 / SPEC-A-05_CLOSED_BY_OWNER_OPTION_A / B_C_D_E_PASS
上传状态：NOT_COMMITTED / NOT_PUSHED / READY_TO_REQUEST_UPLOAD_LOCK
```

本记录在负责人审阅过的W1-C2交接单上原地升级，避免形成两份并行交接记录。W1-C2公共类型、17方法Facade、四方法仓储端口及其测试全部保留；W1-C3实现只处理`SPEC-A-04`。四岗位审计后提出的`SPEC-A-05`只涉及既有v1/v2同名类型的合同解释，负责人选择方案A关闭，无需修改当前代码。

## 2. W1-C3裁决落实

| 合同项 | 实现结果 |
|---|---|
| 三类容器 | 只接受`{"goals": [...]}`、`{"knowledgePoints": [...]}`、`{"activities": [...]}`；顶层只额外允许`x-`扩展 |
| 三类公共类型 | 补齐`KnowledgePointDefinition`、`ActivityReferenceDefinition`及三类Asset接口；保留原`LearningGoalDefinition` |
| 严格条目结构 | 目标、知识点按D.2接口校验；活动先按12号五类`LearningActivity`完整结构校验，再提取四字段最小投影 |
| ID规则 | 主ID和本次闭合涉及的引用必须是非空稳定ASCII标识；三类主ID分别建立唯一索引 |
| 重复规则 | 拒绝三类重复主ID及七类冻结引用数组内部重复值 |
| 闭合规则 | 按D.2.2固定顺序检查目标、知识点、活动全部冻结引用和主辅知识点冲突 |
| 先修图 | 拒绝先修自引用、两节点及任意长度环；`relatedKnowledgePointIds`不参与环检测 |
| 非双向关系 | 不强制关联知识点对称；不强制`requiredActivityIds`与`goalIds`双向相等 |
| 无活动模式 | 未声明`quiz/code/practice`且省略活动路径时，目标和知识点活动引用必须为空且不得声明最终活动 |
| 统一失败 | 所有v2结构和闭合失败仍是`ProfileValidationError`，并固定携带`errorCode=invalid_profile` |

`validateProfileV2Directory`仍只返回`ProfileManifestV2`，没有新增未冻结公共DTO。来源、数据集、公开/隐藏测试、Rubric、参考实现、错误实现和环境引用只校验所属活动字段结构，不读取目标文件，也不实施专业语义闭合。

## 3. Fixture与作者测试

合法A fixture现包含：

- 两个目标、两个知识点和一个完整`explain`活动；
- 顶层`x-`扩展；
- 非对称`relatedKnowledgePointIds`正例；
- `goal.requiredActivityIds`与`activity.goalIds`不对称正例；
- 辅助知识点为空及与主要知识点不同的正例。

非法A fixture和临时副本覆盖：

- 裸数组、错误/第二核心容器、空数组、未知条目字段和字段类型错误；
- 目标、知识点、活动重复ID及空/非ASCII ID；
- 七类引用数组重复；
- 目标、知识点、活动每一类冻结悬空引用；
- 主要/辅助知识点冲突；
- 先修自引用、两节点环和三节点环；
- 五类活动合法结构及缺失子类型字段；
- 计分模态下空活动数组；无活动路径时仍声明活动引用。

fixture只位于`pi-study-helper/tests/fixtures/profile-v2/`，没有写入B的Pandas资料包目录。

## 4. 合同问题状态

### 4.1 SPEC-A-04

```text
负责人裁决：方案A
合同依据：21号W1-C3，D.2.1—D.2.4
状态：CLOSED_BY_W1_C3
剩余A合同缺口：无
```

关闭依据：三类核心资产已能按冻结容器解析，完成重复ID、重复引用、跨文件悬空引用、主辅冲突和先修环校验；合法与非法fixture均由作者测试覆盖。没有读取旧候选结构或扩展B/C专业资产Schema。

### 4.2 SPEC-A-05

```text
问题：v1与v2存在同名但语义不同的ProfileStatus和SessionStatus，G1唯一性范围未明确
负责人裁决：方案A
状态：CLOSED_BY_OWNER_OPTION_A
代码处理：NO_CHANGE_REQUIRED
```

负责人书面明确，G1“公共类型只有一处定义”只约束v2公共入口，允许v1遗留类型继续存在于旧模块中；下游必须使用以下唯一导入边界，不得混用：

```text
v1 ProfileStatus / SessionStatus：src/domain/types.ts
v2 ProfileStatus：src/domain/v2-types.ts
v2 SessionStatus：src/application/learning-runtime-facade.ts
```

因此不重命名、不合并状态枚举、不修改v1兼容层，也不由A修改19—26号负责人文档。E已基于该裁决撤销原`BLOCKED_PUBLIC_CONTRACT`并补充确认`PASS / 不阻塞上传`。

## 5. 本次修改文件与保留边界

W1-C3实际修改：

```text
pi-study-helper/src/domain/v2-types.ts
pi-study-helper/src/domain/profile-v2-schema.ts
pi-study-helper/tests/v2-types.test.ts
pi-study-helper/tests/profile-v2-schema.test.ts
pi-study-helper/tests/fixtures/profile-v2/
新版设计文档-重写版/第一周任务/A岗位第二天公共骨架.md
```

W1-C2以下A产物原样保留，本次没有修改：

```text
pi-study-helper/src/application/learning-runtime-facade.ts
pi-study-helper/src/repositories/learning-session-repository.ts
pi-study-helper/tests/learning-runtime-facade.test.ts
pi-study-helper/tests/learning-session-repository.test.ts
```

package、锁文件、tsconfig、v1 `profile-schema.ts`、`demo-review`、19—26号负责人文档、其他岗位文件和真实Pandas资产均未修改。

## 6. 测试结果

```text
npm.cmd run typecheck：PASS
npm.cmd test -- tests/v2-types.test.ts tests/profile-v2-schema.test.ts tests/learning-runtime-facade.test.ts tests/learning-session-repository.test.ts：PASS（4个文件，38项）
npm.cmd test：PASS（25个测试文件，155项；W1-C3前140项及原117项全部保留）
npm.cmd run verify：PASS（typecheck、155项测试、文档链接、Extension冒烟和release检查）
工作区边界审计：PASS（无tracked修改；未跟踪内容均属于A源码、测试、fixture或本交接记录）
远端基线复核：PASS（HEAD与origin/main均为7a0ccf66fa71f755a529b74c86d7d5804703df92，领先/落后0/0）
```

W1-C3新增15项作者测试：Profile v2测试由7项增至21项，v2类型测试由9项增至10项。Facade与仓储7项作者测试未变；四份A作者测试合计38项。

## 7. B/C/D/E只读审计状态

当前状态：`B_C_D_E_PASS / NO_A_BLOCKER`。

| 岗位 | 最终结论 | 动态测试 | 结论摘要 |
|---|---|---|---|
| B | `PASS / 不阻塞` | `NOT_RUN` | 三类Profile资产、闭合顺序、非双向关系和专业资产边界符合W1-C3；审计包SHA-256一致 |
| C | `PASS / 不阻塞` | `NOT_RUN`（审计机无npm） | 五类活动投影、单数主要知识点、辅助知识点不计分及`evaluator_error`边界正确；审计包SHA-256一致 |
| D | `PASS / 不阻塞` | `NOT_RUN` | Evidence仍为单数知识点，辅助知识点不计分，正式Evidence仍只能由仓储`commit`公开 |
| E | `PASS / 不阻塞` | `PASS` | 4个A测试文件38项、全量25个文件155项、typecheck和verify全部通过；`SPEC-A-05`经负责人方案A裁决后解除阻塞 |

四名审计者均确认没有直接修改A文件。B/C/D未发现A实现错误；E首次发现`SPEC-A-05`公共合同解释缺口，而非代码或测试失败。负责人裁决后E补充确认`CLOSED_BY_OWNER_OPTION_A / PASS / 不阻塞上传`，无需代码整改或再次复验。

## 8. 上传门禁

```text
SPEC-A-04：CLOSED_BY_W1_C3
SPEC-A-05：CLOSED_BY_OWNER_OPTION_A
B/C/D/E只读审计：PASS / NO_A_BLOCKER
最终验证：PASS
工作区边界：仅A岗位产物
当前门禁：READY_TO_REQUEST_UPLOAD_LOCK
```

下一步只允许向负责人申请上传锁。获锁前不提交、不推送、不创建PR；获锁后刷新远端、检查同路径冲突、复跑验证，只暂存A产物并进行唯一一次正式上传。
