# W5-D3-C-R3 验证报告

## 结论

R3在R2主体通过的基础上关闭最终证据集合缺口：采集器不再依赖缺失的R1测试；普通测试不改写正式证据；全部命令结果来自精确26项候选和负责人合同环境；全量无失败。业务方向及`W5-D64-PYODIDE-1`不变。

## 实测范围

- `public-package-runs.json`：真实组合根、真实 HTTP `/run`、5 个代码活动、每个 2 组、每组 Node 3 次。
- `process-tree-evidence.json`：受控 runner 创建子进程、记录 PID、正式超时、PID 最终不存活。
- `environment-measurement.json`：逐命令记录 UTC、退出码、stdout/stderr 字节数与 SHA-256、结果值和依据。
- `fault-matrix.json`：逐项区分适配器边界、仓储状态读取和真实组合根快照依据，不使用统一硬编码的无副作用声明。
- `diff-check.json`：隔离 `GIT_INDEX_FILE`，对全部拟提交文件执行 intent-to-add 后的差异检查。

## 边界

- Pyodide 保持 `NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`，不声称 `measured_dual_backend`。
- C 不修改环境锁、seal、revision 2、依赖或其他岗位文件。
- `hash-inventory.txt`、`manifest-verification.json`、`diff-check.json` 的审计副本和原始脱敏日志按清单标记 `AUDIT_ONLY / NOT_FOR_GIT`；正式文件中的 `diff-check.json` 是可复核的结构化结果。
- 当前未 commit、未 push、未获得上传锁。

## R3 command outcome (2026-08-22)

- D3 public package: PASS, 1 file / 5 tests; 10 groups, 30 Node runs, 10 Pyodide `NOT_RUN`.
- Process tree: PASS, PID-level child termination verified.
- Fault matrix: PASS.
- Public-run and Python evaluator regression: PASS, 3 files / 30 tests.
- Typecheck, build-demo, build-web, check-docs, smoke-extension, check-release: PASS.
- Isolated candidate diff check: PASS, 26/26 files covered; `git diff --check` exit 0.
- Full test: PASS, 98 files / 824 passed / 1 skipped / 0 failed.
- Environment: Node 22.23.1, npm 10.9.8, Python 3.13.7, Pandas 3.0.5, win32/x64；Windows构建号按实际测量记录。`networkIsolation=false`和`reliableMemoryLimit=false`保持未证明。
- Raw command logs and SHA-256 values are in `scripts/w5-c-d3/command-results.json`；R2换行敏感seal失败保留为历史环境归因，不再错误归因为B回归。
- 普通`npm test`运行前后三份正式证据SHA-256保持不变；只有采集器显式设置输出路径时才更新证据。

## Delivery state

`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`
