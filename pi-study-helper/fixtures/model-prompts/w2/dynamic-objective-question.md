# 动态客观题提示词草稿（w2-d4-v1）

用途：只生成待审核的单选题或判断题候选。调用类别为生成类，温度固定为 `0.7`。

## 输入 DTO

```json
{
  "generationRunId": "stable-run-id",
  "profileRevision": 2,
  "knowledgePointId": "public-knowledge-point-id",
  "difficulty": "S-R | S-U | M-U | M-A | C-A",
  "sourceAnchorIds": ["public-source-id"],
  "safeLearningContext": "public-summary-only"
}
```

## 允许输出 Schema

```json
{
  "artifactId": "stable-artifact-id",
  "kind": "single_choice | judgment",
  "prompt": "string",
  "options": ["string"],
  "sourceAnchorIds": ["public-source-id"],
  "rationale": "public-source summary"
}
```

只输出一个 JSON 对象，不输出 Markdown 或额外字段。只生成单选或判断题；单选提供 3 至 5 个互不重复选项，判断题必须省略 `options`。题面、理由和引用仅使用输入给出的公开来源，`sourceAnchorIds` 必须是输入集合的子集。输出不包含标准答案、诊断答案、隐藏测试、评分、学习者原始代码或私有材料。

不得修改或推断知识点、难度、客观答案、代码分数、Rubric 阻断结果、正式 Evidence、KnowledgeState、路径、先修关系、隐藏测试或环境锁；不得生成完整 AI 代码题。输出不是权威诊断资产，必须经后续确定性校验。

结构错误时仅重试当前阶段，初始调用后最多再试两次；不得重建已经成功的上游产物。超时、预算耗尽、拒答、版本冲突、提供方失败或重试耗尽时，编排层返回固定 fallback：`{"status":"fallback","reason":"dynamic_question_unavailable"}`。该 fallback 不是 `ModelExecutionResult` 的新枚举，不写入权威事实。
