# W6 真实AI六节客观题本地运行记录

状态：`REOPENED / ANSWER_SEMANTIC_REVIEW_NOT_CLOSED`；未提交、未上传

安全说明：本文只记录公共题干和选项，不记录正确答案、答案解析、hidden tests、Rubric、reference solution、gold 或 API Key。

## 一、历史运行事实（不得作为新版审核通过证据）

- 运行日期：2026-08-24
- 会话：`session-42ec01bd265c6e9611bb9f95`
- Profile revision：3
- 教学正文版本：`guided`
- 实时模型：`deepseek-chat`
- Prompt版本：`w4-d2-v2`
- 合同环境：Node `v22.23.1`、Python `3.13.7`、pandas `3.0.5`
- 六节题组：旧版运行中全部取得过`questionSource=ai_live`，每节6题，共36题
- 最终独立实操：权威评测`pass`
- 评测维度：structure、missing、duplicates、types、invariants、engineering全部为1
- 最终Evidence版本：14
- 会话完成版本：35
- 完成结论：`Session completed. No unresolved deterministic result was recorded.`

重新审查结论：上述事实只证明旧版`w4-d2-v2`曾真实调用模型并生成题组，不能证明候选答案已经被有效审核。第5节第1题把非法金额文本`abc12`“保留原文本”作为正确方向，与正文规定的`pd.to_numeric(..., errors="coerce")`失败后转为缺失相冲突。根因是旧逻辑允许低风险Quiz在Generator后直接接受，且Hunter审核视图不包含候选答案与解析。

当前代码候选已改为所有动态Quiz强制执行`Generator → Hunter → Judge`，仅在Hunter报告争议时插入Defender；Hunter和Judge获得只供模型审核的私有答案视图，公共DTO、DOM和普通日志仍不得出现答案。实时Prompt已升级为`w4-d2-v3`以隔离旧缓存，但尚未完成新版真实API复验，因此不得登记`LIVE_MODEL_PASS`。

边界事实：第5节首次Generator输出未通过确定性结构校验，固定题正常接管，重试后取得`ai_live`。第6节曾因生成器允许的活动来源与题组选择器允许的来源集合不一致，出现固定题和0题；修复为统一使用“活动来源 + 知识点来源”后，真实API复验取得`ai_live`。这些运行事实保留，但不能覆盖本次重新打开的答案语义审核阻塞。

## 二、01 读取CSV

来源：`act-read-csv`；`questionSource=ai_live`；`retryNumber=0`

1. 对Python来说，读取CSV之前，磁盘上的CSV文件本质上是什么？
   - A. 已经是正在运行的表格对象，可直接对字段做去重
   - B. 只是一段保存在磁盘上的文本，需要先读进适合处理表格的数据对象
   - C. 一个已经带有数据类型的二维表，可以进行清洗
   - D. 一个数据库表，可以直接执行查询
2. 订单CSV中金额被写成 `"¥1,200.50"`（带引号）时，下面哪种做法是正确的？
   - A. 先手工用字符串`split(',')`切分，再合并金额字段
   - B. 按CSV规则处理引号，交给`read_csv`解析，使金额逗号仍属于同一个单元格
   - C. 直接忽略引号，把金额逗号当作分隔符
   - D. 把带引号的行整行丢弃
3. 执行 `orders = pd.read_csv("orders-learning.csv")` 后，通常返回并保存到orders的是什么？
   - A. 一个字符串，表示文件路径
   - B. 一个列表，包含每一行拆开的字段
   - C. 一个DataFrame，即pandas中的二维表格对象
   - D. 一个文件句柄，需手动关闭
4. 反例中把文件路径直接赋值给变量 `orders = "orders-learning.csv"`，会导致什么后果？
   - A. orders本身就是一个DataFrame，可直接检查列
   - B. orders只是一个字符串，没有订单表的列，无法进行DataFrame检查
   - C. 会自动读取文件并持久化到数据库
   - D. 会立即触发pandas读取并返回表格
5. 根据正文，读取成功后程序没有报错时，应如何看待数据的清洗状态？
   - A. 可以立即宣布数据已经合格并提交
   - B. 读取成功只说明文件能按当前参数组织成表，不代表列齐全、类型正确或已去重
   - C. 说明金额、日期等所有字段已经自动清洗完成
   - D. 说明所有订单号都已无缺失
   - E. 说明读取阶段已经替代了全部后续步骤
6. 根据正文关于编码与分隔符的说明，下面哪种做法是合理的？
   - A. 不断尝试不同编码直到看起来能打开文件，因为结果看起来正确即可
   - B. 在源文件没有表头时，仍把第一条订单当成列名
   - C. 分隔符、表头和必要编码应来自资料包或明确配置，不能靠猜测
   - D. 任意上传其他CSV来替换资料包文件

## 三、02 检查DataFrame结构

来源：`act-quiz-inspect-dataframe`；`questionSource=ai_live`；`retryNumber=0`

1. 结构检查必须发生在哪些处理步骤之前？
   - A. 缺失值处理、去重和类型转换之前
   - B. 类型转换和重排顺序之后
   - C. 删除空值之后
   - D. 格式化为最终输出之后
