# C W5-D1 R3 负责人代改与独立复验报告

## 裁决与结论

- 负责人裁决：`W5-D1-C-OWNER-R1`
- 审核结论：`R3_CANDIDATE_READY_FOR_OWNER_REVIEW`
- Git 状态：`NOT_COMMITTED / NOT_PUSHED`
- 上传锁：`uploadLock=NOT_GRANTED`

本候选落实以下固定语义：`POST /api/activities/:id/run` 成功返回 HTTP 200 和公开 `PreparedActivityOutput`；准备阶段的 `environment_mismatch`、`test_asset_invalid` 返回 HTTP 500 安全错误信封，不返回 `data`、`verdict`、`evaluator_error` 或公开包，也不修改正式会话事实。`POST /api/activities/:id/submit` 的 evaluator 故障继续返回 HTTP 200、`evaluator_error/not_graded`。HTTP 503 仅用于服务初始化不可用。

## 代改内容

1. 修复 HTTP 路由级错误映射，限定仅 `/run` 的两类准备失败返回 500，不改变 `/submit` 既有降级语义。
2. 将 C-2 手工 adapter 和 Facade 强转测试替换为 `createDemoRuntime`、真实 `ComposedLearningRuntimeFacade`、正式 revision 3 Profile、真实 HTTP 和文件会话仓库轨迹。
3. 正常 `/run`、两类准备失败以及 `/submit` evaluator 故障均比较完整 bound snapshot，证明 Attempt、Evidence、KnowledgeState、path、activityProgress 和版本事实未变化。
4. 题目推进只使用公开题面投影和确定性重试，不读取私有答案；错误注入只修改测试临时 dataRoot 的激活副本。
5. 环境证据将原生 Python/Pandas 与 Pyodide 分开：原生 sanity check 为 PASS；Pyodide 不可用，最小 Pandas 任务登记 `NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`。
6. 候选差异检查使用隔离 Git index，对全部拟提交路径 intent-to-add 后执行 `git diff --check`，覆盖 untracked 文件且不污染真实 index。

## 独立复验

- C/Web 定向：`6 files / 50 passed / 0 failed / 0 skipped`
- A/C 回归：`3 files / 17 passed / 0 failed / 0 skipped`
- Python evaluator：`3 files / 31 passed / 0 failed / 0 skipped`
- 全量测试：`88 files / 769 passed / 0 failed / 1 skipped`
- `verify`：`88 files / 769 passed / 0 failed / 1 skipped`
- `typecheck`、`build:demo`、`build:web`、`check:docs`、`smoke:extension`、`check:release`：全部退出 0
- 候选覆盖差异检查：19 个拟提交文件，退出 0
- 泄漏扫描：0 findings，PASS
- Manifest：19 个正式拟提交文件；18 个文件哈希；`manifest.json` 为唯一 self-excluded；复算 PASS
- 审核附加文件：`hash-inventory.txt`、`manifest-verification.json`，均为 `AUDIT_ONLY / NOT_FOR_GIT`

## 候选包

- 文件：`C-W5-D1-formal-candidate-0fd1f45-r3.zip`
- 大小：`35443 bytes`
- 文件条目：`21`
- SHA-256：`A4B6BC6571F8E9B4DC83340BE176CB10D1A3BD201C5F3B34333B3ABEC73F3E65`
- 排除项：旧 ZIP、`node_modules`、`.demo-data`、`.demo-build`、虚拟环境、整库副本和绝对宿主路径均未进入候选包

## Demo 边界

本轮仅修复影响比赛合同、确定性闭环、安全演示和可复算证据的问题。登录、多租户、云数据库、公网部署、生产级沙箱、高并发、完整运维监控、复杂权限和生产 SLA 均未扩项，继续登记为延期或 advisory。
