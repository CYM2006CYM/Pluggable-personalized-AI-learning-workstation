# 02 检查DataFrame结构：三版本中文教学正文候选

状态：`DRAFT / CONTENT_REVIEW_REQUIRED / NOT_IMPLEMENTED`

知识点：`pandas.clean.inspect-dataframe`

适用裁决：`W6-D73-RICH-LESSON-1`

预计学习时间：10至15分钟

本文件只用于负责人审阅教学内容，不是运行时Profile资产，不修改revision 3 seal，也不表示Web页面已经实现。

## 共同事实与来源

三套正文必须共同覆盖以下规则：

- `INSPECT-01`：结构检查发生在缺失、去重和类型转换之前。
- `INSPECT-02`：固定列及顺序为`order_id, customer_id, amount, city, order_date, status, note`。
- `INSPECT-03`：`shape/columns/dtypes/head/isna`回答不同问题，不能互相替代。
- `INSPECT-04`：少量预览不能证明整列或整表合格，dtype也只是当前表示方式。
- `INSPECT-05`：检查或选择固定列不得修改传入的原始DataFrame。

主要来源：

- `src-pandas-dtypes`
- pandas官方用户指南`Basics / dtypes`
- 定位：<https://pandas.pydata.org/docs/user_guide/basics.html#dtypes>
- Profile revision：`3`

---

## 版本一：逐步讲解 `guided`

### 学习目标

**需要了解**

1. DataFrame的行、列、shape、列名、dtype和缺失概况分别代表什么。
2. 为什么查看前三行不能证明整张订单表合格。
3. 为什么结构检查必须早于删除、去重和类型转换。

**需要掌握**

1. 使用`shape/columns/dtypes/head/isna`进行有目的的检查。
2. 按固定七列和顺序识别缺列、多列、错名和错序。
3. 在不修改原始输入的前提下，得到恰好七列的检查结果副本。
4. 根据检查现象判断下一步应进入缺失处理还是类型规范化。

### 先建立直觉：体检要在治疗之前

上一节把CSV读成了DataFrame。现在面对的是一张“能被代码操作”的表，但我们还不知道它是否符合订单清洗的入口要求。就像医生不会在没有测量和询问的情况下直接用药，数据清洗也不应该一上来就删除空值或转换日期。先检查，才能知道后面的代码正在处理什么。

结构检查不是漫无目的地打印数据。每个工具都回答一个具体问题：`shape`告诉我们有多少行和列，`columns`告诉我们列名及顺序，`dtypes`告诉我们各列当前怎样表示，`head`让我们快速观察几条记录，`isna`帮助了解缺失分布。把这些结果放在一起，才能形成完整的入口画像。

### 把概念拆开

#### 1. shape只回答“有多大”

`shape`返回一个二元组，第一个数字是行数，第二个数字是列数。公开订单CSV读入后可以先查看：

```python
rows, columns = raw_orders.shape  # 分别取得行数和列数
print(rows, columns)
```

即使列数是7，也不能证明列名正确。七列可能包含`price`而不是`amount`，也可能顺序完全不同。因此`shape`是快速警报，不是最终结构判定。

【术语注释：二元组】二元组是包含两个位置的Python序列。这里的两个位置固定表示行数和列数。

#### 2. columns同时包含“名字”和“顺序”

本项目的固定顺序不是装饰，而是输出合同的一部分：

```python
expected = [
    "order_id", "customer_id", "amount", "city",
    "order_date", "status", "note",
]
actual = raw_orders.columns.tolist()  # 转成普通列表便于比较
print(actual)
```

可以分别找出缺少和多出的列：

```python
missing = [name for name in expected if name not in actual]  # 应有却没有
extra = [name for name in actual if name not in expected]    # 合同之外的列
```

如果`set(actual) == set(expected)`但列表不相等，说明列名集合正确、顺序错误。集合比较会忽略顺序，所以不能单独作为最终判据。

#### 3. dtypes告诉我们“现在怎样存”，不告诉我们“业务上对不对”

先打印整表和单列dtype，观察当前表示，不在这一模块执行转换。

```python
print(raw_orders.dtypes)           # 每一列当前的dtype
print(raw_orders["amount"].dtype) # 单独查看金额列
```

