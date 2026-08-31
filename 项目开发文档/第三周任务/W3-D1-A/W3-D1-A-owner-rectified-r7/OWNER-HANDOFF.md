# W3-D1 A 负责人代修交接单

状态：负责人协作助手基于A的`W3-D1-A-redelivery-r6.zip`完成代码代修和独立复验；本包不是commit、push或上传锁授权。A必须先核对输入基线、叠加文件并在自己的实际工作区复跑门禁，再报告负责人。

## 1. 输入身份

```text
R6 ZIP SHA-256 = 13f325cb457a8b40cd2e62e57619fe412acdcb44d8f06efc9f139cf35de4a0d0
R6 HEAD = 2db7127bcd22035951474ddd3f86de4e8cfa77be
W3_START_COMMIT = f190326a4a906b46e4001484ffa30a7839b82ed2
```

本包只适用于上述R6候选。若A实际文件不是R6内容，不得直接混合覆盖；应先恢复到自己的R6候选或逐项人工合并并重新运行全部门禁。

## 2. 已修复问题

1. 公共`PathSafeSnapshot`只保存公共安全字段，不再补造`difficulty/scaffold/required/positionLocked/createdAt`等内部事实。
2. 内部完整路径只由`InternalPathSessionPort.commitInternalPath()`写入，并与公共安全投影逐字段闭合。
3. `getInternalPathSnapshot()`校验`sessionVersion`，陈旧读取返回`session_version_conflict`，不再混合两个会话版本。
4. `commitInternalPath()`返回本次原子提交的安全快照；Facade直接使用该返回值并校验版本，不再提交后进行第二次仓储读取。
5. 内部路径候选进入提交幂等哈希和prepared transaction语义闭合；同一`requestId`绑定不同内部内容返回`idempotency_conflict`。

## 3. 覆盖文件

将本包中的以下路径覆盖到A的R6候选对应路径：

```text
pi-study-helper/src/application/path-learning-facade.ts
pi-study-helper/src/repositories/file-learning-session-repository.ts
pi-study-helper/src/repositories/internal-path-session-port.ts
pi-study-helper/tests/file-learning-session-repository.test.ts
pi-study-helper/tests/path-session-boundary.test.ts
```

前四项是R6文件的修正版；第五项是新增的4项边界回归测试。不得覆盖或重做R6已经通过且未受影响的PathEngine、Profile resolver、V3证据和问题单。

## 4. 独立复验结果

在`HEAD=2db7127...`的干净副本叠加完整R6，再覆盖本包5个文件后执行：

```text
npm.cmd test -- --run tests/path-engine.test.ts tests/path-runtime.test.ts tests/path-session-boundary.test.ts tests/file-learning-session-repository.test.ts tests/profile-v2-revision-resolution.test.ts tests/path-engine-development-20.test.ts --maxWorkers=1
退出码0；6个文件；49项通过

npm.cmd run typecheck
退出码0

npm.cmd test -- --run --maxWorkers=1
退出码0；44个文件；452项通过、1项跳过

npm.cmd run check:docs
退出码0；45个Markdown文件链接有效
```

V3证据未改写，仍为：

```text
V3-1 = f29d9fb982d2647b2b440496d02585a06fa5ae8e5b27f384f00493d2a27a820b
V3-2 = 02f9f7754ad5e9197555803d90c668d63f5b8a05cc59b0db902a30f76543754a
development-20 normalized-text = 54c0f5f30bc0b9a104ac2e9e38e6ca3d6f33c5cbe3ade17c62be1c69be1b8473
```

## 5. A提交前必须完成

1. 拉取最新`origin/main`，确认`W3_START_COMMIT`仍是实际HEAD祖先。
2. 核对本包逐文件SHA-256，再覆盖或人工合并；不得把本ZIP、解压目录或旧ZIP加入Git。
3. 在A实际工作区重跑第4节全部命令，并据实记录首次结果和最终结果。
4. 更新A自己的交接单、R7整改映射、测试项数、实际HEAD、拟提交清单和逐文件SHA-256；不得继续沿用R6清单冒充新结果。
5. 保持V3-1/V3-2文件哈希不变，不运行final-60，不激活Profile，不修改SDK、依赖、B/C/D/E资产或负责人合同。
6. 取得负责人明确上传锁后，只暂存授权文件；暂存后运行`git diff --cached --check`，报告实际暂存清单，等待最终commit/push指令。

