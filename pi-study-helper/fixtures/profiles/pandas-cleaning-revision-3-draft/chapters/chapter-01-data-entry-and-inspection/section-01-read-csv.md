# 读取 CSV

- 知识点：`pandas.clean.read-csv`
- 预计时间：15 分钟；先修：`basic-python`
- 学习目标：使用 `pandas.read_csv` 读取固定七列订单数据，并明确返回对象是 DataFrame。

## 核心概念与最小示例

```python
import pandas as pd
orders = pd.read_csv("orders-learning.csv")
```

读取是进入清洗流程的第一步；后续处理应基于 DataFrame，而不是手工拼接字符串。

## 反例与典型误区

不要把文件路径当作 DataFrame，也不要在未读取数据时先猜测列名或排序规则。

## 无分自测

`pd.read_csv` 返回的对象类型是什么？读取后下一步应检查哪两项结构信息？

## 来源与最终任务关系

来源：`src-pandas-read-csv`，定位见 `sources/source-map.json`。本节提供 `clean_df` 的可靠输入；它本身不清洗数据。