金额列混有货币符号时可能显示为字符串表示，日期列在读取后也可能仍是文本。这里先记录现状，不急着调用`astype`。后面的类型格式小节会按照冻结规则进行转换。

【术语注释：dtype】dtype是某一列当前的存储或表示类型。它是排查线索，不是“该列已经满足业务合同”的证明。

#### 4. head用于观察，不用于证明

用头尾少量记录帮助定位明显异常，但不要把抽样结果当成全表断言。

```python
print(raw_orders.head(3))  # 只看前3行
print(raw_orders.tail(2))  # 再看末尾2行，仍只是抽样
```

前三行没有空订单号，不代表后面也没有；前三行日期格式正常，不代表整列都正常。`head`适合发现明显错位、乱码和异常外观，但整列判断必须使用列级操作。

#### 5. isna用于统计缺失概况

按列统计pandas已经识别出的缺失数量，再把结果交给字段策略处理。

```python
missing_counts = raw_orders.isna().sum()  # 各列缺失数量
print(missing_counts)
```

这一步只统计，不删除。不同列的缺失规则不同，不能看到数字后立刻对整表调用`dropna()`。结构检查负责报告现象，缺失值小节负责执行字段规则。

### 跟着一张小表走一遍

先构造一个公开、可理解的最小样例：

```python
import pandas as pd

raw_orders = pd.DataFrame({
    "order_id": ["O001", None],
    "customer_id": ["C001", "C002"],
    "amount": ["88", "N/A"],
    "city": ["上海", "北京"],
    "order_date": ["2026-01-03", "bad-date"],
    "status": ["completed", "pending"],
    "note": ["首单", None],
})
```

按同一顺序检查：

```python
print(raw_orders.shape)             # (2, 7)
print(raw_orders.columns.tolist())  # 七个列名
print(raw_orders.dtypes)            # 当前类型
print(raw_orders.isna().sum())      # 缺失概况
```

这里能得出“表有2行7列、order_id和note各有缺失、金额与日期仍需后续处理”，但不能在本节直接删除第二行或转换日期。

正式代码活动还要求结果恰好保留固定七列，同时原始输入不能被改写：

```python
before = raw_orders.copy(deep=True)        # 保存输入快照
inspected = raw_orders.loc[:, expected].copy()  # 选择固定七列副本
assert raw_orders.equals(before)           # 原始输入保持不变
```

【术语注释：深拷贝】深拷贝会建立独立的数据副本。后续若修改副本，不应连带改动原始表。

### 怎样读懂一份检查结果

检查输出不是越多越好，关键是把每个现象翻译成下一步行动。如果`shape`显示只有一列，而列名是一整串带逗号的文字，优先怀疑CSV分隔符或表头解析；如果列名和顺序正确，但`amount`显示为字符串表示，这通常不是结构失败，而是后续类型转换的正常输入；如果`order_id`存在缺失，应把数量交给缺失值阶段，不能在检查阶段直接补一个虚构编号。

```python
if raw_orders.shape[1] == 1:
    raise ValueError("csv_structure_invalid")  # 可能是分隔符读取错误

if raw_orders["order_id"].isna().any():
    print("order_id_missing_observed")          # 只登记，下一节再处理
```

列名比较也需要分层解释。“缺列”意味着合同需要的数据不存在，后续无法可靠补救；“多列”表示上游提供了合同外信息，活动可以按明确清单生成固定七列副本，但必须保留这一异常事实；“仅错序”表示名字都在，却不能直接声称输出合格。把三种情况分开，错误信息才真正能帮助学习者。

```python
if missing:
    print("missing_columns", missing)
elif extra:
    print("extra_columns", extra)
elif actual != expected:
    print("column_order_invalid")
```

### 为什么不能边检查边修复

初学者容易觉得“既然已经发现问题，顺手改掉不是更省事吗”。但检查函数如果同时改列名、填缺失和转类型，就很难回答某次失败到底来自原始输入还是修复代码。更麻烦的是，同一个DataFrame可能还要用于失败重试、公开预览或原始行序比较；它被第一次调用修改后，第二次调用就不再面对同一输入。

保持输入不变，可以让每个阶段都有清楚的责任。结构阶段只确认表的外形并生成固定列副本；缺失阶段处理字段空值；去重阶段根据原始顺序选择记录；类型阶段转换表示；验证阶段判断所有不变量。每一步都能独立测试，也能在失败后从原始输入重新开始。

