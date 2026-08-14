# W4-D2-D-4 最终验证报告

状态：`D_REMEDIATION_PASS / FULL_VERIFY_PASS / LIVE_NOT_RUN`

## 已确认基线

- 实际 `HEAD` 与 `origin/main`：`576d326dbcaf73d92ec56093dd010332c3936e98`，两者一致。
- A 正式提交：`4c52eb7c78fa80007aa9a8ab4e00768d71d3f3f5`，祖先检查退出 0。
- B 正式提交：`56398ab5f44283e9c10b6d66ec2f0732cc043790`，祖先检查退出 0。
- 负责人随后提交了 W2 V2-6 有界超时修复 `576d326`；D 候选在该提交之上复验，未修改该修复或其他岗位实现。
- revision 3 独立读取正式 seal：78 entries，`e118fd65c4583821f686cba4faab5990a81d2149a8f73cf89af2c376ba15b352`。

## 实现结论

- `AdaptiveContentService` 只实现 A 冻结的 `AdaptiveContentPort`，仅返回候选或 `unavailable`。
- quiz 与 card 使用独立 `artifactKind`、稳定运行键、checkpoint 和私有缓存。
- 低风险 quiz 仅执行 Generator；高风险 quiz 执行 Generator → Hunter → 条件 Defender → Judge；所有 card 进入完整审核链。
- Hunter/Judge 不接收动态题的 `correctAnswer` 或 `explanation`；任何额外 authority 字段、私有资产请求、绝对路径或凭据形态内容均拒绝。
- 15 秒返回 `unavailable`；15–60 秒合格晚到结果仅进入私有缓存；到达 60 秒的结果丢弃。
- `CapabilityTaskService` 只接受两个冻结触发器，异步生成五维 `complete/partial/unverified` 快照；任务状态与快照状态分离，失败保留旧快照。
- `SessionCapabilityEvidenceProvider` 只依赖 A 的 `SessionBindingReader` 只读正式快照，校验 session/revision/evidenceVersion/evidenceId/knowledgePointId，并用字段白名单生成 safeSummary。
- 当前会话版本允许绑定该版本之前的全部累积正式 Evidence；会话最新版本仍必须等于任务版本，Evidence归属、版本上界和ID唯一性仍严格校验。
- 画像更新保留同一Profile revision下上一快照的已验证维度，仅替换本次模型实际返回的维度；失败、过期和无证据不会清空旧画像。
- revision 3使用D所有、显式版本化的保守可观察维度映射表；映射只使用公开的Profile revision、knowledgePointId、activityId和Evidence form，未知组合返回空映射，不根据答对答错或分数猜测维度。
- CapabilityScorer提示词、Graph提示词、录制响应和程序校验均要求画像理由包含简体中文。
- `createW4DModelGraphs()` 提供 C 可注册的 `generator/hunter/defender/judge/capability-scorer` 五个 D Graph；未知 graphId 通过 `PiGraphModelExecutionAdapter` 返回 `graph=unavailable`。
- 所有 checkpoint、缓存、轨迹、画像快照和画像任务状态的文件实现均限定在 Profile 族 `_user/w4-d/`。
- 没有接入在线模型、真实 Key 或运行时 CIDPP。状态为 `LIVE_NOT_RUN`。

## 验证结果

- 官方 Node v22.23.1 便携包 SHA-256 与 Node 官方 `SHASUMS256.txt` 一致；合同环境 npm 为 10.9.8。
- 仓库外 Python v3.13.7 / Pandas 3.0.5 环境完成预检，且正式测试禁用用户 site-packages。
- `npm run typecheck`：PASS。
- D 定向/回归：7 files、37 tests，全部 PASS。
- A/D 受影响回归：11 files、83 tests，全部 PASS。
- 六类录制响应：14 条，覆盖与敏感扫描 PASS；capability-scorer 绑定 A 正式 session 轨迹；`LIVE_NOT_RUN`。
- `npm run check:docs`、`npm run smoke:extension`、`npm run check:release`：PASS。
- 合同环境 `npm run verify`：`77 files / 727 passed / 1 skipped`，退出 0；已包含 W2 V2-6 有界超时修复。
- V2-6 direct runner：development=20、final=60，候选和正式主干提交均通过，冻结输入哈希不变。
- 合同 Node v22.23.1 / Python 3.13.7 / Pandas 3.0.5 下，Python 评测相关 2 files、26 tests 全部 PASS。
- 本轮每条最终命令均保存实际开始/结束时间、退出码、项数以及stdout/stderr SHA-256；原始日志保存在仓库外临时目录，不进入Git候选。
- 历史失败日志不被改写；本轮最终结果作为新的 `final-*` 记录追加在唯一 `command-results.json` 中。D未修改 W2 原始案例、A/B/C 实现或依赖锁文件。

## 发布状态

本报告对应 D2 正式候选，待负责人确认后提交。未进行持久 Profile 激活，未修改 HTTP/Web，未签发 C 开工或 W4 GO。在线模型状态固定为 `LIVE_NOT_RUN`。
