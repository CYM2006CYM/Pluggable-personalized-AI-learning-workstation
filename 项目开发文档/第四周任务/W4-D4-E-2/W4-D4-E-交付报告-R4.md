# W4-D4 E 一次性整改交付报告 R4

交付状态：`READY_FOR_OWNER_REVIEW_WITH_LIMITATIONS`

版本状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

本报告不签署 W4 GO，最终结论由负责人在 D5 签署。

## 交付物

- 审计 ZIP：`W4-D4-E-audit-R4.zip`
- ZIP sidecar：`W4-D4-E-audit-R4.zip.sha256`
- ZIP SHA-256：`0f033a99053c77ea712243d5db85a0a9c699f43a569eb664c5c826d2be6b5496`
- ZIP 大小：155265 bytes
- ZIP 条目：83 个文件及 5 个目录条目
- Manifest：列出除 Manifest 自身外的 82 个文件，逐项包含 byteLength 与 SHA-256
- 候选仓库文件：35 个

旧的 `W4-D4-E-audit.zip` 与旧交付报告未覆盖。本次整改包使用 `-R4` 后缀，避免新旧证据混淆。

## 输入绑定

- 正式基线与最新 `origin/main`：`a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4`
- A：`4c52eb7c78fa80007aa9a8ab4e00768d71d3f3f5`
- B：`56398ab5f44283e9c10b6d66ec2f0732cc043790`
- D：`dc1693e5bfcc0bed226ff0f20613fc4b2ec88681`
- C：`a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4`
- revision 3 seal：78 项
- D 录制响应：14 条，SHA-256 `4dc9fae61d7d179947fe24ed661b5a6826484f9c27e79a0b2fc39a55a186061c`

`团队协作参考/审计后一次性整改提示词编写规范.md` 未找到，已登记 `AUDIT_INPUT_INCOMPLETE`。该缺失不影响已独立执行的 V4 技术断言，但阻止整体签成 PASS。

## 完成内容

1. submitted 刷新后通过 Bootstrap 与 `getNextStep` 进入下一活动。
2. 代码公开检查先保存最新草稿，再使用新 `draftVersion` 运行；409 保留文本并重读快照。
3. evaluator_error 保持同一 Attempt，支持成功重试与重复失败后继续重试。
4. 路径重算真实调用 `replanPath`，展示 changed、fallback 与 changeReasons；刷新缺字段时安全禁用。
5. 总结展示 fail、partial、insufficient、unverified，不计算 mastery。
6. Vite 后端代理收窄到真实端点，修复 `/api/*.ts` 模块被代理导致的浏览器白屏。
7. 推荐与章节两条真实 HTTP 轨迹完成三类刷新恢复与提交后继续。
8. revision 3 六个核心知识点逐点执行 V4-8，不由单点外推。

## V4 状态

| 门禁 | 状态 |
|---|---|
| V4-1 | PASS |
| V4-2 | PASS |
| V4-3 | PASS |
| V4-4 | PASS |
| V4-5 | PASS |
| V4-6 | PASS |
| V4-7 | PASS，在线模型 `LIVE_NOT_RUN` |
| V4-8 | PASS，六点独立结果 |

## 最终命令结果

最终 `command-results.json` 记录 12 条命令，`nonzeroExitCount=0`：

- Web：11 文件，69 项通过。
- 两条真实 API：1 文件，3 项通过。
- 六点 V4-8：1 文件，7 项通过。
- 受影响回归：13 文件，78 项通过。
- 全量：85 文件，738 项通过，1 项跳过。
- typecheck、check:docs、build:web、smoke:extension、verify、git diff --check 均退出码 0。

合同环境为 Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、dateutil `2.9.0.post0`、`PYTHONNOUSERSITE=1`。首次错误环境中的 26 项失败作为 `ENVIRONMENT_MISMATCH_RETAINED` 随包保留，未覆盖。

## 浏览器限制

复验时 `127.0.0.1:4310` 被外部 `QQ.exe` PID 10840 占用。E 未结束外部进程，也未漂移合同端口。

- Edge CDP 桌面 1440x1000 安全错误恢复态：有效，无横向溢出。
- Edge CDP 移动 390x844 安全错误恢复态：有效，无横向溢出。
- 正常真实 API 浏览器轨迹：`NOT_RUN_FIXED_PORT_OCCUPIED`。

ZIP 内提供截图索引、两张有效截图和独立固定端口限制报告。空白诊断截图、Edge profile、工具链和构建产物均未进入 ZIP。

## 归因修正

- `reviewTimeline` 为可选字段；未提供写 `NOT_PROVIDED`，不是 A 违约。
- Bootstrap 未冻结 `evidenceVersion`，不要求 A 为 E 的刷新重算场景扩合同。
- Bootstrap 未冻结持久化 `CompleteSessionOutput` 或完整 `KnowledgeState`，不归因为 A 违约。

## 文件与安全

ZIP 不含整库、`node_modules`、`.demo-data`、`.demo-build`、`dist-web`、便携工具链、真实 Key、私有模型响应或 Edge profile。Manifest 复算失败数为 0，候选文件清单与 staging 实际文件均为 35 个且完全一致。
