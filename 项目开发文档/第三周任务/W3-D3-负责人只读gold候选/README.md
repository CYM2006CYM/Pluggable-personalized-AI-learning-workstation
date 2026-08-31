# W3-D3负责人只读60例gold候选

状态：`OWNER_READONLY_GOLD_CANDIDATE`；`NOT_FORMAL_GOLD`；`NOT_AUTHORIZED_FOR_GIT_UPLOAD`。

本目录承载D44负责人终裁形成的完整负责人只读候选和审计证据，不是正式gold，不授权Git上传。B/E封存原件、完整`adjudication-log.candidate.jsonl`、负责人机械差异清单和工作记录不得提供给E；E只接收difficulty/path候选、无原始意见的公开终裁索引、冻结记录、验证记录及相应SHA-256。

生成器以B/E双封存资格`PASS`为前置，将`goalId + availableMinutes + diagnosticAnswers`作为冻结输入签名。后40例必须逐一复现前20例中同签名的B/E结构化意见模式，才允许沿用既有负责人终裁；发现新分歧模式时立即停止，不自行放宽。

候选必须保持前20例原字节不变，后40例`negotiationStatus`固定为`SKIPPED_BY_D44`。正式gold及最终哈希只能在D4复核E结果后由负责人另行生成和上传。
