# W4-D4 E 交付报告

交付状态：`BLOCKED / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

本报告位于 ZIP 外。候选包不代表 W4 GO，最终结论由负责人在 D5 复核签署。

## 1. 输入提交

| 岗位 | 正式提交 |
| --- | --- |
| A | `4c52eb7c78fa80007aa9a8ab4e00768d71d3f3f5` |
| B | `56398ab5f44283e9c10b6d66ec2f0732cc043790` |
| D | `dc1693e5bfcc0bed226ff0f20613fc4b2ec88681` |
| C | `a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4` |

执行时 HEAD 与 `origin/main` 均为 `a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4`。B revision 3 seal 共 78 项，asset tree 为 `d1438022a49f83df20fa865443c36f4c3442856c8b679aac989de9e61a3feb30`；D 录制响应 14 条，SHA-256 为 `4dc9fae61d7d179947fe24ed661b5a6826484f9c27e79a0b2fc39a55a186061c`。四类正式输入完整，未登记 `AUDIT_INPUT_INCOMPLETE`。

## 2. 完成内容

- Vite root 收窄到 `src/web`，固定 `127.0.0.1:5173`、严格端口和 `/api -> 127.0.0.1:4310` 代理。
- Web API client 直接导入 A contracts 类型，处理 200/202 与 400/404/409/422/500/503 安全 envelope。
- 六页运行时代码移除 mock 依赖，开始、诊断、路径、学习、code/quiz 活动、总结均接入真实 API。
- Bootstrap 作为会话、路径和 Attempt 的权威恢复来源；Zustand 仅保存按 Attempt 隔离的未提交代码文本。
- quiz 刷新验证同一 Attempt、同一 question IDs，不创建替代 Attempt；提交后只消费服务端进度或安全复盘。
- loading、empty、error、conflict、recovery 五类状态和基础可访问性语义已覆盖。
- E 独立重算 D 录制响应哈希并回放六类索引、审核顺序、fallback 与越权拒绝。

## 3. V4 状态

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| V4-1 | PASS | 非法题组拒绝、程序判分。 |
| V4-2 | PASS | Schema/超时/provider/fallback 降级。 |
| V4-3 | PASS | 串行审核与 Agent 越权拒绝。 |
| V4-4 | PASS | Evidence 忠实投影、unverified 与失败保留。 |
| V4-5 | BLOCKED | 覆盖阶段的两种真实 API 轨迹和三处刷新通过；批准版评测环境缺失，完整代码闭环和两个上游恢复分支不能签 PASS。 |
| V4-6 | PASS | HTTP、DOM、bundle、审计日志、Agent 上下文、Vite 直链零私有泄漏。 |
| V4-7 | PASS | 六类 14 条录制响应通过；在线模型 `LIVE_NOT_RUN`。 |
| V4-8 | PASS | 六点 6/6、每组 4 题、阈值、重试、insufficient、答案边界通过。 |

整体结论为 `BLOCKED`，不是 PASS。

## 4. 命令结果

| 命令组 | 结果 |
| --- | --- |
| `test:web` | 10 文件、49 项通过，exit 0 |
| 推荐/章节真实 HTTP 轨迹 | 1 文件、3 项通过，exit 0 |
| V4 定向 | 12 文件、71 项通过，exit 0 |
| 全量测试 | 81 文件通过、3 失败；692 项通过、26 失败、1 跳过，exit 1 |
| `typecheck` | exit 0 |
| `check:docs` | 81 个 Markdown 项目链接有效，exit 0 |
| `build:web` | 47 modules，exit 0 |
| `verify` | 同一 3 文件/26 项环境失败，exit 1 |
| `git diff --check` | exit 0 |

每条命令的 UTC 时间、工作目录、完整命令、退出码、项数及 stdout/stderr SHA-256 位于候选包中的 `command-results.json`。原始日志保存在 `raw/`，因含诊断宿主路径而未进入 ZIP。

## 5. 真实失败和归因

批准环境要求 Node `v22.23.1`、Python `3.13.7`、Pandas `3.0.5`；实际为 Node `v24.18.0`，Python 仅有 WindowsApps 占位入口，Pandas 不可用。26 项失败全部位于 Python 评测或 W3 B Python 交付测试，登记 `ENVIRONMENT_MISMATCH`，未通过修改上游文件规避。

固定 API 端口 4310 被用户进程 `QQ.exe` PID `34036` 占用。E 未终止用户进程、未漂移端口，因此真实 Edge Demo 截图登记 `PORT_OCCUPIED/BLOCKED`，`screenshots/` 为空。

A 的上游安全合同仍缺：`NextStepOutput.reviewTimeline`、诊断完成后建路失败恢复所需 `evidenceVersion`、完成态总结和完整 KnowledgeState 投影。详情见 `issues/W4-D4-E-blockers.md`。

## 6. 文件与范围

- 候选文件：32 个，完整清单见 `manifests/W4-D4-E-candidate-files.txt`。
- 每文件 SHA-256：见 `manifests/W4-D4-E-files.sha256`。
- ZIP 文件项：35 个文件，39 个目录/文件条目。
- ZIP 禁止项扫描：0 命中。
- 上游与锁文件核验：`package-lock.json`、contracts、A/B/C/D、fixtures、gold 均无差异。
- 明确排除：`.demo-build/`、`dist-web/`、`.demo-data`、`node_modules`、原始日志、完整私有响应、真实 Key、私有答案与整库副本。

## 7. 交付物

- ZIP：`D:/.A_C_code/PPALW/W4-D4/W4-D4-E-audit.zip`
- ZIP SHA-256：`22c12f4b4c183b03faf505c682bec36648c361c22d38675c45438b347df299b4`
- 哈希旁车：`manifests/W4-D4-E-zip.sha256`
- 本报告：`D:/.A_C_code/PPALW/W4-D4/W4-D4-E-交付报告.md`

未执行 `git add`、`git commit`、`git push`，未申请上传锁。
