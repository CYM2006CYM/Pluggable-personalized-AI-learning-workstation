# W2 Claim 拆分模板

本模板只定义 claim 结构；不得填入系统正式输出、正式效果结论或未冻结的内容。

| 字段 | 类型 | 约束 |
|---|---|---|
| `claimId` | string | 稳定、唯一的 claim 标识。 |
| `artifactId` | string | 对应冻结产物的稳定标识。 |
| `knowledgePointId` | string | Profile revision 2 中存在的知识点 ID。 |
| `text` | string | 可追溯的 claim 文本，不含私有资产、答案或系统输出。 |
| `sourceAnchorIds` | string[] | 非空、去重的来源锚点 ID。 |
| `profileRevision` | number | 本周固定为 `2`。 |

```json
{
  "claimId": "<stable-claim-id>",
  "artifactId": "<frozen-artifact-id>",
  "knowledgePointId": "<profile-v2-knowledge-point-id>",
  "text": "<traceable-claim-text>",
  "sourceAnchorIds": ["<source-anchor-id>"],
  "profileRevision": 2
}
```

本周只冻结字段结构，不生成正式 claim 或指标结论。
