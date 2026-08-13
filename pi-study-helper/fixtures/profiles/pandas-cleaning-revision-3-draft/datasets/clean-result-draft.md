# clean_df候选结果说明

状态：`draft / pending_owner_decision`。本文件只记录预期，不替代锁定环境产生的唯一clean_df。

- 公开CSV输入30行；缺失`order_id`的1行应删除。
- `O011`保留日期为`2026-01-15`的记录。
- `O012`两条日期均不可解析，保留原始第一条。
- `O013`日期相同，保留原始第一条。
- 因此候选输出应为26行；具体dtype名称、序列化文本和摘要待C环境原型及负责人批准。
- 固定列序：`order_id, customer_id, amount, city, order_date, status, note`。
- 不允许通过排序、自动改列名或填充非合同缺失值来获得预期结果。
