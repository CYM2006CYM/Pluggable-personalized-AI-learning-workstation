# W4-D2-D-4 岗位 D 正式交接单

## 身份与上游

- 合同：W4-C2 / W4-R1
- 实际基线：`576d326dbcaf73d92ec56093dd010332c3936e98`
- A：`4c52eb7c78fa80007aa9a8ab4e00768d71d3f3f5`，HEAD 祖先检查退出 0
- B：`56398ab5f44283e9c10b6d66ec2f0732cc043790`，HEAD 祖先检查退出 0
- revision 3：78 entries，`e118fd65c4583821f686cba4faab5990a81d2149a8f73cf89af2c376ba15b352`

## D 候选输出

1. `AdaptiveContentService`：区分 quiz/card；低风险题直达、高风险题和全部卡片完整审核；15/60 秒降级；私有 checkpoint/cache/trace；恢复不重复发布。
2. `ProfileAdaptiveContentSourceProvider`：只读取 B 的公开 knowledge/activity/source 投影，不读取 B 私有答案、Rubric、hidden tests、reference solutions 或私有 CSV。
3. `CapabilityTaskService`：只响应两个冻结触发器；同会话任务串行；五维 complete/partial/unverified；任务失败保留旧快照。
4. `SessionCapabilityEvidenceProvider`：D 所有的生产 Evidence 投影适配器，只依赖 A 的 `SessionBindingReader` 只读接口，从正式 bound snapshot 校验并投影 Evidence，不读取答案草稿、hidden tests、Rubric、reference solution 或宿主路径。
5. `createW4DModelGraphs()`：D 所有的 Graph 注册工厂，覆盖 `generator/hunter/defender/judge/capability-scorer`，供 C 直接交给 `PiGraphModelExecutionAdapter`。
6. `FileProfileUserRuntimeStore`：所有 D 运行态严格落在 Profile 族 `_user/w4-d/`，键名哈希化。
7. 14 条无密钥录制响应，覆盖正常、非法 Schema、超时、provider 错误、高风险审核、越权拒绝六类；capability-scorer 绑定 A 正式 sessionId，默认 recorded，`LIVE_NOT_RUN`。
8. 定向、受控时钟、安全、画像、录制重放、Graph 注册和 A/B fixed fallback 联调测试。
9. revision 3专用可观察维度保守映射；累积Evidence版本绑定；跨单元画像快照合并；中文画像理由硬校验。

## 验证与已知限制

仓库外合同环境为 Node v22.23.1、Python v3.13.7、Pandas 3.0.5。类型检查、7 files/37 tests 的 D 定向/回归、11 files/83 tests 的 A/D 受影响回归、录制响应安全校验、文档、扩展 smoke 和 release check 均 PASS。

合同环境 `npm run verify` 已在 `576d326` 基线和 D 候选叠加目录中通过：77 files、727 passed、1 skipped，退出 0。V2-6 direct runner development=20、final=60 均通过，Python evaluator 2 files/26 tests PASS。最终状态为 `D_REMEDIATION_PASS / FULL_VERIFY_PASS / LIVE_NOT_RUN`；录制响应只证明离线边界，不证明在线模型质量。

C 绑定入口：`SessionCapabilityEvidenceProvider` 从 `src/infrastructure/session-capability-evidence-provider.ts` 导入，构造参数为 `{ sessions: SessionBindingReader }`；`createW4DModelGraphs()` 从 `src/graphs/w4-d-graph-factory.ts` 导入，返回可注册的五个 D Graph。正式 capability 录制轨迹固定输入为 `subjectId=pandas`、`requestId=w4-d2-d-r1-formal-session` 或 `w4-d2-d-r1-node-session`、`profileRevision=3`、`modelId=deepseek-chat`、`promptVersion=w4-d2-v1`；预期 runId 分别为 `w4-cap-8c9b5a032b938c8b3725dc6e` 和 `w4-cap-9903ca4f8ae1d9450a77f039`。

未进行在线模型测试，未证明在线时延、供应商可用性或真实模型质量。`RECORDED_PASS` 仅代表离线录制边界，状态为 `LIVE_NOT_RUN`。

## 锁与发布声明

本交接单随 D2 正式候选提交；无 Profile 激活、无 HTTP/Web 变更、无 C 开工、无 W4 GO。在线模型状态为 `LIVE_NOT_RUN`。
