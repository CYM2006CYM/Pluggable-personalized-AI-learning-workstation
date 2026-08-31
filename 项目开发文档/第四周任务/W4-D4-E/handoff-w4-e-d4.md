# W4-D4 E Handoff

状态：`BLOCKED / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

## 候选内容

- W3 六页 Web 已切换到真实 HTTP API，运行时代码不依赖 mock。
- Vite root 收窄为 `src/web`，固定 `/api` 代理并限制文件系统访问。
- Bootstrap 驱动推荐/章节入口、诊断、路径、学习、code/quiz 活动和总结。
- Zustand 只保存按 Attempt 隔离的未提交代码文本。
- quiz 刷新通过服务端现有 Attempt 重放恢复同一题组，不创建新 Attempt。
- 结构化 V4 结果、输入绑定、命令哈希、安全扫描和独立验证正文已生成。

## 门禁摘要

- `test:web`：10 文件、49 项通过。
- 真实 API：1 文件、3 项通过。
- V4 定向：12 文件、71 项通过。
- `typecheck`、`check:docs`、`build:web`、`git diff --check`：通过。
- 全量/`verify`：81 文件通过、3 文件失败；692 项通过、26 项失败、1 项跳过。失败均为批准版 Node/Python/Pandas 不可用。
- D 录制响应：14 条、六类齐全，`LIVE_NOT_RUN`。
- V4-1/2/3/4/6/7/8：PASS；V4-5：BLOCKED；整体：BLOCKED。

## 阻塞项

- 当前 Node `v24.18.0`，批准版为 `v22.23.1`；Python `3.13.7` 和 Pandas `3.0.5` 不可用。
- 端口 4310 被用户进程占用，未生成真实 Demo 截图。
- A 合同仍缺 `reviewTimeline`、建路失败恢复所需 `evidenceVersion`、完成态总结和完整 KnowledgeState 安全投影。

E 未修改 A/B/C/D 实现、contracts、SDK、依赖、`package-lock.json`、gold 或私有资产。`.demo-build/` 是既有未跟踪构建产物，明确排除在候选清单与 ZIP 外。最终 W4 GO 仍由负责人 D5 复核签署。
