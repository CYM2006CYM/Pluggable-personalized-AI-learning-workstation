# C岗位 W2-D5 V2-3 最终报告

## 1. 最终结论

结论：`C_D33_STEPS_1_5_PASS`。

负责人已按 `W2-C2/W2-R5` 和 `W2-V2-3-ENV-1` 独立复核 D33 第1-5项。负责人确认 pandas 审计版本固定为 `3.0.5`；在 pandas `2.3.3` 时，入口在读取 manifest、Profile、CSV、参考实现、测试或其他 B 资产前停止，退出码为 `2`，输出 `status=BLOCKED`、`v23Status=BLOCKED`、唯一分类 `environment_mismatch` 和非空 blocker。

本报告明确：上述阻断是负责人独立负向复验证据，不是 C 作者测试结果。负责人豁免 C 新增正式版本不匹配负向作者测试；负责人在 Python `3.13.14`、pandas `3.0.5` 独立环境中的完整 V2-3 PASS 继续有效，负责人豁免 C 重复执行完整 V2-3。本轮不把豁免项目写成 C 已执行。

## 2. 正式绑定与冻结内容

| 项目 | 结果 |
|---|---|
| 合同 | `W2-C2/W2-R5` |
| D33补充裁决 | `W2-V2-3-ENV-1` |
| W2_START_COMMIT | `f343a6c1c630f362f4686e6f6b0f50c6577d5562` |
| 拉取后的实际 HEAD | `c46f8bb13dc3bbb4c2140bbded0156c3c4994076` |
| D5正式绑定提交 | `fa26097e46a72a2826d960a7e1934a8885098112` |
| 冻结文件 | 67/67 一致，缺失 0，不一致 0 |
| 资产树 SHA-256 | `07fb50caf5cfd646654cedf5c038f836bbbede912c6034f4e3523deaf77183ab` |
| `final-60` SHA-256 | `b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c` |
| manifest JCS SHA-256 | `39a16ca7e2d7af92b327f7417d0732e79a30ea16826b08c44bf3b26c3b4ddc3b` |
| 诊断摘要 JCS SHA-256 | `a6000080559dbc9a12f269f8d0bd8b10d9dfd1835cdf57fda0c33939ece11e88` |
| D4报告规范化 SHA-256 | `d945c2456d001f4e62252d3e425b96df1c5f34dc4e161a9d56fd3932760ad014` |

负责人确认 B 冻结 67 项、资产树和 `final-60` 内容未变化，不触发 B 重建、gold 重冻或标注作废。

## 3. 复现记录与豁免边界

副本拉取确认命令：

```powershell
git pull --ff-only origin main
git status --short
git diff --check
```

历史 D4 完整 V2-3 命令和 D5 正式绑定命令保留在本目录既有交付记录中；本轮不重新执行。负责人独立复验环境为 Python `3.13.14`、pandas `3.0.5`；C 本轮未重新运行完整 V2-3，也未将负责人结果冒充 C 作者测试。

## 4. 文件哈希登记

`audit_v23.py`、`requirements-w2-v23.txt`、本报告和 `handoff-w2-c.md` 的最终 SHA-256 统一登记在仓库外收口证据 `C-W2-D33-final-hash-inventory.txt`，计算规则为 UTF-8、LF、无 BOM。该证据不进入 Git。

## 5. 范围与限制

- Profile 保持 `draft`；`W2-V2-3-ENV-1` 仅为第二周临时审计基线，不是最终产品环境锁。
- 未修改 B 资产、gold、SDK、`package.json`、`package-lock.json` 或 Profile `environment-lock.json`。
- 未新增正式版本不匹配负向作者测试；未重复执行 pandas 3.0.5 完整 V2-3；两项均为负责人豁免。
- V2-2、V2-7、V2-8、gold 冻结和真实 Python 沙箱不属于本次 C 结论。
