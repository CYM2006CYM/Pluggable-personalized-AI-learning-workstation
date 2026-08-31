# 岗位 C 第五周 D1 R3 负责人代改交接

## 状态

- 合同：`W5-C1 / W5-R1`
- 负责人裁决：`W5-D1-C-OWNER-R1`
- `W5_START_COMMIT`：`4e316822d343d90bdf295f37b7aaaa0131890501`
- `HEAD` / `origin/main` / A 正式上游：`0fd1f45386682a3859d8d9f6b37904b47ae98c33`
- 状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## R3 完成

`tests/w5-c-d1-public-run.test.ts` 通过 `createDemoRuntime` 和真实 `ComposedLearningRuntimeFacade` 建立 revision 3 Profile、HTTP、会话仓库完整轨迹，不再手工构造 adapter 或强转 Facade。正常 `/run` 返回 HTTP 200 公开包；`environment_mismatch` 与 `test_asset_invalid` 返回 HTTP 500 安全信封且不含 `data/verdict/evaluator_error/public bundle`；`/submit` evaluator 环境故障保持 HTTP 200、`evaluator_error/not_graded`。四类调用前后均按合同比较正式会话事实，未产生越权写入。

题目推进只使用公开问题投影和确定性重试，不读取私有答案。失败注入只作用于测试临时 dataRoot 的激活副本。候选差异检查通过隔离 Git index 对全部拟提交路径执行 intent-to-add 后的 `git diff --check`，覆盖 untracked 文件且不污染真实 index。

## 上游与权限边界

C 未修改 A contracts/Facade、B 正式 Profile/environment-lock/seal、D 评测材料、E Worker/BrowserCodeRunner、SDK、依赖、锁文件、gold 或正式 Evidence/mastery/path 规则。原生 Python/Pandas sanity check 为 PASS；Pyodide 当前登记 `PYODIDE_CANDIDATE_UNAVAILABLE`，其最小 Pandas 任务登记 `NOT_RUN`。D3 双后端裁决和 10 组对照尚未开始。W5-D1-C 通过不等于 Pyodide 启用或 W5 GO。

## 证据与文件范围

完整命令证据见 `pi-study-helper/scripts/w5-c-validation/command-results.json`。R3 完整采集自然退出 0：C/Web 定向 6 files / 50 passed；A/C 回归 3 files / 17 passed；Python evaluator 3 files / 31 passed；全量测试和 `verify` 均为 88 files / 769 passed / 1 skipped；typecheck、两套 build、docs、extension、release、差异检查和泄漏扫描全部通过。`proposed-files.txt` 只列正式 Git 文件；`manifest.json` 是唯一 `selfExcluded`；`hash-inventory.txt` 与 `manifest-verification.json` 仅为 `AUDIT_ONLY / NOT_FOR_GIT`。ZIP、sidecar、缓存、构建目录、`node_modules`、虚拟环境和私有资产不进入 Git。

最终状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`。
