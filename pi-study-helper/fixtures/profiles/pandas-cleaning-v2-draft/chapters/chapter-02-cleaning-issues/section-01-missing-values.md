# 处理缺失值

- 知识点：`pandas.clean.missing-values`
- 预计时间：20 分钟；先修：`pandas.clean.inspect-dataframe`
- 学习目标：依据固定业务合同处理各列缺失值，而不是对整表无差别 `dropna()`。

## 核心概念与最小示例

```python
clean_df = df.dropna(subset=["order_id"]).copy()
```

只有 `order_id` 缺失会删除该行；其余列的处理由固定合同决定，并须保留可审计的列结构。

## 反例与典型误区

`df.dropna()` 会删除不该删除的有效订单；把非法金额直接改为 0 也会伪造业务事实。

## 无分自测

为什么 `customer_id` 缺失不能自动等同于删除订单？

## 来源与最终任务关系

来源：`src-pandas-missing-data`。本节保证 `clean_df` 的行删除规则只由合同决定。
