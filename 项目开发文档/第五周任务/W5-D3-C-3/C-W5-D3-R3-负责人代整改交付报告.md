# W5-D3-C R3 负责人代整改交付报告

- 合同：`W5-C1/W5-R1`
- 基线：`383690831a8b3de42dad58795e71f218678f6fbc`
- 裁决：`W5-D64-PYODIDE-1 / PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- `PYODIDE_ENABLED=false`
- `LIVE_MODEL=LIVE_NOT_RUN`
- 状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 代整改内容

1. 删除R2最终候选对缺失R1测试`w5-c-d3-node-measurement.test.ts`的现行依赖，保留其历史失败记录。
2. 三项作者测试默认只断言、不写正式证据；仅正式采集器通过显式输出路径生成证据。
3. `command-results.json`由精确26项候选和负责人合同环境重新生成，不消费主工作区残留文件。
4. R2的换行敏感raw-binary seal失败登记为checkout环境归因，不再错误归因为B资产回归。
5. 安全扫描覆盖24项可扫描正式文件、30份审计日志和1份包内交付报告，共55个文件表面。
6. 组包入口固定执行：安全扫描、Manifest重建、Manifest验证、组包、解包后再次验证。
7. 普通全量测试前后三份正式证据SHA-256保持不变，不再污染Manifest。

## 独立复验结果

- 真实HTTP公开执行包：1文件 / 5测试；5个代码活动各2组，共10组；每组Node连续3次，共30次；字段一致10/10。
- Pyodide：10/10均为`NOT_RUN / PYODIDE_CANDIDATE_UNAVAILABLE`。
- Windows进程树：受控runner创建子进程并记录PID；正式超时后PID不存在，`processTreeTermination=true`有实测证据。
- 故障矩阵：超时、输出限制、临时目录、磁盘失败、环境/版本/资产冲突、幂等重放、服务重启和`/run`/`/submit`边界通过。
- 定向复验：6文件 / 37通过 / 0失败。
- 全量：98文件 / 824通过 / 1跳过 / 0失败。
- `typecheck`、`build:demo`、`build:web`、`check:docs`、`smoke:extension`、`check:release`全部退出0。
- 隔离候选差异检查：26/26文件覆盖，退出0。
- 安全扫描：55文件，0命中。
- Manifest：25个文件逐字节匹配，`manifest.json`为唯一selfExcluded。
- 最终阶段解包后Manifest再次验证：PASS。

## 环境和冻结绑定

- Node：`v22.23.1`
- npm：`10.9.8`
- Python：`3.13.7`
- Pandas：`3.0.5`
- `PYTHONNOUSERSITE=1`
- revision 3环境锁SHA-256：`59917d1528d031f46a1e76359d99628e810f2dfa78a92d66e03386c860fbaf43`
- revision 3 `assetTreeSha256`：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- environmentHash：`sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76`
- revision 2、Profile环境锁、revision seal、Rubric、hidden tests、reference solution、gold、SDK和依赖均未修改。

## 交付包

- ZIP：`C-W5-D3-formal-candidate-3836908-r3.zip`
- ZIP SHA-256：`0bf3f6318f71839c1c86f2de34ff725ae03b81c25dc89500324d0ff81165e2fc`
- sidecar：`C-W5-D3-formal-candidate-3836908-r3.zip.sha256`
- 正式Git拟提交：26项，见包内`pi-study-helper/scripts/w5-c-d3/proposed-files.txt`
- `AUDIT_ONLY / NOT_FOR_GIT`：包内`delivery-report.md`、`hash-inventory.txt`、`manifest-verification.json`和`logs/`

本报告和ZIP只形成负责人代整改候选，不构成commit、push、Profile激活、W5 GO或上传锁授权。
