# W4-D1-A-4 最终独立复验报告

## 结论

- 唯一候选：`W4-D1-A-4-owner-audit-final4-20260813.zip`
- 候选 ZIP SHA-256：`866285e7299001987d3fa99b91896950b7b4cb586f67bcfaa74b6f891212502f`
- 基线：`dc23504c3f353883d4f665e64a47cee9afb5723a`
- W4 起点：`ac6e307e17cf84450845dfc5ffa467063dd3ae4c`
- 合同：`W4-C2 / W4-R1`
- 复验结论：候选核心整改、Python 评测、三套 TypeScript 编译、文档与发布检查通过；未发现新增逻辑 blocker。
- smoke 结论：`BLOCKED_BASELINE_REPRODUCIBLE`。A-4 两次均在 30 秒内未返回 `get_state`；负责人已确认 `dc23504` 干净基线同环境可复现并批准按环境/基础设施或既有探针阻塞处理。不得标记为 PASS，也不得归因于 A-4 回归。
- `verify`：未作为整体 PASS。按脚本分项执行并逐项报告。
- 状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`。

## 包与范围核验

- manifest：70 个载荷条目、55 个候选文件，逐文件 SHA-256 和字节数闭合。
- `tracked-changes.patch` SHA-256：`66662b355b9d47fe57935b8b838af6092d8abfdef3015ba8b70bb4b9831f3dfc`。
- clean baseline `git apply --check`：PASS，exit code 0。
- 独立 detached worktree 基于 `dc23504` 应用候选：PASS。
- 差异：25 个 tracked、30 个新增文件；仅包含 A 授权范围、两个批准 Web 文件和一个批准 W2 test-local 兼容文件。
- 未发现 SDK、依赖/锁文件、B/D/C/E 正式资产、gold、Rubric、hidden tests、私有答案、reference solutions、历史 ZIP、sidecar 或 Git 元数据进入候选。

## 环境

- Node：`v22.23.1`
- Python：`3.13.7`
- Pandas：`3.0.5`
- 候选 worktree：`C:\Users\VIVIAN\OneDrive\Desktop\cym云枢智学\W4-D1-A-4-reverification-20260813090548395\worktree`
- 所有复验均在仓库外独立 worktree/导出目录执行；正式工作区未被本轮复验修改。

## 测试与门禁结果

| 项目 | 退出码 | 耗时 | 结果与归因 |
| --- | ---: | ---: | --- |
| 核心整改套件首次 | 1 | 23.041s | `86/87`；单个严格 `<100ms` 时序断言抖动 |
| `path-runtime` 隔离复跑 | 0 | 3.808s | `8/8 PASS` |
| 核心整改套件完整复跑 | 0 | 11.501s | `9 files / 87 tests PASS` |
| Python 评测 | 0 | 78.298s | `2 files / 26 tests PASS` |
| 全量 Vitest | 1 | 270.268s | `69 files PASS / 1 file FAIL`; `689 passed / 1 failed / 1 skipped`。唯一失败为既有 V2-6 外层 30 秒包装器超时 |
| V2-6 直接复算 | 0 | 48.329s | 20 development + 60 final，PASS |
| V2-6 独立运行时测试 | 0 | 43.363s | `1 file / 5 tests PASS` |
| `tsc --noEmit` | 0 | 通过 | PASS |
| `tsc -p tsconfig.test.json` | 0 | 通过 | PASS |
| `tsc -p tsconfig.web.json` | 0 | 通过 | PASS |
| `npm run typecheck` | 0 | 通过 | 三套编译均 PASS |
| `npm run check:docs` | 0 | 通过 | PASS |
| `npm run check:release` | 0 | 通过 | PASS |
| `git diff --check` | 0 | 通过 | PASS |
| A-4 smoke 第一次 | 1 | 31.083s | 30 秒未返回 `get_state` |
| A-4 smoke 第二次 | 1 | 31.068s | 30 秒未返回 `get_state` |

每条命令的精确 UTC 起止时间、工作目录、退出码、耗时和 stdout/stderr SHA-256 见 `command-results.json` 与 `command-logs/`。

## Verify 分项

`npm run verify` 的组成项按要求分开执行：

- typecheck：PASS
- full Vitest：非零退出；仅 V2-6 外层 30 秒包装器超时，直接复算与独立运行时测试均 PASS
- check:docs：PASS
- smoke:extension：`BLOCKED_BASELINE_REPRODUCIBLE`
- check:release：PASS

因此不得声称 `npm run verify` 整体 PASS。

## Smoke 证据说明

包内附 A-4 两次 smoke 的完整 stdout/stderr 和 JSON 元数据。负责人已完成并裁定 `dc23504` 干净基线在相同 Node、依赖版本与脚本下同样超时，因此本报告按授权记为 `BLOCKED_BASELINE_REPRODUCIBLE`。负责人执行产生的外部原始日志未随裁决消息提供，不能伪造或声称已收入本包；本包以 `owner-baseline-smoke-adjudication.txt` 保存裁决原文，并附本轮实际基线补跑的完整日志。

为补齐可交付日志，本轮又从 `dc23504` 导出基线并复用相同依赖目录补跑一次；该次约 8 秒通过。此补跑说明探针存在时序波动，不覆盖负责人已确认的基线超时事实，也不把 A-4 两次超时改写为 PASS。候选与基线的 `package.json`、`package-lock.json`、`scripts/smoke-extension.mjs`、`src/extension/index.ts` 哈希完全一致，详见 `baseline-candidate-key-hashes.json`。

## 重点合同结论

1. `all_in_order` 保留目标 `finalActivityId`，最终实操计入顺序和时间预算。
2. Bootstrap 节点状态由服务端 `activityProgress` 投影。
3. 公共 `getSnapshot()` 严格校验版本；内部绑定读取使用 `getBoundSnapshot()`。
4. 诊断、Quiz、Code 使用内部 `RuntimeCommitContext` 传递本次冻结事实。
5. 幂等重放持久识别为 `replayed=true`，不重复触发 capability task。
6. capability task 使用提交后的冻结 snapshot，不异步读取后续最新快照。
7. `completeSession()` 按 Profile 目标 `finalActivityId` 判定最终实操。
8. 公共 `CapabilityTaskPort` 未新增内部字段，内部上下文未暴露到公共 DTO。

## 剩余失败归因

- V2-6 外层 30 秒包装器：既有包装预算超时；直接 20+60 复算和独立运行时测试通过，不属于 A-4 逻辑失败。
- A-4 smoke：负责人批准的基线可复现环境/基础设施或既有探针阻塞；不归因候选回归，不标记 PASS。
- 无 Windows `EPERM` 出现在本轮全量测试结果中。
- 无其他失败或新增逻辑 blocker。

最终是否授予 uploadLock 由负责人裁定；本次复验不申请、不授予、不执行上传锁。
