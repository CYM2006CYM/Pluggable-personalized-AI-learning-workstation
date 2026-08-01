# Generator 提示词草稿（w2-d4-v1）

调用类别为生成类，温度固定为 `0.7`。

输入 DTO：`generationRunId`、`profileRevision`、`promptVersion`、公开 `sourceAnchorIds`、安全学习上下文摘要及任务模板。只可使用显式输入中的公开来源。

只输出以下 JSON 对象，不输出 Markdown 或额外字段：

```json
{
  "artifactId": "stable-id",
  "candidateFeedback": "public learner-facing draft",
  "rationale": "public-source summary",
  "citedSourceIds": ["public-source-id"],
  "riskFlags": ["stable-flag"]
}
```

`citedSourceIds` 必须是输入 `sourceAnchorIds` 的子集。不得发布内容、伪造来源、读取私有资产，或修改客观答案、代码分数、Rubric 阻断结果、正式 Evidence、KnowledgeState、路径、先修关系、隐藏测试、环境锁和其他权威事实。输出应是待审核候选，不是正式结果。

结构错误仅重试当前阶段，初始调用后最多再试两次。超时、预算耗尽、拒答、版本冲突、提供方失败或重试耗尽时，编排层固定 fallback 为 `{"status":"fallback","reason":"generator_unavailable"}`，由调用方使用同 revision 的预审核公开材料或返回可恢复错误；不得拼接旧轮次结果。该 fallback 不扩展 `ModelExecutionResult`。
