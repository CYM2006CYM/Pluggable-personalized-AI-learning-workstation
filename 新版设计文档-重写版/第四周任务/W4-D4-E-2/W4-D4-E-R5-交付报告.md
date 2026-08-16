# W4-D4 E R5 负责人直接整改交付报告

状态：`READY_FOR_OWNER_REVIEW`

本 R5 保留 R4 历史证据，不覆盖既有运行记录；当前仍为 `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`，不代表 W4 GO。

## 修改范围

- E：修复首次非通过题组刷新后无法恢复重试、未完成学习步骤误跳总结，并补 Web 回归测试。
- A：按 42 号合同最小修复 `getNextStep()`，未确认卡片与其后首个未终止活动必须在同一安全输出中返回。
- 未修改 B 资产、C HTTP、D Agent、公共合同、私有答案、依赖、锁文件或环境锁。

## 合同环境

- Node `v22.23.1`，npm `10.9.8`。
- Python `3.13.7`，Pandas `3.0.5`，`PYTHONNOUSERSITE=1`。
- Python 运行时位于仓库外独立目录；未修改系统 Python 或项目依赖。
- 固定 Demo 使用 API `127.0.0.1:4310`、Vite `127.0.0.1:5173`，未漂移正式端口。

## 复验结果

- Python evaluator：2 files / 26 tests PASS。
- A/E 受影响回归：3 files / 35 tests PASS。
- Web：11 files / 71 tests PASS。
- 两种入口真实 API 与六点运行时：2 files / 10 tests PASS。
- `npm.cmd run verify`：85 files / 740 passed / 1 skipped / 0 failed，退出码 0。
- `npm.cmd run build:web`、`check:docs`、`smoke:extension`、`check:release`、`git diff --check`：全部 PASS。

## 固定 Demo 浏览器复验

- 推荐模式 400 分钟：固定诊断 8/8、诊断草稿刷新恢复、7 节点路径生成及刷新恢复通过。
- 首次 1 题辅助活动提交为 `in_progress/insufficient`，刷新后恢复并创建新 Attempt；旧 Attempt 未复用。
- 第二次结果终止后进入 `pandas.clean.read-csv`，教学目标、分步解释、示例、常见误区和来源均可见。
- 卡片确认与 4 题 fixed 组打开同事务通过；刷新后 Attempt ID 不变，打开阶段无答案。
- 120 分钟路径为 `path_infeasible`，属于确定性预算结果；400 分钟路径正常，不以放宽预算规则修复。

## V4 口径

- V4-5：`PASS`。空临时数据根的推荐/章节真实 API 轨迹通过；固定 4310/5173 的正常浏览器推荐轨迹及诊断草稿、题组 Attempt、提交后三处恢复通过。
- V4-8：`PASS_SCOPED_RUNTIME_ASSET`。六个核心点的卡片、有效题组、判分、重试、insufficient 和打开零泄漏逐点通过；不扩写为六点完整浏览器端到端。
- 真实 Key：`LIVE_NOT_RUN`，按合同可选，不构成阻塞。

本候选可进入负责人最终复核，但只有负责人可签署 W4 GO 或授予上传锁。
