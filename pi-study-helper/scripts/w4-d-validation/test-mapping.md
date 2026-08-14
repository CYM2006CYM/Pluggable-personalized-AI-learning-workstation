# W4-D2-D 必测反例映射

| # | 合同反例 | 证据位置 | 当前执行状态 |
|---:|---|---|---|
| 1 | 修改 `correctAnswer` 拒绝 | `adaptive-content-service.test.ts` authority table | PASS |
| 2 | Evidence/KnowledgeState/mastery/score/path/cursor 越权拒绝 | authority table、严格 exact-key 校验 | PASS |
| 3 | 私有资产请求拒绝 | authority table、review-stage 脱敏反例 | PASS |
| 4 | 低风险题仅 Generator | low-risk quiz test | PASS |
| 5 | 高风险严格审核顺序 | high-risk quiz test | PASS |
| 6 | 所有动态卡片完整审核 | card review test | PASS |
| 7 | checkpoint 恢复且不重复发布 | checkpoint resume test | PASS |
| 8 | card/quiz 不串缓存 | identical-key separation test | PASS |
| 9 | 15 秒返回 unavailable 绑定 fixed | controlled-clock test + fixed fallback integration | PASS |
| 10 | 60 秒内晚到只缓存 | controlled-clock late-cache test | PASS |
| 11 | 60 秒后丢弃 | controlled-clock discard test | PASS |
| 12 | 非法 Schema unavailable | invalid-output tests/recording | PASS |
| 13 | provider 错误 unavailable | provider-error tests/recording | PASS |
| 14 | 全模型不可用固定主链继续 | `w4-d-fixed-fallback-integration.test.ts` | PASS |
| 15 | 无证据维度 unverified | capability partial/empty tests | PASS |
| 16 | 画像失败保留旧快照 | capability failure test | PASS |
| 17 | 画像失败不回滚事务 | 冻结异步端口边界 + old-snapshot preservation | PASS |
| 18 | 录制响应无真实敏感数据 | fixture security test + `security-scan-result.json` | PASS |
| 19 | CIDPP 未进入请求主链 | scope/CIDPP static scan | 静态 PASS |
| 20 | D 不绕过 A 产生学习结果 | A-port integration + scope audit | PASS |
| 21 | 正式 Evidence provider 只读 A bound snapshot | `session-capability-evidence-provider.test.ts` | PASS |
| 22 | missing/duplicate/foreign/cross-session/revision/future version 拒绝 | `session-capability-evidence-provider.test.ts` | PASS |
| 23 | 较旧任务遇到较新 Evidence 标记 stale | `session-capability-evidence-provider.test.ts` | PASS |
| 24 | A 正式 session/create/commit → D capability snapshot | `w4-d-formal-ad-binding.test.ts` | PASS |
| 25 | diagnostic_completed 与 node_completed 两类触发 | `w4-d-formal-ad-binding.test.ts` | PASS |
| 26 | Graph 注册覆盖五个 D graphId 且 unknown unavailable | `w4-d-graph-factory.test.ts` | PASS |
| 27 | 同一当前版本绑定历次累积 Evidence | `session-capability-evidence-provider.test.ts` | PASS |
| 28 | outcome变化不改变可观察维度，未知组合不默认映射 | `session-capability-evidence-provider.test.ts` | PASS |
| 29 | 跨学习单元保留旧画像已验证维度 | `capability-task-service.test.ts` | PASS |
| 30 | 英文理由拒绝、中文理由可采用 | `capability-task-service.test.ts`、录制响应校验 | PASS |

六类无密钥轨迹均由 `w4-d-recorded-responses.test.ts` 通过正式 `ModelExecutionPort` 边界重放。A 正式事务到 D 画像快照由 `w4-d-formal-ad-binding.test.ts` 证明。`RECORDED_PASS` 不是在线模型能力证明；在线状态固定为 `LIVE_NOT_RUN`。
