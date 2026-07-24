# 07 Pandas 示范资料包设计

> **D01—D03 已冻结**：Pandas五维为基础语法与API、数据理解与抽象、清洗逻辑与推理、结果验证与调试、工程规范与独立完成；数据列、清洗、城市映射、重复选择和规模以 [第一周公共合同总册](./第一周任务/21-第一周公共合同总册.md) 为准，具体 dtype 待环境原型后冻结。

> `pandas-cleaning` 是唯一完整 Profile v2。它证明资料包、诊断、路径、普通题、代码活动、实操和证据可以闭环；不代表覆盖全部 Pandas。

## 1. 定位和完成目标

学习者在2至3小时内，能够读取一份小型脏订单数据，检查结构，按明确业务契约处理缺失、重复、金额、日期、城市和状态，最后生成符合规范的 `clean_df`。

正式学习入口只有：

- 章节学习：按三章六节目录顺序学习；
- 系统推荐：依据诊断、证据、先修和时间预算选择同一批材料和活动。

两种入口不复制内容、题目或证据，只改变顺序、题量、数据复杂度和代码注释档位。目标只有最终独立实操通过才算完成。

## 2. 章节、知识点和先修

```text
chapter-01-data-entry-and-inspection/      # 第1章；建立数据表和检查基础
├─ section-01-read-csv.md                  # 读取CSV；知识点pandas.clean.read-csv
└─ section-02-inspect-dataframe.md         # 检查结构；知识点pandas.clean.inspect-dataframe
chapter-02-cleaning-issues/                # 第2章；处理最常见脏数据
├─ section-01-missing-values.md             # 缺失值；知识点pandas.clean.missing-values
└─ section-02-duplicate-orders.md           # 重复订单；知识点pandas.clean.duplicate-orders
chapter-03-format-and-validation/          # 第3章；统一类型并验证结果
├─ section-01-type-format-cleanup.md       # 金额/日期/文本；知识点pandas.clean.type-format
└─ section-02-validate-result.md            # 不变量验证；知识点pandas.clean.validate-result
```

Pandas示范包经过人工确认后采用六个核心知识点；02号规范不把六个数量写成全局限制。`basic-python` 是独立辅助知识点，只在诊断发现需要时提供短补救，不占六个Pandas核心节点。

默认保守顺序：读取→检查→缺失→重复→格式→验证。每节独立建立知识点，即使概念相近也不合并；用 `relatedKnowledgePointIds` 表示关联。

| 知识点 | 目标 | 先修 | 最低验证 |
|---|---|---|---|
| `pandas.clean.read-csv` | 读取CSV并理解分隔符、编码和字段 | `basic-python` | 单选/判断 |
| `pandas.clean.inspect-dataframe` | 使用`shape/columns/dtypes/head`检查结构 | `read-csv` | 单选/代码阅读 |
| `pandas.clean.missing-values` | 识别、保留或处理字段缺失 | `inspect-dataframe` | 客观题＋代码补全 |
| `pandas.clean.duplicate-orders` | 按`order_id`和日期规则处理重复 | `inspect-dataframe` | 客观题＋代码补全 |
| `pandas.clean.type-format` | 清洗金额、日期、城市、状态和备注 | `missing-values` | 客观题＋代码补全 |
| `pandas.clean.validate-result` | 检查列、类型、缺失、唯一性和行序 | `duplicate-orders`,`type-format` | 客观题＋验证补全/实操 |

## 3. 小节学习卡片

每节卡片必须包含：学习目标、先修说明、核心概念、最小示例、反例、典型误区、来源名称与定位、无分自测、预计时间、与最终 `clean_df` 任务的关系。内容由CIDPP评价清晰性、完整性、深度、实用性和针对性；CIDPP分数只用于内部优化，不作为学习者分数。

三类典型画像用于构建期检查针对性：高基础学习者应能压缩重复讲解；非计算机初学者应能看到输入—代码—输出关系；实践导向学习者应先看到业务验收标准。运行时不因画像改变固定初始诊断题。

## 4. 资料包目录和资产

