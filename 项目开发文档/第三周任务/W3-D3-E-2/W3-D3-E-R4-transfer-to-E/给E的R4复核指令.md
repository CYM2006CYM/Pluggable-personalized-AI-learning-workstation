# W3-D3 E岗位R4修正版复核指令

当前合同：`W3-C5/W3-R2`。仓库基线：`07a5822badf1d8e082f32dbb21705c4a150819e9`。本包是负责人修正后的候选，不构成commit、push、上传锁、D4执行或V3最终结论授权。

请同时解压并使用：

- `W3-D3-E-R4-owner-fixed.zip`
- `W3-D3-负责人只读gold候选-E-HANDOFF.zip`

不得获取或读取`OWNER-ONLY.zip`、完整仲裁日志、机械差异清单、B原始标注或负责人私有说明。

## 已完成的最小修正

1. V3-7已适配E安全交接真实Schema，并独立验证difficulty/path前20原字节、公开终裁索引前20逐行哈希及后40 D44状态。
2. A正式提交`07a5822...`、A审计清单和五个测试文件已按SHA-256绑定；V3-1/V3-2不再绕过A正式提交。
3. 已增加固定轨迹Demo层和D4总前置检查。D正式提交、D固定轨迹测试清单和实际命令未解析时，D4 Execute机械拒绝。
4. R4只剩`d-d3-formal-commit`和`d-d3-fixed-trace-test-manifest`两项合法PENDING，不得猜测文件名。

## 你需要复核

1. 先复算两个ZIP及各自sidecar，确认哈希一致。
2. 在`HEAD == origin/main == 07a5822...`的工作区运行R4的`Test-W3D3Baseline.ps1`。
3. 使用你本机真实E-D1/E-D2路径和解压后的E安全交接目录运行`Test-W3D3InputManifest.ps1`；不得使用`AllowUnavailableEOwnedInputs`跳过你本人拥有的文件。
4. 运行`Test-W3D3R4SelfTests.ps1`，确认7项正反例全部通过。
5. 运行V3-1至V3-8的Plan模式；不得运行完整V3、正式60例系统、真实Key或在线模型。
6. 运行`Test-W3D4Readiness.ps1 -Mode Plan`，预期结论必须为`NOT_READY_FOR_D4_EXECUTION`，且仅列出D两项PENDING。

请回交实际命令、退出码、首次和最终结果、R4输入绑定证据、self-test记录、D4 readiness Plan记录、包内外SHA-256及实际`git status --short`。不得改写负责人安全候选，不得降低断言，不得commit、push或申请上传锁。D正式提交进入`main`后，再另建D4解析清单和已解析固定轨迹配置，不得回写本R4冻结原件。
