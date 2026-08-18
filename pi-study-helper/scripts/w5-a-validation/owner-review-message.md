# W5-D1 岗位 A 负责人审核说明

请审核以下候选：

- 基线：`W5_START_COMMIT=4e316822d343d90bdf295f37b7aaaa0131890501`
- 候选基线：`768f3eae00c50da1c7563a7efd1447e5021f29c8`
- 正式 commit / `origin/main`：`de9718ca94fb1aae0f2bcb0c8348d39267969961`
- 合同：`W5-C1/W5-R1`
- 当前状态：`COMMITTED / PUSHED / uploadLock=GRANTED`

## 本次交付

1. 严格的 `PublicExecutionBundle`、公开运行类型和 `BrowserCodeRunner`。
2. 纯应用层安全投影与 validator：规范摘要、固定五分钟过期、session/activity/revision/environment 绑定、公开资产路径与内容哈希校验。
3. `prepareActivityRun` 的当前 Attempt 和活动生命周期校验，以及预览无正式学习事实副作用证明。
4. 公开测试、私有测试伪装、越界路径、Rubric/参考实现/宿主路径泄漏等正反向测试。
5. 仅按授权更新 Web DTO 夹具中的 `activityId`，未修改页面或 API client。

## 验证结论

- 定向回归：`6 files / 41 tests PASS`。
- `typecheck`、docs、Web build、extension smoke、release、`git diff --check`：PASS。
- 原始机器历史结果：`740 passed / 25 failed / 1 skipped`；失败归因是原始机器缺少合同要求的 Python `3.13.7 + Pandas 3.0.5`，该历史事实继续保留。
- 负责人合同环境独立复验：A 定向 `6 files / 41 tests PASS`，Python evaluator `2 files / 26 tests PASS`，全量 `87 files / 765 passed / 0 failed / 1 skipped`，`verify`、typecheck、docs、Web build、release、extension smoke、diff check 全部 PASS。
- 详细复验记录、实际路径、命令、时间、退出码和 stdout/stderr SHA-256：`pi-study-helper/scripts/w5-a-validation/owner-revalidation-w5-d1-r1.json`。负责人原始复验包外层 SHA-256：`5be2fdb03593a99ae0de9ae040b3797d012785363a8dccbb4be803b341fe9127`。

## 当前裁决与后续顺序

- 是否同意本候选的文件范围和 Web 夹具例外。
- 原始机器的 Python 环境缺失仅作为历史运行事实保留，不构成当前候选的全量/verify 阻塞；负责人合同环境独立复验已通过。
- A 的正式 commit 已推送到 `origin/main`；C 可按 `A -> C` 顺序消费该正式上游。
- 本包不替代正式 commit，也不包含 ZIP/sidecar；ZIP 和 sidecar 保留在交付目录供审核留存。
