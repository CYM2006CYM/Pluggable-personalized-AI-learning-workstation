# W5-D2-A-R4 交付报告

合同：`W5-C1/W5-R1`。候选基线：`677f54c609ef3bfbe78ff6d37f6b432e9c68ff4d`。

当前状态：`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`。本报告不构成上传授权、正式上游或 W5-D2 通过结论。

## 整改结论

- `A-R4-01`：闭合 R3 生产组合根缺失。Extension 正式注册 `/study-web <sessionId>`，通过现有 `createDemoRuntime()`、`LearningRuntimeFacade`、`AppBootstrapFacade`、`TuiSharedSessionEntry` 和 `StudyTuiGateway` 读取当前服务端步骤、保存 pending 并生成 localhost 深链。
- `A-R4-02`：新增文件 pending store，写盘前执行严格白名单校验；不存在的 session 明确引导 Web 开始页，不产生 pending、不新建替代会话；命令前后完整 Bootstrap 事实一致。
- `A-R4-03`：保留并复验陈旧写入 CAS、重 Bootstrap、同输入幂等重放、不同输入 `idempotency_conflict`，且不重复产生 Attempt/Evidence 或路径版本。
- `A-R4-04`：R4 proposed、Manifest、ZIP 执行精确集合、字节数、SHA-256、嵌套 ZIP、禁止目录和越权文件检查。

## 真实入口证据

`tests/shared-web-extension-entry.test.ts` 调用 Extension 实际注册的 handler，不在测试中直接构造 `StudyTuiGateway` 代替生产入口。测试在真实 revision 3 fixture、真实文件仓储和现有 Demo composition root 上创建 session、完成诊断、构建并确认路径，再执行 `/study-web`。

验证结果证明：Web 服务未启动时仍能写入安全 pending 并返回 `http://localhost:5173/study?...`；服务端 session/path/activity/Attempt/Evidence 等事实不变；session 不存在时只提示 Web 开始页且不创建替代事实。

## 合同环境与门禁

R4 使用负责人合同环境：Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、`PYTHONNOUSERSITE=1`。Python runtime 目录置于 PATH 首位，避免 `where.exe python` 选择系统解释器。

- A 定向：3 files / 32 passed / 0 failed。
- 受影响回归：5 files / 42 passed / 0 failed。
- 全量与最终 verify：90 files / 785 passed / 0 failed / 1 skipped。
- typecheck、docs、Web build、extension smoke、release：PASS。
- `git diff --check` 与包机械审计：PASS。

R4 首次独立 typecheck 发现真实入口测试夹具向 `completeDiagnostic()` 传入两个现行 DTO 已移除的字段，报 `TS2353`。字段已删除，最终 typecheck 和 verify 均自然退出 0；该失败保留在结构化历史中，没有改写为首次 PASS。R2 环境失败和 R3 `BLOCKED / REQUIRES_R4` 也继续保留。

## 边界与限制

本候选只证明 D2 生产 Extension 入口和接口交接，不声明 D4 浏览器正反向跨端正式闭环。E 页面/Worker、B seal、C 正式服务、服务重启和 V5-1/V5-3/V5-4 仍待正式上游到位后复验。旧 `/study` 图执行工作流没有在本轮改写为共享 Web session；D2 新入口要求提供现有 sessionId。

真实模型状态为 `LIVE_NOT_RUN`。本轮未修改 `src/web`、C evaluator、B Profile/revision/seal/环境锁、D 材料、SDK、依赖、gold、hidden tests、Rubric 或 reference solution，也不声明生产沙箱、多用户、高并发或公网能力。

## 文件绑定

最终拟提交集合、逐文件字节数和 SHA-256 见同包 `proposed-files.txt` 与 `sha256-manifest.json`。Manifest 只排除自身摘要；ZIP 内文件集合与 proposed 精确相等。外层 ZIP 与 sidecar 不进入 Git 拟提交集合。