```text
pandas-cleaning/                              # Pandas Profile v2根目录；Profile仓储管理
├─ profile.json                               # 唯一清单、能力、版本和路径
├─ subject.md                                 # 资料包简介和总体目标
├─ chapters/                                  # 三章六节正文；学习者可见
├─ knowledge/knowledge-points.json            # 六个知识点、先修、来源和活动引用
├─ cards/                                     # 讲解卡、示例、反例和复盘
├─ self-checks/                               # 无分自测；不形成正式掌握度证据
├─ activities/                                # 正式活动；按活动编号分目录
│  ├─ act-missing-completion-01/              # 缺失值代码补全固定任务
│  ├─ act-duplicate-completion-01/            # 重复订单代码补全固定任务
│  ├─ act-format-completion-01/               # 类型/格式代码补全固定任务
│  ├─ act-validation-completion-01/           # 结果验证代码补全固定任务
│  └─ act-final-cleaning-01/                  # 最终独立实操固定任务
├─ assessments/                               # 诊断、学习兜底和正式评测索引
│  ├─ diagnostic/questions.json                # 8至12题固定诊断题面
│  ├─ diagnostic/private/answer-key.json      # 诊断答案和评分；服务端受限
│  ├─ quiz-fallback/                           # 学习后动态题失败时使用的少量固定题
│  └─ evaluation/                              # 本包内部活动测试；不含05号保留评测集
├─ rubrics/                                   # 代码补全和最终实操Rubric
├─ datasets/                                  # 固定数据和维护脚本
│  ├─ fixtures.json                           # 公开和私有CSV的稳定ID、可见性、路径和SHA-256索引
│  ├─ public/orders-learning.csv              # 约30行公开教学数据
│  ├─ private/orders-variant-01.csv           # 约20至30行私有变体
│  ├─ private/orders-variant-02.csv           # 约20至30行私有变体
│  ├─ private/orders-variant-03.csv           # 可选第三份变体
│  └─ tooling/generate-orders.ts              # 仅维护/复现，不进入学习运行主链
├─ task-generation/                           # 母题、思维原子和三级注释生成记录
│  ├─ mother-tasks/                           # 4个代码母题和1个实操母题
│  ├─ thinking-atoms/                         # 构建期AI抽取、人工确认的原子
│  └─ accepted-variants/                      # 固定活动引用的已接受变式
├─ reference-solutions/                       # 固定参考实现；服务端受限
├─ sources/source-map.json                    # 来源锚点、摘录、版本和许可证
├─ environments/environment-lock.json         # 实际原型验证后的运行环境锁
└─ quality/                                   # 启用前质量报告和CIDPP摘要
```

`datasets/fixtures.json`按21号D.6登记公开学习CSV和2至3份私有变体。活动`datasetRefs`列出任务允许的数据ID；每条公开/隐藏测试通过`fixtureRefs`选择本次实际数据。公开测试只能绑定公开学习CSV；隐藏测试既可复用公开CSV，也可分别绑定私有变体01、02和可选03。任何额外字段、重复/悬空引用、公开测试引用私有变体或哈希不一致都阻止Profile从`draft`提升为`active`。

AI构建期生成精简、标准、详细三级中文代码注释；代码结构、可编辑区域、公开/私有测试、参考实现和通过标准固定。所有核心资产经过程序检查、单一CIDPP评价、必要的一次优化和人工确认。

## 5. 数据集和唯一清洗契约

正式运行不使用任意CSV上传。资料包直接保存一份公开文件和2至3份固定私有文件；辅助脚本只用于维护和复现，运行时不依赖生成器。

固定字段和顺序：

```text
order_id, customer_id, amount, city, order_date, status, note
```

字段规则：

1. `order_id`：去首尾空格；缺失则删除整行。
2. `customer_id`：去首尾空格；缺失保留为空值。
3. `amount`：去除`¥`、`￥`、逗号和空格；合法内容转数值；空字符串和非法文本转缺失并保留行。
4. `city`：去首尾空格并应用少量已知映射；未知非空值保留清洗后的原值。
5. `order_date`：接受资料包声明的日期格式，转为无时区日期时间；解析失败转缺失并保留行。
6. `status`：去首尾空格、转小写；只允许`completed/pending/cancelled`；非法值转缺失并保留行。
7. `note`：去首尾空格；缺失转空字符串，不做复杂文本语义改写。

