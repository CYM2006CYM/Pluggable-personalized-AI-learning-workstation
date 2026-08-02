# C岗位第二周最终交接清单

## 1. 基线与合同

- `W2_START_COMMIT`: `f343a6c1c630f362f4686e6f6b0f50c6577d5562`
- 拉取后的实际 HEAD: `c46f8bb13dc3bbb4c2140bbded0156c3c4994076`
- `origin/main`: `c46f8bb13dc3bbb4c2140bbded0156c3c4994076`
- 合同: `W2-C2/W2-R5`
- D33补充裁决: `W2-V2-3-ENV-1`
- D5正式绑定提交: `fa26097e46a72a2826d960a7e1934a8885098112`

## 2. 冻结绑定

- 67项冻结文件：67/67 PASS，缺失 0，不一致 0。
- 资产树：`07fb50caf5cfd646654cedf5c038f836bbbede912c6034f4e3523deaf77183ab`。
- `final-60`：`b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c`。
- manifest JCS：`39a16ca7e2d7af92b327f7417d0732e79a30ea16826b08c44bf3b26c3b4ddc3b`。
- 诊断摘要 JCS：`a6000080559dbc9a12f269f8d0bd8b10d9dfd1835cdf57fda0c33939ece11e88`。
- D4报告规范化 SHA-256：`d945c2456d001f4e62252d3e425b96df1c5f34dc4e161a9d56fd3932760ad014`。
- 负责人确认上述 67 项、资产树和 `final-60` 内容未变化。

## 3. D33环境裁决与豁免

- 审计 pandas 固定为 `3.0.5`；Python 和平台仅登记负责人实际证据，不冻结最终产品环境。
- pandas `2.3.3` 阻断由负责人独立执行：退出码 `2`，状态 `BLOCKED/BLOCKED`，唯一分类 `environment_mismatch`，blocker 非空，未产生 B 资产缺陷或负 Evidence。
- 负责人豁免 C 新增正式版本不匹配负向作者测试；该结果不得写成 C 作者测试已执行。
- 负责人在 Python `3.13.14`、pandas `3.0.5` 独立环境中的完整 V2-3 PASS 继续有效；负责人豁免 C 重复执行，不得写成 C 已重新运行。

## 4. 精确 Git 上传清单

正式 Git 只暂存以下 10 个 C 授权文件：

1. `pi-study-helper/scripts/w2-data-validation/audit_manifest.py`
2. `pi-study-helper/scripts/w2-data-validation/audit_v23.py`
3. `pi-study-helper/scripts/w2-data-validation/bind_formal_commit.py`
4. `pi-study-helper/scripts/w2-data-validation/validation-matrix.json`
5. `pi-study-helper/scripts/w2-data-validation/matrix-self-check.mjs`
6. `pi-study-helper/scripts/w2-data-validation/test_audit_v23.py`
7. `pi-study-helper/scripts/w2-data-validation/test_formal_binding.py`
8. `pi-study-helper/scripts/w2-data-validation/v2-3-final-report.md`
9. `pi-study-helper/scripts/w2-data-validation/handoff-w2-c.md`
10. `pi-study-helper/scripts/w2-data-validation/requirements-w2-v23.txt`

`audit_v23.py`、`requirements-w2-v23.txt`、本报告和本交接清单的最终 SHA-256 统一登记在仓库外 `C-W2-D33-final-hash-inventory.txt`；ZIP、sidecar、临时运行输出、缓存、完整仓库副本、B资产、gold及其他岗位文件不进入 Git。

## 5. 复现与状态

- 副本已执行 `git pull --ff-only origin main`，实际 HEAD 为 `c46f8bb13dc3bbb4c2140bbded0156c3c4994076`。
- 已执行 `git diff --check`；正式仓库上传前必须再次执行并核对精确清单。
- Profile 保持 `draft`；未修改 B 资产、gold、SDK、`package.json`、`package-lock.json` 或 `environment-lock.json`。
- 未重复执行被负责人豁免的完整 V2-3；未新增被负责人豁免的正式负向作者测试。
- 获锁后只提交上述 10 个文件；push 后立即报告提交号并释放上传锁。
