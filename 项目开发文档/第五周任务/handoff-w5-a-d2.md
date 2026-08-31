# 岗位 A W5-D2 R4 交接单

状态：`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`。

合同为 `W5-C1/W5-R1`，正式基线为 `baseHead=677f54c609ef3bfbe78ff6d37f6b432e9c68ff4d`。本文件描述未提交候选，不是正式上游，也不表示 W5-D2 已获得负责人通过。

## R3 阻塞闭合

R3 只在测试中手工构造 `StudyTuiGateway`，生产组合根未注入 `TuiSharedSessionEntry`，因此不能证明真实 Pi/TUI 入口可达。R4 在 Extension 中正式注册 `/study-web <sessionId>`，从生产 handler 实际调用 `StudyTuiGateway.prepareSharedWebActivity()`；真实入口测试通过同一注册路径执行，不再用测试内手工 Gateway 冒充生产入口。

## A 侧实现与事实源

`src/tui/shared-session.ts` 提供 `TuiSharedSessionBridge` 和 `TuiSharedSessionEntry`。桥接器只消费既有 `AppBootstrapFacade` 与 `LearningRuntimeFacade` 的恢复视图、`getNextStep`、活动恢复、草稿保存和正式提交方法，不读取仓储，也不建立第二套 Facade 或提交协议。

`/study-web` 使用现有 `createDemoRuntime()` 组合根；数据根与 Web launcher 一致，优先读取 `PI_STUDY_DATA`，否则使用包内 `.demo-data`；Web 地址与 launcher 的冻结端口一致，为 `http://localhost:5173`。命令不要求模型、不自动启动浏览器，也不依赖 Web 服务当时在线。A 不修改页面、API client 或 Worker。

## Pending、深链与恢复

pending 固定写入共享数据根下的 `tui/pending-activity.json`。字段白名单为 `sessionId/sessionVersion/profileRevision/pathVersion/nodeId/activityId/attemptId/draftVersion/savedAt`；文件存储边界在落盘前再次解析并校验。`attemptId` 与 `draftVersion` 必须同时出现；未知字段、答案、Rubric、hidden tests、reference solution、宿主路径和路径正文均被拒绝。

深链仅允许 `http://localhost` 或 `http://127.0.0.1` 的 `/study`，参数仅为单份 `sessionId/nodeId/activityId`。未知或重复参数、认证信息、fragment、绝对路径、换行和非 localhost 地址均被拒绝。

恢复先通过 `AppBootstrapFacade` 读取最新服务端恢复视图，再使用该视图中的版本调用 `getNextStep`。合法绑定返回 `restored`；陈旧 session/path 返回明确冲突；revision 不一致、session 不存在、活动错配或无恢复视图返回 `resume_from_web`。不存在的 session 不产生 pending、不创建替代会话；任何分支都不会调用 `startSession` 或使用客户端旧快照继续提交。

## CAS、幂等和副作用边界

TUI 草稿与正式提交原样传递既有 `requestId/sessionVersion/profileRevision/attemptId/draftVersion`。冲突后重新读取 Bootstrap，绝不覆盖服务端较新状态。同一正式提交输入重放首次结果；相同幂等键但不同代码返回 `idempotency_conflict`。正式适配器回归证明重放和冲突后仍只有一个 Attempt、一个 Evidence 和原路径版本。

pending、深链、恢复和公开预览本身不新增 Attempt、Evidence、KnowledgeState、mastery 或路径进度。真实入口测试比较命令前后的完整 Bootstrap，确认服务端事实不变。只有既有正式提交成功且 `committed=true` 时清理 pending。

## D2 与 D4 边界

R4 只声明“生产 Extension 入口、A 侧共享会话适配和接口交接可复核”。浏览器内正反向跨端闭环、页面接入、Worker、服务重启联调、正式 B seal/C 服务/E 页面绑定以及 V5-1/V5-3/V5-4 属于 D4。旧 `/study` 图执行流程没有在本轮改写为 Web 共享会话；R4 的 D2 入口是显式 `/study-web <sessionId>`。

真实模型状态为 `LIVE_NOT_RUN`；该确定性入口不依赖模型，不声明 `LIVE_MODEL_PASS`。

完整命令结果、负责人环境实际路径、历史失败归因、日志哈希、精确候选清单和逐文件哈希见同包验证材料。获负责人批准和上传锁后才可成为 E 的正式上游。