### 从检查现象走向下一节

完成本节后，不需要把所有警告都解决掉，而要正确分流：列名、列数或列序不满足合同，停在结构边界；`order_id/customer_id/note`有缺失，进入缺失值处理；金额和日期dtype不符合最终要求，进入类型格式；发现`order_id`重复，记录现象并交给去重阶段。检查的价值就是让后续工作有目的，而不是让程序在错误结构上继续试错。

```python
next_stage = "missing_values"
if raw_orders.columns.tolist() != expected:
    next_stage = "structure_blocked"
```

### 哪里容易错

#### 反例一：只看head就宣布合格

下面的代码把人工预览直接升级成整体结论，缺少机器判据。

```python
print(raw_orders.head())
structure_ok = True  # 错误：预览不能证明整表结构
```

正确做法是明确比较列并统计缺失：

```python
structure_ok = raw_orders.columns.tolist() == expected
missing_counts = raw_orders.isna().sum()
```

#### 反例二：用集合比较列名

集合会忽略顺序，因此即使结果为真也不能证明固定列序。

```python
assert set(raw_orders.columns) == set(expected)  # 错误：忽略列序
```

```python
assert raw_orders.columns.tolist() == expected   # 正确：同时检查名字和顺序
```

#### 反例三：为了整齐自动排序列

下面的排序会改写输入事实，而不是报告原始错序。

```python
raw_orders = raw_orders.reindex(sorted(raw_orders.columns), axis=1)  # 错误：掩盖错序
```

正确做法是先报告错序；只有合同明确要求的固定选择才可生成新副本：

```python
inspected = raw_orders.loc[:, expected].copy()
```

#### 反例四：检查时修改原表

使用`inplace`删除列会让检查函数污染调用者持有的原始DataFrame。

```python
raw_orders.drop(columns=["unexpected"], inplace=True)  # 错误：污染输入
```

```python
inspected = raw_orders.loc[:, expected].copy()  # 正确：返回独立结果
```

### 接到最终任务

最终`clean_df`必须恰好七列且顺序固定。结构检查为后续步骤建立护栏：列错了，缺失处理可能访问不存在的字段；列序错了，最终结果即使值相同也不满足合同；输入被提前修改，重复选择和行序验证就失去原始依据。

```python
inspected = inspect_orders(raw_orders)  # 先确认结构
clean_df = clean_orders(inspected)      # 再进入完整清洗
```

本节完成时，你应该能给出一份检查摘要，而不是一张已经被偷偷清洗的表。摘要说明行列数量、列名与顺序、当前dtype和缺失概况；输出副本只保留固定七列；原始DataFrame保持不变。

这份摘要也应让第一次接触项目的人看懂风险落在哪一层，而不是只剩一串难以解释的打印结果。

### 术语与依据

- **shape**：DataFrame的行数和列数。
- **columns**：列标签序列，包含列名及其顺序。
- **dtype**：某列当前的表示类型。
- **抽样预览**：只查看少量记录，用于观察而非完整证明。
- **深拷贝**：建立独立副本，避免修改结果时污染原始输入。
- **不变量**：处理前后必须保持的条件，本节的不变量之一是原始输入不被修改。

依据claim：DataFrame结构和dtype检查绑定`src-pandas-dtypes`；固定七列、列序和输入不变来自Profile revision 3公开合同。正文不引用私有测试、Rubric或参考实现。

---

## 版本二：重点速览 `concise`

### 学习目标

**需要了解**

1. 结构门禁为何要同时检查列数、列名、列序、dtype和缺失概况。
2. 抽样观察与全表断言的证据强度差异。
3. 输入不可变为何是后续确定性处理的基础。

**需要掌握**

1. 用一组紧凑检查快速定位缺列、多列、错序和类型风险。
2. 区分可报告异常与本节允许生成的固定七列副本。
3. 避免集合比较、自动排序和`inplace`修改掩盖输入问题。
4. 输出可供后续清洗消费的结构化检查结果。

### 先看合同：检查不是打印日志

结构检查的输出应能支持明确判断：输入是否具备固定七列，顺序是否准确，当前dtype和缺失分布是什么，原始DataFrame是否保持不变。`print(df.head())`只能辅助观察，不能替代任何一项合同断言。

```python
EXPECTED = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
actual = df.columns.tolist()  # 保留顺序的实际列名
```

