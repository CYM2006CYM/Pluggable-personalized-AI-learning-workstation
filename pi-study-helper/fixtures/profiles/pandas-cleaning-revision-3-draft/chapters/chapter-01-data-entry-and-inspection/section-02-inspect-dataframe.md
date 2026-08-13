# 检查 DataFrame 结构

- 知识点：`pandas.clean.inspect-dataframe`
- 预计时间：15 分钟；先修：`pandas.clean.read-csv`
- 学习目标：使用 `shape`、`columns`、`dtypes` 和 `head` 检查输入，并确认七列的固定顺序。

## 核心概念与最小示例

```python
print(df.shape)
print(df.columns.tolist())
print(df.dtypes)
print(df.head())
```

结构检查把输入合同显式化，避免在缺失、重复或类型清洗后才发现列名或列序错误。

## 反例与典型误区

不要仅凭 `head()` 的几行输出假定所有列齐全；也不要为了“整齐”而自行重排列。

## 无分自测

哪个属性用于确认列的顺序？为什么 dtype 检查不能替代列名检查？

## 来源与最终任务关系

来源：`src-pandas-dtypes`。本节确定 `clean_df` 应保留的结构边界，并为后续所有清洗操作提供输入校验。
