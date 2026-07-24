# 2.2 金额、城市、日期和状态

金额去掉货币符号、逗号和空格后转换为数值；城市只使用冻结的六条映射；日期仅接受 `YYYY-MM-DD`；状态去空格并小写后只允许 `completed`、`pending`、`cancelled`。

来源锚点：`src-pandas-to-numeric`、`src-pandas-to-datetime`、`src-pandas-string`。
