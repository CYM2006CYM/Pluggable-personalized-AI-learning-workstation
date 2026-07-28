# E 岗位第六天审计阻塞问题

- 状态：`blocking`
- 审计人：E（独立复验）
- 审计基线：`db38be6`（2026-07-28；拉取 `origin/main` 后工作区干净）
- 适用决策：仅 D01—D14。
- 边界说明：D15—D20 于 2026-07-26 拍板、2026-07-27 正式签发；它们不追溯适用于第一周，本问题不以 D15—D20 为依据。

## 问题

`pi-study-helper` 的 npm 发布包边界包含本应隔离的私有资产。`package.json` 的 `files` 包含 `fixtures/profiles`，因此即使包目前标记为 `private: true`，执行 `npm pack --dry-run` 仍会将下列内容写入 tarball：

- `assessments/diagnostic/private/answer-key.json` 与 `assessments/quiz-fallback/private/answer-key.json`；
- `assessments/private/tests/*-hidden.py` 与 `assessments/private/test-cases.json`；
- `datasets/private/*.csv`；
- `reference-solutions/*.py`；
- `rubrics/*.json` 及私有 task bundle。

这违反第一周合同中“正确答案、隐藏测试、参考实现、完整 Rubric、密钥和宿主路径不得进入公开区域”的隔离要求。`private: true` 只阻止 npm 发布，不会令 `npm pack` 产物安全；一旦归档、内部共享或配置改变，上述资产即可泄漏。

## 可复现步骤

```powershell
Set-Location pi-study-helper
npm.cmd pack --dry-run
```

预期：发布包不含答案、隐藏测试、私有数据、参考实现或完整 Rubric。

实际：上述路径列在 tarball 内容中；本次输出为 110 个文件、解包后 523.2 kB。

## 影响与裁决请求

- 影响范围：B 的私有资产隔离，以及 E 的泄漏扫描 / Go-No-Go 门禁。
- 安全影响：高。当前可打包泄漏属于真实资产边界缺陷，不能以现有单元测试通过代替修复。
- 不涉及：不改变 Profile、Facade、评测评分、错误码或 D15—D20 后续治理要求。

请负责人指定并监督以下既定顺序；每位所有者只修改其拥有的文件并附最小复验证据：

1. A：确认发布边界及公共合同消费方式不受破坏；如需公共打包规则裁决，先书面冻结。
2. B：调整资料包的可分发公共表面，确保私有资产不进入 tarball。
3. C：复验评测协议仍能从受控私有位置消费授权资产，且不向公开 DTO / 发布包泄漏。
4. D：复验 Agent 录制响应、上下文和 fallback 不重新引入受限资产。
5. E：拉取 D 的最新提交，重跑 Profile v1、五个 Pi 命令、契约 / 资产 / 评测 / Agent / 泄漏扫描及 `typecheck`、`test`、`smoke`、`verify`，再提交最终审计报告。

## 已通过但不足以解除阻塞的证据

- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：31 个测试文件、355 个测试通过。
- 高风险独立集：8 个测试文件、222 个测试通过（Facade/仓储、Profile、资产、评测、Agent）。
- `npm.cmd run smoke:extension`、`npm.cmd run verify`、`npm.cmd run check:history`：通过。
- 五个 Pi 命令已注册：`study`、`study-recover`、`study-profile`、`study-build`、`study-revise`。

现有 `check:release` 未检查 tarball 内容，故其“no private data or secrets found”结论不能覆盖此问题。问题修复前结论为 **No-Go（阻塞）**。
