# D47三层测试计划R4

合同：`W3-C5/W3-R2`；裁决：`W3-D47-TEST-LAYERS-1`。

| 层 | 范围 | D3状态 | D4前置条件 |
| --- | --- | --- | --- |
| 确定性层 | V3-1、V3-2、V3-4、V3-5、V3-8 | PLAN_ONLY | A正式提交和测试清单已绑定 |
| 评测器集成层 | V3-3、V3-6 | PLAN_ONLY | 批准Node/Python/Pandas环境及C/A输入已绑定 |
| 固定轨迹Demo层 | D冻结成功/失败/越权/fallback轨迹，经假LLM和`ModelExecutionPort`回放 | PENDING_D_FORMAL_BINDING | D正式提交、实际测试文件、命令和哈希已绑定 |

D4逐层登记原始命令、测试文件、输入路径、SHA-256、退出码、项数、原始输出和失败归因。固定轨迹层统一登记`LIVE_NOT_RUN`；只在实际fallback时登记`MOCK_FALLBACK_USED`。任何层未执行不得写PASS，固定轨迹层不替代V3-1至V3-8。
