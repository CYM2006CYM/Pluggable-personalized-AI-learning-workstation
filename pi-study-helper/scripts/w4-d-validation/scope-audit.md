# W4-D2-D-3 范围审计

## 允许范围

候选仅新增 D 所有权下的 application/infrastructure 实现、D 测试、D 私有录制 fixture/prompt，以及指定的验证材料和交接单。

负责人批准的revision 3可观察维度保守映射位于D所有的Evidence投影适配器中，只读取公开的revision、知识点、活动和Evidence form；未修改A公共Schema、B资料包或seal。

## 禁止范围检查

- `src/contracts/`：未修改。
- A 判分、Evidence、KnowledgeState、路径、游标、事务和仓储：未修改。
- B revision 3 Profile 原件及 `assessments/private`：未修改。
- C HTTP/Bootstrap/启动器：未修改。
- `src/web/` 与 `tests/web/`：未修改。
- SDK、`package.json`、锁文件、W3 环境锁、正式 gold：未修改。
- 运行时 CIDPP：未新增、未接入。
- 负责人合同与裁决文档：未修改；仅新增指令要求的 D 交接单。

工作树原先存在的仓库根审计目录、ZIP 和旧交接材料均属于用户，未读取后改写、未删除、未纳入本候选。候选包使用显式逐文件清单构建，不使用工作树通配收集。

## 权限边界结论

D 端口不能直接写 Evidence、KnowledgeState、mastery、confidence、分数、路径、活动游标或 Attempt 结果。动态内容服务只返回 A 冻结端口允许的候选或 `unavailable`；Capability 服务只写 `_user` 私有任务/快照存储。最终 fixed/supplemental/insufficient 选择及学习结果仍由 A 的确定性实现负责。

当前状态：`NOT_COMMITTED`、`NOT_PUSHED`、`uploadLock=NOT_REQUESTED`。
