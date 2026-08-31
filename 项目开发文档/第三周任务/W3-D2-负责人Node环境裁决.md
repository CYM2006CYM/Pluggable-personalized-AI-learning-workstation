# W3-D2 负责人Node环境裁决

状态：`[负责人已签署；以本文件首次进入origin/main的提交为生效锚点]`。裁决标识：`W3-D40-ENV-1`。签署时间：`2026-08-08T01:30:21+08:00`。现行合同保持`W3-C3/W3-R2`；本文是20号D40的D2执行记录，不新增D编号，不修改公共类型或上传顺序。

## 1. 裁决依据与证据绑定

本裁决依据[20号D40](../第一周任务/20-第一周开发前负责人决策冻结清单.md)、[21号跨周公共合同](../第一周任务/21-第一周公共合同总册.md)、[35号第三周公共合同](./35-第三周公共合同总册.md)和[38号C任务书](./38-岗位C第三周任务书.md)，只批准本地受信任测试者的Node正式提交环境。

| 证据项 | 冻结值 |
|---|---|
| 证据基线/B正式提交 | `277805b4dc612548f4dcdf4f91189abb4ef5c8e3` |
| C审计ZIP | `W3-D2-C/C-W3-D1-environment-audit-277805b.zip` |
| C审计ZIP SHA-256 | `1cc5bb26ebf21c9e565403dc71c466eda5a753e2b5fda2df3bb54102d3dc04ac` |
| `probe-environment.mjs` SHA-256 | `a3dee9f1986dda26824c26138ebf1c8e26d6c84603faaa90d4b6259f391501f6` |
| `environment-prototype-evidence.json` SHA-256 | `af0b859ef893b1fca6690e39c0551c5c7ec07423adf6127d96cd00442b4697d7` |
| `environment-prototype-report.md` SHA-256 | `b03bd70946affd066be0c555389342b6ef09e10541c80ac4458edbd1d0d26657` |
| 原型证据内部环境摘要 | `sha256:904167c1ecbc1448a12119ebc460d033e2f47cbd4e6b030cfd7de6e6ca5046f6` |
| `act-inspect-dataframe` `assetBundleHash` | `bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c` |
| `act-practical` `assetBundleHash` | `3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c` |

第二周`W2-V2-3-ENV-1`的`pandas==3.0.5`只是当周V2-3审计基线，不直接写入W3环境锁。本次W3批准依据是C在D1对同一版本的新原型测量，不是复制W2历史值。

## 2. 批准的Node正式提交环境

| `EnvironmentLock`投影 | 批准值 |
|---|---|
| `environmentId` | `env-python-pandas-candidate` |
| `schemaVersion` | `1` |
| `status` | `measured_node_submit` |
| `nodeVersion` | `v22.23.1` |
| `pythonVersion` | `3.13.7` |
| `pandasVersion` | `3.0.5` |
| `allowedLibraries` | 仅`pandas==3.0.5` |
| `platform` | `win32-10.0.26100-x64` |
| `evaluatorVersion` | `node-python-evaluator-w3-c1` |
| `limits.wallClockMs` | `4000` |
| `limits.stdoutBytes` | `8192` |
| `limits.stderrBytes` | `8192` |
| `limits.sourceBytes` | `8000` |
| `limits.datasetBytes` | `65536` |
| `capabilityFlags.processTreeTermination` | `true` |
| `capabilityFlags.networkIsolation` | `false` |
| `capabilityFlags.reliableMemoryLimit` | `false` |
| `prototypeEvidenceRef` | `scripts/w3-code-evaluation/environment-prototype-evidence.json` |
| `createdAt` | `2026-08-08T01:30:21+08:00` |

证据同时记录正式fixture总计`4181 bytes`、三次Pandas启动最大`804.922 ms`、输出洪泛观测各`20000 bytes`并各裁剪为`8192 bytes`，以及成功、失败和超时清理与Windows子孙进程树终止结果。上表的`65536`是本地MVP单任务数据安全上限，不将当前fixture总大小写成上限。

## 3. 不批准的能力

1. `memoryBytes`不填写；`reliableMemoryLimit=false`。
2. `networkIsolation=false`；不声称已禁止网络。
3. `pyodideVersion`在W3环境锁中保持`null`；不批准`measured_dual_backend`。
4. 本裁决不将原型写成生产级沙箱，只适用于比赛MVP、研究验证和现场演示的本地受信任测试者。

21号已冻结“公开/隐藏使用独立Python进程、Node父评测器持有隐藏断言、隐藏测试和参考实现不得写入用户工作目录”。这些继续是C的D2强制实现与V3验证边界，不另造`EnvironmentLock`能力字段。

## 4. 哈希和生效语义

原型证据内部摘要`sha256:904167...46f6`是对C原型测量文档投影的摘要，不是正式`environment-lock.json`的`environmentHash`。C必须填入本裁决批准的完整锁字段、裁决时间和证据引用，再按12号统一规范以UTF-8、对象键字典序、数组业务顺序、无多余空白处理，排除`environmentHash`自身后重新计算正式锁哈希。

## 5. C的D2执行边界

1. C先拉取包含本裁决的最新`origin/main`，报告实际HEAD和本裁决文件SHA-256。
2. C核对B两个`assetBundleHash`与第1节一致，不修改B业务资产、Rubric权重、阻断规则或通过线。
3. C才可将Profile候选环境锁写为`measured_node_submit`，按第4节复算正式`environmentHash`，并使原型证据显式绑定`W3-D40-ENV-1`。
4. C重跑环境探针、20项作者测试、受影响回归、`npm.cmd run verify`和`git diff --check`，完成V3-3/V3-4/V3-6作者证据后再申请C的D2上传锁。
5. C的正式跨边界输出仍止于21号`ActivityResult`；不得生成正式Attempt、Evidence、KnowledgeState或路径事实。

本裁决只解除C的D2环境前置阻塞，不授权Profile激活、正式gold生成、C立即上传或修改其他岗位文件。
