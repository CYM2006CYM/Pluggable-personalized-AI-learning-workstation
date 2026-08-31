# W3-D3 A 岗位正式审计候选交接单

执行记录：`W3-D36-PROFILE-ACTIVATION-1`
现行合同：`W3-C5/W3-R2`
负责人裁决：`W3-D47-TEST-LAYERS-1`
审计基线：`bd1b599524ef2e3362d14a422d97debbf240f70f`

## 输入与合同

- `HEAD == origin/main == bd1b599524ef2e3362d14a422d97debbf240f70f`。
- `f190326a`、`277805b`、`8f8e2c7`、`8648620` 均已核验为 HEAD 祖先。
- `act-inspect-dataframe`：`bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c`。
- `act-practical`：`3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c`。
- 环境锁原始文件 SHA-256：`59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43`。
- 环境锁内部 `environmentHash`：`sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76`。
- D36 签发时为 `W3-C4`；D47 进入 main 后将现行业务合同升级至 `W3-C5`，且明确不撤销 D36 激活批准，故无实质合同冲突。

## 实现结论

`ProfileFamilyRepository.activateV2Draft()` 是 revision 2 唯一激活入口：它重新校验固定 draft、在临时目录生成 active 候选、将旧 active 以 `archived` manifest 归档，并在任一故障时恢复旧 active。会话只绑定仓储 active 选择的 revision；旧会话只从 active/archived 解析，正式 resolver 不读取 draft。

`ActivityRuntimeService` 仅接收 C 的公共 `ActivityResult`。新增的 `submitFormalActivity` 是 A-owned 正式提交编排入口：它显式剥离评测器内部状态，将公共结果交给 `LearningSessionUnitOfWork`，由 `LearningSessionRepository.commit` 一次性发布 Evidence、KnowledgeState、未完成路径后缀和 checkpoint，随后将对应Attempt标记为已提交；若回标失败，Attempt保留为恢复句柄。入口返回安全 `ActivitySubmissionOutput`；非计分评测器故障不进入 Evidence。

## 确定性层验证

| 命令 | 结果 |
| --- | --- |
| D47确定性/Mock显式集合（排除2个C真实Python评测器文件） | 50文件、501通过、1跳过、退出码0 |
| V3-4 定向 | 3 文件、25 通过、退出码 0 |
| V3-5 定向 | 2 文件、37 通过、退出码 0 |
| V3-6 定向 | 5 文件、66 通过、退出码 0 |
| 全量原始门禁 | 52文件；505通过、22失败、1跳过、退出码1；22项均位于C所有的2个Python评测器集成文件，当前机器返回批准环境不匹配或进程超时，不归因于A确定性层 |
| `npm.cmd run typecheck` | 退出码 0 |
| `npm.cmd run check:docs` | 退出码 0，49 个项目 Markdown 链接有效 |
| `git diff --check` | 退出码 0；仅 CRLF→LF 警告，无 diff 错误 |

未覆盖：按 D47，A 未主动启动 Python 评测器、真实 Key、在线模型或固定轨迹 Demo；这些属于评测器集成层或其他岗位，并不构成 A 确定性层失败。

## 本轮整改

1. 根因：会话候选已可恢复时，UnitOfWork 仍无条件删除对应 Attempt，恢复后可能留下 Evidence 而缺少 Attempt。修复：会话仓储暴露候选探针；候选存在时保留 Attempt；`LearningSessionUnitOfWork.recover()` 成功发布 checkpoint 后幂等写入 `committedAt`。
2. 根因：Evidence ID 只在当前候选批次内去重。修复：在准备会话事务时与当前已提交 Evidence 集合交叉检查；冲突在写入和版本推进前返回 `evidence_invalid`。
3. 根因：原 `submitActivity` 只写活动Attempt候选，没有连接 `LearningSessionUnitOfWork`，正式链路不会发布Evidence、KnowledgeState、路径后缀和checkpoint。修复：增加A-owned `submitFormalActivity` 编排入口和端到端fixture测试；覆盖pass、partial、learner error、evaluator error、幂等重放和内容冲突。

反例覆盖 `evidence_written`、`knowledge_state_written`、`path_written`、`checkpoint_written` 四个跨仓储故障点，以及会话事实已发布但 `markCommitted` 回标失败的故障点：首次提交后旧 checkpoint 仍公开；恢复后Attempt、Evidence、KnowledgeState、路径与checkpoint成组存在；回标失败保留Attempt，下一次恢复只补写 `committedAt`；重复恢复和同 requestId 重试均不产生第二份事实。

## 正式证据

- [输入与 Profile 状态](../../pi-study-helper/scripts/w3-path-validation/W3-D3-A-input-profile-state-evidence.json)
- [V3-4](../../pi-study-helper/scripts/w3-path-validation/v3-4-author-evidence.json)
- [V3-5](../../pi-study-helper/scripts/w3-path-validation/v3-5-author-evidence.json)
- [V3-6](../../pi-study-helper/scripts/w3-path-validation/v3-6-author-evidence.json)
- [故障矩阵](../../pi-study-helper/scripts/w3-path-validation/failure-matrix.json)

状态：`NOT_COMMITTED`、`NOT_PUSHED`、未申请上传锁。审计 ZIP 位于仓库外的系统临时目录，不进入 Git 拟提交清单。未修改 B/C/D/E、gold、SDK、依赖、环境锁、合同或负责人批准记录。
