# V3-7测试用例合同R4

输入只允许负责人E安全交接和W2公开gold基线。禁止读取完整`adjudication-log.candidate.jsonl`、机械差异、B/E封存原件或负责人私有说明。

正例断言：difficulty/path/public index均为60例稳定顺序；difficulty/path前20原字节分别以W2正式文件为精确前缀；public index前20的`adjudicationRecordSha256`逐行匹配W2 adjudication原记录加LF的SHA-256；后40全部为`SKIPPED_BY_D44`；冻结记录、公开证明和验证记录的实际SHA-256相互闭合；候选仍为只读且非正式gold；冻结前正式60例运行数为0。

反例至少覆盖：前20正文变化但caseId不变、前20公开终裁哈希变化、后40状态变化、可见文件哈希变化、冻结记录字段缺失、把OWNER-ONLY文件加入输入。任一反例必须返回非零或`BLOCKED`。
