# 规范类型与格式

- 知识点：`pandas.clean.type-format`
- 预计时间：30 分钟；先修：`pandas.clean.missing-values`
- 学习目标：规范金额、日期、城市、状态和文本列，使结果符合环境锁和业务合同。

## 核心概念与最小示例

```python
clean_df["amount"] = pd.to_numeric(clean_df["amount"], errors="coerce")
clean_df["order_date"] = pd.to_datetime(clean_df["order_date"], format="%Y-%m-%d", errors="coerce")
```

金额转换失败变为缺失；日期只接受 `YYYY-MM-DD`；文本列最终使用 `StringDtype`。

## 反例与典型误区

不要宽松猜测日期格式，也不要把未登记城市自动加入映射表或把所有列转为 Python `object`。

## 无分自测

为什么 `errors="coerce"` 比将非法金额改为 0 更符合数据合同？

## 来源与最终任务关系

来源：`src-pandas-to-numeric`、`src-pandas-to-datetime`、`src-pandas-string`。本节完成 `clean_df` 的可比较 dtype 与合法业务格式。
