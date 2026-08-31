# V3-6 测试用例合同

## 目标

在批准的 Node/Python/Pandas 评测器集成层中，验证 dependency、environment、test_asset、protocol 四类故障不会制造正式负 Evidence，并绑定A正式事务测试清单。

## 冻结输入

- `b-task-bundles-file`
- `c-formal-commit`
- `c-binding-fix-commit`
- `c-environment-lock`
- `c-environment-hash`
- `a-d3-formal-commit`（`07a5822...`）
- `a-d3-deterministic-test-files`（A正式审计清单及五个测试文件SHA-256）

## 原始命令

- `npm.cmd test -- --maxWorkers=1 --run tests/activity-rubric.test.ts tests/evaluation-protocol.test.ts tests/python-process-evaluation.test.ts tests/python-process-evaluation-r2.test.ts tests/knowledge-state.test.ts tests/activity-runtime-service.test.ts`（批准环境执行；期望退出码 0）

## 期望项数与指标

- 两个正式任务 × 四类故障 = 8个故障场景
- 每个场景验证：ActivityResult未评分、无负Evidence、mastery/confidence/KnowledgeState版本不降低、路径后缀和checkpoint不变、失败运行和草稿保留，共16项状态断言
- `negativeEvidenceCount` = `0`

## 机械PASS条件

- 两个任务均覆盖四类故障
- ActivityResult保持 `not_graded` 或等价公共失败
- 不生成正式负Evidence
- mastery、confidence、KnowledgeState版本、路径后缀和checkpoint均不降低或变化
- 失败运行和学习者草稿按合同保留

任一输入仍为PENDING、命令退出码不符或状态断言失败只能记录 BLOCKED，归因按D47登记 `AUDIT_INPUT_INCOMPLETE`、`ENVIRONMENT_MISMATCH` 或 `CODE_DEFECT`；D3不执行该命令。
