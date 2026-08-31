# W5-D3 B 交接单

## 状态与绑定

- 合同：`W5-C1/W5-R1`
- C正式上游：`6acc56fa03986797be54156af639a905c2e74a64`
- 负责人裁决：`W5-D64-PYODIDE-1`
- Pyodide：`PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- Profile：`pandas-cleaning` revision 3
- revision 3 seal：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- 权限：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 交付给A

1. 三类输入位于`evaluation/showcases/`，均为公共字段和公开诊断作答；
2. 输入哈希位于`pi-study-helper/scripts/w5-b-d3/showcase-input-bindings.json`；
3. A必须在正式提交后拉取本交付，用正式`DiagnosticRuntime`和`PathEngine`生成实际KnowledgeState、路径及输出哈希；
4. A不得把`w5-d3-expected-differences.json`复制为实际结果，也不得为满足矩阵手工改路径、难度、Evidence或mastery；
5. 若实际差异少于每对三项，应提交真实输出和最小复现给负责人裁决，不得修改案例答案、Rubric、先修或最终实操。

## 交付给E

1. D4只消费A正式生成的实际路径/状态输出，不直接把B的预期矩阵画成页面证据；
2. 独立验证三条路径合法率100%、每对至少三项可观察差异；
3. 按关闭裁决移除预览死入口和双后端误导文案，保持Node正式提交可用；
4. 页面和浏览器证据不得包含私有答案、hidden tests、Rubric正文、reference solution或宿主路径。

## 环境和Profile结论

- C的正式测量与现行环境锁逐字段一致，正确动作是保持Profile字节不变；
- `environment-lock.json` SHA-256仍为`59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43`；
- revision 3 seal已独立复算为78项且与现行值一致；
- revision 2逐字节不变；
- `networkIsolation=false`、`reliableMemoryLimit=false`，不得升级为true；
- Pyodide不得写`PASS`或`measured_dual_backend`。

## 验证摘要

- 三案例双目录诊断重放：PASS；
- 定向：`5 files / 29 tests PASS`；
- 最终全量：`102 files / 841 passed / 1 skipped / 0 failed`；
- typecheck、docs、Web build、extension smoke、release：PASS；
- 首次命令、npm内部模块、错误Python、损坏Python和单次smoke超时均作为历史失败保留；
- 详细证据见`pi-study-helper/scripts/w5-b-d3/`。

## 边界

本交付不是D4实际路径验证、不是E页面验证、不是Pyodide启用、不是在线模型验证，也不是W5 GO。`LIVE_MODEL=LIVE_NOT_RUN`保持不变。
