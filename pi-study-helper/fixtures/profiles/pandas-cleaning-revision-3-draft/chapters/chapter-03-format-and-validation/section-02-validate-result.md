# 验证清洗结果

- 知识点：`pandas.clean.validate-result`
- 预计时间：20 分钟；先修：`pandas.clean.duplicate-orders`、`pandas.clean.type-format`
- 学习目标：验证列、dtype、缺失、唯一性和被选记录的行序，确认结果是唯一的 `clean_df`。

## 核心概念与最小示例

```python
from pandas.testing import assert_frame_equal
assert_frame_equal(actual.reset_index(drop=True), expected.reset_index(drop=True))
```

比较前可以重置索引，但不能通过自动排序、改列名或填充缺失来掩盖错误。

## 反例与典型误区

只比较行数或只比较值会漏掉列序与 dtype 错误；使用真实网络模型也不是本周确定性判定的一部分。

## 无分自测

为什么相同的行集合在行序不同的情况下仍可能是不合格的 `clean_df`？

## 来源与最终任务关系

来源：`src-pandas-testing`、`src-python-security`。本节是最终实操活动的验收入口，不引入新的清洗规则。
