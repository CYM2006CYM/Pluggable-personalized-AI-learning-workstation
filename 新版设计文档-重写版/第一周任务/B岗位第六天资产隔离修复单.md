# B 岗位第六天资产隔离修复单

- 前置：A 已上传发布 / 消费边界说明。
- 顺序：**第 2 步；仅在拉取 A 后开始，完成并上传后 C 才可开始。**
- 验收依据：仅第一周 D01—D14；D15—D20 不追溯适用。

## 任务

按 A 冻结的边界重整 B 所有的资料包分层，使可打包 / 可公开表面不包含受限资产，同时保留 C 经授权评测所需的确定性输入。

必须隔离出发布包的内容：

- 诊断与 fallback 的 answer key；
- `assessments/private` 下的隐藏测试、私有 test case 与 task bundle；
- `datasets/private`；
- `reference-solutions`；
- 完整 Rubric 和任何能还原隐藏判定的私有材料。

允许保留的仅为 A 已书面确认的公开学习内容、公开数据和公开测试投影。不得更改专业事实、评分、Profile 公共字段或 C 的评测协议。

## 交付与验收

- 交付：资产目录 / 打包规则变更、C 可消费的受控私有资产位置说明。
- 最小验证：Profile v2 schema、pandas assets 测试、`npm.cmd pack --dry-run`。
- 通过标准：tarball 不列出任何上述受限路径；公开 Profile 仍可加载且维持 draft 状态；C 能获得一份不泄漏的授权资产清单。

上传后通知 C 拉取；E 不修改 B 资产正文。
