# W3-D1 A R7 审计候选交接单

状态：负责人已通过截图授权本次候选暂存；未 commit、未 push、未申请新的上传锁。

## 基线与输入核验

```text
HEAD=2db7127bcd22035951474ddd3f86de4e8cfa77be
origin/main=2db7127bcd22035951474ddd3f86de4e8cfa77be
W3_START_COMMIT=f190326a4a906b46e4001484ffa30a7839b82ed2
W3_START_COMMIT 是 HEAD 祖先：git merge-base --is-ancestor 退出码 0
R6 ZIP SHA-256=13f325cb457a8b40cd2e62e57619fe412acdcb44d8f06efc9f139cf35de4a0d0
负责人 R7 ZIP SHA-256=6857dd5c12f4f387a28f91305a9618ca4336adfdb239b93409616e70124e91b2
```

R7 ZIP 与外部 `.sha256` 一致；包内 6 条 OWNER-FIX-SHA256 记录全部一致（其中 5 条为覆盖/新增代码与测试，另 1 条为负责人交接单）。

## 本轮修改

- 叠加负责人修订的 Facade、文件仓储、内部路径端口和仓储测试。
- 新增 `path-session-boundary.test.ts`，覆盖会话版本陈旧读取、原子提交返回、内部路径幂等冲突。
- 公共安全 DTO、内部完整快照和重启恢复边界保持分层。
- 未修改已通过的 PathEngine 主体、Profile resolver、V3 输入/证据或 D3 事务。

## 实际验证

```text
npm.cmd test -- --run tests/path-engine.test.ts tests/path-runtime.test.ts tests/path-session-boundary.test.ts tests/file-learning-session-repository.test.ts tests/profile-v2-revision-resolution.test.ts tests/path-engine-development-20.test.ts --maxWorkers=1
退出码 0；6 个文件；49 项通过

npm.cmd test -- --run --maxWorkers=1
退出码 0；44 个文件；452 项通过、1 项跳过

npm.cmd run typecheck
退出码 0
npx.cmd tsc --noEmit
退出码 0
npm.cmd run check:docs
退出码 0；45 个 Markdown 文件链接有效
git diff --check
退出码 0（profile-family-repository.ts 保留 CRLF 提示）
```

V3-1、V3-2 与 development-20 哈希均与 R6 一致，未运行 final-60。

## 最终实际工作区状态（暂存前）

```text
 M pi-study-helper/src/repositories/file-learning-session-repository.ts
 M pi-study-helper/src/repositories/profile-family-repository.ts
 M pi-study-helper/tests/file-learning-session-repository.test.ts
?? W3-D1-A-V3-1-evidence.json
?? W3-D1-A-V3-2-evidence.json
?? W3-D1-A-delivery.zip
?? W3-D1-A-development-20-evidence.json
?? W3-D1-A-file-sha256.txt
?? W3-D1-A-redelivery-r2.zip
?? W3-D1-A-redelivery-r3.zip
?? W3-D1-A-redelivery-r4.zip
?? W3-D1-A-redelivery-r5.zip
?? W3-D1-A-redelivery-r6.zip
?? W3-D1-A-redelivery.zip
?? pi-study-helper/src/application/path-learning-facade.ts
?? pi-study-helper/src/domain/path-engine.ts
?? pi-study-helper/src/repositories/internal-path-session-port.ts
?? pi-study-helper/tests/path-engine-development-20.test.ts
?? pi-study-helper/tests/path-engine.test.ts
?? pi-study-helper/tests/path-runtime.test.ts
?? pi-study-helper/tests/path-session-boundary.test.ts
?? pi-study-helper/tests/profile-v2-revision-resolution.test.ts
?? 新版设计文档-重写版/第三周任务/W3-D1-A-PATH-INFEASIBLE-ISSUE.md
?? 新版设计文档-重写版/第三周任务/W3-D1-A-R6-verification.md
?? 新版设计文档-重写版/第三周任务/W3-D1-A-R7-verification.md
?? 新版设计文档-重写版/第三周任务/handoff-w3-a-d1.md
```

所有 ZIP、旧包、解压目录及本地审计材料均排除在拟提交清单之外。

## R7 拟提交清单

```text
pi-study-helper/src/application/path-learning-facade.ts
pi-study-helper/src/domain/path-engine.ts
pi-study-helper/src/repositories/file-learning-session-repository.ts
pi-study-helper/src/repositories/internal-path-session-port.ts
pi-study-helper/src/repositories/profile-family-repository.ts
pi-study-helper/tests/path-engine-development-20.test.ts
pi-study-helper/tests/path-engine.test.ts
pi-study-helper/tests/path-runtime.test.ts
pi-study-helper/tests/file-learning-session-repository.test.ts
pi-study-helper/tests/path-session-boundary.test.ts
pi-study-helper/tests/profile-v2-revision-resolution.test.ts
W3-D1-A-V3-1-evidence.json
W3-D1-A-V3-2-evidence.json
W3-D1-A-file-sha256.txt
新版设计文档-重写版/第三周任务/W3-D1-A-R6-verification.md
新版设计文档-重写版/第三周任务/W3-D1-A-R7-verification.md
新版设计文档-重写版/第三周任务/W3-D1-A-PATH-INFEASIBLE-ISSUE.md
新版设计文档-重写版/第三周任务/handoff-w3-a-d1.md
```

明确排除：`W3-D1-A-owner-rectified-r7.zip`、`W3-D1-A-redelivery-r6.zip`、其他旧 ZIP、解压目录、`W3-D1-A-development-20-evidence.json`、缓存、整库副本、hidden/private/reference/Rubric 安全材料及其他岗位文件。D1 未激活 Profile v2，未实现 D3 Attempt/Evidence 正式事务。
