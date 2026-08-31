# W3-D3 E岗位 R3 整改交付报告

## 结论边界

```text
contractVersion = W3-C5/W3-R2
deliveryStage = W3-D3
E_W3_D3_R3 = READY_FOR_OWNER_AUDIT
fullV3Status = NOT_RUN_D3
V3_1_TO_V3_8 = NOT_EXECUTED
gateConclusion = NOT_PRODUCED_D3
gitStatus = NOT_COMMITTED / NOT_PUSHED
uploadLock = NOT_REQUESTED
```

本包只完成R2基础上的最小R3工具整改，不构成D4授权、第三周整体PASS、正式60例系统运行、gold生成或Go/No-Go。

## 执行基线

```text
HEAD = bd1b599524ef2e3362d14a422d97debbf240f70f
origin/main = bd1b599524ef2e3362d14a422d97debbf240f70f
git status --short =
 M pi-study-helper/.gitignore
 M pi-study-helper/package-lock.json
 M pi-study-helper/package.json
?? pi-study-helper/index.html
?? pi-study-helper/src/web/
?? pi-study-helper/tests/web/
?? pi-study-helper/tsconfig.web.json
?? pi-study-helper/vite.config.ts
```

已执行 `git fetch origin main`；本次远端返回 HTTP 502。由于本地 `HEAD`/`origin/main` 已处于负责人要求的 `bd1b599...`，未对工作区做覆盖或拉取合并。

## R3整改摘要

- 同步全部配置、模板、执行器、输入清单和报告为 `W3-C5/W3-R2`，绑定 `W3-D47-TEST-LAYERS-1`、提交 `bd1b599...` 与文件 SHA-256。
- D47 三层计划已冻结：确定性层、评测器集成层、固定轨迹Demo层；登记 `CODE_DEFECT`、`ENVIRONMENT_MISMATCH`、`AUDIT_INPUT_INCOMPLETE`、`LIVE_NOT_RUN`、`MOCK_FALLBACK_USED`。
- V3-4 扫描 `activity-rubric.ts`、`code-evaluation-port.ts`、`evaluation-protocol.ts`、`python-process-evaluation-adapter.ts`，并保留 A 正式事务测试清单 PENDING。
- V3-6 保留 `PENDING_A_D3_DETERMINISTIC_TEST_FILES`，明确两个任务×四类故障及状态保持断言；未猜测A测试文件名。
- V3-7 改为负责人 difficulty、path constraints、adjudication log、freeze record 四项 PENDING 输入；D4按实际解析清单绑定路径和哈希，不固定 `gold-candidate.jsonl`。
- R2 原件、R2 包和所有R2 SHA-256未修改。

## 自测记录

| 检查 | 实际结果 |
| --- | --- |
| JSON解析 | 36个JSON文件通过 |
| PowerShell脚本解析 | 9个脚本通过 |
| R3基线结构 | 8个门禁、27项输入、7项PENDING，退出码0 |
| 输入绑定复算 | 27/27通过，20冻结、7待定，退出码0 |
| Plan模式 | V3-1至V3-8，8/8退出码0 |
| V3-7重复caseId | 拒绝 |
| V3-7缺少候选 | 拒绝 |
| V3-7前20修改 | 拒绝 |
| V3-7后40非SKIPPED_BY_D44 | 拒绝 |
| V3-7冻结哈希不一致 | 拒绝 |
| 无D4令牌Execute | 拒绝 |
| PENDING输入Execute | 拒绝 |
| 确定性层隔离 | V3-8 Plan不受gold/A/D待定污染 |

上述均为D3准备和反例自测；未运行V3-1至V3-8正式门禁、Python、正式60例系统、gold或D4。

## 输入PENDING清单

`a-d3-formal-commit`、`a-d3-deterministic-test-files`、`d-d3-formal-commit`、负责人 difficulty gold 候选、负责人 path constraints 候选、负责人 adjudication log 候选、负责人候选冻结记录。

## 拟提交与明确排除

拟提交仅为负责人审核材料，不申请提交：`r3-source/**` 及本报告、外层哈希和自测记录。明确排除仓库代码、React页面、A/B/C/D文件、合同原件、SDK、依赖、环境锁、R2原件、D1标注、机械差异清单、正式gold、node_modules、dist-web、日志和浏览器profile。

## 负责人审核顺序

1. 核对外层 ZIP SHA-256 和包内逐文件 SHA-256。
2. 核对 D47 提交/文件哈希绑定与三层计划。
3. 核对 V3-4/V3-6/V3-7 配置、反例自测及 PENDING 边界。
4. 负责人交付 A/D/gold 候选后，另建 D4解析清单再执行；不得回写本R3冻结清单。

## 交付物哈希

```text
W3-D3-E-owner-review-package-r3.zip SHA-256 = ba5a5b062271ca16a98c2338a59c461557bd9d6ffea87063aa5e7ffa52eb3c4e
包内payload文件 = 53
包内逐文件复算 = 53/53匹配
```

详见 `W3-D3-E-hashes-r3.sha256` 与 `W3-D3-E-r3-package-verification.json`。
