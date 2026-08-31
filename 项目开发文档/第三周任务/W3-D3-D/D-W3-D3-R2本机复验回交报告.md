# D岗位 W3-D3 R2候选本机复验回交报告

状态：`LOCAL_VERIFICATION_PASS`  
提交状态：`NOT_COMMITTED`  
推送状态：`NOT_PUSHED`  
上传锁：`NOT_REQUESTED`

> 本报告用于负责人复核，不属于最终拟提交清单。

## 1. 同步基线

执行命令：

```powershell
git fetch origin main
git pull --ff-only origin main
git rev-parse HEAD
git rev-parse origin/main
git status --short
```

执行结果：

```text
git pull --ff-only origin main: Already up to date.
HEAD:        07a5822badf1d8e082f32dbb21705c4a150819e9
origin/main: 07a5822badf1d8e082f32dbb21705c4a150819e9
```

结论：本地`HEAD`与`origin/main`一致，未自行回退。

## 2. 接收包SHA-256复算

| 文件 | 负责人给定SHA-256 | 本机实际SHA-256 | 结果 |
|---|---|---|---|
| `D-W3-D3-owner-fixed-r2-transfer-to-D.zip` | `d31c5c451218389bc47a6cafa6dc01caa09fd951158de956d01f4f4732be5643` | `d31c5c451218389bc47a6cafa6dc01caa09fd951158de956d01f4f4732be5643` | PASS |
| `D-W3-D3-rectified-candidate-r2.zip` | `8b61d7330433cc4dad9e2fa819a0c4bd1282d4dc6dbcfff8d64e88928b65306c` | `8b61d7330433cc4dad9e2fa819a0c4bd1282d4dc6dbcfff8d64e88928b65306c` | PASS |

两个SHA-256均一致后，才将内层候选中的9个批准文件按`pi-study-helper/`原路径覆盖到正式仓库。未覆盖、删除或暂存其他岗位文件及既有本地材料。

## 3. 本机复验

复验均从`pi-study-helper`目录执行。

### 3.1 材料验证

```powershell
node fixtures/model-responses/w3/validate-w3-materials.mjs
```

退出码：`0`

```text
status: PASS
schemas: 2
recordedScenarios: 6
authorityCases: 6
scannedFiles: 4
sensitivePatternCanaries: 6
```

### 3.2 D定向测试

```powershell
npx vitest run fixtures/model-responses/w3/offline-dynamic-question.test.ts --maxWorkers=1 --fileParallelism=false
```

退出码：`0`

```text
Test Files: 1 passed (1)
Tests:      23 passed (23)
```

### 3.3 TypeScript类型检查

```powershell
npm.cmd run typecheck
```

退出码：`0`

### 3.4 Git空白错误检查

```powershell
git diff --check
```

退出码：`0`

本轮未声明全量仓库测试PASS，也未因Python评测器环境问题修改C岗位文件、环境锁或依赖。

## 4. Git状态

D候选相关`git status --short`：

```text
?? pi-study-helper/fixtures/model-prompts/w3/
?? pi-study-helper/fixtures/model-responses/w3/
?? pi-study-helper/src/application/offline-dynamic-question-orchestrator.ts
```

外层ZIP、sidecar、R1审核包、既有审计包和仓库原有本地材料继续保持未跟踪。暂存区为空。本报告本身同样保持未跟踪，不进入正式拟提交清单。

## 5. 最终拟提交清单

正式拟提交只允许以下9项：

```text
pi-study-helper/fixtures/model-prompts/w3/dynamic-objective-question.md
pi-study-helper/fixtures/model-prompts/w3/model-configuration.json
pi-study-helper/fixtures/model-responses/w3/candidate-manifest.sha256
pi-study-helper/fixtures/model-responses/w3/d1-handoff.md
pi-study-helper/fixtures/model-responses/w3/offline-dynamic-question.test.ts
pi-study-helper/fixtures/model-responses/w3/recorded-responses.json
pi-study-helper/fixtures/model-responses/w3/unauthorized-requests.json
pi-study-helper/fixtures/model-responses/w3/validate-w3-materials.mjs
pi-study-helper/src/application/offline-dynamic-question-orchestrator.ts
```

以下内容不得进入拟提交清单：内外层ZIP、sidecar、负责人指令、本回交报告、日志、临时目录、密钥及其他岗位文件。

## 6. 最终声明

```text
NOT_COMMITTED
NOT_PUSHED
UPLOAD_LOCK_NOT_REQUESTED
CANDIDATE_CONTENT_UNCHANGED_AFTER_OWNER_R2_OVERLAY
```

当前保持候选不再变化，等待负责人复核并明确授予D-D3上传锁。
