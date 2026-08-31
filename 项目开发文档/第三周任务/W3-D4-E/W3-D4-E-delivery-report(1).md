# W3-D4 岗位 E 独立验证交付报告

## 1. 结论

```text
contractVersion = W3-C5/W3-R2
deliveryStage = W3-D4
candidateConclusion = BLOCKED
classification = ENVIRONMENT_MISMATCH
fullV3Conclusion = NOT_PRODUCED
gitStatus = NOT_COMMITTED / NOT_PUSHED
uploadLock = NOT_REQUESTED
```

本轮已完成 D4 输入机械解析和 readiness Execute，具备开始 D4 的输入条件。独立执行到 V3-3 时，本机不满足负责人批准的 Node/Python/Pandas 环境：合同要求 Node `v22.23.1`、Python `3.13.7`、Pandas `3.0.5`，本机为 Node `v24.18.0`，Python 命令仅为 WindowsApps 占位符且退出 `9009`，Pandas 不可用。V3-3 真实退出码为 `1`，至少观察到 23 个失败测试，归类为 `ENVIRONMENT_MISMATCH`。

依据 D47 测试层隔离裁决，继续完成不依赖 Python 的 V3-4、V3-7、V3-8及固定轨迹 Demo；停止受影响的 V3-5、V3-6和后续全量门禁。本报告不构成第三周整体 PASS、正式 gold、Go/No-Go、commit、push 或上传锁授权。

## 2. Git 基线

```text
HEAD        = 81c607d77f733129bf072fdcca70244f294a0fea
origin/main = 81c607d77f733129bf072fdcca70244f294a0fea
D commit    = 81c607d77f733129bf072fdcca70244f294a0fea
A parent    = 07a5822badf1d8e082f32dbb21705c4a150819e9
```

W3 起点、B、C、C绑定修复、A、D提交均已机械验证为 HEAD 祖先。首次 `git pull --ff-only origin main` 遇到远端 HTTP 502并退出1；封包前重试成功，退出0并显示 `Already up to date.`。当前工作区仍保留既有 E-D2 React 候选，未被清理、回退、暂存或提交。

## 3. 输入与 readiness

- R4传输 ZIP SHA-256：`7aef62e7ba06e9f55629df3ef79f4daca3483f0d312f14230a99935db8714e06`
- 负责人 E 安全候选包 SHA-256：`d9a35cee18cf4f174f0a54179fe6944ed3ee5cdd6d620fe1970e3672cff8d3e8`
- D candidate manifest SHA-256：`1aed0ab6a6ca68f7f453761dcfb4369c13278c46d8edcf6daf6dde39799b4ed9`
- D 固定轨迹测试 SHA-256：`2bd6a2b9af0dcd37e91ba47757a4a6f862d57ca0b2535dff78feae7b295dd52e`
- D 验证脚本 SHA-256：`51b2a281399d267529f3e7ab14e206fd95351c98b065518094bbc6a92ffb0dbc`
- 输入清单：33/33 FROZEN，`pendingInputIds=[]`，未使用 `AllowUnavailableEOwnedInputs`
- Plan：`READY_FOR_D4_EXECUTION`，退出0
- Execute：`READY_FOR_D4_EXECUTION`，退出0
- `fullV3ConclusionAllowed=true`，`fixedTraceCommandsReady=true`，`errors=[]`

R4原件 Baseline 与7项 self-test 均退出0。D4只使用仓库外工作副本，没有回写R4冻结原件。

## 4. V3-1至V3-8结果

| 门禁 | 状态 | 实际结果 |
|---|---|---|
| V3-1 | COMMAND_PASS | 1文件/1聚合测试通过；内部覆盖20例×10次，共200项 |
| V3-2 | COMMAND_PASS | 1文件/1聚合测试通过；覆盖原始预算及边界fixture，合同220项 |
| V3-3 | BLOCKED | 退出1；至少23项失败；`ENVIRONMENT_MISMATCH` |
| V3-4 | COMMAND_PASS | 4文件/30测试通过；4个C边界源文件扫描无越权写入命中 |
| V3-5 | NOT_RUN_AFTER_BLOCKER | 冻结命令包含受环境影响的评测器测试，按阻塞规则停止 |
| V3-6 | NOT_RUN_ENVIRONMENT_MISMATCH | 缺少批准的Python/Pandas环境 |
| V3-7 | COMMAND_PASS | difficulty/path/public index均60条；前20保持W2内容，后40为`SKIPPED_BY_D44` |
| V3-8 | COMMAND_PASS | 5文件/61测试通过；typecheck通过；14个Web文件边界扫描通过 |

V3-7仅读取 E 安全交接允许的候选、公开索引、冻结记录、公开证明和验证记录。`withheldMaterialRead=false`、`formalGold=false`；未读取 OWNER-ONLY、完整仲裁日志、机械差异、B原始标注或负责人私有裁决正文。

## 5. 固定轨迹 Demo

实际命令：

```powershell
npx vitest run fixtures/model-responses/w3/offline-dynamic-question.test.ts --maxWorkers=1 --fileParallelism=false
```

结果为1个测试文件、23/23测试通过、退出0。在线模型登记 `LIVE_NOT_RUN`，未使用真实Key。测试实际覆盖正常录制响应和确定性 fallback 场景，因此 `MOCK_FALLBACK_USED=true`；该结果不证明在线模型能力，也不替代V3全量结论。

## 6. 全量门禁

`npm.cmd run typecheck` 已作为 V3-8 的独立命令通过。发现 V3-3真实阻塞后，按照负责人“发现真实失败立即停止受影响流程”的要求，以下命令未执行：全量测试、文档检查、extension smoke、release check、verify、`git diff --check`。未执行项不能记为PASS。

## 7. 失败归属与恢复条件

失败归属为“批准的 Node/Python/Pandas 评测器环境提供方”，不是 E 前端、标注或验证脚本所有者。本轮没有修改 A/B/C/D业务实现，也没有降低断言、删除失败测试或修改预期。

恢复条件：在满足 Node `v22.23.1`、Python `3.13.7`、Pandas `3.0.5`及正式环境锁的机器上，从 V3-3重新执行受影响层；V3-3通过后再执行V3-5、V3-6及全部全量门禁。不得沿用本轮未执行项形成PASS。

## 8. 拟提交与排除项

`proposed-upload-list.json`仅登记 E-D1标注/封存记录及 E-D2 React mock拟提交清单，不构成上传授权。审核包明确排除：node_modules、dist-web、整个仓库副本、OWNER-ONLY材料、机械差异、B原始标注、正式gold、安全候选原文件、SDK源码副本及A/B/C/D业务文件。

## 9. 权限声明

```text
NOT_COMMITTED
NOT_PUSHED
uploadLock = NOT_REQUESTED
未执行正式60例系统运行
未运行真实Key或在线模型
未形成第三周整体PASS/BLOCKED终裁
```

本包供负责人审核。待批准环境复验完成并由负责人审核通过后，E才可按负责人后续指令申请上传锁。
