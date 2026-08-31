# W5-D3 C R3 交接单

## 状态

- 合同：`W5-C1/W5-R1`
- 基线：`383690831a8b3de42dad58795e71f218678f6fbc`
- 裁决：`W5-D64-PYODIDE-1`
- 结论：`PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- `PYODIDE_ENABLED=false`
- `LIVE_MODEL=LIVE_NOT_RUN`
- 权限：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## R3 整改

- `proposed-files.txt` 已纳入正式文件集合；最终 ZIP 解压后可直接运行 Manifest、安全扫描和重新组包工具。
- 环境版本、平台、allowedLibraries、环境锁 SHA-256、规范 environmentHash、阈值和能力均由 `measure-environment.mjs` 现场采集。
- Windows 进程树能力由受控 runner 创建子进程并记录 PID；正式超时后 PID 级检查确认子进程不再存活。
- 10 组输入均来自真实组合根和 HTTP `/run` 签发的公开执行包，覆盖 5 个代码活动，每组绑定公开包字段并完成 Node 三连测。
- 全部拟提交文件通过隔离 Git index 的 intent-to-add 差异检查；不再以普通 `git diff --check` 忽略 untracked 文件。
- 报告、JSON、日志和交付材料使用仓库相对路径或占位符，不登记宿主绝对路径。
- 删除对缺失R1测试的现行依赖；普通测试不再写正式证据，证据只由显式采集命令生成。
- R2换行敏感seal失败不再归因为B回归；精确R3候选在负责人合同环境全量通过。
- 安全扫描覆盖正式文件、handoff、审计日志和外层交付报告。

## 冻结绑定

- revision 3 环境锁 SHA-256：`59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43`
- revision 3 `assetTreeSha256`：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- revision 2 逐字节不变。
- C 未修改 Profile、seal、Rubric、hidden tests、reference solution、gold、SDK、依赖、锁文件或 A/B/D/E 所有权文件。

## 能力结论

- Node 真实环境已验证。
- Pyodide 十组均为 `NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`。
- `processTreeTermination=true` 仅依据本轮 PID 级实测。
- `networkIsolation=false`，`reliableMemoryLimit=false`，均未证明。
- 本交付不是 Pyodide 启用、双后端测量或 W5 GO。

## 历史失败

R1 已登记的 `vitest_not_found`、D3 测试类型错误、`runner_crash` 和首次外部 smoke 超时均保留。R2 新增的公开包错误断言、草稿版本冲突和拟提交文件缺失也按真实结果登记，不改写为 PASS。

## R3 command outcome (2026-08-22)

- D3 public package: PASS, 1 file / 5 tests; 10 groups, 30 Node runs, 10 Pyodide `NOT_RUN`.
- Process tree: PASS, PID-level child termination verified.
- Fault matrix: PASS.
- Public-run and Python evaluator regression: PASS, 3 files / 30 tests.
- Typecheck, build-demo, build-web, check-docs, smoke-extension, check-release: PASS.
- Isolated candidate diff check: PASS, 26/26 files covered; `git diff --check` exit 0.
- Full test: PASS, 98 files / 824 passed / 1 skipped / 0 failed.
- Environment: Node 22.23.1, npm 10.9.8, Python 3.13.7, Pandas 3.0.5, win32/x64；Windows构建号按实际测量记录。`networkIsolation=false`和`reliableMemoryLimit=false`保持未证明。
- Detailed command records and log hashes: `pi-study-helper/scripts/w5-c-d3/command-results.json`.

## Delivery state

`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`
