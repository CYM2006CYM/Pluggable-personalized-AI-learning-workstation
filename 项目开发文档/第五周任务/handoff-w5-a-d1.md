# 岗位 A 第五周 D1 交接

## 候选身份

- `W5_START_COMMIT`: `4e316822d343d90bdf295f37b7aaaa0131890501`
- `baseHead`（未提交候选基线）: `768f3eae00c50da1c7563a7efd1447e5021f29c8`
- 正式 commit / `origin/main`: `de9718ca94fb1aae0f2bcb0c8348d39267969961`
- 上传后 `HEAD`: `de9718ca94fb1aae0f2bcb0c8348d39267969961`
- 合同：`W5-C1/W5-R1`
- 状态：`COMMITTED / PUSHED / uploadLock=GRANTED`

本候选只覆盖公共 DTO、公开执行包安全投影、校验和交给 C 的入口。没有修改 HTTP、执行器、Profile 内容、环境锁、SDK、依赖、gold 或页面行为；没有新增第二套 Facade。按授权，仅更新了 `src/web/mocks/safe-dtos.ts` 与对应 Web DTO 测试夹具，并补充 `activityId`。

## 公共入口

- `pi-study-helper/src/contracts/facade.ts` 导出严格十字段 `PublicExecutionBundle`、`BrowserCodeRunner` 和公开运行请求/响应类型；`PreparedActivityOutput` 的 `activityId` 为必填。
- `pi-study-helper/src/application/public-execution-bundle.ts` 提供纯 projector/validator。`bundleHash` 对除自身外的公开字段执行键排序、数组保序的规范 JSON SHA-256；`starterCodeHash` 与公开数据内容哈希均为 `sha256:<64hex>`。
- `prepareActivityRun` 在既有 Facade 内验证当前 code Attempt、Activity、draft、session、revision 和 environment 绑定，并只新增运行准备记录。过期时间固定为准备记录 `createdAt + 5 分钟`。
- `ProfileFamilyCodeActivityAssetResolver` 严格检查公开测试 visibility、`assessments/public/` 路径、声明引用、公开数据 `datasets/public/` 路径及内容哈希。私有测试、Rubric、参考实现、宿主绝对路径、越界引用和错误内容哈希返回 `test_asset_invalid`，环境源错配返回 `environment_mismatch`。

## 验证结果

- D1 定向回归：`6 files / 41 tests PASS`。
- `typecheck`、`check:docs`、`build:web`、`smoke:extension`、`check:release`、`git diff --check`：PASS。
- 原始机器历史结果保留：`740 passed / 25 failed / 1 skipped`；失败归因是原始机器缺少合同要求的 Python `3.13.7 + Pandas 3.0.5`，该记录没有被覆盖或改写。
- 负责人合同环境独立复验追加记录：Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、`PYTHONNOUSERSITE=1`；A 定向 `6 files / 41 tests PASS`，Python evaluator `2 files / 26 tests PASS`，全量 `87 files / 765 passed / 0 failed / 1 skipped`，`verify` 及其余门禁全部 PASS。完整路径、命令、时间、退出码、stdout/stderr 大小和 SHA-256 位于 `pi-study-helper/scripts/w5-a-validation/owner-revalidation-w5-d1-r1.json`，来源为负责人提供的 `W5-D1-A-owner-reverify-R1.zip`（外层 SHA-256：`5be2fdb03593a99ae0de9ae040b3797d012785363a8dccbb4be803b341fe9127`）。
- 正式 commit `de9718ca...` 已推送到 `origin/main`；C 可按 `A -> C` 顺序消费该正式上游。
- 历史与独立复验命令、退出码、测试计数和日志哈希分别保留在 `command-results.json` 与 `owner-revalidation-w5-d1-r1.json`，不互相覆盖。

## 泄漏反例与副作用证明

定向负向覆盖包括非当前 Attempt、旧 session/revision、环境错配、过期包、字段或摘要篡改、私有测试伪装、私有/绝对/越界路径、内容哈希错误、重复文件名或测试引用，以及隐藏测试、Rubric、参考实现和宿主路径字段零泄漏。准备前后会话快照深比较证明预览不改变 `sessionVersion`、Attempt 状态、Evidence、KnowledgeState、mastery、路径或活动进度。

## 给 C 的消费方式

C 只从 `contracts/facade.ts` 导入 `PublicExecutionBundle` 和公开运行类型，将整个 bundle 原样传给 E 的 `BrowserCodeRunner`；不得从 repository、Profile 或 `assetBundleHash` 重建包，也不得把 `publicTestSources` 之外的测试资产发送到浏览器。C 在消费前调用 `validatePublicExecutionBundle`，绑定当前 `sessionId`、`activityId`、`profileRevision`、`environmentId`，并把 `activity_lifecycle_conflict` 与 `environment_mismatch` 保持为既有错误码。

## 文件与限制

`scripts/w5-a-validation/proposed-files.txt` 是精确拟提交清单，`sha256-manifest.json` 是逐文件 SHA-256 清单并包含最终 handoff（仅 self-excluded manifest 自身）。正式候选已提交并推送到 `origin/main`，ZIP、sidecar 和交付目录未进入 Git；上传锁为 `GRANTED`。
