# 负责人 W2 V2-6 测试超时修复与 D 复验说明

## 1. 身份与边界

- 修复编号：`OWNER-W4-V2-6-TIMEOUT-1`
- 适用基线：`6b8d87541919ffba64bcc2845bfad47ffffcdf0a`
- W4 合同：`W4-C2 / W4-R1`
- 性质：负责人批准的跨岗位测试基础设施修复，不是 D 业务实现修复。
- D 的 30 项候选业务文件保持不变；本包两份 W2 文件不得计入 D 的岗位所有权、候选 Manifest 或 D 提交说明。
- 本包不修改 20/60 输入、冻结哈希、诊断规则、KnowledgeState、D Agent、画像、fallback 或任何产品运行行为。

## 2. 已确认根因

1. `v2-comprehensive-verification.test.mjs` 的 V2-6 外层预算固定为 30 秒。
2. `v2-6-preconditions.test.mjs` 的 20+60 运行时重算预算固定为 60 秒。
3. D 的合同环境证据显示，同一 direct runner 实际需要约 64.5 至 69.5 秒；因此 direct 的 `runtime.exitCode=1` 是内层 60 秒测试超时，不是输入错误或 D 业务断言失败。
4. 外层超时后继续运行的嵌套任务会干扰后续 Python evaluator；使用 15 秒 Python 测试诊断时，Python evaluator 在全量套件中全部通过，唯一失败仍是外层 W2 V2-6 30 秒超时。

## 3. 本包修改

| 文件 | 原预算 | 新预算 | 原因 |
|---|---:|---:|---|
| `pi-study-helper/scripts/w2-verification/v2-6-preconditions.test.mjs` | 60 秒 | 120 秒 | 为合同环境实测 64.5 至 69.5 秒保留有界余量 |
| `pi-study-helper/scripts/w2-verification/v2-comprehensive-verification.test.mjs` | 30 秒 | 150 秒 | 必须大于内层 120 秒，等待子任务自然返回后再断言 |

没有修改全局 Vitest timeout，也没有取消超时保护。

## 4. 应用前核对

在覆盖前，D 应确认正式上游包含 A、B 提交，且这两份旧文件的 SHA-256 分别为：

```text
9175ceec43994b0260c1a452d51a32fffaa6f50de5b5656b7e176b72d1fa48f8  pi-study-helper/scripts/w2-verification/v2-comprehensive-verification.test.mjs
2c23584f0a53c0371a533befb7443043b201292301a2341a4296e64a8a3df41e  pi-study-helper/scripts/w2-verification/v2-6-preconditions.test.mjs
```

若不一致，停止覆盖并报告实际 HEAD、文件哈希和差异，不得自行合并。

本包新文件哈希见 `file-sha256.json`。解压后应保持本包中的相对路径，将两份文件覆盖到同名仓库路径。

## 5. D 的正式复验

使用全新的临时 worktree 和新的 PowerShell 会话，避免继承此前超时诊断残留进程。环境必须为：

```text
Node v22.23.1
Python 3.13.7
Pandas 3.0.5
PYTHONNOUSERSITE=1
```

按顺序执行：

```powershell
npm.cmd test -- --run scripts/w2-verification/v2-comprehensive-verification.test.mjs --maxWorkers=1 --reporter=verbose
node scripts/w2-verification/v2-6-preconditions.mjs --development ../evaluation/personas/development-20.jsonl --final ../evaluation/personas/final-60.jsonl --profile fixtures/profiles/pandas-cleaning-v2-draft
npm.cmd test -- --run scripts/w2-verification/v2-6-preconditions.test.mjs --maxWorkers=1 --reporter=verbose
npm.cmd run verify
git diff --check
```

执行 `npm.cmd run verify` 的仓库外命令记录器总预算不得再设为 124 秒或 304 秒，应至少为 900 秒；这只是记录器等待预算，不修改仓库测试语义。

## 6. 通过标准

- comprehensive 中 V2-6 自然退出 0，不再触发 30 秒超时；
- direct runner 返回 `status=PASS`、`runtime.exitCode=0`，20/60 数量和两个冻结哈希不变；
- isolated V2-6 自然退出 0；
- 原始 `npm.cmd run verify` 自然结束，Python evaluator 不再发生级联失败；
- 首次历史失败、后续不可复现记录和本次修复后 PASS 必须分别保留，不能覆盖历史证据；
- 任何非 W2 超时的新失败都应停止并提交完整 stdout/stderr，不得只提交内部哈希。

## 7. 上传纪律

本包只用于负责人修复和 D 独立复验。D 不得把两份 W2 文件写入自己的 30 项候选 Manifest，也不得以 D 岗位身份提交它们。负责人应先以独立负责人提交把该修复进入 `origin/main`；D 随后拉取该正式负责人提交，在新 HEAD 上复验并重建 D 的证据和交接材料。

