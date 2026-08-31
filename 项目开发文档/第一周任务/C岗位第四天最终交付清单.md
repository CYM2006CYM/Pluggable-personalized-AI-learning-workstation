# C岗位第四天最终交付清单

依据：[19-第一周总任务布置与权限边界](./19-第一周总任务布置与权限边界.md)、[24-岗位C执行器与后端任务书](./24-岗位C执行器与后端任务书.md)。

## 1. 交付结论

| 项目 | 结果 |
|---|---|
| 公共合同版本 | `W1-C5` |
| 开发基线 | `f6c83968f66fbb173d6de6788c79080b8374138f` |
| C项目文件 | 14项 |
| C作者测试 | 2个文件、24项 |
| 四文件聚焦测试 | 4个文件、43项 |
| 单进程全量测试 | 28个文件、188项 |
| 候选ZIP SHA-256 | `fef59381beca64214d9423878335c5b044c42e378a24d4780cf1d1d98705da87` |
| 14项实现状态 | `OWNER_REVIEW_PASS / UPLOAD_LOCK_GRANTED` |
| 本清单上传状态 | `INCLUDED_IN_OWNER_APPROVED_SCOPE` |
| 正式上传范围 | 15项（14个C项目文件 + 本清单） |

负责人已单独审核并批准本清单作为第15项正式交付文件，现有上传锁覆盖表中15项。

## 2. 24号交付物对照

| 24号交付要求 | 已交付内容 | 状态 |
|---|---|---|
| 评测端口/结果fixture | `code-evaluation-port.ts`、`evaluation-protocol.ts`、活动结果及请求/响应fixture | 完成 |
| 错误矩阵和协议时序 | 五阶段固定顺序、合法/非法时序、学习者/评测器/请求冲突错误矩阵 | 完成 |
| 环境锁模板 | `environment-lock-unmeasured.json`，版本和资源上限保持未实测 | 完成 |
| 第3—5周原型实测问题清单 | 环境锁模板中的10项`pending_C_prototype`问题，见第5节 | 完成记录，等待原型证据 |
| `handoff-w1-c-*`交接记录 | 面向A、B、D、E的4份交接fixture | 完成 |

本周按冻结范围提供确定性fixture adapter，不启动真实Python进程，不实现HTTP、运行时依赖安装、云判题或生产级沙箱。

## 3. 14项项目文件

### 3.1 端口与协议

- `pi-study-helper/src/infrastructure/code-evaluation-port.ts`
- `pi-study-helper/src/infrastructure/evaluation-protocol.ts`

### 3.2 固定fixture与交接记录

- `pi-study-helper/fixtures/evaluator-results/activity-results.json`
- `pi-study-helper/fixtures/evaluator-results/evaluator-requests.json`
- `pi-study-helper/fixtures/evaluator-results/evaluator-responses.json`
- `pi-study-helper/fixtures/evaluator-results/stage-sequences.json`
- `pi-study-helper/fixtures/evaluator-results/error-matrix.json`
- `pi-study-helper/fixtures/evaluator-results/environment-lock-unmeasured.json`
- `pi-study-helper/fixtures/evaluator-results/handoff-w1-c-a.json`
- `pi-study-helper/fixtures/evaluator-results/handoff-w1-c-b.json`
- `pi-study-helper/fixtures/evaluator-results/handoff-w1-c-d.json`
- `pi-study-helper/fixtures/evaluator-results/handoff-w1-c-e.json`

### 3.3 C作者测试

- `pi-study-helper/tests/code-evaluation-port.test.ts`
- `pi-study-helper/tests/evaluation-protocol.test.ts`

## 4. 已固定的行为与安全边界

- 评测阶段固定为`prepare → user_code → public_tests → hidden_tests → summarize`，跳过、交换、重复或未知阶段均被拒绝。
- `ActivityResult`和`LearningRuntimeErrorCode`只从A维护的公共类型导入，C没有正式Evidence、mastery或路径写入能力。
- fixture adapter使用`requestId + attemptId`固定幂等边界；同一标识对应不同请求时返回公共`idempotency_conflict`。
- `evaluator_error`、`test_asset_invalid`及其他评测器错误不携带分数或维度结果，不产生负Evidence。
- `run()`以内部私有准备状态为权威，核对完整准备字段、TTL及篡改；未知或畸形准备状态稳定返回无评分`test_asset_invalid`。
- 无内部状态时不回显调用方元数据；宿主路径不能通过结果元数据或`outputSummary`进入安全结果。
- 运行时资产校验采用失败关闭：必须提供文件摘要和符号链接检查上下文，文件缺失、摘要不符或符号链接风险均被拒绝。
- 用户stdout/stderr与协议Envelope分离，用户输出中的伪造JSON不能改变权威结果。

