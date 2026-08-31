# W3-D1 B上传执行说明

状态：`负责人代修候选`。本文件只随交付包发送给B，不进入正式Git提交。

负责人正式文件包：`B-W3-D1-formal-upload-files.zip`

负责人正式文件包SHA-256：`dc058a2f247d87d25315c821b66b5104efd62665ced05ce865123aaacd40fe4b`

## 固定基线

- 现行合同：`W3-C3/W3-R2`
- A已上传提交：`d50ad4e8c0fe8e1ec3822b164e973897e6aeca91`
- W3起点：`f190326a4a906b46e4001484ffa30a7839b82ed2`

## B必须执行

1. 保留现有工作和审计材料，先获取最新`main`，确认实际HEAD包含`d50ad4e8c0fe8e1ec3822b164e973897e6aeca91`。
2. 先复算`B-W3-D1-formal-upload-files.zip`并确认与上述SHA-256一致，再把ZIP内容按仓库相对路径覆盖到B的上传工作区；不要把外层ZIP文件本身复制进仓库。
3. 正式拟提交文件以`B-W3-D1-formal-upload-manifest.txt`为准，共23项：Manifest的22项`proposedCommitPaths`加根目录`w3-d1-b-rectified-candidate.zip`。
4. 不得暂存冻结输入、历史原seal、负责人说明、外层交付ZIP、sidecar、旧ZIP、缓存或其他岗位文件。
5. 依次运行B定向测试、全量测试、typecheck、文档检查和`git diff --check`，如实报告首次结果与复跑结果。
6. 报告实际HEAD、`git status --short`和拟提交清单；未取得负责人明确上传锁前不得commit或push。

## 必须保持

- B标注SHA-256：`eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf`
- 冻结输入规范化SHA-256：`b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c`
- 29项TaskBundle资产树SHA-256：`ddd23e6cd4b54725e4e00cbcdac299c0ba3cf5d6c997b6fe748767f5309df04c`
- 不修改E标注、正式gold、A/C/D/E文件、SDK、依赖或Profile激活状态。
