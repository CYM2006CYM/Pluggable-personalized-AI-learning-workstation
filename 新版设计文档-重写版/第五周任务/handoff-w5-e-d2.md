# 岗位 E W5-D2 R2 交接单

状态：`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

正式基线为 `HEAD == origin/main == 127a71cce4a8423327fb5ce75d31294252b92a0b`。消费 A-D1 `0fd1f45386682a3859d8d9f6b37904b47ae98c33`、C-D1 `677f54c609ef3bfbe78ff6d37f6b432e9c68ff4d` 和 A-D2 `127a71cce4a8423327fb5ce75d31294252b92a0b`。

## R2 整改

- 命令结果现在记录实际 Node、npm、Python、Pandas、`PYTHONNOUSERSITE`，测试命令记录 test files 与 passed/failed/skipped/total；非测试命令统一标记 `NOT_APPLICABLE`。
- 运行期测试命令只记录稳定的 `<TEMP_RUNTIME_REPORT>` 占位路径；正式拟提交文件接受 JSON 转义后的宿主用户目录扫描，任何命中均阻止证据 PASS。
- 新增证据自校验，缺失统计、退出码冲突、报告统计不一致、运行期证据缺失、范围混入、ZIP/sidecar/Manifest 不闭合均返回非零。
- 运行期安全结论来自实际 ActivityPage 聚焦测试和 Edge/CDP Worker 网络捕获，不再写死布尔结论。未实测项只能登记 `NOT_RUN`，不能汇总为 PASS。
- 截图索引只消费本轮 `evidence/d2-r2/` 实际捕获结果；每项包含 URL、viewport、等待条件、DOM 投影、PNG 哈希及捕获记录引用。
- 正式 Git 拟提交、AUDIT_ONLY 和 ZIP 清单已分离。W5-D1 历史材料和 PNG 不进入正式 Git 清单；PNG 只作为本轮 AUDIT_ONLY 交付证据进入 ZIP。
- R2 ZIP 使用唯一文件名，生成同名 `.sha256` sidecar，包内 Manifest、ZIP 清单、文件数、大小和哈希接受机械复验。

## 保持不变

已通过的 Web 实现未在 R2 重做。`/study` 安全深链、草稿版本绑定、Worker 取消/超时/UTF-8 输出限制/销毁重建及 Pyodide 不可用降级继续由既有 Web 测试覆盖。预览不可用时，“提交正式评测”仍独立可用。

`PYODIDE_CANDIDATE_UNAVAILABLE`，未新增 CDN、网络加载器、依赖或本地运行时资产。`LIVE_MODEL=LIVE_NOT_RUN`。本轮不声明 D3 双后端裁决、D4 Web/TUI 跨端闭环、服务重启闭环、三个正式案例或 W5 PASS。

结构化命令结果、安全报告、截图索引、测试映射、限制、上游绑定、三类范围清单和 Manifest 位于 `pi-study-helper/scripts/w5-e-validation/`。首次失败、Node 24 失败和最终复验历史保留在命令结果中。

负责人接管修复后的首次封包在仅提供 `pwsh` 的环境中因脚本硬调用 `powershell` 而失败；封包器已改为显式探测 `pwsh` / `powershell` 并保留真实启动错误，随后重新执行完整包级复验。

未取得负责人明确授权，不执行 `git commit`、`git push`、强推或申请上传锁。
