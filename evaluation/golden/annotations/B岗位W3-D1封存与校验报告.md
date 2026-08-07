# W3-D1 B 岗位整改与负责人审计候选

状态：`OWNER_SYNCED_CANDIDATE`（负责人已完成双封存资格检查和A后集成复验；未提交、未推送、未授予上传锁）。

原作者验证基线HEAD为`2db7127bcd22035951474ddd3f86de4e8cfa77be`；该历史结果保留。负责人代修集成基线为A已上传提交`d50ad4e8c0fe8e1ec3822b164e973897e6aeca91`。D1不激活Profile。

## 反馈逐条核对

1. **确定性 Rubric：完成。** `act-practical.engineering` 使用独立 `static_check` 文件 `assessments/private/tests/test-practical-engineering-static.py`，规则覆盖 AST 解析、Import/ImportFrom、别名、危险模块（os/subprocess/socket/requests/urllib/pathlib/shutil）和 eval/exec/open；解析及违规均固定为 `AssertionError("static_check_failed")`。未修改六维权重、通过线、阻断规则或反馈码，未使用 `manual_review`。
2. **唯一事实与映射：完成。** 全局保持 5 个 Bundle；W3 目标恰为 `act-inspect-dataframe`、`act-practical`。两目标 Bundle activity 与 Profile 深相等，内嵌 rubric 与 `rubricRef` 深相等。`test-practical-hidden-02` 仅承担 variant-02 运行时不变量（含输入不变），engineering 仅映射 `test-practical-engineering-static`；公开/私有登记无重复、无悬空引用。
3. **最小范围修订：完成。** 将已封存且 SHA-256 为 `eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf` 的 B 标注原件登记为 `proposedCommit` 包条目和拟提交路径；它不属于只读输入或 audit-only。`rubric-structure` 外部及内嵌标签均恢复为 `列结构`，未改权重、通过线、阻断、映射或反馈码。原 seal 仍只读保留于 `original/audit-only`；候选 seal 是唯一拟上传入口，状态仍为 `PENDING_OWNER_DUAL_SEAL_CHECK`。候选树为 29 项，SHA-256 `ddd23e6cd4b54725e4e00cbcdac299c0ba3cf5d6c997b6fe748767f5309df04c`。
4. **Manifest/ZIP：完成。** manifest 使用 `packageEntries`、`fileEntries`、`proposedCommitPaths`、`frozenInputsReadOnly`、`auditOnly`、`auditEvidence`；`selfExcluded=true`。构建器实际读取 ZIP 中央目录，逐项核对路径、长度和 SHA-256；冻结输入和历史 seal 不在 proposedCommitPaths。
5. **作者验证：完成。** 验证全局 5 Bundle、W3 目标集合、activity/rubric 闭合、参考实现通过、starter 拒绝、known-wrong 逐项被拒绝，以及静态正反例（含别名与文件/进程/网络调用）。候选证据脚本退出码为 0，摘要为 baselinePassed、allBaselineRepeatsStable、allStartersRejected、allKnownWrongRejectedPerFixture 均 true。
6. **复验与门禁：双封存资格已由负责人机械复核PASS。** 已保留冻结哈希：标注`eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf`；输入`b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c`。E已独立封存，A已完成D1上传；剩余门禁仅为B在实际上传工作区完成复验、报告清单并取得负责人明确上传锁。

## 已执行命令

`python quality/prepare-w3-b-d1-delivery.py --verify`：0；`npm.cmd test -- --run tests/pandas-cleaning-v2-assets.test.ts`：0（10/10）；`npm.cmd test -- --run tests/evaluation-protocol.test.ts`：0（8/8）；`npm.cmd test -- --run tests/w3-b-d1-delivery.test.ts`：0（8/8）；`npm.cmd test -- --run`：0（40 文件、425 通过、1 跳过）；`npx.cmd tsc --noEmit`：0；`npm.cmd run check:docs`：0（45 个 Markdown）；`git diff --check`：0。

候选 ZIP 将由 manifest 中央目录实核：43 个实际包文件、42 个已登记非自身文件、`selfExcluded=true`。ZIP 与负责人审计包的旁路 SHA-256 仅写入其仓库外旁路校验文件；任何环境类失败会原样记录，不改写为 PASS。

## 负责人代修同步与A后集成复验

1. 负责人决定将根目录`w3-d1-b-rectified-candidate.zip`作为B的正式仓库工件随提交上传，以闭合`w3-b-d1-delivery.test.ts`对候选ZIP的检查。
2. 正式提交集合为Manifest的22项`proposedCommitPaths`加根目录候选ZIP；ZIP不进入自己的`packageEntries`或`proposedCommitPaths`，不得递归包含自身。
3. 在`origin/main@d50ad4e8c0fe8e1ec3822b164e973897e6aeca91`上叠加B候选后，A/B文件路径交集为0。
4. 负责人首次在不放入ZIP的干净集成目录运行B定向测试，真实得到`FileNotFoundError`；补入本轮正式ZIP后，定向测试通过，全量结果为45个测试文件、460项通过、1项跳过，typecheck和文档链接检查通过。首次失败事实不得删除。
5. B仍须在自己的实际上传工作区重新运行并据实报告；本段不替代B的上传前复验，也不构成commit或push授权。