### 五个检查入口及其边界

把规模、列、dtype、抽样和缺失分别输出，每项只支撑有限结论。

```python
print(df.shape)          # 规模：多少行、多少列
print(df.columns)        # 结构：列名及顺序
print(df.dtypes)         # 表示：当前dtype
print(df.head(3))        # 观察：少量记录外观
print(df.isna().sum())   # 分布：各列缺失数量
```

`shape[1] == 7`不代表列名合格，`set(columns)`相同不代表顺序合格，dtype看起来像数值不代表金额规则合格，前3行正常不代表第20行正常。每个入口只回答一个有限问题。

### 列门禁：先比较，再决定是否生成副本

先计算缺列、多列和错序，再依据冻结合同决定是否能生成固定七列副本。

```python
missing = [name for name in EXPECTED if name not in actual]
extra = [name for name in actual if name not in EXPECTED]
wrong_order = not missing and not extra and actual != EXPECTED
```

缺列时不能凭空制造业务数据；多列时不能静默把异常当作正常；错序时应明确报告。对于活动规定的固定七列投影，可以返回副本：

```python
result = df.loc[:, EXPECTED].copy()  # 明确选择并保持固定顺序
```

如果缺少任何固定列，这一行会明确失败，比后续在不相关步骤产生模糊错误更容易定位。

### dtype门禁：记录现状，延迟转换

把dtype保存成可审计摘要，本节不调用金额或日期转换API。

```python
type_snapshot = df.dtypes.astype(str).to_dict()  # 可审计的类型摘要
amount_dtype = type_snapshot["amount"]
```

本节不执行`pd.to_numeric`或`pd.to_datetime`。原因不是这些API不能使用，而是类型转换有独立业务规则。检查和转换分离后，失败可以准确归因：读取/结构错误属于入口，非法金额和日期属于类型格式。

### 判定矩阵：同一个现象不能支持所有结论

高基础学习者最需要避免的是证据越界。`shape == (30, 7)`只能证明当前有30行7列；`columns == EXPECTED`才能证明列名和顺序；`dtypes`只能证明当前表示；`isna().sum()`只统计pandas已经识别出的缺失；输入不可变需要运行前后比较。一个检查结果不能替另一个结果签字。

```python
checks = {
    "seven_columns": df.shape[1] == 7,
    "exact_columns": df.columns.tolist() == EXPECTED,
    "input_unchanged": df.equals(before),
}
```

建议把结构门禁分为三种出口：`ready`表示固定列可生成并进入下一阶段；`blocked`表示缺少必要列或对象不是DataFrame；`observed_risk`表示存在多余列、可疑dtype或缺失，但风险归属后续阶段。这样既不会因脏值把整个读取链误判为失败，也不会把可运行误写成已合格。

### 精确投影不是自动修复

`df.loc[:, EXPECTED]`看起来像“重排列”，但它的合法性来自活动明确要求输出固定七列。它不能推广为遇到任何列问题都自动调整。如果`amount`不存在，投影应失败；如果上游把`amount`改名为`price`，检查函数不能猜测二者等价；如果出现`channel`，可以在结果中排除，但仍应在检查摘要登记extra列。

```python
if missing:
    raise ValueError("required_columns_missing")

result = df.loc[:, EXPECTED].copy()  # 只执行合同已批准的投影
```

这一区别对于审计非常重要：投影是执行已冻结合同，自动改名是创造新合同。前者可重复验证，后者会让不同开发者根据个人理解产生不同结果。

### 缺失概况：不要从统计直接跳到删除

先按列统计缺失，删除或保留动作仍由下一节的字段规则决定。

```python
missing_counts = df.isna().sum().to_dict()
order_id_missing = missing_counts["order_id"]
```

统计结果进入下一节作为输入。`order_id`缺失会删除行，`customer_id`缺失则保留；如果在这里统一`dropna`，字段语义会被抹平。

### 输入不可变

运行前保存深拷贝，生成结果后比较原表，证明检查没有副作用。

```python
before = df.copy(deep=True)
result = df.loc[:, EXPECTED].copy()
assert df.equals(before)  # 检查过程没有污染调用者输入
```

这条不变量让重复选择仍能依赖原始行序，也让失败重试拿到同一输入。使用`inplace=True`会让检查函数拥有超出职责的副作用。