## 5. 第3—5周原型实测问题

以下约束目前只有静态合同，全部保持`pending_C_prototype`，取得原型证据并由负责人冻结前不得写成正式环境承诺。

| 问题编号 | 待取得的原型证据 |
|---|---|
| `temporary-directory-cleanup` | 唯一运行目录及成功、失败、取消后的清理证据 |
| `public-hidden-process-isolation` | 公开测试与隐藏测试使用独立干净进程的证据 |
| `hidden-asset-ownership` | 隐藏资产只由Node父评测器持有且不进入用户目录的证据 |
| `shell-working-directory` | 明确可执行文件、固定工作目录及`shell:false`的证据 |
| `minimal-environment` | 子进程最小环境变量允许清单及负责人批准 |
| `process-tree-timeout` | Windows超时与取消能终止完整进程树的证据 |
| `output-truncation-escaping` | stdout/stderr字节上限、截断和转义证据 |
| `runtime-versions-dtype` | Node、Python、Pandas、Pyodide、平台、评测器及dtype行为测量 |
| `resource-limits` | 时间、源码、数据集、输出和内存上限的重复运行测量 |
| `network-memory-capabilities` | Windows网络隔离和可靠内存限制的可实施性结论 |

## 6. 交接边界

| 接收岗位 | 可直接消费的内容 | 不授予的能力 |
|---|---|---|
| A | 公共类型导入位置、幂等和错误边界 | C不能提交Evidence、更新mastery或重排路径 |
| B | 5个TaskBundle、3个数据fixture及阶段映射 | C不重定义Pandas规则、Rubric语义或业务合同 |
| D | `ActivityResult.safeFeedback`及5类固定结果 | D不得改写分数、verdict或错误归因，不读取隐藏资产 |
| E | 作者测试、错误归因、确定性、取消和泄漏检查入口 | C本机结果不能替代E独立复验 |

## 7. 验证结果

| 命令或检查 | 结果 |
|---|---|
| `npm.cmd run typecheck` | PASS |
| `npm.cmd test -- tests/evaluation-protocol.test.ts tests/code-evaluation-port.test.ts --maxWorkers=1` | PASS，2个文件、24项 |
| 四文件聚焦测试 | PASS，C协议、C端口、B资产、A公共类型共4个文件、43项 |
| `npm.cmd test -- --maxWorkers=1` | PASS，28个文件、188项 |
| `npm.cmd run verify` | PASS，类型检查、188项测试、文档、Extension冒烟和release检查 |
| 上传前执行`git diff --cached --check` | PASS |
| B资源及公共/配置文件差异 | 0项 |

A、B、E已对最新14项候选版本给出`PASS / 不阻塞`，负责人完成技术与安全复核，并单独审核本清单后批准15项正式上传范围。无需重新生成14项完整性ZIP，也无需A、B、E重复审计。审计回执和整改过程材料不进入正式项目提交。

## 8. 已知限制和岗位边界

- 当前只有确定性fixture adapter，没有真实Python/Pandas子进程、HTTP服务、Pyodide主链或外部评测器。
- EnvironmentLock中的版本、时限、内存、网络和输出上限均未形成有效实测证据。
- 静态执行约束不等于生产沙箱能力，第3—5周必须完成原型测量后再申请负责人冻结。
- C不决定Pandas清洗规则、Rubric含义、Evidence权重、KnowledgeState、路径逻辑或前端页面。
- 未修改19—26号负责人文档、A公共类型、B资料包、D/E文件、package、锁文件或TypeScript配置。

## 9. 上传与汇报边界

现有14项候选ZIP及旁路SHA保持不变，继续作为14个项目文件的完整性证据。本清单由负责人单独审核批准，不加入原ZIP；正式上传范围为14个C项目文件加本清单，共15项。

上传时必须逐项暂存批准的15个文件，不得暂存ZIP、旁路SHA、审计过程文档、19—26号负责人文档、package、配置或其他岗位文件。上传后按19号文档第10节报告：

```text
成员/岗位：C 执行器与后端
提交编号：<上传后填写完整提交号>
本次修改文件：<实际暂存文件清单>
依据的21号合同章节：合同A、合同B、合同E及合同D的任务资产/环境锁条款
运行的测试：<实际上传前命令>
测试结果：<实际结果>
是否存在待负责人决定的问题：否
下一位允许拉取：是
```
