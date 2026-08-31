# B -> 负责人：W3-D1 上传候选交接单

结论：`OWNER_SYNCED_CANDIDATE`。负责人已完成双封存资格检查并确认A的D1提交已经上传；本候选仍需B在实际上传工作区复验并取得明确上传锁后才能commit/push。

## 交接内容

- 候选 seal：`evaluation/golden/annotations/b-final-021-060.seal.candidate.json`；`qualificationStatus=PENDING_OWNER_DUAL_SEAL_CHECK`。
- 候选资产树：29 项，SHA-256 `ddd23e6cd4b54725e4e00cbcdac299c0ba3cf5d6c997b6fe748767f5309df04c`。
- 原 seal：`evaluation/golden/annotations/original/audit-only/b-final-021-060.seal.json`，只读历史审计材料，未覆盖。
- 负责人审计候选 ZIP（仓库外）：`w3-d1-b-owner-audit-handoff.zip`；旁路校验文件：`w3-d1-b-owner-audit-handoff.sha256`。
- 候选 ZIP（包内登记并作为根目录正式仓库工件上传）：`w3-d1-b-rectified-candidate.zip`；SHA-256 `4472528da92359df20d0d494e4f42a74d06b04e37fec4fe2bd809ecac23034a2`。

负责人已决定采用比赛MVP下的最轻量方案：`w3-d1-b-rectified-candidate.zip`作为根目录正式仓库工件随B提交上传。该ZIP只封装`packageEntries`，不得包含自身；其最终SHA-256以本轮重建后本交接单登记值为准。

## 仓库状态

- 负责人代修集成基线：`d50ad4e8c0fe8e1ec3822b164e973897e6aeca91`
- B上传工作区实际HEAD：由B复验时据实填写，必须包含上述基线
- 提交状态：`NOT_COMMITTED`
- 推送状态：`NOT_PUSHED`
- D1 Profile：未激活

## C 消费入口

`pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/task-bundles.json#bundles`

## 拟提交文件清单

正式拟提交集合固定为：

1. `w3-d1-b-candidate-manifest.json`中的全部`proposedCommitPaths`；
2. 根目录`w3-d1-b-rectified-candidate.zip`。

ZIP不加入自己的`packageEntries`或`proposedCommitPaths`，避免递归自包含。冻结输入（`final-60.jsonl`、`b-first-20.jsonl`）和`original/audit-only`原seal仍不得暂存。

## 负责人必须完成

1. 负责人机械复核结果：Schema、40/40覆盖、冻结输入规范化哈希、B/E两份输出seal和独立性资格均为`PASS`。
2. A已上传`d50ad4e8c0fe8e1ec3822b164e973897e6aeca91`，A/B拟提交路径交集为0。
3. B必须在实际上传工作区拉取最新main，按上述正式集合逐项暂存前复验，并报告实际HEAD、状态、测试结果和拟提交清单。
4. 未取得负责人明确上传锁前，B不得commit或push。
