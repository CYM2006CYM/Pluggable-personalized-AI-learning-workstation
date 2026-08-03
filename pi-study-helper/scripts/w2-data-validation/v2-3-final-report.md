# C岗位 W2-D5 V2-3 正式交付与 D33 收口报告

## 1. 结论

结论为 `V2-3_BINDING_PASS / C_D5_DELIVERY_READY / C_D33_STEPS_1_5_PASS`。

D4 完整 V2-3 已绑定正式 Git 提交 `fa26097e46a72a2826d960a7e1934a8885098112`。负责人已独立确认 D33 第1-5项环境阻断整改通过。本报告保留 D4/D5 原始命令、结果和历史验证计数，并在独立章节登记 D33 负责人复验与豁免；D33 收口不覆盖原 D5 证据。

## 2. 正式绑定结果

| 检查项 | 结果 |
|---|---|
| 合同 | `W2-C2/W2-R5` |
| D33补充裁决 | `W2-V2-3-ENV-1` |
| `W2_START_COMMIT` | `f343a6c1c630f362f4686e6f6b0f50c6577d5562` |
| D5正式绑定提交 | `fa26097e46a72a2826d960a7e1934a8885098112` |
| D33文档修正基线 | `fdca992c8b6df4f9ce6c1342eb7958ef1bef6c35` |
| 冻结文件 | 67/67 一致，缺失 0，不一致 0 |
| 资产树 SHA-256 | `07fb50caf5cfd646654cedf5c038f836bbbede912c6034f4e3523deaf77183ab` |
| `final-60` SHA-256 | `b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c` |
| manifest JCS SHA-256 | `39a16ca7e2d7af92b327f7417d0732e79a30ea16826b08c44bf3b26c3b4ddc3b` |
| 诊断摘要 JCS SHA-256 | `a6000080559dbc9a12f269f8d0bd8b10d9dfd1835cdf57fda0c33939ece11e88` |
| D4报告规范化 SHA-256 | `d945c2456d001f4e62252d3e425b96df1c5f34dc4e161a9d56fd3932760ad014` |

负责人确认 B 冻结67项、资产树和 `final-60` 内容未变化，不触发 B 资产重建、gold 重新冻结或已有标注作废。

## 3. D4完整V2-3原始执行链与结果

以下命令按 D4 整改复审报告原记录保留。`audit-tools`、`audit-input` 和 `audit-output` 是当时仓库外审计目录，不是当前 Git 依赖。

```powershell
python .\audit-tools\audit_manifest.py --outer .\audit-input\received-package.zip --extract-root .\audit-input\candidate --output .\audit-output\manifest-audit.json --expected-manifest-jcs 39a16ca7e2d7af92b327f7417d0732e79a30ea16826b08c44bf3b26c3b4ddc3b
python -m unittest discover -s .\audit-tools -p 'test_*.py'
python .\audit-tools\audit_v23.py --profile-root .\audit-input\candidate\pi-study-helper\fixtures\profiles\pandas-cleaning-v2-draft --manifest-audit .\audit-output\manifest-audit.json --output .\audit-output\v23-audit.json
python .\audit-tools\compare_remediation.py --old-root ..\C-W2-D4-audit-f343a6c-20260801-144142\audit-input\candidate --new-root .\audit-input\candidate --old-v23 ..\C-W2-D4-audit-f343a6c-20260801-144142\audit-output\v23-audit.json --new-v23 .\audit-output\v23-audit.json --candidate-evidence .\audit-input\candidate\pi-study-helper\fixtures\profiles\pandas-cleaning-v2-draft\quality\c-execution-evidence.json --rerun-evidence .\audit-output\b-candidate-evidence-rerun.json --output .\audit-output\remediation-comparison.json
python .\audit-input\candidate\pi-study-helper\fixtures\profiles\pandas-cleaning-v2-draft\quality\run-candidate-evidence.py --output .\audit-output\b-candidate-evidence-rerun.json
npm.cmd test -- tests/pandas-cleaning-v2-assets.test.ts --maxWorkers=1
```

