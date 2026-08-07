# W3-D1 B 验证证据

本证据仅为候选审计材料，不是上传授权。

| 检查 | 结果 |
|---|---|
| HEAD / origin/main | `2db7127bcd22035951474ddd3f86de4e8cfa77be`，一致 |
| 全局 Bundle | 5；W3 目标恰为 `act-inspect-dataframe`、`act-practical` |
| 标注 SHA-256 | `eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf`（冻结） |
| final-60 输入 SHA-256 | `b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c`（冻结） |
| 原 seal | `original/audit-only`，逐字节保留 |
| 资产树 | 29 项，`ddd23e6cd4b54725e4e00cbcdac299c0ba3cf5d6c997b6fe748767f5309df04c` |
| B 标注装配 | 正式路径已作为 `proposedCommit` 写入 manifest、ZIP 和拟提交清单；SHA-256 与封存值一致 |
| Rubric 标签 | 外部及内嵌 `structure.label` 均严格为 `列结构` |
| 静态作者反例 | `STATIC AUTHOR CHECK PASSED`，退出码 0 |
| 候选证据 | `overallExitCode=0`；baseline/starter/known-wrong 摘要均通过 |

完整逐项结果保存在同目录 `quality/c-execution-evidence.json`，其内容来自候选证据脚本；不得将本文件解读为负责人双封存 PASS。
