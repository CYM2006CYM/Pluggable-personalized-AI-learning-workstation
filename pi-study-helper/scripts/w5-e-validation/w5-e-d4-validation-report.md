# W5-D4 E R2 负责人代整改验证报告

状态：`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

正式基线为`aaf588202b3ae92ed72c63994b912d78977516bb`，合同为`W5-C1/W5-R1`，Profile revision 3 seal为`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`。

## 结论

- `PYODIDE_DECISION=PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- `PYODIDE_ENABLED=false`
- `LIVE_MODEL=LIVE_NOT_RUN`
- `PATH_LEGALITY=3/3`
- `PAIR_DIFFERENCES=32/12/21`
- `REAL_WEB_CODE_CHAIN=5/5`
- `FINAL_PRACTICAL=PASS`
- `CROSS_END/SAME_ATTEMPT/SAME_EVIDENCE=PASS`
- `SECURITY_SCAN=PASS`
- `DESKTOP_MOBILE=PASS`

## 阻塞整改

1. 三案例页面不再跨Vite根读取`scripts/w5-a-d4`。生成脚本把A正式结果机械投影到Web根内，测试逐字段确认生成投影与A输入一致。
2. 正式`npm run demo`先构建Web，再使用`vite preview`提供静态页面和同源API代理。Edge/CDP使用相同preview配置，不扩大`fs.allow`，不替换URL后再扫描。
3. 浏览器实际捕获的请求URL、资源URL、DOM、存储、日志和bundle均检查原始内容；零`/@fs`、宿主绝对路径、外部请求、`/run`请求或Worker资源。
4. ActivityPage在提交修改后的代码前先保存正式草稿，使用服务端返回的新`draftVersion`提交，关闭真实后端发现的`draft_version_conflict`。
5. 真实Web集成从章节会话依次完成题组，在ActivityPage中正式提交五个代码活动，包括`act-practical`，最终路径和会话完成。证据不含代码正文。
6. 正式候选使用隔离Git index执行清单核对和`git diff --cached --check`；包验证器允许显式指定交付目录。

`package.json`、`vite.config.ts`和`src/demo/launcher.ts`属于负责人为关闭现场安全阻塞批准的最小跨所有权修复；未修改依赖版本或锁文件。

## 命令结果

- Web：`17 files / 106 passed / 0 failed / 0 skipped`
- 受影响回归：`9 files / 34 passed / 0 failed / 0 skipped`
- 全量及verify：`105 files / 843 passed / 0 failed / 1 skipped`
- typecheck、docs、Web/Demo build、extension smoke、release、独立验证、preview浏览器、安全扫描和隔离差异：PASS

原交付失败和负责人整改中发现的脚本变量、preview API、真实URL泄漏、真实代码提交冲突等失败均保留在`d4-command-results.json`。原始大日志只留在系统临时目录。

## 边界

PNG为`AUDIT_ONLY`，不进入正式Git。Pyodide和Monaco未启用，未安装依赖；本交付不声明在线模型、双后端、完整V5或W5 GO。