### 失败信息应告诉调用者下一步

只抛出`invalid data`几乎没有教学价值。结构错误至少要区分对象错误、缺列、多列和错序；公开错误可以给出列名级摘要，但不能夹带宿主绝对路径或私有数据内容。错误信息的目的不是把内部栈全部展示给学习者，而是帮助其回到正确阶段。

```python
if not isinstance(df, pd.DataFrame):
    raise TypeError("dataframe_required")
if missing:
    raise ValueError(f"required_columns_missing:{','.join(missing)}")
```

对于多余列，活动允许生成固定七列结果时可以继续，但应把`extra`写入脱敏观察；对于错序，结果投影后可以满足固定输出，但输入错序仍应在调试证据中保留。报告事实和产生合法结果并不冲突。

### 为什么抽样仍然有价值

`head`不是门禁，却不应完全删除。它能快速发现所有字段挤在一列、中文乱码、引号解析异常或列内容明显错位。正确用法是先观察、再断言：观察帮助定位，断言负责判定。把两者写在一起，代码既便于人读，也能由机器复验。

```python
print(df.head(3))                         # 人工定位线索
assert df.columns.tolist() == EXPECTED    # 机器结构判定
```

### 反例与正确写法

#### 只比较集合

下面先展示会丢失顺序的写法，再展示精确列表比较。

```python
set(df.columns) == set(EXPECTED)  # 错误：列序信息丢失
df.columns.tolist() == EXPECTED   # 正确：顺序参与比较
```

#### 通过排序制造“稳定”

自动字母排序并不是合同顺序，正确做法是按固定清单生成副本。

```python
df = df.reindex(sorted(df.columns), axis=1)  # 错误：改变输入事实
result = df.loc[:, EXPECTED].copy()          # 正确：按合同生成副本
```

#### 用预览代替断言

预览负责观察，断言负责判定，两者应同时存在但不能互相冒充。

```python
print(df.head())                     # 观察
assert df.columns.tolist() == EXPECTED  # 判定
```

#### 检查时顺手转类型

类型转换越过了当前职责，本节只记录金额列当前dtype。

```python
df["amount"] = df["amount"].astype(float)  # 错误：越过类型规则
amount_dtype = str(df["amount"].dtype)      # 正确：本节只记录
```

### 工程交接摘要

将结构事实组织成有限字典，便于后续排查，同时不保存订单正文。

```python
summary = {
    "shape": list(df.shape),
    "columns_match": df.columns.tolist() == EXPECTED,
    "dtypes": df.dtypes.astype(str).to_dict(),
    "missing": df.isna().sum().to_dict(),
}
```

摘要可以进入脱敏日志或调试视图，但不能包含私有数据行。后续步骤消费DataFrame本身和冻结合同，不依赖人工查看日志做业务判断。

### 相邻边界：哪些事情不属于结构检查

结构检查最容易膨胀成一个什么都做的函数，因此需要明确四条禁止线。第一，不根据内容猜测列名，例如不能因`price`看起来像金额就改成`amount`；第二，不根据dtype直接转换列；第三，不因缺失数量删除记录；第四，不因订单号重复选择保留项。这些动作都有各自的业务语义和测试责任。

```python
# 本节允许：观察并产生固定列副本
result = df.loc[:, EXPECTED].copy()

# 本节不做：转换、删除、去重
# result["amount"] = pd.to_numeric(result["amount"])
# result = result.dropna().drop_duplicates("order_id")
```

边界分离还保护错误归因。如果结构函数返回`required_columns_missing`，学习者知道要检查输入；如果金额转换返回缺失，那是类型规则的结果；如果重复选择不符合优先级，那是去重逻辑。所有问题都叫`invalid_data`虽然省字，却会让恢复、提示和证据失去针对性。

### 判定优先级

建议按“对象类型→必要列存在→列序→输入不可变→风险摘要”的顺序判断。前两项失败时无法继续；列序可以通过合同投影生成合法结果，但必须记录原始错序；输入被修改属于实现错误；dtype和缺失是观察风险，通常交给后续阶段。

```python
if not isinstance(df, pd.DataFrame):
    raise TypeError("dataframe_required")
if any(name not in df.columns for name in EXPECTED):
    raise ValueError("required_columns_missing")
```

