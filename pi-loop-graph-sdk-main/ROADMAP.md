# Roadmap

## 0.2.x — 稳定当前机制，修复已知问题

> 短期目标：让现有单图工作流在生产级质量上可靠运行

- **Mechanism 系统稳定化**：修复自动校验、重试策略、失败处理中的边界情况
- **Recording/Replay 完善**：修复嵌套调用边界的 checkpoint/resume 兼容性问题，提升回放可靠性
- **上下文帧栈 Bug 修复**：修复 `compose`/`call` 边界下上下文折叠的可能
- 问题
- **错误信息改进**：让 `GraphFailure` 提供更精确的阶段定位和可操作的错误描述
- **测试覆盖补充**：补全嵌套子图、边界恢复等场景的测试
- **性能优化**：减少大型日志文件的写入开销

## 0.3.x — 多 Agent 运行时

> 中长期目标：类 ROS2 的多 Agent 通讯与并发执行

Loop Graph SDK 的多 Agent 通讯是 [独立研究方向](docs/research/multi-agent-communication.md)。0.3 的目标是把它从研究落地为稳定 API。

### 通讯机制：类 ROS2 的 Topics/Services

- **Topic（发布/订阅）**：多 Agent 之间通过命名 Topic 异步广播消息。支持多种 QoS 策略（best-effort / reliable），不要求 Agent 同时在线
- **Service（请求/响应）**：类似 ROS2 Service 的同步调用模式，一个 Agent 发起请求，另一个 Agent 处理并返回结果
- **节点发现**：类似 ROS2 Node Discovery，Agent 可以动态加入/退出通讯网络，不影响已有通讯链路

### SDK 侧 API

```ts
// 异步调用：多个子图/Agent 并发运行
const [review, test, lint] = await host.executeAll([
  { graph: reviewGraph, input: { code } },
  { graph: testGraph,   input: { code } },
  { graph: lintGraph,   input: { code } },
]);
// 三个图并发执行，互不阻塞

// 发布消息到 Topic
await host.publish("code.changes", { file, diff });

// 订阅 Topic
host.subscribe("code.changes", async (msg) => {
  // 收到消息后触发对应图
  await host.execute(reviewGraph, msg.data);
});

// Service 调用
const result = await host.call("code.format", { code });
```

### 设计原则

- **隔离优先**：每个 Agent 运行在独立会话中，上下文和状态互不污染
- **容错优先**：单个 Agent 失败不影响整体通讯网络，支持超时、重试和降级
- **可观测优先**：所有通讯链路均可 Recoding/Replay，多 Agent 交互也能完整审计
- **渐进增强**：不破坏 0.2 的单图 API，多 Agent 能力作为可选扩展层叠加

---

> Loop Graph SDK 目前处于早期实验阶段。路线图会根据实际使用反馈调整，不保证时间表。
