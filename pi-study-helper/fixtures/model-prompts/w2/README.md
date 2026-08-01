# W2 D 岗离线模型材料

状态：`w2-d4-v1` 候选，供 A 做权威事实边界只读审计、供 E 做 V2-7 脱敏只读审计。它不表示真实模型、CIDPP 或任何运行主链已经接入，也不构成 A/E 的审计结论。

本目录只保存动态客观题及 Generator、Hunter、Defender、Judge 的提示词草稿、D15 配置说明、D20 问题单和 D 岗交接材料。脱敏录制响应及离线校验器位于相邻的 `../../model-responses/w2/`。

所有提示词只消费显式、安全的 JSON DTO 和已登记的公开来源摘要。它们不得读取或改写客观答案、代码分数、Rubric 阻断结果、隐藏测试、路径、正式 Evidence、KnowledgeState、先修关系或其他权威事实。结构错误只允许在初始调用后再重试两次；超时、预算耗尽、拒答、版本冲突或提供方失败进入各文件定义的固定 fallback，不拼接旧轮次结果。

`version_conflict` 只属于 `ReviewOrchestrator` 的固定错误码，不是 `ModelExecutionPort` 的 `provider_error` 错误码。对应录制案例必须是端口可加载的 `ok` 响应，并通过返回的 `modelId` 或 `promptVersion` 与 checkpoint 绑定不一致触发编排层拒绝。

本周保持关闭：外部评测器、完整 AI 代码题、GoA/OAEO、SSE、批量离线生成及 CIDPP 服务。CIDPP 仅登记 W4 周日 18:00 的自动裁决条件：V4-1 至 V4-7 任一未通过或运行时 CIDPP 未完成时自动关闭；即使通过也仅允许单一评价 Agent、最多一次优化、超时降级且失败不阻断学习。本周不实现 CIDPP。

D 岗按 D19 登记为 W6 演示视频制作人；本周只确认责任和后续输入，不制作最终视频。

离线校验命令：`node pi-study-helper/fixtures/model-responses/w2/validate-w2-materials.mjs`（从仓库根目录执行）。正式端口/编排器复现命令：`npx vitest run fixtures/model-responses/w2/recorded-responses.test.ts --maxWorkers=1 --fileParallelism=false`（从 `pi-study-helper/` 目录执行）。两者均不调用真实模型、不发起网络请求、不修改仓库文件。
