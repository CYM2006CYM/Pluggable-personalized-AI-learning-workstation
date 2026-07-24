# 2.1 重复订单选择

重复 `order_id` 先保留日期可解析的记录，再保留日期最新的记录；日期相同、缺失或都不可解析时保留原始第一条。选择完成后按原始位置恢复相对顺序。

来源锚点：`src-pandas-duplicates`、`src-pandas-sort-values`。
