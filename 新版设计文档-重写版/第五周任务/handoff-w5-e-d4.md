# 岗位E W5-D4 R2 负责人代整改交接单

状态：`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 正式绑定

- 合同：`W5-C1/W5-R1`
- 基线/A-D4可移植Manifest：`aaf588202b3ae92ed72c63994b912d78977516bb`
- C-D3：`6acc56fa03986797be54156af639a905c2e74a64`
- B-D3：`a0d5a37116a6c67f009ca19e313501d9eed96f78`
- revision 3 seal：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- Pyodide：`PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- `LIVE_MODEL=LIVE_NOT_RUN`

## E-D4结果

1. 活动页没有预览按钮、`/run`调用、预览路由或双后端启用文案；底层BrowserCodeRunner、Worker和公共合同保留。
2. `npm run demo`使用构建后的Vite preview和同源API代理。真实浏览器请求与资源URL零`/@fs`和宿主绝对路径，未通过清洗URL制造PASS。
3. 三案例Web数据由A正式输出机械生成到Web根，页面不手写路径、mastery或差异。E独立复算合法率`3/3`，差异`32/12/21`。
4. 两条跨端轨迹复验同一session、Attempt和Evidence；pending只在`committed=true`后清理。
5. 真实ActivityPage依次提交`act-inspect-dataframe`、`act-missing`、`act-duplicates`、`act-types`和最终`act-practical`，全部由Node/Python正式判分通过，路径及会话完成。
6. 模型fallback、评测器失败恢复、版本冲突、重复提交和服务重启由受影响回归覆盖。
7. Edge/CDP重新生成三案例桌面、案例移动端、关闭态活动桌面/移动共6份页面证据；DOM、网络、资源URL、Worker、存储、日志与bundle扫描PASS。

## 验证摘要

- 环境：Node `v22.23.1`、npm `10.9.8`、Python `3.13.7`、Pandas `3.0.5`、`PYTHONNOUSERSITE=1`
- Web：`17 files / 106 passed`
- 受影响回归：`9 files / 34 passed`
- 全量及verify：`105 files / 843 passed / 1 skipped / 0 failed`
- typecheck、docs、build、extension smoke、release、A Manifest、独立验证、浏览器与隔离差异：PASS

`package.json`、`vite.config.ts`和`src/demo/launcher.ts`是负责人为解决正式Demo宿主路径泄漏所做的最小跨所有权修复；依赖与锁文件未变化。

## 后续与边界

E-D4正式结果可供D5封存与彩排使用。PNG仅为`AUDIT_ONLY`；不声明Pyodide启用、在线模型、双后端PASS、完整V5或W5 GO。未经负责人授权不得commit或push。
