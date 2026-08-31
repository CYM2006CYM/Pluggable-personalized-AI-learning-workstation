# W3-D4 岗位E独立验证正文

## 1. 结论边界

```text
contractVersion = W3-C5/W3-R2
baselineCommit = af7386276d8a6e56e5263942b29b53e6d861250c
candidateConclusion = PASS
ownerFinalReview = PENDING
NOT_COMMITTED
NOT_PUSHED
uploadLock = NOT_REQUESTED
```

本结论是岗位E提交负责人复核的候选结论，不是负责人第三周正式签署或Go/No-Go。旧D4工作树的V3-8仅含5个Web测试文件、61项测试，未绑定D2-R2的27个冻结文件，因此该旧V3-8结论已作废并保留为历史失败证据。本次在独立工作树中恢复正确D2-R2候选后重新形成V3-8证据。

## 2. 输入与工作树

- 工作树：`D:/.A_C_code/PPALW/W3-D4/final-r2-worktree`
- `HEAD == origin/main == af7386276d8a6e56e5263942b29b53e6d861250c`
- D2-R2 ZIP SHA-256：`678bb456f824d90d7eed3c7a71a71666bdd44a9fbf302e690c95603d1a72525e`
- 候选绑定：`candidateFiles=27, matched=27, missing=0, unexpectedMismatch=0, extraEFiles=0`
- `pi-study-helper/tests/web/boundary-contract.test.mjs`：存在且哈希匹配
- D1标注 SHA-256：`af450ede185be215e12e5d13688ebc7b34cb3af9816f50803e5612c2219da266`
- D1封存记录 SHA-256：`e96569d1a47395649300e016e5f582d66dfb9dac1b7294840340b5222f21a636`

首次恢复后及全部测试完成后各执行一次27文件逐文件核对，两次均为27/27一致。测试与构建没有改写冻结候选。

## 3. V3-8

`npm.cmd run test:web`退出0，实际为6个测试文件、81/81通过。测试覆盖：六页路由及缺少`nodeId`的反例、六页`ready/empty/error/session_version_conflict/recovery`状态、活动四阶段、`score=0.78`且不转百分制、真实DOM按钮恢复、草稿跨冲突/错误/恢复/路由逐字保留、DTO字段合同、固定依赖与Web边界。

独立AST扫描分别追踪`FACADE_DTO_MOCKS`和`PAGE_DISPLAY_FIXTURES`可达初始化对象，两组各扫描10类禁止内容，均为0命中。扫描48个Web层外源文件，页面fixture非Web导入为0。扫描14个Web源文件，真实HTTP、Pyodide、客户端评分/PASS、路径/mastery计算和正式仓储写入命中为0。

`build:web`、`typecheck`、全量测试和全部聚合门禁均退出0。因此V3-8候选结论为`PASS`。

## 4. V3-1至V3-7与固定轨迹

V3-1、V3-2、V3-4和V3-7输入哈希未变化，保留既有原始证据。D47批准环境下的V3-3、V3-5、V3-6及平台兼容证据保持不变：V3-3为3文件30/30，V3-5为2文件37/37，V3-6为6文件51/51，D47平台兼容为1文件5/5。没有重写这些原始证据。

固定轨迹Demo为1文件23/23通过，继续登记`LIVE_NOT_RUN`，未使用真实Key；mock/fallback结果不代表在线模型能力。

| 门禁 | 最终候选状态 | 证据 |
|---|---|---|
| V3-1 | PASS | 原D4证据按字节保留 |
| V3-2 | PASS | 原D4证据按字节保留 |
| V3-3 | PASS | D47批准环境复验30/30 |
| V3-4 | PASS | 原测试证据及D47四文件边界复核 |
| V3-5 | PASS | 两个正式仓储测试37/37 |
| V3-6 | PASS | 冻结故障矩阵51/51 |
| V3-7 | PASS | 60例只读候选冻结、顺序和哈希证据 |
| V3-8 | PASS | D2-R2 27/27、6文件81/81及双组扫描 |

## 5. 聚合门禁

| 命令 | 实际结果 |
|---|---|
| `npm.cmd ci` | 退出0 |
| `npm.cmd run test:web` | 退出0；6文件、81通过 |
| `npm.cmd run build:web` | 退出0 |
| `npm.cmd run typecheck` | 退出0 |
| `npm.cmd test -- --run --maxWorkers=1` | 退出0；60文件、636通过、1跳过 |
| `npm.cmd run check:docs` | 退出0 |
| `npm.cmd run smoke:extension` | 退出0 |
| `npm.cmd run check:release` | 退出0 |
| `npm.cmd run verify` | 退出0；60文件、636通过、1跳过 |
| `git diff --check` | 退出0 |

普通`git diff --check`及当前`check:release`主要覆盖tracked内容，不能单独证明未跟踪的`src/web`与`tests/web`安全。因此本审核包同时提供27文件哈希、6文件81/81边界测试、双组AST泄漏扫描和未跟踪状态记录。获得上传锁并按白名单暂存后，仍必须在commit前执行`git diff --cached --check`、`npm.cmd run check:release`和`npm.cmd run verify`，并先交负责人复核暂存区文件清单。

## 6. 权限与未决项

本次未修改A/B/C/D、D40环境锁、D47负责人修复、Profile、gold、SDK或依赖；未读取OWNER-ONLY材料、B原始标注或机械差异；未运行在线模型。唯一未决项是负责人对审核包和拟提交清单的复核。未经确认不申请上传锁、不暂存、不commit、不push。