| D4检查 | 退出码 | 原始结果 |
|---|---:|---|
| manifest/资产树复算 | 0 | 6项载体、67项候选全部通过 |
| C作者测试 | 0 | 11/11 |
| 完整V2-3 | 0 | 33次参考执行、9次完整清洗、21次错误矩阵 |
| 新旧整改差异 | 0 | 仅3项变化；数据与结果不变；敏感扫描0命中 |
| B v5候选证据重跑 | 0 | 11组基线稳定；错误实现全部拒绝 |
| B资产作者测试 | 0 | 1文件、10/10 |

## 4. D5正式绑定与最小复现

以下命令从副本仓库根执行。D4载体和D4报告是仓库外只读输入，两个JSON输出到仓库外证据目录，不进入Git。

```powershell
$evidenceDir = '..\C-W2-D5-evidence-fa26097e-remediation'
python .\pi-study-helper\scripts\w2-data-validation\bind_formal_commit.py --repo-root . --commit fa26097e46a72a2826d960a7e1934a8885098112 --carrier <D4整改审计载体.zip> --d4-report <D4整改复审报告.md> --output "$evidenceDir\formal-binding.json"
python .\pi-study-helper\scripts\w2-data-validation\audit_v23.py --profile-root .\pi-study-helper\fixtures\profiles\pandas-cleaning-v2-draft --manifest-audit "$evidenceDir\formal-binding.json" --output "$evidenceDir\v23-formal.json"
python -m unittest discover -s .\pi-study-helper\scripts\w2-data-validation -p "test_*.py" -v
```

正式绑定命令退出码0，67/67一致。D5最小V2-3命令退出码0：公开CSV 1份、私有变体2份各连续运行3次，共9次完整清洗；33次参考执行稳定；5份已知错误实现、21次fixture/repeat检查和27次测试拒绝全部通过。

## 5. D5历史作者测试与受影响回归

下表是 D33 之前已经完成并记录的 D5 原始验证结果，本轮 D33 文档修正未重新执行这些命令。

| 命令 | 退出码 | 原始结果 |
|---|---:|---|
| `node .\pi-study-helper\scripts\w2-data-validation\matrix-self-check.mjs` | 0 | PASS |
| `python -m unittest discover -s .\pi-study-helper\scripts\w2-data-validation -p "test_*.py" -v` | 0 | 22/22 |
| `npm.cmd test -- tests/pandas-cleaning-v2-assets.test.ts --maxWorkers=1` | 0 | 1文件、10/10 |
| `npm.cmd run verify` | 0 | 37文件、389/389；typecheck、文档链接、extension smoke、release check通过 |

npm命令在 `pi-study-helper` 包目录执行。上述22/22、10/10和389/389是原D5验证记录，不是D33阶段重新运行结果。

## 6. D33环境阻断与负责人豁免

- 负责人独立复核结论：`C_D33_STEPS_1_5_PASS`。
- `W2_V2_3_AUDIT_PANDAS_VERSION = 3.0.5`。
- 负责人在 pandas `2.3.3` 环境独立执行负向复验：入口在读取 manifest、Profile、CSV、参考实现、测试或其他B资产前停止，退出码为2；输出 `status=BLOCKED`、`v23Status=BLOCKED`，唯一分类为 `environment_mismatch`，blocker非空。
- 该负向结果未产生 `b_asset_defect`、`c_validator_defect`、学习者错误或负Evidence。
- 负责人豁免C新增正式版本不匹配负向作者测试；上述负向结果是负责人独立复验证据，不写成C作者测试已执行。
- 负责人在Python `3.13.14`、pandas `3.0.5`独立环境中的完整V2-3 PASS继续有效，并豁免C重复执行；本轮不写成C已重新运行。

## 7. 哈希、环境与范围

`audit_v23.py`、`requirements-w2-v23.txt`、本报告和 `handoff-w2-c.md` 的最终SHA-256登记在仓库外 `C-W2-D33-final-hash-inventory.txt`，该文件不进入Git。

- Profile保持`draft`；`W2-V2-3-ENV-1`仅是第二周临时审计基线，不是最终产品运行环境或Profile最终环境锁。
- 未修改B资产、gold、SDK、`package.json`、`package-lock.json`或Profile `environment-lock.json`。
- 本报告不替代V2-2，不授予Profile active，不覆盖V2-7、V2-8、gold冻结或真实Python沙箱。
