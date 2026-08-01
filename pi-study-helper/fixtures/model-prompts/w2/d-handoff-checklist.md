# D 岗第二周 D4 交接清单（w2-d4-v1）

## 基线与范围

| 项目 | 记录 |
| --- | --- |
| `W2_START_COMMIT` | `f343a6c1c630f362f4686e6f6b0f50c6577d5562` |
| D4 最新拉取后 HEAD | `f34251449274f96c7f85b4db9c555a3df54a7da2` |
| 祖先关系 | `W2_START_COMMIT` 是 D4 HEAD 的祖先 |
| 同步状态 | D4 已执行 `git pull --ff-only origin main`，本地 `main` 与 `origin/main` 一致 |
| 合同版本 | `W2-C2/W2-R5` |
| D 岗可写范围 | `fixtures/model-prompts/w2/`、`fixtures/model-responses/w2/` |
| 越界修改 | 无；未修改 `ModelExecutionPort`、`ReviewOrchestrator`、Graph 运行代码、公共 DTO、Profile 或评测资产 |

## 候选交付

- 动态客观题、Generator、Hunter、Defender、Judge 提示词草稿；
- D15 OpenAI 兼容配置、温度、60 秒超时、2 次结构重试、100000 token 会话预算和固定 fallback 说明；
- 正常、结构错误、超时、拒答、Provider 失败、版本冲突、Hunter 分支和 Judge 拒绝的脱敏录制响应；
- 离线逐角色 Schema、场景覆盖、敏感字段和宿主路径扫描器；
- D 专属正式消费测试：确认公共端口可加载修复后的成功响应，并由 `ReviewOrchestrator` 基于失配 `modelId` 产生 `version_conflict`；
- D20 token 预算口径问题单；
- A/E D4 只读审计申请。

## 关闭项与后续责任

- D16：外部代码评测器、完整 AI 代码题、GoA/OAEO、SSE 和批量离线生成保持关闭。
- D17：本周不实现 CIDPP；仅记录 W4 周日 18:00 按 V4-1 至 V4-7 自动关闭的条件，以及通过时仍限单一 Agent、最多一次优化、超时降级。
- D19：D 登记为 W6 演示视频制作人；本周不制作最终视频。
- D20：`ModelExecutionResult` 不扩字段；预算扣减口径等待负责人书面裁决。

## D4 验证与上传门禁

作者校验命令：

```text
node pi-study-helper/fixtures/model-responses/w2/validate-w2-materials.mjs
Set-Location pi-study-helper
npx vitest run fixtures/model-responses/w2/recorded-responses.test.ts --maxWorkers=1 --fileParallelism=false
```

最后一次修改后的真实结果：

- D 离线校验：`PASS`，12 条录制响应、10 个提示词/配置/审计文件、敏感模式 0 命中；
- 正式端口/编排器 D 专属测试：`PASS`，1/1；`version_conflict` 由成功响应的失配 `modelId` 在 `ReviewOrchestrator` 层产生；
- 校验器 `node --check` 与 fixture JSON 解析：`PASS`；
- `npm run typecheck`：`PASS`；
- 本次裁决直接相关的公共端口、公共编排器与 D 修复测试：3 个文件、162/162 `PASS`；
- 全量 `npm test -- --maxWorkers=1 --fileParallelism=false`：356/388 通过，32 项既有临时目录/文件系统用例超过默认 5 秒并伴随 `ENOTEMPTY`，故本轮全量回归不记为全绿；D 新增测试未失败。该现象记录为 Windows I/O/测试时序噪音，不归因于 D 的 fixture 修复，也不篡改测试阈值换取 PASS；
- `npm run check:docs`：`PASS`，41 个 Markdown 文件的本地链接有效；`npm run check:release`：`PASS`，207 个已跟踪文件未发现私有数据或密钥；
- `npm run smoke:extension`：两次均因 30 秒内未返回 `get_state` 而失败；本次未修改扩展、探针或超时阈值，该既有运行探针问题不写成 D 离线 fixture 通过，也不越权修复；
- 最终候选 SHA-256 见相邻响应目录的 `d4-validation-report.md`。

A 的权威事实边界审计和 E 的 V2-7 脱敏审计必须分别给出书面 `PASS`，随后 D 才能申请本周唯一正常上传锁。当前文件不自报 A/E `PASS`，也不以本地作者测试替代独立审计。

当前状态：候选待 A/E 只读审计；未取得上传锁，因此不得 commit/push。D 材料链不等待 C 的 V2-3、gold 输入冻结或 B/E 标注。
