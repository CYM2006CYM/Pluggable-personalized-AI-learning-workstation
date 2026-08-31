# V3-2 测试用例合同

## 目标

验证20例原始预算不可行结构、全部掌握和缺失先修fixture。

## 冻结输入

- `w3-start-commit`
- `development-20`
- `owner-profile-approval`
- `a-d1-v3-2-evidence`
- `a-d3-formal-commit`
- `b-task-bundles-file`
- `c-environment-lock`

## 原始命令

- `npm.cmd test -- --maxWorkers=1 --run tests/path-engine-development-20.test.ts`（期望退出码 0）

## 期望项数与指标

- `expectedTestItems` = `220`
- `originalCases` = `20`
- `runsPerCase` = `10`
- `boundaryFixtures` = `2`
- `boundaryRunsPerFixture` = `10`
- `illegalPathCount` = `0`
- `projectionRuleVersion` = `w3-v3-original-budget-v1`

## 机械PASS条件

- 20例原始预算结果结构均合法
- 全部掌握fixture确定且先修可跳过
- 缺失先修fixture不跨越先修闭包
- 非法路径为0

任一命令退出码不符、指标缺失、输入哈希不匹配或机械条件不满足时只能记录 BLOCKED，失败所有者为：A。D3不得执行这些命令或填写最终结论。