2. 下列哪个方法回答“这张表有多少行和多少列”的问题？
   - A. `raw_orders.shape`
   - B. `raw_orders.columns`
   - C. `raw_orders.dtypes`
   - D. `raw_orders.isna()`
3. 正式代码活动要求检查结果副本恰好保留固定七列，同时原始输入不能被改写。下列哪段代码符合要求？
   - A. `inspected = raw_orders.loc[:, expected].copy()`
   - B. `inspected = raw_orders.drop(columns=['unexpected'], inplace=True)`
   - C. `raw_orders = raw_orders.reindex(sorted(raw_orders.columns), axis=1)`
   - D. `inspected = raw_orders.copy(deep=True)`
4. 用集合比较列名为什么不能作为最终结构判据？
   - A. 因为集合会比较忽略列的顺序，即使为真也不能证明固定列序
   - B. 因为集合比较会更改数据内容
   - C. 因为列名不能被比较
   - D. 因为集合比较会删除缺失值
5. 观察前三条记录用的是哪个工具？
   - A. `raw_orders.head(3)`
   - B. `raw_orders.shape`
   - C. `raw_orders.dtypes`
   - D. `raw_orders.isna().sum()`
6. amount列当前显示为字符串形式（如金额混有货币符号），此时检查阶段应该怎么做？
   - A. 只记录现状，不急着调用`astype`，交给后面的类型格式小节处理
   - B. 立即调用`astype`转换为数值
   - C. 立刻删除该列
   - D. 直接在检查阶段补一个虚构数值

## 四、03 处理缺失值

来源：`act-quiz-missing-values`；`questionSource=ai_live`；`retryNumber=0`

1. 在pandas中，`pd.isna()`对下列哪个值返回False？
   - A. `None`
   - B. `pd.NA`
   - C. `NaN`
   - D. 空字符串`""`
2. 判断order_id是否有效订单号时，为什么不能只调用`notna()`？
   - A. `None""`会被当作缺失
   - B. 纯空格会被误认为有效订单号
   - C. `notna()`会修改原有数据
   - D. `notna()`无法用于字符串列
3. 某订单order_id有效但customer_id缺失，按教学规则应如何处理？
   - A. 删除该订单整行
   - B. 为customer_id填上假客户号
   - C. 用`pd.NA`填充该订单金额
   - D. 保留订单，customer_id继续保留缺失
4. 处理未知金额amount时，下列哪种做法符合本节的修复方法？
   - A. `fillna(0)`把未知金额改成0元
   - B. `fillna(今天的日期)`充当默认日期
   - C. 保留缺失，交给后续类型阶段统一转换
   - D. `fillna("未知")`填文本
5. 为什么不能用 `df.dropna(subset=["order_id"], inplace=True)` 删除无效订单？
   - A. 删除数量无法统计
   - B. 它会误删缺备注的有效订单
   - C. 调用者输入被污染，无法重试和审计
   - D. `dropna`只对数值列生效
6. 按教学规则，缺失note应如何处理？
   - A. 作为伪造事实填充0
   - B. 删除包含缺失备注的整行
   - C. 转换为空字符串并去首尾空格
   - D. 填文本“未知”

## 五、04 处理重复订单

来源：`act-quiz-duplicate-orders`；`questionSource=ai_live`；`retryNumber=0`

1. 本项目判断多条记录是否属于同一订单时，重复键是哪个字段？
   - A. order_id
   - B. 金额
   - C. 状态
   - D. 备注
2. O012组中第一条为2026-01-14、第二条为2026/01/14，按三级规则应保留哪条？
   - A. 保留第二条，因为它在文件中靠后
   - B. 保留第一条，因为只有它满足YYYY-MM-DD且可解析
   - C. 两条合并成一条
   - D. 保留金额较大的那条
3. O013组两条记录日期都不可解析（not-a-date与also-bad），按三级规则最终应保留哪条？
   - A. 原始数据中的第一条
   - B. 原始数据中的最后一条
   - C. 金额最大的那条
   - D. 按备注排序后的第一个
4. 以下哪种日期解析方式符合合同冻结格式？
   - A. `pd.to_datetime(df["order_date"], format="%Y-%m-%d", errors="coerce")`
   - B. `pd.to_datetime(df["order_date"], errors="coerce")`的宽松推断
   - C. 自己编写用正则接受斜杠日期的拆解逻辑
   - D. 先把斜杠替换为短横线再宽松解析
5. 完成去重选择后，为什么最终输出要按`_row`恢复顺序而不是按order_id排序？
   - A. 按order_id排序会更整齐，应该采用
   - B. order_id排序会抹掉获胜记录在原始数据中的先后关系
   - C. 按`_row`排序会让重复组重新聚合
   - D. order_id排序会破坏日期格式
6. 为什么去重结果是“整行保留”而不是逐列取最优（如金额取最大、备注取第一个）？
   - A. 逐列取最优可能拼出原始数据中从未存在的订单
   - B. 逐列取最优运行更快
   - C. 整行保留能保留更多重复记录
   - D. 逐列取最优会与order_id冲突

## 六、05 规范类型与格式

