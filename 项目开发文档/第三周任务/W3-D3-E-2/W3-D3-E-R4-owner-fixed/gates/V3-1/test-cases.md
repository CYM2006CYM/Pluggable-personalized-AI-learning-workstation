# V3-1 测试用例合同

## 目标

20例按w3-v3-feasible-180-v1仅投影availableMinutes=180，每例10次。

## 冻结输入

- `w3-start-commit`
- `development-20`
- `owner-profile-approval`
- `a-d1-v3-1-evidence`
- `a-d3-formal-commit`
- `b-task-bundles-file`
- `c-environment-lock`

## 原始命令

- `npm.cmd test -- --maxWorkers=1 --run tests/path-engine-development-20.test.ts`（期望退出码 0）

## 期望项数与指标

- `expectedTestItems` = `200`
- `caseCount` = `20`
- `runsPerCase` = `10`
- `candidateCount` = `20`
- `identicalSnapshots` = `20`
- `actualPathLegalRate` = `1`
- `projectionRuleVersion` = `w3-v3-feasible-180-v1`

## 机械PASS条件

- 20/20均产生candidate
- 每例10次输出哈希唯一数为1
- 实际路径合法率100%
- 输入投影只改变availableMinutes

任一命令退出码不符、指标缺失、输入哈希不匹配或机械条件不满足时只能记录 BLOCKED，失败所有者为：A。D3不得执行这些命令或填写最终结论。