这种优先级避免低层错误覆盖高层根因。例如对象不是DataFrame时，不应先访问`dtypes`；必要列缺失时，不应先调试金额内容。每次只暴露最靠前、最可行动的失败，学习者更容易修正。

### 对性能和可读性的取舍

当前订单数据很小，`copy(deep=True)`和列级统计的成本可接受。本Demo不需要为了微小性能收益省略输入保护，也不需要一次输出整张表。真正有用的是有限摘要、精确断言和清楚阶段。若以后数据规模扩大，可以调整采样和日志，但固定列合同与输入不可变仍应保留。

高基础版本的“简洁”不是少做验证，而是让每条检查只承担一个结论，并把结果组织成机器可读结构。代码短，证据不能薄。

### 与最终任务的连接

结构维度是最终实操的第一道护栏。七列和列序不正确时，后续任何“值清洗正确”都没有意义。检查结果应保持原始行序和原始值，只建立固定列副本并提供结构事实。

```python
checked = inspect_orders(df)
assert checked.columns.tolist() == EXPECTED
```

### 术语与来源

- **结构门禁**：进入下一阶段前必须满足的列结构条件。
- **投影**：从表中按明确清单选择列，本节不指图形显示。
- **副作用**：函数除返回结果外还修改了外部状态，例如改写输入DataFrame。
- **类型摘要**：只记录dtype名称，不包含原始订单值。
- **证据强度**：不同观察能支持的结论范围；抽样弱于全表断言。

API事实绑定`src-pandas-dtypes`；固定列、输入不可变和精确顺序绑定revision 3公开合同。

---

## 版本三：案例实战 `practice`

### 学习目标

**需要了解**

1. 上游导出变化如何表现为缺列、多列、错序、乱码或dtype漂移。
2. 为什么错误结构会让后续清洗在错误位置工作。
3. 为什么现场排障要保留原始输入和检查摘要。

**需要掌握**

1. 编写可直接运行的订单表结构检查脚本。
2. 根据检查输出快速判断故障属于规模、列、类型还是缺失问题。
3. 生成固定七列副本，同时证明输入DataFrame没有被修改。
4. 使用交接清单把结构事实传给下一处理阶段。

### 业务场景：上游悄悄多了一列

昨天的订单导出还是七列，今天运营系统新增了`channel`列。CSV仍然能被读取，`head()`看起来也很正常。如果清洗代码不做结构检查，最终结果可能多出一列，或者某段按位置取列的代码处理错字段。结构检查就是发现这种“能运行但合同已变化”的问题。

```python
print(raw_orders.shape)            # 30行、8列会立刻暴露规模变化
print(raw_orders.columns.tolist()) # 找到新增的channel列
```

### 建立一份现场检查脚本

检查函数只读取规模、列、dtype和缺失，不修改或筛选数据。

```python
EXPECTED = [
    "order_id", "customer_id", "amount", "city",
    "order_date", "status", "note",
]

def inspect_table(df):
    return {
        "shape": df.shape,
        "columns": df.columns.tolist(),
        "dtypes": df.dtypes.astype(str).to_dict(),
        "missing": df.isna().sum().to_dict(),
    }
```

这个函数只读取结构信息，没有删除、转换或排序。现场输出可以告诉你问题在哪里，但业务判断仍由明确断言完成。

### 第一步：确认规模与列差异

先运行检查函数，再分别计算必要列缺失和合同外多余列。

```python
report = inspect_table(raw_orders)
actual = report["columns"]
missing = [name for name in EXPECTED if name not in actual]
extra = [name for name in actual if name not in EXPECTED]
```

若`missing`非空，后续代码可能无法完成，必须明确失败；若`extra`非空，要确认活动是否允许投影为固定七列，不能默默把上游变化当作正常。

### 第二步：确认顺序

名字集合和精确顺序分开判断，能够定位“列都在但位置错误”。

```python
same_names = set(actual) == set(EXPECTED)
same_order = actual == EXPECTED
print(same_names, same_order)  # 名字相同但顺序可能不同
```

假设`city`和`order_date`交换位置，集合比较仍返回真，精确列表比较才会发现错序。最终输出要求固定顺序，因此这一检查不可省略。

### 第三步：观察dtype和缺失

从摘要中读取金额dtype和订单号缺失数量，把风险交给对应后续阶段。

