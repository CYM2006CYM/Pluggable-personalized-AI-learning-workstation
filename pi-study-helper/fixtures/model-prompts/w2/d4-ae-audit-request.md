# D4 A/E 只读审计申请（w2-d4-v1）

## 审计基线

- `W2_START_COMMIT`：`f343a6c1c630f362f4686e6f6b0f50c6577d5562`
- D4 修复候选基线 HEAD：`f34251449274f96c7f85b4db9c555a3df54a7da2`
- 合同：`W2-C2/W2-R5`、D15—D20
- 范围：仅 `pi-study-helper/fixtures/model-prompts/w2/` 与 `pi-study-helper/fixtures/model-responses/w2/`
- 性质：离线候选，不代表真实模型调用、运行主链、CIDPP 或线上能力已经可用

## 请 A 审计

1. 输入仅含安全 DTO、公开来源编号和公开摘要；
2. Generator/Hunter/Defender/Judge 均不能改写客观答案、代码分数、Rubric 阻断结果、正式 Evidence、KnowledgeState、路径、先修关系、隐藏测试或环境锁；
3. Hunter 只报告问题，Defender 只回应已有争议，Judge 只裁决；
4. fallback 不发布未审核候选、不写权威事实，且未扩展公共 DTO；
5. 动态客观题仅为待审核候选，不被描述为正式诊断资产。

A 首轮结论：`BLOCKED`，唯一阻塞为 `w2-d4-judge-version-conflict` 被错误录制成端口 `provider_error`。负责人已裁决 `version_conflict` 继续归 `ReviewOrchestrator`；D 已把该案例改为端口可加载的成功响应，通过失配 `modelId` 触发编排层错误。当前状态：`PENDING_A_TARGETED_RECHECK`，请复验正式 fixture 加载和该场景，不代填 `PASS`。

## 请 E 审计

1. 对 `recorded-responses.json` 做 V2-7 范围内的脱敏预检；
2. 确认诊断答案、私有 CSV、隐藏测试、参考实现、完整 Rubric、API 密钥、宿主绝对路径和学习者原始代码零命中；
3. 确认 `traceSummary` 仅为裁剪摘要，模型 ID 和提示词版本存在且不含密钥；
4. 独立运行冻结版本的 V2-7 工具；不得以 D 的作者校验替代 E 的结论。

E 首轮结论：`D3_PRECHECK_PASS_PENDING_OWNER_AND_TOOL_BASELINE`，内容与脱敏预检未发现 D 阻塞；D4 正式结论仍待 E 使用冻结工具复验。修复后请至少复验变更的响应、D 测试和验证记录，本申请不代填正式 `PASS`。

## 作者复现命令

```text
node pi-study-helper/fixtures/model-responses/w2/validate-w2-materials.mjs
Set-Location pi-study-helper
npx vitest run fixtures/model-responses/w2/recorded-responses.test.ts --maxWorkers=1 --fileParallelism=false
```

该命令只读 D 岗材料，不调用真实模型、不访问网络、不修改文件。A/E 均通过后，D 再申请 D4 唯一正常上传锁；未取得上传锁前不 commit、不 push。D 材料审计不依赖 C 的 V2-3 或负责人 gold 冻结。
