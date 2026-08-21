# W5-D3 负责人Pyodide裁决

状态：`[负责人已签署；以本文件首次进入origin/main的提交为生效锚点]`。裁决标识：`W5-D64-PYODIDE-1`。签署时间：`2026-08-21`。现行合同保持`W5-C1/W5-R1`；本文是[20号D64](../第一周任务/20-第一周开发前负责人决策冻结清单.md)的D3执行记录，不新增D编号，不修改公共类型、上传顺序或V5门禁标准。

## 1. 裁决

```text
decisionId       = W5-D64-PYODIDE-1
PYODIDE_DECISION = PYODIDE_DISABLED_WITH_NODE_FALLBACK
PYODIDE_ENABLED  = false
LIVE_MODEL       = LIVE_NOT_RUN
```

含义：

1. 不启用浏览器内Pyodide公开预览；
2. Node.js/Python继续承担代码补全和最终独立实操的权威评测；
3. 不新增Pyodide依赖、不修改`package.json`或锁文件、不使用CDN或任何网络加载器；
4. 按[52号第4节](./52-第五周公共合同总册.md)和D64，Pyodide关闭不单独阻塞`W5_GATE`；
5. 关闭态页面不得保留无效预览按钮、空路由或误导性“双后端”文案。

本裁决只在[52号第4节](./52-第五周公共合同总册.md)允许的两种正式状态中选择其一，不创造第三种状态，也不把关闭解释为确定性主链失败。

## 2. 裁决依据与证据绑定

依据[20号D64/D65/D67/D68](../第一周任务/20-第一周开发前负责人决策冻结清单.md)、[52号第2—5节](./52-第五周公共合同总册.md)、[12号第11、13节](../12-学习活动代码任务与执行器设计.md)、[15号第5节](../15-代码评测系统调研与适配方案.md)以及E的D2正式提交。

| 证据项 | 冻结值 |
|---|---|
| E的D2正式提交 / `origin/main` | `590985af616861e503ee30f2bf56c6392b0055f7` |
| A的D1正式提交 | `0fd1f45386682a3859d8d9f6b37904b47ae98c33` |
| C的D1正式提交 | `677f54c609ef3bfbe78ff6d37f6b432e9c68ff4d` |
| A的D2正式提交 | `127a71cce4a8423327fb5ce75d31294252b92a0b` |
| E的D2交付包 | `第五周任务/W5-D2-E-2/W5-D2-E-R2-delivery.zip` |
| E的D2交付包 SHA-256 | `b88d3c9c0eab9d7c4e783180c33e0cc6790b352a17fbc6beb5e3c5e2e84462d0` |
| C的D1环境原型证据 | `pi-study-helper/scripts/w5-c-validation/environment-prototype.json` |
| revision 3环境锁 SHA-256 | `59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43` |
| revision 3 `environmentHash` | `sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76` |
| 裁决输入时revision 3 seal `assetTreeSha256`（代码判分修复前历史值） | `e1564481e6b1fa7d264c04912d5e39a8adb8384f2e2716372e70e56dfd57401d` |
| D3后续执行唯一现行revision 3 seal `assetTreeSha256` | `ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d` |

负责人独立复算结论：

1. E交付包实测SHA-256与同目录sidecar和本表第一致，`W5-D2-E-R2-delivery.zip.sha256`逐字节相符；同目录另有一份历史sidecar `W5-D2-E-R2-delivery.zip(1).sha256`记录旧值`d7646728...b176f`，属于被取代的历史材料，不作为本裁决输入。
2. `PYODIDE_CANDIDATE_UNAVAILABLE`在正式源码中可复核：`pi-study-helper/src/web/preview/pyodide-preview.worker.ts`对任何`run`消息只返回`pyodide_candidate_unavailable`，`create-browser-code-runner.ts`导出同名常量，仓库未新增Pyodide依赖、CDN或本地运行时资产。
3. C的D1实测记录`pyodide.available=false`、`loadMode=unavailable`、`errorCode=module_not_found`，其最小Pandas任务登记`NOT_RUN`；原生Python/Pandas sanity check为PASS且未被归因为Pyodide能力。
4. 因此[52号第4节](./52-第五周公共合同总册.md)启用门的第一项（锁定版本可离线/本地加载）已经失败，其余启用条件无需继续测量即可判定不成立。

