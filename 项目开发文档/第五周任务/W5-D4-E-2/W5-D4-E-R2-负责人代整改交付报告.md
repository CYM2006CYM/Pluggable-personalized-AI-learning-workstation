# W5-D4 E R2 负责人代整改交付报告

- 合同：`W5-C1/W5-R1`
- 基线：`aaf588202b3ae92ed72c63994b912d78977516bb`
- ZIP：`W5-D4-E-delivery.zip`
- ZIP SHA-256：`ce940aba6edf44fb9f392bc675aeab043af8de6afa0b5e9e14a0985e16353452`
- ZIP条目：57项，包括50项正式候选、6张AUDIT_ONLY PNG和ZIP Manifest
- 正式Manifest：49项，Manifest自身唯一排除
- 正式Manifest SHA-256：`e9d570669e5c447d077d09eae2c0cb9832d43f5e0452bf75adf73fe153a797b1`
- Package verification：`FINAL_PACKAGE / PASS`
- 状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 原阻塞闭合

1. 正式Demo和Edge证据改用构建后的Vite preview；真实请求URL、资源URL、DOM、存储、日志和bundle零宿主绝对路径，不再规范化URL后判PASS。
2. 三案例数据由A正式结果机械生成到Web根，页面不再跨根运行时导入。
3. ActivityPage正式提交前先保存修改后的服务端草稿，关闭`draft_version_conflict`。
4. 真实页面/API/Node/Python链通过五个代码活动和最终实操，路径与会话完成；证据不含代码正文。
5. 50项正式候选通过隔离Git index及`git diff --cached --check`。
6. 包验证器支持显式交付目录，收到的ZIP可以在任意位置机械复验。

## 测试

- Web：`17 files / 106 passed`
- 受影响跨岗：`9 files / 34 passed`
- 全量及verify：`105 files / 843 passed / 1 skipped / 0 failed`
- 负责人关键节点复验：显式绑定合同Node和`PI_PYTHON_EXECUTABLE`后，同一次运行`13 files / 70 tests / 70 passed / 0 failed`。另行负向复验确认未绑定合同Python时会返回`environment_mismatch`，不会产生伪造判分。
- 真实页面/API/Node/Python复验：`5/5`代码活动正式判分通过，包含最终独立实操、next-step完成和会话完成。
- 独立路径合法率：`3/3`
- 三对差异：`32 / 12 / 21`
- 浏览器页面证据：重新捕获6份，桌面和移动均PASS
- 安全、typecheck、docs、Web/Demo build、extension smoke、release、隔离差异和package：PASS

## 环境说明

本机4310和5173端口已有用户此前启动的旧项目Demo进程，因此没有终止旧进程后再次运行完整`npm run demo`监督器。新的`build:web + vite preview`已由独立Edge/CDP实测；该端口占用不影响候选结论，但未登记为监督器重复启动PASS。

本报告、ZIP、sidecar、package verification和6张PNG均为`AUDIT_ONLY / NOT_FOR_GIT`。`LIVE_MODEL=LIVE_NOT_RUN`，Pyodide与Monaco保持关闭。
