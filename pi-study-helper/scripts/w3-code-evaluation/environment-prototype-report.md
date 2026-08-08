# C岗位第三周Day1环境原型与Day2候选报告

## 1. 结论

当前结论：

```text
C_W3_D1_PROTOTYPE_PASS
C_W3_D2_IMPLEMENTATION_CANDIDATE_READY
C_W3_D2_FORMAL_BLOCKED_OWNER_ENVIRONMENT_DECISION
```

Day1环境、资源、隔离、终止和故障原型已经完成。Day2的两个正式TaskBundle适配器、五阶段内部协议、Rubric汇总、公共`ActivityResult`映射及V3-3/V3-4/V3-6作者证据已经在副本完成并通过测试。

负责人D2环境裁决尚未进入`origin/main`，因此本候选没有修改正式`environment-lock.json`，没有声明`measured_node_submit`已获批准，也没有申请上传锁、commit或push。

## 2. 绑定

| 项目 | 值 |
|---|---|
| `W3_START_COMMIT` | `f190326a4a906b46e4001484ffa30a7839b82ed2` |
| B正式提交/候选HEAD | `277805b4dc612548f4dcdf4f91189abb4ef5c8e3` |
| 合同 | `W3-C3/W3-R2` |
| `act-inspect-dataframe` | `bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c` |
| `act-practical` | `3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c` |

C只读取并校验B的TaskBundle、fixture、测试和Rubric，没有改写B业务资产、权重、阻断规则、通过线或参考实现。

## 3. Day1实际环境与候选限制

执行命令：

```powershell
node .\scripts\w3-code-evaluation\probe-environment.mjs --output .\scripts\w3-code-evaluation\environment-prototype-evidence.json
```

退出码：`0`。

| 项目 | 实测/候选值 |
|---|---|
| Node | `v22.23.1` |
| Python | `3.13.7` |
| Pandas | `3.0.5` |
| 平台 | `win32-10.0.26100-x64` |
| 评测器 | `node-python-evaluator-w3-c1` |
| 允许第三方库 | `pandas==3.0.5` |
| 墙钟候选 | `4000 ms` |
| stdout/stderr候选 | 各`8192 bytes` |
| 源码候选 | `8000 bytes` |
| 数据候选 | `65536 bytes` |
| 正式fixture实际总字节 | `4181 bytes` |

三次Pandas冷启动均成功，Pandas字符串dtype均为`string`。机器证据记录每次实际耗时，最大值低于候选墙钟限制。

已证明：

- 显式Python可执行文件，`shell:false`；
- 每次运行唯一临时目录，成功、失败和超时后均清理；
- 公开与隐藏阶段使用不同Python进程和不同工作目录；
- 隐藏测试由Node父进程持有，不复制到用户工作目录；
- stdout/stderr洪泛达到阈值后停止，证据只保留字节计数；
- Windows超时测试观察到子孙进程PID，`taskkill /T /F`后子孙进程不存在；
- 子进程环境只传入Python确定性键和Windows/libuv运行所需键，未传入名称包含KEY、TOKEN、SECRET、PASSWORD或CREDENTIAL的变量。

未证明并明确为`false`：

- `networkIsolation`；
- `reliableMemoryLimit`。

本原型只适用于本地受信任测试者，不是生产级沙箱；Pyodide和双后端不属于W3。

## 4. Day2候选实现

Node父进程实现以下边界：

1. `prepare`先验证实际Python/Pandas环境，再读取B资产；环境不匹配时返回`environment_mismatch`，不归类为B资产缺陷。
2. 只接受`act-inspect-dataframe`和`act-practical`，绑定revision、templateVersion、环境引用和`assetBundleHash`。
3. 校验fixture和测试为Profile根内普通文件、非符号链接且SHA-256一致。
4. 按`prepare → user_code → public_tests → hidden_tests → summarize`执行。
5. 用户代码、公开测试和隐藏测试分别在干净Python进程中运行；公开/隐藏阶段不共享Python全局状态。
6. Python通过私有结果文件返回结构化协议，用户stdout不能伪造父进程结果。
7. Node确定性汇总B冻结Rubric；阻断维度未通过时不能PASS。
8. 端口只返回21号公共`ActivityResult`，不返回隐藏断言、完整Rubric、参考实现、私有CSV、宿主路径或原始输出。
9. C源码不导入Attempt、Evidence、KnowledgeState、PathRepository或UnitOfWork，不创建正式事实。

## 5. V3作者结果

作者测试：

```powershell
npm.cmd test -- --maxWorkers=1 --run tests/activity-rubric.test.ts tests/python-process-evaluation.test.ts
```

实际结果：退出码`0`，2个测试文件，`20/20`通过。

- 两个正式任务各连续运行3次，公共结果逐字段一致并均为PASS；
- 覆盖正确、部分正确、语法错、运行错、测试失败、超时、超输出、禁用导入和提交协议错误；
- 覆盖环境不匹配、测试资产损坏、依赖缺失、评测器超时、协议损坏、父运行器崩溃；
- 所有评测器故障均为`not_graded`，不含`score`或`dimensionResults`；
- 幂等冲突不会重复运行或重复计分。

全量回归：

```powershell
npm.cmd test -- --maxWorkers=1
```

实际结果：退出码`0`，47个测试文件通过，`480`项通过，`1`项跳过。

完整门禁：

```powershell
npm.cmd run verify
```

实际结果：退出码`0`；typecheck、47个测试文件/480项通过（1项跳过）、47个Markdown项目链接、扩展冒烟和release检查全部通过。

自检：

```powershell
node .\scripts\w3-code-evaluation\self-check.mjs --output scripts/w3-code-evaluation/self-check.json
```

实际结果：`PASS_PENDING_OWNER_ENVIRONMENT_DECISION`，无自检原因项。

## 6. 正式阻塞和下一步

唯一正式阻塞是负责人D2环境裁决尚未提交。按34、35、38号合同，在收到裁决前不得：

- 将Profile环境锁写成`measured_node_submit`；
- 将上述候选限制写成已批准产品值；
- 形成C正式V3-3/V3-4/V3-6 PASS提交；
- 申请上传锁、commit或push。

负责人裁决后，C必须拉取最新`origin/main`，核对B的两个`assetBundleHash`未变化，只按批准值更新C环境锁和证据，重跑环境探针、20项作者测试、受影响回归、`npm.cmd run verify`及`git diff --check`，再申请上传锁。
