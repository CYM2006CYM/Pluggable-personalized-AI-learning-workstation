# 1.2 缺失值处理

不同列的缺失规则不同：缺失 `order_id` 删除整行；缺失 `customer_id` 保留；非法金额和日期转缺失但保留行；缺失 `note` 转为空字符串。不能用一次全表 `dropna` 代替业务规则。

来源锚点：`src-pandas-missing-data`。
