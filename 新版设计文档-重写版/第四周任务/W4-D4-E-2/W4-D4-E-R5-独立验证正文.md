# W4-D4 E R5 独立验证正文

## 环境与端口

本轮使用仓库外独立环境：Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`，并设置 `PYTHONNOUSERSITE=1`。固定 Demo 使用合同端口 `4310/5173`。

## 缺陷与闭合

1. E 刷新恢复只把非 `in_progress` 状态当作已提交，导致首次 `insufficient` 的合法重试游标显示 EMPTY。现改为读取服务端 `result`，并按 `status=in_progress + quizRetryCount=1` 创建新 Attempt 重试。
2. A 的 `getNextStep()` 在卡片未确认时漏返后续活动，E 因 `completed=false/activity缺失` 误跳总结。现 A 同时返回卡片与首个未终止活动；E 对异常缺活动快照只允许重新读取，不再进入总结。
3. 预算 120 分钟无法覆盖完整目标时返回 `path_infeasible`，属于冻结的确定性规则，不作为代码缺陷处理；400 分钟轨迹已通过。

## 验证

- Python evaluator：26/26。
- A/E 受影响回归：35/35。
- Web：71/71。
- 全量 `verify`：740 passed / 1 skipped / 0 failed。
- 固定 Demo 浏览器：诊断草稿、路径、首次 insufficient 重试、提交后推进、教学卡片、4 题 fixed 组和 Attempt 刷新恢复均通过。

## 状态

`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

本结论不是 W4 GO；真实 Key 仍为 `LIVE_NOT_RUN`。
