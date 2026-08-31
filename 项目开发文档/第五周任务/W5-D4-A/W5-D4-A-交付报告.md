# W5-D4-A 交付报告

候选基线：`a0d5a37116a6c67f009ca19e313501d9eed96f78`  
合同：`W5-C1/W5-R1`  
状态：`READY_FOR_OWNER_CONTRACT_ENV_REVALIDATION / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

## 交付结论

A 已完成正式组合根上的双向 Web/TUI 共享会话测试、服务重启恢复、安全 Attempt 读取和 B 三案例正式 PathEngine 重放。三案例每对实际差异为 32、12、21 项，输入、路径和规范输出均绑定 SHA-256。

V5-1 与 V5-4 的 A 责任范围在当前机器通过。V5-3 的 C D3 正式合同环境结果已绑定，但 A 当前机器不匹配合同版本且缺少 Pandas，因此 A 独立 V5-3、全量和 verify 保持 `NOT_VERIFIED_IN_CONTRACT_ENV`，不得写成 PASS。

## 当前机器验证

| 验证项 | 结果 |
|---|---|
| D4 跨端 | PASS，1 文件 / 2 测试 |
| D4 三案例 | PASS，1 文件 / 1 测试 |
| 受影响回归 | PASS，3 文件 / 21 测试 |
| typecheck/docs/build:web/smoke:extension/check:release/diff check | PASS，exit 0 |
| revision 3 正式 Node 合同测试 | NOT VERIFIED，3 PASS / 2 FAIL |
| 全量 | 非合同环境，95/102 文件通过；806 PASS / 30 FAIL / 1 skipped |
| verify | 非合同环境，因全量 evaluator 失败 exit 1 |

实际环境：Node `v24.18.0`、npm `11.16.0`、Python `3.11.9`、Pandas `UNAVAILABLE`、`PYTHONNOUSERSITE=1`。每条命令的 UTC 时间、自然退出码和日志哈希见 `command-results.json`。

## 复核要求

负责人在合同环境 Node `22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5` 下复验正式 Node、全量和 verify。审核 ZIP、外置 sidecar、Manifest 和 proposed 清单仅用于复核，不进入正式 Git 候选。

本轮没有修改 Web、Profile、环境锁、执行器、SDK、依赖或其他岗位文件，也没有执行 add、commit、push 或上传锁申请。