来源：`act-quiz-type-format`；`questionSource=ai_live`；`retryNumber=1`

审查状态：以下第1题是已确认的阻塞样例，不得作为合格题证据，也不得进入正式题组。

1. 对金额列做类型规范化时，应先清理文本再转数值。下列关于“abc12”这类非法文本的说法正确的是？
   - A. 直接使用正则提取数字，abc12会被正确转为12
   - B. 清理只移除¥￥和逗号与空格后，abc12不包含批准字符，应保留原文本而非强制转数值
   - C. N/A、abc12等无法证明的内容应统一改成0以方便求和
   - D. 转化失败时应该抛出异常以提示用户
2. 金额管线中，对转换结果做 `amount.replace([float("inf"), float("-inf")], pd.NA)` 的作用是？
   - A. 把合法的零值也替换成缺失
   - B. 把无穷值视为非法金额并转为缺失
   - C. 把空字符串改成0
   - D. 删除包含无穷值的整行
3. 按资料包合同解析order_date时，下列哪一种写法是正确且严格的？
   - A. `pd.to_datetime(result["order_date"], errors="coerce")`，让解析器自动猜测格式
   - B. `pd.to_datetime(result["order_date"], format="%Y-%m-%d", errors="coerce")`，显式按YYYY-MM-DD解析
   - C. 先把所有分隔符统一替换成横线再解析
   - D. 直接调用`result["order_date"].astype("datetime64")`
4. 对于城市列规范化，正文推荐使用 `city.replace(CITY_MAP)` 而不是 `city.map(CITY_MAP)`，原因是？
   - A. `replace`比`map`性能快很多
   - B. `map`只认识映射表中的键，未登记城市通常会变缺失，违反“未知非空值保留”规则
   - C. `map`无法处理中文字符
   - D. `replace`会自动把未知城市归类到最近的大城市
5. 状态列规范化为允许状态集合后，对于shipped这类不在`{completed,pending,cancelled}`中的值，正确处理是？
   - A. 改成pending，因为shipped可能表示已发货待处理
   - B. 直接删除该行
   - C. 转成缺失（`pd.NA`）但保留订单行
   - D. 把shipped临时加入允许集合
6. 类型规范化过程中为保证输入不可变与行数/行序不变量，下列做法正确的是？
   - A. 直接在传入的原始DataFrame上逐列赋值
   - B. 先复制一份再在副本上转换，结束后断言输入与原快照相同，且索引和订单号序列不变
   - C. 清洗后重新按金额或日期排序
   - D. 清洗期间删除含缺失值的行以减小数据量

## 七、06 验证清洗结果

来源：`act-quiz-validate-result`；`questionSource=ai_live`；`retryNumber=2`

1. 清洗代码没有抛异常，只能说明什么？
   - A. 结果一定满足全部合同不变量
   - B. 程序运行走到了结尾，可能与合同仍不一致
   - C. 结果一定通过了隐藏测试
   - D. 结果一定与预期表完全相等
2. 验证阶段发现列结构错误时，下列哪种做法符合正文规则？
   - A. 先停下字段检查，抛出`columns_invalid`结构失败，回到结构阶段修复实际输出
   - B. 调用`reindex`或排序把列顺序纠正后再比较
   - C. 现场拼接缺失列使比较通过
   - D. 忽略列顺序，只要集合相同就视为通过
3. 合同要求order_id非空、非空白且唯一。若发现空订单号，应回到哪个阶段处理？
   - A. 缺失处理
   - B. 去重
   - C. 类型格式
   - D. 结构检查
4. 正文指出：集合相同但顺序不同，对于列清单仍然不合格。这是因为什么？
   - A. 七列必须恰好固定并保持固定顺序
   - B. 列顺序不影响任何后续操作
   - C. pandas的列集合会自动去重
   - D. 索引必须与业务顺序完全一致
5. 为什么验证阶段不能在比较前对actual调用`sort_values`或`fillna`？
   - A. 会把错误行序或未知值语义隐藏掉，制造虚假通过
   - B. 会显著提高比较精度
   - C. 会让dtype自动转为StringDtype
   - D. pandas不允许在验证阶段读取数据
6. 关于`reset_index`与排序用于比较前处理，正文的正确表述是？
   - A. `reset_index`不改变行的先后只改变行标签，可在比较前使用；`sort_values`会改变记录顺序，不能使用
   - B. `reset_index`和`sort_values`都可安全使用
   - C. 两者都会改变记录顺序，都不能使用
   - D. 必须先`sort_values`再`reset_index`才能比较

## 八、当前裁决建议

当前只能认定“旧版真实DeepSeek曾依据当前选中中文教学正文返回六节题组”，不能认定答案语义审核已经闭合，也不能批准该批题目作为最终比赛证据。

解除阻塞必须使用`w4-d2-v3`新建会话重新运行，并同时证明：题组来源为`ai_live`；低风险题也存在Hunter与Judge阶段；有争议时才调用Defender；第5节错误答案不再通过；公共响应和页面不泄漏答案；模型失败时固定题fallback仍可用。完成这些复验后，才能把本文件状态改回通过。
