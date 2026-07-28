# E岗位第六天泄漏扫描清单

## 扫描边界

按 W1-C4，仓库与本地安装包允许包含运行时受限资产；不得把 `private`、`hidden`、`reference-solutions` 的存在本身判为泄漏。扫描目标是其进入非授权运行时表面。

| 敏感类别 | 禁止出现的表面 | 本次方法 | 结果 |
|---|---|---|---|
| 诊断答案、权重 | 安全 DTO、HTTP、浏览器、Worker、Pyodide、普通 Agent/日志 | Profile 公共表面测试、Facade/评测安全投影和 Agent 上下文测试 | PASS |
| 隐藏测试及断言 | 同上 | 资产分层、评测协议与安全投影测试 | PASS |
| 参考实现、已知错误实现、完整 Rubric | 同上 | 非私有候选表面扫描、Agent 输入/输出测试 | PASS |
| API 密钥 | 跟踪文件、发布检查、普通输出 | `check:release` | PASS |
| 私有原始交互代码/学习数据 | Git 历史与公开运行时表面 | `check:history` 与安全投影测试 | PASS |
| 宿主绝对路径 | DTO、评测 fixture、Agent trace/checkpoint、日志 | 路径拒绝与 redaction 测试 | PASS |

## 安装包完整性

执行 `npm.cmd pack --dry-run --json`，确认运行时需要的 Profile/评测资产完整、路径正确。结果中出现 27 条受限资产路径符合 W1-C4，不记为泄漏。

## 延期项

第一周没有 HTTP 服务、浏览器页面、Worker 或 Pyodide 公开包。对应真实响应/Bundle 扫描标记为 `NOT_IMPLEMENTED / DEFERRED_TO_INTEGRATION`，在集成周重新执行，不把未实现表面虚报为 PASS。
