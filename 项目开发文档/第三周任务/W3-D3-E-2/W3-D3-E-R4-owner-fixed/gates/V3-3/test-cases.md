# V3-3 测试用例合同

## 目标

两个正式任务覆盖正确、部分正确和六类学习者错误，每类连续3次。

## 冻结输入

- `b-formal-commit`
- `b-task-bundles-file`
- `b-asset-inspect`
- `b-asset-practical`
- `c-formal-commit`
- `c-binding-fix-commit`
- `c-environment-lock`
- `c-environment-hash`
- `a-d3-formal-commit`

## 原始命令

- `npm.cmd test -- --maxWorkers=1 --run tests/activity-rubric.test.ts tests/python-process-evaluation.test.ts tests/python-process-evaluation-r2.test.ts`（期望退出码 0）

## 期望项数与指标

- `expectedTestItems` = `48`
- `taskCount` = `2`
- `classificationCountPerTask` = `8`
- `repeatCount` = `3`
- `requiredClasses` = `correct,partially_correct,syntax_error,runtime_error,test_failed,timeout,output_limit,disallowed_import`

## 机械PASS条件

- 两个任务均覆盖8类结果
- 每类连续3次逐字段一致
- 错误归因符合learner/evaluator边界
- 公共结果不暴露隐藏材料

任一命令退出码不符、指标缺失、输入哈希不匹配或机械条件不满足时只能记录 BLOCKED，失败所有者为：C（业务资产问题点名B）。D3不得执行这些命令或填写最终结论。