```python
print(report["dtypes"]["amount"])     # 金额当前怎样表示
print(report["missing"]["order_id"]) # 主键缺失数量
```

金额是文本并不一定是结构故障，因为公开输入含货币符号；订单号缺失也不在本节删除。检查脚本只把现象交给对应工位。

### 第四步：生成固定七列结果并保护输入

保存输入快照后，按固定清单生成独立副本，再证明原表未改变。

```python
before = raw_orders.copy(deep=True)          # 保存原始快照
checked = raw_orders.loc[:, EXPECTED].copy() # 生成独立七列副本
assert raw_orders.equals(before)             # 原表未被改写
```

使用副本后，后续阶段可以安全修改`checked`。原始表保留，便于重试、审计和行序比较。

### 完整走一次故障定位

假设今天收到的表有8列，其中新增`channel`，而`amount`仍是文本。第一步看`shape`得到8列；第二步比较列清单得到`extra=['channel']`；第三步查看dtype发现金额为文本；第四步检查缺失发现一条空订单号。此时不能把四个现象都归为“CSV坏了”。额外列属于结构变化，金额文本属于类型阶段，空订单号属于缺失阶段。

```python
report = inspect_table(raw_orders)
print(report["shape"])            # 发现8列
print(extra)                       # 定位channel
print(report["dtypes"]["amount"]) # 留给类型阶段
```

如果合同允许固定投影，结构阶段生成七列`checked`并保留extra观察；接着缺失阶段删除真正无订单号的记录；类型阶段再清洗金额。这个顺序使每一步都能解释，也不会因为金额暂时是文本就拒绝整张表。

### 排障顺序：先结构，后内容

现场看到异常时，按以下顺序处理最节省时间：先确认对象是否为DataFrame；再看列数和列名；再看列序；然后观察dtype和缺失；最后把风险交给对应阶段。结构未确认前，不要调试复杂的去重排序，因为代码可能正在错误列上运行。

```python
assert isinstance(raw_orders, pd.DataFrame)
assert all(name in raw_orders.columns for name in EXPECTED)
checked = raw_orders.loc[:, EXPECTED].copy()
```

这三行不是完整质量验证，但构成现场继续排查的最低结构条件。若任一断言失败，先回到上游输入或资料包绑定，而不是用填充和改名让流程勉强前进。

### 重试为什么需要原始输入

第一次处理可能因磁盘、进程或代码错误失败。若检查阶段使用`inplace`删除列，第二次重试看到的输入已经不同，问题会变得难以复现。保留`before`和独立副本，能证明重试仍从同一事实开始。

```python
before = raw_orders.copy(deep=True)
checked = raw_orders.loc[:, EXPECTED].copy()
assert raw_orders.equals(before)
```

真正的恢复不是“尽量继续”，而是在明确状态上重新执行。结构摘要可以重算，固定七列副本可以重建，原始行序仍可供后续去重使用。

### 把检查结果说给非开发者听

演示时不要只念`object`或`string`。可以解释为：“文件已经读成30行的订单表，七个必要字段都在；金额目前还是文本，这是后续类型转换要处理的正常风险；发现一条订单号缺失，将在下一步按合同删除。”这种表述把技术观察和业务动作分开，评委也能看懂系统为什么安排下一节。

检查页面若展示摘要，应使用列名、数量和有限状态，不展示整份原始数据，更不能显示私有变体。教学内容帮助理解，正式事实仍由服务端DTO提供。

### 现场输出怎么解释

假设检查报告显示：`shape=(30, 8)`、固定七列全部存在、extra为`channel`、金额dtype为文本、`order_id`缺失1条。正确结论不是“数据全部错误”，而是“上游新增一列；固定七列仍可投影；金额风险交给类型阶段；空订单号交给缺失阶段”。这种逐项解释能让演示从红绿状态变成真正的教学过程。

```python
print({
    "extra": extra,
    "amount_dtype": str(raw_orders["amount"].dtype),
    "missing_order_id": int(raw_orders["order_id"].isna().sum()),
})
```

如果固定列缺少`amount`，结论则不同：后续无法按合同生成结果，流程应明确停下，而不是创建全空金额列。如果所有列都在但顺序错误，可以生成固定顺序副本，同时保留原始错序观察。相似页面状态背后的恢复动作并不相同。

### 与下一位处理者做一次交接演练

