# W5-D4 A R2 负责人代整改交付报告

- 合同：`W5-C1/W5-R1`
- 基线：`a0d5a37116a6c67f009ca19e313501d9eed96f78`
- ZIP：`W5-D4-A-R2-owner-rectified.zip`
- ZIP SHA-256：`5c8b7de1c53c4af679b3a146c0351081962b350c84900b014b0d7641fb102429`
- ZIP条目：26项，与正式`proposed-files.txt`逐项一致
- Manifest：25项逐文件哈希，唯一selfExcluded为Manifest自身
- Manifest SHA-256：`590512062dd1afd2ffdd567dcf5f8d963480d651bff35cb666a16d5aefa41725`
- 当前状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 阻塞闭合

1. 跨端Attempt安全读取增加可选`evidenceId/evidenceVersion`；TUI重启和Web刷新均机械核对正式提交返回的同一Evidence引用。
2. 合同环境定向为`6 files / 29 passed`；最终全量为`104 files / 845 passed / 1 skipped / 0 failed`。
3. 正式候选26项通过隔离Git index清单核对和`git diff --cached --check`；外层本报告、ZIP和sidecar均为`AUDIT_ONLY / NOT_FOR_GIT`。

## 历史失败

- A原非合同环境全量失败保留；
- 负责人整改初次npm包装命令未进入TypeScript编译的环境失败保留；
- 负责人首轮全量出现一次正式评测第三次运行`evaluator_timeout`，未改4000ms阈值，完整全量复跑通过；
- 审计证据重生成曾误用不存在的Vitest reporter，测试未启动，不作为候选测试结果。

## 边界

三案例实际PathEngine输出已生成，但仍待E独立复验路径合法性、页面展示和差异。页面关闭态、完整故障矩阵、V5整体结论及W5 GO均未提前签署。`LIVE_MODEL=LIVE_NOT_RUN`。
