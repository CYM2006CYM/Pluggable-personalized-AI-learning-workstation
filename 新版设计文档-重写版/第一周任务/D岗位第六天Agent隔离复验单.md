# D 岗位第六天 Agent 隔离复验单

- 前置：C 已上传评测资产通路修复。
- 顺序：**第 4 步；仅在拉取 C 后开始。D 上传后由 E 拉取并全量复验。**
- 验收依据：仅第一周 D01—D14；D15—D20 不追溯适用。

## 任务

复验并在必要时最小修复 D 的模型端口、编排、录制响应和 fallback 边界，确保 B/C 的隔离修复没有通过 Agent 上下文、checkpoint、trace、fallback 或公开 fixture 再次泄漏受限资产。

必须验证：

1. Agent 输入不含答案、隐藏测试、参考实现、完整 Rubric、私有数据和宿主绝对路径。
2. 模型结果、traceSummary、checkpoint、录制响应及 fallback 只保留安全投影；失败和超时继续产生固定安全降级。
3. Agent 不写答案、分数、Evidence、KnowledgeState 或路径等权威事实；取消不伪装成模型失败。

不得修改 B 的资产正文、C 的评测规则、A 的公共合同，或借修复引入实时模型、额外依赖或 D15—D20 的后续功能。

## 交付与验收

- 交付：Agent 安全输入 / 输出清单及复验记录。
- 最小验证：`model-execution-port.test.ts`、`review-orchestrator.test.ts`、`v2-learning-graphs.test.ts`、`smoke:extension`、`npm.cmd pack --dry-run`。
- 通过标准：权限、结构、超时、fallback 与中断恢复测试均通过；打包产物和 Agent 可见表面均不含受限资产。

上传后通知 E 拉取。E 将从最新提交重新运行全部第六天审计；在 E 出具 Go 结论前，不得自行宣布通过。