结构阶段交付两样东西：一张未改变值和行序的固定七列副本，以及一份不含原始数据的结构摘要。缺失阶段接收副本，根据字段规则处理空值；它不必重新猜列名，也不能回头修改结构证据。

```python
handoff = {
    "data": checked,
    "summary": {"columns_match": True, "extra_columns": extra},
}
next_input = handoff["data"]
```

演练时还要验证失败保持性。若固定列投影失败，原始DataFrame仍应完整存在；若后续处理失败，可以重新从`raw_orders`生成`checked`。不要把临时副本写回原变量，也不要把结构摘要当作正式学习Evidence。

### 为什么这一步对比赛展示重要

评委看到的不应只是“程序打印了七列”，而应看到系统能解释当前输入、发现风险、保持原始事实并安排下一步。结构检查证明教学路径不是静态页面串联：每个小节有明确责任，代码行为与讲解一致，错误可以复现，结果可以交接。

同时必须诚实说明边界。这里没有证明金额正确、日期正确或订单唯一，只证明后续算法站在正确的表结构上。把有限结论说准确，比展示一个笼统的全绿状态更可信。

### 现场故障一：列名拼写发生变化

用公开副本模拟上游把`amount`改成`price`，观察缺列和多列如何出现。

```python
broken = raw_orders.rename(columns={"amount": "price"})  # 模拟上游改名
missing = [name for name in EXPECTED if name not in broken.columns]
```

错误修法是看到`price`后自动猜它就是`amount`：

```python
broken = broken.rename(columns={"price": "amount"})  # 错误：无合同依据地改名
```

正确做法是报告`amount`缺失、`price`多余，由资料包或负责人确认来源变化。结构检查不能自行发明字段映射。

### 现场故障二：为了通过测试自动排序列

字母排序会制造另一种顺序，无法替代固定七列合同。

```python
sorted_df = raw_orders.reindex(sorted(raw_orders.columns), axis=1)  # 错误
```

排序后的列更“整齐”，却不是冻结七列顺序。正确做法是精确选择：

```python
checked = raw_orders.loc[:, EXPECTED].copy()
```

### 现场故障三：检查函数污染输入

下面的`inplace`操作会永久删除调用者原表中的新增列。

```python
raw_orders.drop(columns=["channel"], inplace=True)  # 错误：原表被改写
```

```python
checked = raw_orders.loc[:, EXPECTED].copy()  # 正确：保留原表
```

如果后续重试仍使用被修改的`raw_orders`，同一输入就可能得到不同结果，破坏确定性。

### 现场故障四：把dtype风险当作读取失败

金额暂时为文本是后续类型阶段的输入，不能直接归类为CSV损坏。

```python
if str(raw_orders["amount"].dtype) == "object":
    raise RuntimeError("csv_broken")  # 错误：混合金额本来就可能是文本
```

```python
amount_dtype = str(raw_orders["amount"].dtype)  # 正确：记录后交给类型阶段
```

### 实战交接清单

交接前用断言确认固定列和输入保护，再把副本交给下一阶段。

```python
assert checked.columns.tolist() == EXPECTED
assert raw_orders.equals(before)
next_input = checked  # 交给缺失值阶段
```

交接前确认：输入来源仍是冻结公开数据；固定列齐全；顺序精确；多余列没有进入结果；dtype和缺失概况已经记录；没有修改原始值和原始行序；没有提前删除或转换。

### 接到最终`clean_df`

结构检查像流水线的入厂检验。它不负责修复每个零件，却决定后续工位拿到的是不是约定型号。最终实操会验证七列、缺失、唯一性、dtype和行序；本节直接承担其中的七列与输入保护基础。

```python
checked = inspect_orders(raw_orders)
clean_df = clean_orders(checked)
```

### 术语与来源

- **上游漂移**：数据提供方改变了列名、列序或格式，而下游代码尚未同步。
- **结构检查**：只确认表的规模、列、dtype和缺失概况，不执行业务清洗。
- **输入不可变**：函数运行后，调用者传入的DataFrame保持原样。
- **固定列投影**：按照合同清单生成恰好七列的独立结果。
- **确定性**：相同输入、代码和环境重复运行得到相同结论。

结构与dtype事实来自`src-pandas-dtypes`，七列、列序和输入保护来自revision 3公开活动合同。
