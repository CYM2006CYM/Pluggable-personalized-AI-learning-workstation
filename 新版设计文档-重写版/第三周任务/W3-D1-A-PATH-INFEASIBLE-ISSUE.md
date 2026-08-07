# W3-D1-A development-20 预算口径问题单

状态：**D45 已裁决**（W3-C3 / W3-R2）。本问题单仅记录验证口径，不修改 Profile、案例、预算、目标、Rubric、必做规则或 Profile active 状态。

## 裁决后的双口径

- V3-1 使用 `projectionRuleVersion=w3-v3-feasible-180-v1`，只在独立验证输入快照中投影 `availableMinutes=180`，保留每例原始背景、诊断答案、KnowledgeState、goal 和 mode；20 例各运行 10 次，要求全部为合法 candidate。
- V3-2 保留 development-20 每例原始 30/60/90/120/150 分钟预算；若预算不足，返回结构化 `path_infeasible`，不得将其计入实际路径合法率；另以 A 自有 fixture 验证全部掌握与缺失先修。
- 冻结源文件 `evaluation/personas/development-20.jsonl`、生成脚本、B 资产及正式 60 例均未修改；源文件使用 `normalized-text`，SHA-256 保持 `54c0f5f30bc0b9a104ac2e9e38e6ca3d6f33c5cbe3ade17c62be1c69be1b8473`。

## 复现与证据

现行证据文件为：

- `W3-D1-A-V3-1-evidence.json`
- `W3-D1-A-V3-2-evidence.json`

两份证据分别登记原始预算、投影预算、投影输入哈希、10 次输出哈希、结果类型和逐候选合法性判定；交付只引用现行两份 V3 证据文件。

## 边界说明

PathEngine 保留必做/最终活动和不可跳过先修；`skipEligible` 是先修压缩的唯一权威条件。预算压缩只移除真实 Profile 中的可选活动，仍超预算时返回 `path_infeasible`。本问题单不以改变 B 资产来制造 candidate。
