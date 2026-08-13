# Python 基础补救卡

适用知识点：`basic-python`。预计 5 分钟；仅在诊断显示需要补救时提供，不计入六个 Pandas 核心知识点覆盖或最终必做活动。

## 最小准备

变量名保存对象引用；属性不带括号，方法调用带括号：`df.shape` 是属性，`df.head()` 是方法调用。

## 最小示例

```python
import pandas as pd
df = pd.DataFrame({"order_id": ["A-1"]})
print(df.shape)
print(df.columns.tolist())
```

## 常见误区与自测

不要写 `df.shape()`；请解释 `df.columns` 与 `df.columns()` 的区别。

来源：`src-python-basic-types`。掌握后进入 `pandas.clean.read-csv`，不改变最终 `clean_df` 合同。
