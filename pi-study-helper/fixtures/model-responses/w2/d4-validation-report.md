# D4 离线验证记录（w2-d4-v1）

修复候选基线 HEAD：`f34251449274f96c7f85b4db9c555a3df54a7da2`。本记录是 D 岗作者自检，不替代 A 的权威事实边界复审或 E 的 V2-7 独立审计。

## 负责人裁决与修复

A 首轮审计的唯一内容阻塞为 `w2-d4-judge-version-conflict`：原录制错误地使用了 `status: provider_error` 与 `errorCode: version_conflict`，无法通过正式 `loadRecordedModelResponseFixtures()`。

负责人裁决：`version_conflict` 继续作为 `ReviewOrchestrator` 层固定错误码，不新增为 `ModelExecutionPort` 的 `provider_error` 录制响应错误码。

D 已按裁决完成以下本人范围修复：

- 案例改为端口可加载的 `ok` Judge 响应，不含 `errorCode`；
- 响应 `modelId` 固定为 `stale-deepseek-chat`，与 checkpoint 期望的 `deepseek-chat` 不一致；
- D 校验器不再允许 `provider_error/version_conflict`，并断言该场景必须是成功响应和失配模型绑定；
- 新增 D 专属测试，使用正式 fixture 加载器、`RecordedModelExecutionAdapter` 和真实 `ReviewOrchestrator`，验证最终由编排层返回 `version_conflict`；
- 未修改公共 DTO、`model-execution-port.ts`、`ReviewOrchestrator` 或公共测试。

## 结果

- `node --check pi-study-helper/fixtures/model-responses/w2/validate-w2-materials.mjs`：PASS。
- PowerShell `ConvertFrom-Json` 解析 `recorded-responses.json`：PASS。
- `node pi-study-helper/fixtures/model-responses/w2/validate-w2-materials.mjs`：PASS；12 条录制响应、10 个提示词/配置/审计文件、敏感模式 0 命中。
- `npx vitest run fixtures/model-responses/w2/recorded-responses.test.ts --maxWorkers=1 --fileParallelism=false`：1/1 PASS；正式端口可加载，编排器产生 `version_conflict`。
- `npm run typecheck`：PASS。
- `npx vitest run tests/model-execution-port.test.ts tests/review-orchestrator.test.ts fixtures/model-responses/w2/recorded-responses.test.ts --maxWorkers=1 --fileParallelism=false`：3 个文件、162/162 PASS。
- `npm test -- --maxWorkers=1 --fileParallelism=false`：356/388 通过；32 项既有临时目录/文件系统测试超过默认 5 秒并伴随 `ENOTEMPTY`，本轮全量回归不记为全绿；D 新增测试未失败。未修改测试阈值或公共实现。
- `npm run check:docs`：PASS，41 个项目 Markdown 文件的本地链接有效。
- `npm run check:release`：PASS，207 个已跟踪文件未发现私有数据或密钥。
- `npm run smoke:extension`：两次均因 30 秒内未返回 `get_state` 而失败；该探针不消费本次 D fixture，未修改扩展、探针或超时阈值。

## 候选 SHA-256

以下哈希在最后一次候选修改后生成；共 13 个候选文件，不包含本记录自身。

```text
89124d85921fd86fa93c1665de734036e2b0a361340b7411df37509d22e852a7  pi-study-helper/fixtures/model-prompts/w2/d15-configuration.md
9bea2db178fe3104dfab70d06b794a5254974aef273eb51bcff3bc07a28c9414  pi-study-helper/fixtures/model-prompts/w2/d20-token-budget-question.md
393f0d5f238d39ad1492197a341b2bdcfb99781b212b0b6e33b1f50ba251131b  pi-study-helper/fixtures/model-prompts/w2/d4-ae-audit-request.md
e8109c173e15d4d6a233e52f0318fd8c93e370a6086c8e81696fdd9cac35a610  pi-study-helper/fixtures/model-prompts/w2/defender.md
7df3de2f539426438c66d43928b8923b4d372a8f45cf4c0279b540a7c5867e08  pi-study-helper/fixtures/model-prompts/w2/d-handoff-checklist.md
3dcef9cca1a208afa76d19f48840701e1e461e674a4895e2178ab734047d0017  pi-study-helper/fixtures/model-prompts/w2/dynamic-objective-question.md
ec8c0953c4ffe41b46d55966688ae4200f0ae220cac37009ba67e05277f6ac4a  pi-study-helper/fixtures/model-prompts/w2/generator.md
35b5da8c7aa4d476e44fd76952c7d4efbfbc0a6dee0d7ffc1fbd1ec1dcb25f23  pi-study-helper/fixtures/model-prompts/w2/hunter.md
c91b8b5a2ad0be603cee0a4e760fa0be2f2a0f7cd038157b80f5128642463f6e  pi-study-helper/fixtures/model-prompts/w2/judge.md
a832147c8adf7f38d474c350f9dccaab34a5953901697ba56dbe462ba84ef0ca  pi-study-helper/fixtures/model-prompts/w2/README.md
8e3b356f0e0607b944cf92b470842b52f54d6c97029210ddc31fa34832c5b033  pi-study-helper/fixtures/model-responses/w2/recorded-responses.json
2ff1252abb475a425264c7ab80fd925114507345c4c75c04a25908f9d204b461  pi-study-helper/fixtures/model-responses/w2/recorded-responses.test.ts
e5c855656b388874bc69bf7e381497d0c8028a16cfeb40154b967b5825f77cbe  pi-study-helper/fixtures/model-responses/w2/validate-w2-materials.mjs
```

状态：`PENDING_A_TARGETED_RECHECK / PENDING_E_D4_FORMAL_RECHECK / NO_UPLOAD_LOCK`。A 首轮阻塞已按负责人裁决修复；E 首轮内容预检无 D 阻塞，但正式 D4 结论仍须独立复验。不得把本地作者自检写成独立审计 PASS，未取得上传锁前不得 commit/push。
