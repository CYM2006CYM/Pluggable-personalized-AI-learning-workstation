# V3-8 测试用例合同

## 目标

复验六页、五状态、活动四阶段、D46恢复和DTO/fixture安全边界。

## 冻结输入

- `e-d2-r2-package`
- `e-d2-r2-hash-report`
- `a-d3-formal-commit`
- `d-d3-formal-commit`

## 原始命令

- `npm.cmd run test:web`（期望退出码 0）
- `npm.cmd run typecheck`（期望退出码 0）
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File {ToolRoot}/Test-WebBoundary.ps1 -WebRoot {RepositoryRoot}/pi-study-helper/src/web -SourceRoot {RepositoryRoot}/pi-study-helper/src -OutputFile {OutputRoot}/v3-8-web-boundary.json`（期望退出码 0）

## 期望项数与指标

- `expectedTestItems` = `81`
- `routeCount` = `6`
- `pageStateCases` = `30`
- `activityModes` = `4`
- `obsoleteLearnRouteMatches` = `0`
- `draftTransitionChecks` = `3`
- `leakMatches` = `0`

## 机械PASS条件

- 六页面均可达且旧学习路由无效
- 六页各五状态及主要操作可用
- 草稿跨冲突/错误/恢复逐字保留
- Facade DTO与页面fixture分离且泄漏扫描为0
- 前端不做评分、mastery、路径、Rubric或PASS判定

任一命令退出码不符、指标缺失、输入哈希不匹配或机械条件不满足时只能记录 BLOCKED，失败所有者为：E。D3不得执行这些命令或填写最终结论。