## 3. 不批准与不改变的事项

1. 不批准`PYODIDE_ENABLED`，不批准`measured_dual_backend`。
2. `pyodideVersion`保持`null`；`networkIsolation`、`reliableMemoryLimit`保持`false`；`processTreeTermination`保持既有实测值。
3. 不批准安装Pyodide、Monaco或任何新依赖；[52号第12节](./52-第五周公共合同总册.md) Monaco条件项保持关闭。
4. Pyodide裁决本身不授权修改SDK、依赖、锁文件、revision 2、60例正式gold、hidden tests、Rubric或reference solution；同提交中经负责人另行登记的代码判分阻塞修复修改了revision 3三个Rubric的`dimensionTestMap`，范围和依据以第7节及专项阻塞记录为准。
5. 不改变`POST /api/activities/:id/submit`的Node/Python权威语义。
6. `POST /api/activities/:id/run`与`BrowserCodeRunner`公共合同保留，仅关闭页面可点击入口；不删除[52号第2—3节](./52-第五周公共合同总册.md)已冻结的类型。

## 4. 接口与页面边界

- `/run`只校验会话、活动、revision并签发公开执行包，不执行evaluator，不产生Attempt、Evidence、mastery或路径重算。
- 关闭态下页面不提供可点击的公开预览入口；“提交正式评测”必须独立可用。
- 关闭态文案只允许表达“公开预览暂不可用”语义，不得出现暗示双后端已启用的表述。
- 预览关闭不影响代码草稿保存与刷新恢复。
- 最终独立实操仍通过正式提交运行公开测试、hidden tests和确定性Rubric。

## 5. 执行顺序

本裁决进入`origin/main`后按[51号第4节](./51-第五周总任务布置与权限边界.md) D3的`C→B`顺序执行：

1. C拉取本裁决和E的D2正式提交`590985af...`，执行D3环境测量与故障验证。
2. C对10组公开输入分别运行Node至少3次；Pyodide逐组登记`NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`，不得写`PASS`。
3. C验证超时、输出洪泛、Windows进程树终止、临时目录清理、磁盘写失败、版本冲突、重复提交和服务重启后准备状态重建。
4. C向B交付唯一结构化环境字段映射建议；C不得修改Profile环境锁或seal。审计通过后先上传C。
5. B拉取C正式提交，逐字段更新revision 3环境锁，未证明能力全部写`false`，不得写`measured_dual_backend`。
6. B重算revision 3 seal，保证revision 2逐字节不变；同时提交三类学习者输入、预期差异矩阵和PPT大纲。
7. B审计通过并上传后D3完成；D4再按`A→E`执行正式路径与页面关闭态验证。

## 6. B修改环境锁前必须知道的源码约束

以下约束由负责人在本机合同环境实测确认，属于既有实现事实，B执行[54号第1项](./54-岗位B第五周任务书.md)时必须遵守，不得以“补齐Pyodide字段”为理由突破：

