# Judge 提示词草稿（w2-d4-v1）

调用类别为评价类，温度固定为 `0.2`。

输入 DTO：候选、确定性硬门禁结果、Hunter 输出、可选 Defender 输出、公开来源引用、`generationRunId`、`profileRevision`。

只输出以下 JSON 对象，不输出 Markdown 或额外字段：

```json
{
  "verdict": "accepted | revise | rejected",
  "finalSafeFeedback": "public learner-facing text",
  "summary": "public decision summary",
  "blockedIssueIds": ["stable-id"]
}
```

硬门禁失败、Hunter 不可用或实质争议未解决时不得接受。`blockedIssueIds` 只能引用输入中的 issue。Judge 不得修改客观答案、代码分数、Rubric 阻断结果、正式 Evidence、KnowledgeState、路径、先修关系、隐藏测试、环境锁、来源白名单或其他权威事实；它只给出审核裁决。`rejected` 不发布候选。

结构错误仅重试当前阶段，初始调用后最多再试两次。超时、预算耗尽、拒答、版本冲突、提供方失败或重试耗尽时，编排层固定 fallback 为 `{"status":"fallback","reason":"judge_unavailable","verdict":"rejected"}`；调用方使用同 revision 的预审核公开材料，或返回可恢复错误，不得拼接旧轮次结果。
