# 处理重复订单

- 知识点：`pandas.clean.duplicate-orders`
- 预计时间：25 分钟；先修：`pandas.clean.inspect-dataframe`
- 学习目标：按可解析日期、最新日期、原始第一条的优先级稳定选择每个 `order_id` 的记录。

## 核心概念与最小示例

先用可解析日期建立选择依据，再仅保留每个订单被选记录；输出恢复被选记录的原始相对顺序。

```python
chosen = df.drop_duplicates(subset=["order_id"], keep="first")
```

上例只说明 API 形状，不能替代本项目的日期优先级合同。

## 反例与典型误区

不要按金额最大或原始最后一条选择；去重后也不能为了显示效果按 `order_id` 再排序。

## 无分自测

若两条日期同样不可解析，为什么要保留原始第一条？

## 来源与最终任务关系

来源：`src-pandas-duplicates`、`src-pandas-sort-values`。本节确保 `clean_df.order_id` 唯一且行序稳定。
