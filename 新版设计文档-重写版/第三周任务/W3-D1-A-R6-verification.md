# W3-D1-A R6 整改与测试映射

本文件仅覆盖 R6 四项确认问题；V3-1/V3-2 输入、口径和证据文件保持 R5 不变。

| 问题 | 根因修复 | 回归测试 |
|---|---|---|
| A-R5-01 公共 PathSafeSnapshot 丢失 | 公共安全候选显式校验并转换为内部持久化快照；非法对象返回 `evidence_invalid` | `file-learning-session-repository.test.ts`：合法公共路径提交、非法公共路径回退 |
| A-R5-02 公共 DTO 泄漏 | `publicSnapshot()` 显式调用 `toPathSafeSnapshot()`；get/commit/recover 共用同一裁剪 | `file-learning-session-repository.test.ts`：三出口字段白名单；`path-runtime.test.ts`：公共/内部快照分离 |
| A-R5-03 应用层隐藏能力 | 新增 A 内部 `InternalPathSessionPort`；PathRuntime 类型显式要求公共仓储与内部端口；File 仓储实现二者 | `path-runtime.test.ts`：重启后内部端口读取与 confirm；`typecheck`/`tsc` |
| A-R5-04 固定节点最终预算未校验 | PathEngine 合并固定节点后执行最终节点、活动、拓扑、状态和预算校验；不可行不提交 | `path-engine.test.ts`：in_progress/positionLocked 超预算与预算内正例；`path-runtime.test.ts`：旧 active 回退、无新归档 |

## DTO 白名单

公共路径顶层仅有：`pathId`、`pathVersion`、`status`、`goalId`、`mode`、`nodes`。公共节点仅有：`nodeId`、`knowledgePointId`、`activityIds`、`status`、`estimatedMinutes`、`reasonCodes`。`difficulty`、`scaffold`、`positionLocked`、`required` 只存在于 A 内部端口快照。

## V3 不变性复核

R6 复跑 `tests/path-engine-development-20.test.ts` 前后，V3-1 与 V3-2 文件 SHA-256 必须相同；若不相同，R6 不得交付。

## 命令结果

最终命令、退出码和测试项数写入 `handoff-w3-a-d1.md`，不在本文件预填未经运行的结果。
