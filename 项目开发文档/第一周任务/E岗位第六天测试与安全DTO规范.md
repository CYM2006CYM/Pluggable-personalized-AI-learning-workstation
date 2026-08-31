# E岗位第六天测试、fixture 与安全 DTO 规范

## 命名与目录

- 测试文件：`tests/<contract-or-surface>.test.ts`；仅断言已冻结合同。
- HTTP fixture：`pi-study-helper/fixtures/http/`；第一周仅保存安全响应示例和命名说明，不实现 HTTP 服务。
- 安全视图 fixture：`pi-study-helper/fixtures/safe-views/`；只含允许字段白名单投影，禁止复制完整资产对象。
- 临时运行目录：使用测试框架临时目录；不得提交 trace、`.jsonl`、本地会话、密钥或宿主路径。
- 人工标准：只记录版本、来源 ID、审阅人和结论；答案、完整 Rubric 与隐藏断言保持在运行时受限资产中。

## 安全 DTO 规则

安全 DTO 采用允许字段白名单构造，只可包含题面、学习者可见说明、起始代码、公开数据、公开测试、安全反馈，以及合同规定的请求/会话/版本元数据。

不得通过“先序列化完整对象、再删除字段”生成响应。以下内容默认禁止进入任何安全 DTO：正确答案与权重、隐藏测试及断言、私有 CSV、参考/已知错误实现、完整 Rubric、内部评分细节、API 密钥、宿主绝对路径和学习者原始答案。

## 第一周状态

`fixtures/http/` 与 `fixtures/safe-views/` 已建立为安全数据目录。它们是契约/fixture 准备，不代表第一周已经实现 HTTP、浏览器、Worker 或 Pyodide。
