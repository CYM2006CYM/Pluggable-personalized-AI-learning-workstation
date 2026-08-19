# 岗位 C W5-D1 R3 负责人代改与验证报告

## 结论

`CANDIDATE_READY_FOR_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

本轮落实负责人裁决 `W5-D1-C-OWNER-R1`，修复 C-2 的 HTTP 错误语义、伪组合根测试、Pyodide 证据误归因和未覆盖 untracked 文件的差异检查。`POST /api/activities/:id/run` 成功时只 prepare、校验并签发 `PublicExecutionBundle`；不运行 evaluator、不产生正式学习事实。`environment_mismatch` 或 `test_asset_invalid` 在该路由返回 HTTP 500 安全错误信封。`POST /api/activities/:id/submit` 的 evaluator 故障继续返回 HTTP 200、`evaluator_error/not_graded`。

## 基线与边界

- `W5_START_COMMIT`: `4e316822d343d90bdf295f37b7aaaa0131890501`
- `HEAD` / `origin/main`: `0fd1f45386682a3859d8d9f6b37904b47ae98c33`
- A 正式上游：`0fd1f45386682a3859d8d9f6b37904b47ae98c33`
- C 未修改 A contracts/Facade、B Profile/environment-lock/seal、D 评测材料、E Worker/BrowserCodeRunner、SDK、依赖、锁文件、gold 或正式事实规则。

## R3-01 真实集成

`tests/w5-c-d1-public-run.test.ts` 的 4 个测试均从 `createDemoRuntime` 进入真实 `ComposedLearningRuntimeFacade`、正式 revision 3 Profile、真实 HTTP 服务和 `FileLearningSessionRepository`。公开轨迹只使用题面投影选择答案，允许确定性重试后到达代码 Activity，不读取私有答案。正常 `/run` 校验公开包、hash 和无泄漏；两类 HTTP 500 以及 `/submit` evaluator 故障均逐次比较完整 bound snapshot，确认 sessionVersion、Attempt、Evidence、KnowledgeState、path、activityProgress 和版本事实不变。错误注入仅修改各测试临时 dataRoot 中已激活 Profile 的副本，不触碰正式 fixtures。

## R3-02 状态矩阵

`endpoint-status-matrix.json` 已明确区分 `/run` 与 `/submit`：`/run` 的环境或资产准备失败返回 HTTP 500，信封不含 `data`、`verdict`、`evaluator_error` 或公开包；`/submit` evaluator 故障保持 HTTP 200、`evaluator_error/not_graded`。HTTP 503 仅用于服务初始化不可用。

## 命令结果

完整命令、工作目录、UTC 起止时间、自然/编排退出码、数量及 stdout/stderr 字节数和 SHA-256 见 `command-results.json`。R3 采集器一次自然退出 0：C/Web 定向为 6 files / 50 passed / 0 failed / 0 skipped；A/C 回归为 3 files / 17 passed；Python evaluator 为 3 files / 31 passed；全量测试和 `verify` 均为 88 files / 769 passed / 0 failed / 1 skipped。`typecheck`、`build:demo`、`build:web`、`check:docs`、`smoke:extension`、`check:release`、候选覆盖差异检查和泄漏扫描全部退出 0。`command-results.json` 中保留的 historicalFailures 属于 C-2 及其整改过程，不是 R3 最终失败。

## 环境与限制

合同环境为 Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、`PYTHONNOUSERSITE=1`。`environment-prototype.json` 将原生 Python/Pandas sanity check 登记为 PASS；Pyodide 为 `PYODIDE_CANDIDATE_UNAVAILABLE`，最小 Pandas 任务明确登记 `NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`。未安装依赖、未修改正式环境锁。C 未实现 E 的 Worker/BrowserCodeRunner；D3 双后端裁决和 10 组对照尚未开始。W5-D1-C 通过不等于 Pyodide 启用或 W5 GO。

## 文件集合

- `proposed-files.txt` 只列正式 Git 文件。
- `manifest.json` 是唯一 `selfExcluded` 文件，并覆盖其余正式拟提交文件。
- `hash-inventory.txt`、`manifest-verification.json` 仅在审核 ZIP 中标记 `AUDIT_ONLY / NOT_FOR_GIT`，不进入正式拟提交集合。
- ZIP、sidecar、完整原始日志、`.demo-data`、`.demo-build`、`node_modules`、虚拟环境和私有资产不进入 Git。
- 最终状态保持 `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`。
