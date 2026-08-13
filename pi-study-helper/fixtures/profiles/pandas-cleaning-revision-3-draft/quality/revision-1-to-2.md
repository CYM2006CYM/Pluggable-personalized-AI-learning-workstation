# Pandas Profile revision 1 → 2 迁移记录

状态：本地 D2 候选；`draft`，待负责人审批。revision 1 从未 active，唯一运行目录保持为 `pandas-cleaning-v2-draft`；历史版本仅由 Git 提交 `f6c8396` 与本记录保留。

## 知识点映射

| revision 1 | revision 2 |
|---|---|
| `kp-structure` | `pandas.clean.read-csv`、`pandas.clean.inspect-dataframe` |
| `kp-missing` | `pandas.clean.missing-values` |
| `kp-duplicates` | `pandas.clean.duplicate-orders` |
| `kp-types` | `pandas.clean.type-format` |
| `kp-invariants`、`kp-engineering` | `pandas.clean.validate-result` |
| 无 | `basic-python`（补救节点，importance 为 0） |

## 内容与结构迁移

- 三章六节改为 `chapter-01-data-entry-and-inspection`、`chapter-02-cleaning-issues`、`chapter-03-format-and-validation`，每节对应一个核心 Pandas 知识点。
- `act-structure` 拆分为 `act-read-csv` 与 `act-inspect-dataframe`；原核心活动、诊断、兜底题和 TaskBundle 元数据改用 revision 2 标识。
- 来源入口由 `sources/source-registry.json` 迁移为 `sources/source-map.json`；来源仍为候选，技术冲突仅由官方文档裁决。

## D3 续作边界

公开/私有 CSV、参考实现、唯一 `clean_df`、错误实现、20 个开发案例、60 个正式案例、作者复算证据和 gold 均不在 D2 完成，也未创建或冻结。D2 不提交、不推送、不生成 D4 候选 ZIP。
