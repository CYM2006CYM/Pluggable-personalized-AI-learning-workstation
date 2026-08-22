# W5-D4 A R2 负责人代整改验证报告

## 结论

- 合同：`W5-C1/W5-R1`
- 基线：`a0d5a37116a6c67f009ca19e313501d9eed96f78`
- Profile：`pandas-cleaning` revision 3
- seal：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- 裁决：`PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- 当前结论：`PASS_A_SCOPE_E_INDEPENDENT_REVIEW_PENDING`
- Git状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## A-D4-R2-01：同一Evidence跨端读取

现有安全`ActivityAttemptSafeView`新增可选`evidenceId/evidenceVersion`，只投影已提交Attempt关联的Evidence引用，不返回Evidence正文。代码Attempt与题组Attempt两个公共读取出口使用同一字段语义。

双向轨迹均使用正式组合根、正式HTTP路由、TUI桥接和共享干净数据目录：

1. TUI准备活动，Web正式提交；runtime重启后TUI读取同一Attempt、同一Evidence ID/版本和下一步；
2. Web打开活动，TUI正式提交；Web刷新后HTTP读取同一Attempt和同一Evidence ID/版本。

两条轨迹均为`sameEvidence=true`。pending、深链和读取本身不创建Evidence；只有正式提交写入一次。

## A-D4-R2-02：合同环境复验

最终环境：Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、`PYTHONNOUSERSITE=1`。

- 定向与跨岗位：`6 files / 29 passed / 0 failed`；
- 最终全量：`104 files / 845 passed / 1 skipped / 0 failed`；
- 三套TypeScript检查：PASS；
- docs：PASS；
- Web build：PASS；
- extension smoke：PASS；
- release check：PASS。

A原交付在非合同环境中的`806 passed / 30 failed / 1 skipped`保留。负责人整改首轮全量另出现一次第三次正式评测`evaluator_timeout`，当轮为`103/104 files`、`844 passed / 1 failed / 1 skipped`；未修改4000ms阈值，完整全量复跑通过。原始退出码与输出哈希见`command-results.json`。

## A-D4-R2-03：交付范围

正式Git候选只包含源码、测试、最小结构化证据、验证工具和`handoff-w5-a-d4.md`。外层整改报告、ZIP和sidecar均为`AUDIT_ONLY / NOT_FOR_GIT`，不进入`proposed-files.txt`。

候选通过隔离Git index的逐项清单核对与`git diff --cached --check`，Manifest唯一排除自身。

## 三案例

B的三个输入分别在两个全新数据目录经正式诊断、PathEngine、确认和下一步读取，输入、语义输出和路径SHA-256两次一致。每对机械差异为`32 / 12 / 21`，均超过三项；未读取或复制B的预期差异文件来制造结果。

实际输出由A生成；路径合法性、页面展示及每对三项差异仍待E独立复验，不能提前登记V5-2整体PASS。

## 边界

- 不修改Web、Profile、seal、环境锁、C执行器、D材料、SDK、依赖、gold、hidden tests、Rubric或reference solution；
- `LIVE_MODEL=LIVE_NOT_RUN`；
- 本交付不是页面关闭态验证、完整V5门禁或W5 GO。
