# W5-D3 B 验证报告

## 结论

- 合同：`W5-C1/W5-R1`
- 正式上游：C提交`6acc56fa03986797be54156af639a905c2e74a64`
- 负责人裁决：`W5-D64-PYODIDE-1 / PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- 当前结论：`B_D3_CANDIDATE_PASS`
- Git状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 环境锁与seal

- C实测与现行revision 3锁逐字段一致，B裁决为`NO_PROFILE_BYTE_CHANGE_REQUIRED`；
- 环境锁原始SHA-256：`59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43`；
- `environmentHash`记录值与规范重算值均为`sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76`；
- `status=measured_node_submit`，`pyodideVersion=null`，未写`measured_dual_backend`；
- `processTreeTermination=true`只采用C的PID级实测；`networkIsolation=false`、`reliableMemoryLimit=false`保持未证明；
- revision 3 seal排除自身后为78项，复算值与现行值均为`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`；
- revision 2为71文件，逐字节树摘要仍为`2a4538272cc47a3451b434999d620f429e5deaa0eb0f2c3f95fa76e53d80786d`；
- Profile环境锁和seal均未产生Git差异。

## 三案例

- 已提供高基础、非计算机初学者、实践导向三类输入；
- 三案使用同一`pandas-cleaning` revision 3、同一seal、同一目标、同一推荐入口、同一400分钟预算；
- 每个输入在两个全新数据目录完成一次固定诊断重放，三案均得到两次一致的确定性状态摘要；
- 三组两两差异矩阵每对4项假设，全部标记为预期；
- 未在B交付中保存实际路径、KnowledgeState、Evidence、mastery或实际难度；
- 后续状态：`A_PATHENGINE=PENDING / E_INDEPENDENT_REVIEW=PENDING`。

## 命令结果

- B合同验证器：PASS；
- 定向与受影响回归：`5 files / 29 tests PASS`；
- 类型检查：PASS；
- 文档检查：`94`个项目Markdown文件，PASS；
- Web构建：PASS；
- extension smoke：PASS；
- release check：PASS；
- 最终合同环境全量verify：`102 files / 841 passed / 1 skipped / 0 failed`。

结构化起止时间、退出码及stdout/stderr SHA-256见`command-results.json`。

## 保留的历史失败

1. 首次定向命令误用Vitest不支持的`--runInBand`且shell解析到Node 24，未进入测试；
2. 合同npm目录缺失内部`node-gyp`模块，首次聚合包装命令在执行子命令前失败；后续仅通过`NODE_PATH`引用机器上既存模块，未安装或修改依赖；
3. 首次全量使用错误Python 3.13.14/Pandas 2.3.3，产生环境不匹配；
4. 第二个Python 3.13.7虚拟环境的标准库编码文件损坏，仍不能作为合同环境；
5. extension smoke曾单次30秒超时，独立复验及最终聚合verify均通过。
6. 首次隔离候选`git diff --check`发现PPT头两行行尾空格；修正后复验通过，首次输出保留在`diff-check.json`。

这些失败均保留在`command-results.json`，没有改写为PASS。最终结论只绑定可正常导入Pandas 3.0.5的既存合同Python 3.13.7、Node 22.23.1、npm 10.9.8和`PYTHONNOUSERSITE=1`。

## 未证明和后续责任

- Pyodide十组仍为`NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`；
- `LIVE_MODEL=LIVE_NOT_RUN`；
- 本交付不证明D4实际三路径差异、页面关闭态、Web/TUI正式闭环或W5 GO；
- A必须用正式PathEngine生成并绑定实际路径/状态输出；
- E必须独立复验路径合法性、每对至少三项差异和页面证据。