1. `pi-study-helper/src/infrastructure/python-process-evaluation-adapter.ts`对正式Node提交环境执行逐字段严格校验，并在排除`environmentHash`自身后重算规范JSON摘要。任何新增字段、改值或改键都会使重算摘要改变，导致`prepare()`返回`environment_mismatch`，正式代码提交立即不可用。
2. 该校验同时要求`pyodideVersion === null`。因此关闭态下`pyodideVersion`只能保持`null`，不能写入实测候选字符串。这与[52号第5节](./52-第五周公共合同总册.md)“保留实测候选值或`null`”并不冲突：本裁决按源码事实选定`null`，候选测量值只登记在C的证据文件中。
3. `status`必须保持`measured_node_submit`；`nodeVersion`、`pythonVersion`、`pandasVersion`、`platform`、`evaluatorVersion`、`createdAt`、`prototypeEvidenceRef`、`limits`各项与`capabilityFlags`三项均被逐值比对。
4. `platform`当前固定为`win32-10.0.26100-x64`，而本机实际构建号已是`10.0.26200`。按[20号D47](../第一周任务/20-第一周开发前负责人决策冻结清单.md)，Windows构建号只记录、不作为拒绝条件，因此`platform`字段值保持不变，不得按当前构建号改写。
5. revision 3 seal中`environments/environment-lock.json`条目为`raw-binary`、`byteLength=891`。锁文件任何字节变化都必须同步重算seal，且`revision 2`目录逐字节不变。

结论：若C的D3测量结果与上表批准值完全一致，B在环境锁上的正确动作是**不改变任何字段值**，只完成证据映射、seal复算与差异说明；若C测出与批准值不同的数值，B必须停止写入并提交阻塞，由负责人另行裁决，不得为通过测试自行改锁或改源码常量。

补充（本提交同步生效）：负责人已按`W5-D3-CODE-GRADING-001`修复revision 3的五个`assetBundleHash`、三个Rubric的`dimensionTestMap`并重算seal。因此B在D3拉取到的revision 3 `assetTreeSha256`唯一现行值为`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`（78条目）；`e1564481…`只作为修复前历史输入保留，不得用于后续复算。B必须以该新值为基线，重算后若与之不符即为自身改动引入，须停止并报告。`environment-lock.json`本身未变，其SHA-256仍为`59917d15…`。

## 7. 已登记的阻塞与本裁决的适用边界

负责人在签署本裁决时于合同环境独立复验发现一项与Pyodide无关、但影响D3验收表述的既有缺陷，已单列为[W5-D3负责人正式代码判分阻塞记录](./W5-D3-负责人正式代码判分阻塞记录.md)，编号`W5-D3-CODE-GRADING-001`。该问题已于同日经用户授权修复并复验关闭，原始失败事实在该记录中完整保留。

因此本裁决的验收表述按如下边界执行：

| 验收项 | 本裁决状态 |
|---|---|
| Pyodide不可用没有被伪装为双后端PASS | 可立即验收 |
| 关闭态页面无死入口、正式提交按钮正常 | 由D4按本裁决第4节验收 |
| DOM、网络、Worker、日志和构建产物零敏感泄漏 | 由D4验收 |
| 环境版本、阈值及能力标志均有C实测证据 | 由D3 C→B验收 |
| B的seal可复算、revision 2不变 | 由D3 B验收 |
| Node同一提交连续3次结论一致 | 负责人侧已具备正式回归测试证据（原阻塞已关闭） |
| 最终独立实操能够正式判分、重试和恢复 | 判分与连续一致性已具备证据；重试与恢复仍由D4验收 |

`W5-D3-CODE-GRADING-001`已于同日经用户授权修复并由负责人独立复验关闭：revision 3五个代码活动在历史真实HTTP轨迹上全部`verdict=pass`，会话可走到`SESSION COMPLETED`；正式回归测试进一步使用合同Python对五个活动各运行3次并断言结果字段一致，同时守护revision 2仅保留两个历史正式活动。修复未启用Pyodide，也未改动环境锁任何字段，因此本裁决的Pyodide结论不变。

上述两项在E完成独立验证、负责人在D6复核前仍不得写成V5正式PASS；本裁决只登记负责人侧证据已存在。

## 8. 授权边界

本裁决只解除C的D3环境测量与故障验证前置阻塞。它不授权：

- `git commit`、`git push`或任何岗位的上传锁；
- Profile激活、seal终裁或正式gold生成；
- 修改其他岗位文件、公共合同、SDK或依赖；
- `W5_GATE`签署或V5任一门禁结论。

C与B必须各自保持`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`直到负责人逐次授锁。
