# V3-5 测试用例合同

## 目标

验证requestId+attemptId幂等及每个正式提交阶段故障无半写。

## 冻结输入

- `a-d3-formal-commit`
- `owner-profile-approval`
- `b-task-bundles-file`
- `c-formal-commit`
- `c-binding-fix-commit`

## 原始命令

- `npm.cmd run typecheck`（期望退出码 0）
- `npm.cmd test -- --maxWorkers=1`（期望退出码 0）

## 期望项数与指标

- `expectedTestItems` = `6`
- `idempotencyCases` = `1`
- `faultStages` = `attempt,evidence,knowledge_state,path_suffix,checkpoint_publish`
- `halfWritesAllowed` = `0`

## 机械PASS条件

- 重复requestId+attemptId不重复计分
- 五个阶段逐一注入故障
- 每次失败后正式事实快照不出现半写
- 恢复后结果确定且不重复Evidence

任一命令退出码不符、指标缺失、输入哈希不匹配或机械条件不满足时只能记录 BLOCKED，失败所有者为：A。D3不得执行这些命令或填写最终结论。
