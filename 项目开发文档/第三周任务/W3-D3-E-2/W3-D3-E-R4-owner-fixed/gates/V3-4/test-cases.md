# V3-4 测试用例合同

## 目标

独立扫描 C 正式提交涉及的四个实现文件，证明公共输出止于 `ActivityResult`，C 不写 Attempt、Evidence、KnowledgeState、Path 或 checkpoint，也不获得正式事实仓储能力；同时运行A正式提交中的活动事务和Profile绑定测试。

## 冻结输入

- `c-formal-commit`
- `c-binding-fix-commit`
- `c-environment-lock`
- `a-d3-formal-commit`（`07a5822...`）
- `a-d3-deterministic-test-files`（A正式审计清单及五个测试文件SHA-256）

## 原始命令

- `npm.cmd test -- --maxWorkers=1 --run tests/code-evaluation-port.test.ts tests/evaluation-protocol.test.ts tests/activity-runtime-service.test.ts tests/profile-bound-session-runtime.test.ts`（期望退出码 0）
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File {ToolRoot}/Test-CBoundary.ps1 -RepositoryRoot {RepositoryRoot} -OutputFile {OutputRoot}/v3-4-source-scan.json`（期望退出码 0）

## 机械PASS条件

- 扫描 `activity-rubric.ts`、`code-evaluation-port.ts`、`evaluation-protocol.ts`、`python-process-evaluation-adapter.ts`
- 禁止正式事实仓储/写入模式匹配数为0
- 公共输出类型为 `ActivityResult`
- A正式事实事务入口唯一公开，A测试清单和实际文件哈希与`07a5822...`一致

任一输入哈希不符、命令退出码不符或扫描命中只能记录 BLOCKED；不得采信作者报告中的PASS。
