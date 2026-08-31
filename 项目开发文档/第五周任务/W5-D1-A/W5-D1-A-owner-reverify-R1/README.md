# W5-D1-A 负责人独立复验证据包

## 证据性质

本目录记录负责人在合同环境中对 A W5-D1 候选的独立复验结果，标记为 `OWNER_INDEPENDENT_REVERIFY`。这些日志不是 A 首次运行的原始日志，不替代 A 已报告的历史结果；A 的历史 `740 passed / 25 failed / 1 skipped` 及首次日志缺失说明必须继续保留。

## 绑定输入

- 合同：`W5-C1/W5-R1`
- `W5_START_COMMIT`：`4e316822d343d90bdf295f37b7aaaa0131890501`
- 候选基线 HEAD：`768f3eae00c50da1c7563a7efd1447e5021f29c8`
- 候选状态：未提交、未推送、未申请上传锁
- 独立工作目录：`C:/Users/win11/AppData/Local/Temp/w5-d1-a-candidate-66b0558378e44d94b8aa609a0887320f/pi-study-helper`

## 合同环境

- Node `v22.23.1`
- npm `10.9.8`
- Python `3.13.7`
- Pandas `3.0.5`
- dateutil `2.9.0.post0`
- `PYTHONNOUSERSITE=1`

## 通过结果

- A 定向：6 个文件 / 41 项通过；
- Python evaluator：2 个文件 / 26 项通过；
- 全量 Vitest：87 个文件 / 765 通过 / 0 失败 / 1 跳过；
- `npm run verify`：退出码 0；
- `typecheck`、`check:docs`、`build:web`、`check:release`、`smoke:extension`、`git diff --check`：退出码 0。

每条命令的工作目录、UTC 时间、退出码、stdout/stderr 字节数及 SHA-256 见 `owner-reverify-command-results.json`。

## 历史尝试

首次全量和 verify 曾被宿主控制信号中止，首次 smoke 探针曾超过 30 秒；对应原始日志仍保留在本目录的 `full-vitest.stdout.log`、`verify.stdout.log` 和 `smoke-extension.stdout.log`。随后改用无 PTY 独立进程重跑，三项均通过。历史中止/超时不得写成候选测试失败，也不得从证据中删除。

## A 后续动作

A 应将本证据包绑定到 R1 handoff 和 Manifest，保留历史结果，不伪造首次日志；最终版 `handoff-w5-a-d1.md` 必须加入逐文件 SHA-256。完成 ZIP、sidecar 和 Manifest 重建并通过负责人复核前，不得 commit、push 或申请上传锁。
