# W4-D4 E 独立验证正文

状态：`BLOCKED / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

## 输入绑定

- HEAD 与 `origin/main`：`a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4`，一致。
- A：`4c52eb7c78fa80007aa9a8ab4e00768d71d3f3f5`。
- B：`56398ab5f44283e9c10b6d66ec2f0732cc043790`。
- D：`dc1693e5bfcc0bed226ff0f20613fc4b2ec88681`。
- C：`a896c4b219cccb0da256fdf7e5d1cb96ba41f7b4`。
- B revision 3 seal 共 78 项，asset tree 为 `d1438022a49f83df20fa865443c36f4c3442856c8b679aac989de9e61a3feb30`。
- D 录制响应共 14 条，SHA-256 为 `4dc9fae61d7d179947fe24ed661b5a6826484f9c27e79a0b2fc39a55a186061c`。
- A/B/C/D 输入均存在，未登记 `AUDIT_INPUT_INCOMPLETE`。

## V4 结论

| 门禁 | 状态 | 独立结论 |
| --- | --- | --- |
| V4-1 | PASS | 非法题组拒绝、程序判分通过。 |
| V4-2 | PASS | Schema、超时、provider 错误和 fallback 降级通过。 |
| V4-3 | PASS | 串行审核顺序和 Agent 越权拒绝通过。 |
| V4-4 | PASS | 正式 Evidence 白名单投影、unverified 保留和失败保留旧快照通过。 |
| V4-5 | BLOCKED | 两种真实 HTTP 轨迹和三处刷新检查已执行，但批准版 Python/Pandas 缺失，不能完成代码评测闭环；完成态总结及建路失败恢复合同也不完整。 |
| V4-6 | PASS | HTTP、DOM、bundle、审计日志、Agent 上下文和 Vite 直链未发现私有资产泄漏。 |
| V4-7 | PASS | 六类 14 条录制响应独立哈希、类别和顺序检查通过；`LIVE_NOT_RUN`。 |
| V4-8 | PASS | 六点卡片/题组 6/6、每组 4 题、阈值、重试去重、insufficient 和答案边界通过。 |

整体不得写 PASS。负责人需要先处理 V4-5 的环境和上游恢复合同，再复核签署。

## 命令证据

统一工作目录为 `D:\.A_C_code\PPALW\Pluggable-personalized-AI-learning-workstation\pi-study-helper`；`git diff --check` 在仓库根目录执行。时间为 ISO 8601 UTC，原始 stdout/stderr 位于仓库外 `W4-D4/raw/`。

| 命令 | 开始/结束 | 退出码 | 项数 | stdout / stderr SHA-256 | 结论 |
| --- | --- | ---: | --- | --- | --- |
| `npm.cmd run test:web -- --maxWorkers=1` | 01:06:53.028Z / 01:06:59.421Z | 0 | 10 文件，49 通过 | `84bdfaf4...55eaa8` / `e3b0c442...b855` | PASS |
| 真实 API 轨迹 | 01:06:59.422Z / 01:07:03.608Z | 0 | 1 文件，3 通过 | `3c2dac85...f58f5` / `e3b0c442...b855` | 覆盖阶段 PASS |
| V4 定向 | 01:07:03.609Z / 01:07:16.254Z | 0 | 12 文件，71 通过 | `30993bed...8cb` / `e3b0c442...b855` | PASS |
| 全量测试 | 01:07:16.254Z / 01:08:12.116Z | 1 | 81 文件通过、3 失败；692 通过、26 失败、1 跳过 | `b74a4ad8...9de0` / `08e3237d...fe2f` | ENVIRONMENT_MISMATCH |
| `npm.cmd run typecheck` | 01:08:12.116Z / 01:08:26.131Z | 0 | 三套 TS 配置 | `657f3a77...bd68` / `e3b0c442...b855` | PASS |
| `npm.cmd run check:docs` | 01:08:26.132Z / 01:08:26.500Z | 0 | 81 个 Markdown 项目 | `a3a3fc7c...e95` / `e3b0c442...b855` | PASS |
| `npm.cmd run build:web` | 01:08:26.501Z / 01:08:27.572Z | 0 | 47 modules | `e0e9c31d...0065` / `e3b0c442...b855` | PASS |
| `npm.cmd run verify` | 01:08:27.573Z / 01:09:38.597Z | 1 | 同一 3 文件/26 项环境失败 | `cb6a62c0...7ea6` / `6611457f...e033` | ENVIRONMENT_MISMATCH |
| `git diff --check` | 01:09:38.598Z / 01:09:38.664Z | 0 | 0 whitespace error | `e3b0c442...b855` / `e3b0c442...b855` | PASS |

完整哈希、命令文本、工作目录和毫秒时间见 `scripts/w4-e-validation/command-results.json`。

## 真实失败与归因

批准环境要求 Node `v22.23.1`、Python `3.13.7`、Pandas `3.0.5`。实际环境为 Node `v24.18.0`，`python.exe` / `python3.exe` 仅指向 WindowsApps 占位入口，Pandas 不可用。全量失败只出现在 `python-process-evaluation-r2.test.ts`、`python-process-evaluation.test.ts` 和 `w3-b-d1-delivery.test.ts`，归因 `ENVIRONMENT_MISMATCH`，E 未修改评测器或 B 资产。

固定端口 `127.0.0.1:4310` 被用户进程 `QQ.exe` PID `34036` 占用。E 未终止用户进程、未漂移端口，因此真实 Demo 截图登记 `PORT_OCCUPIED/BLOCKED`。DOM 语义、表单标签、状态区域、键盘可操作控件和响应式布局由 Web 测试及构建检查覆盖，但不冒充真实浏览器截图。

## 上游合同缺口

- A `NextStepOutput` 无安全 `reviewTimeline`，学习页只显示明确阻塞信息。
- A `SessionRecoverySafeView` 无诊断完成后的 `evidenceVersion`，建路请求失败后无法从 Bootstrap 重试。
- A 完成态 Bootstrap 无持久化总结和完整 KnowledgeState 投影，总结刷新只能显示活动进度并明确阻塞。
- 初始检查认为 quiz Attempt 题面不可恢复；E 通过真实 API 证明 `currentAttempt -> getNextStep -> openActivity` 会返回同一 Attempt 和相同 question IDs，因此该项由消费端安全恢复，不再作为独立上游阻塞。

## 安全边界

Vite root 为 `src/web`，只允许 Web 与公共 contracts，`/api` 代理固定至 `127.0.0.1:4310`。页面运行时代码无 mock 导入；生产 bundle 对私有答案文件名、private/rubric/reference-solution/hidden 路径、Key、系统提示和宿主绝对路径均为零命中。原始审计日志含测试诊断所需宿主路径，保留在仓库外且不进入 ZIP。
