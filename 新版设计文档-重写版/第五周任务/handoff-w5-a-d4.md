# 岗位A W5-D4 R2 负责人代整改交接单

状态：`PASS_A_SCOPE_E_INDEPENDENT_REVIEW_PENDING / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 正式绑定

- 合同：`W5-C1/W5-R1`
- 基线/B D3：`a0d5a37116a6c67f009ca19e313501d9eed96f78`
- A D2：`127a71cce4a8423327fb5ce75d31294252b92a0b`
- E D2：`590985af616861e503ee30f2bf56c6392b0055f7`
- C D3：`6acc56fa03986797be54156af639a905c2e74a64`
- revision 3 seal：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- 环境锁SHA-256：`59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43`
- Pyodide：`PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- `LIVE_MODEL=LIVE_NOT_RUN`

## 跨端闭环

`ActivityAttemptSafeView`只增加可选的`evidenceId/evidenceVersion`安全引用。代码与题组Attempt读取均从已提交服务端事实投影，不下发Evidence正文，也不建立第二套Facade。

已实测：

1. `TUI → Web正式提交 → runtime重启 → TUI`读取同一session、Attempt、Evidence ID/版本和下一步；
2. `Web打开 → TUI正式提交 → Web刷新`读取同一session、Attempt和Evidence ID/版本；
3. 两条轨迹均使用共享干净数据目录；pending只在`committed=true`后清理；
4. CAS、幂等、无替代session、无额外Evidence和失败恢复回归通过。

## 三案例交给E

- 输入仍为B正式提交的三类输入，未修改；
- A实际输出：`pi-study-helper/scripts/w5-a-d4/showcase-path-results.json`；
- 两两差异：`showcase-differences.json`；
- 差异数：`32 / 12 / 21`；
- 每个案例绑定输入SHA-256、revision 3 seal、实际路径SHA-256和规范输出SHA-256。

E必须独立复验路径合法率100%、每对至少三项实际差异和页面展示。不得直接把A结果标成E PASS，也不得手改路径或Evidence。

## 验证

- 合同环境定向：`6 files / 29 passed`；
- 最终全量：`105 files / 846 passed / 1 skipped / 0 failed`；
- typecheck、docs、Web build、extension smoke、release：PASS；
- A原非合同环境失败和负责人首轮单次evaluator超时均保留在结构化命令结果中。
- Manifest使用`utf8-lf-v1`规范化哈希；Windows `core.autocrlf=true`检出的CRLF文件与Git中的LF blob按同一内容验证。

## 禁止与后续

本轮未修改`src/web`、Profile、环境锁、执行器、SDK、依赖、gold或私有评测资产。E后续负责关闭态页面、三案例页面证据、完整故障注入与独立V5复验；本交付不声明完整V5或W5 GO。