重复`order_id`采用三级规则：优先保留日期可解析的记录；再保留日期最新的记录；日期同样、缺失或均无法解析时，保留原始数据中第一条。处理后保持被选中记录的原始相对顺序，不额外排序。

最终变量必须是 `clean_df`，只保留固定7列和固定顺序，不新增清洗标记列。`amount`为规范数值类型，`order_date`为无时区日期时间，其他字符串列在环境锁定后统一使用Pandas `StringDtype`和明确空值规则。具体城市映射和日期格式必须随数据资产登记，不能由实现者临时猜测。

## 6. 诊断、普通题和固定兜底

初始诊断固定8至12道单选/判断，10分钟以内；覆盖六个核心点并抽样`basic-python`。背景问卷只收集Python/Pandas经验、目标、可用时间、解释详细度和注释偏好，不直接改变掌握度。诊断完成后生成不可变快照，主动重测或相关修订才创建新版本。

每个知识点学习后由AI决定4至6道单选/判断的题量和固定/动态比例，优先使用动态题。AI只能改变难度、情境、典型错误针对性和措辞；程序校验知识点、来源、选项和`correct_answer`；高风险争议才进入Hunter/Judge；代码直接比较答案。Pandas v2暂不加入动态简答。

动态题成功时缓存；失败时从该知识点未做过的固定兜底题补充。兜底题不是主要题库：每个核心知识点默认只准备1至2道固定兜底题，用于模型/API/审核失败时维持流程。若动态题失败后固定兜底题仍不足4道，则结束本轮并标记“验证证据不足”，不阻塞页面，也不虚报题组通过。75%通过线使用 `ceil(questionCount × 0.75)`。每题保留明细证据，同一题组在置信度和证据形式数量中只计一次相关验证。诊断题、学习兜底题和05号正式评测题分开管理。

## 7. 代码补全和最终实操

四个代码补全母题分别覆盖：缺失值、重复订单、金额/日期/文本格式、结果验证；另有一个最终独立实操母题覆盖完整流水线。代码活动采用固定起始代码、固定入口、固定可编辑区域和固定 `clean_df` 输出契约。不同画像共用代码区域，只调整数据复杂度和中文注释档位；不制作三套不同代码结构。

最终实操Rubric：读取与列结构10%、缺失处理20%、重复处理15%、类型与格式25%、结果不变量20%、可读与安全10%。总分达到0.80且全部阻断测试通过才算目标完成。未通过后按错误维度回补相应小节或代码补全，旧Attempt保留，新建Attempt重试。

## 8. 学习者评价方案

确定性知识点底座使用 `mastery/confidence`。在其上正式增加 Pandas 五维：基础语法与API、数据理解与抽象、清洗逻辑与推理、结果验证与调试、工程规范与独立完成。

诊断完成后，AI对活动预先声明的可观察维度直接输出0至100分、0至1置信度、证据理由和引用；不可观察维度为`unverified`。程序只校验范围、引用、版本和幂等，不重新计算AI分数。页面使用“分数+置信度+证据卡片”，画像不驱动PathEngine。

## 9. 来源和质量指标

官方文档、教材和公开教程均可登记；发生冲突时官方文档优先。来源必须记录名称、定位、版本、许可证和摘录/摘要哈希。资料包质量门禁检查资产完整性、来源闭合、固定数据可运行、参考实现正确、私有测试隔离和结果可复现。幻觉率、难度匹配和学习增益由05号统一评测，不在本包重复定义。

## 10. 降级和边界

进度不足时依次隐藏五维高级图形但保留画像数据、减少动态题和关闭运行时CIDPP，回退到固定诊断、固定代码任务、确定性判分和固定中文反馈。不得削减Profile校验、来源记录、私有测试隔离、最终实操和证据恢复。完整AI代码题生成保留为12号候选扩展，不属于本Pandas六周主链。
