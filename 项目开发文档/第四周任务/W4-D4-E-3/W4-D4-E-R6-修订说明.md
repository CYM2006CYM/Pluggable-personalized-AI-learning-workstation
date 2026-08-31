# W4-D4-E R6 修订说明

## 修订范围

本说明针对 W4-D4-E R5 复验结果及负责人后续独立审验发现的问题。R5 ZIP、原始日志和历史报告均作为历史证据保留，不直接改写。

## 已修复的源码问题

文件：`pi-study-helper/src/web/pages/PathPage.tsx`

路径确认后刷新时，浏览器历史状态可能仍携带旧的 `location.state.candidate`。修订后，服务端 Bootstrap 返回的 `session.path` 在状态为 `active`、`confirmed` 或 `completed` 时具有权威优先级；只有服务端没有权威路径时才使用历史候选。确认响应也不再依赖历史候选才能渲染路径。

新增回归测试：`pi-study-helper/tests/web/pages.test.tsx`

- 同时注入旧 candidate 和服务端 active path；
- 页面必须显示“进入学习”，不能显示“确认路径”；
- 点击“进入学习”必须调用 `getNextStep()`；
- 不得再次调用 `confirmPath()`。

## 复验结果

合同环境：Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、`PYTHONNOUSERSITE=1`。

- Web 页面定向测试：25/25 通过；
- `typecheck`：通过；
- 完整 `verify`：85 个文件、741 passed、1 skipped、0 failed；
- `check:docs`、`smoke:extension`、`check:release`、`git diff --check`：通过。

## R5 历史证据的处理要求

以下问题不能通过修改历史 ZIP 解决，必须由 E 以 R6 或更高版本重新生成证据：

1. 旧报告中的 PASS 结论必须标记为 `HISTORICAL_SUPERSEDED`，当前报告统一反映源码修复后的结论；
2. 浏览器流程脚本不得依赖固定 `250ms` 等待，也不能因按钮暂时不存在直接 `break`；应等待题号、草稿版本或题面变化，并记录超时上下文；
3. 浏览器流程必须作为统一命令结果中的独立命令，记录真实 `exitCode`、时间、stdout/stderr 和 SHA-256；
4. `evidence-index` 的 `archivePath` 必须与 ZIP 内实际路径一致；
5. ZIP、Manifest 和报告中的文件数统一写为 `68/68`，不得写成“68 个条目对应 67 个文件”。

当前仅完成源码修复和本地复验，未执行 `git add`、`commit`、`push`，不授予上传锁，也不声明 W4 GO。E 需基于当前源码重新执行真实浏览器两种入口、刷新恢复、学习卡片、题组 Attempt 和提交后推进流程，并生成一套内部结论一致的新证据包。
