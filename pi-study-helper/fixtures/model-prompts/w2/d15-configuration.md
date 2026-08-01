# D15 离线配置说明（w2-d4-v1）

本说明冻结 W4 真实接入将消费的参数，不实现调用、端口或公共 DTO。

| 项目 | 固定值/规则 |
| --- | --- |
| 接口 | OpenAI 兼容接口；本周不实现或调用 |
| `OPENAI_MODEL` | 未设置时默认 `deepseek-chat` |
| `OPENAI_BASE_URL` | 正式调用必填；缺失时不得发起网络请求，进入配置错误或固定 fallback |
| `OPENAI_API_KEY` | 正式调用必填；缺失时不得发起网络请求。真实密钥仅存放于宿主安全环境，不写入 Profile、会话、前端、普通 Agent 日志、轨迹正文或 fixture |
| 生成、解释、问答 | 温度 `0.7` |
| Hunter、Defender、Judge、CapabilityScorer、CIDPP 评价 | 温度 `0.2` |
| 单次调用 | 超时 `60` 秒 |
| 结构错误 | 初次调用后最多重试 `2` 次，只重试失败阶段；不重建已成功的上游产物 |
| 单会话预算 | 累计上限 `100000` token；达到上限后不得追加调用，直接使用固定 fallback |

模型 ID 必须进入缓存键、裁剪轨迹、脱敏录制响应元数据和盲评/评测配置。W4 冻结后不得为绕过故障临时切换模型。缓存键还应绑定资料包修订、输入摘要和提示词版本；本周只记录规则，不实现缓存。

`ModelExecutionResult` 当前没有真实 token 用量字段。本周不得扩展 DTO；D 岗已在 `d20-token-budget-question.md` 按 D20 形成待负责人裁决的问题单。裁决前不得虚构实际 token 用量，也不得自行选择扣减口径。

固定 fallback 仅返回预先审核的公开占位内容或可恢复错误：不发布候选草稿、不写入权威事实、不产生 Evidence/KnowledgeState/路径/Rubric/分数变更。fallback 是编排层既有结果语义，不为 `ModelExecutionResult` 新增状态或字段。

## D16—D17 关闭项

- 六周内保持关闭：外部代码评测器、完整 AI 代码题、GoA/OAEO、SSE 和批量离线生成。
- W2 不实现 CIDPP。W4 周日 18:00 前，V4-1 至 V4-7 任一未通过或运行时 CIDPP 未完成时，运行时 CIDPP 自动关闭；即使条件全部通过且已经接入，也只允许单一评价 Agent、最多一次优化、超时降级，失败不阻断学习。
