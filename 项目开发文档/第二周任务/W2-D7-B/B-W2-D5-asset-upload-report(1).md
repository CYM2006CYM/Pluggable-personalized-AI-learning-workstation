# B 岗 W2-D5 第一段正式资产上传回执

上传锁状态：已完成上传并释放。

## 提交与远端

- 正式提交：`fa26097e46a72a2826d960a7e1934a8885098112`（`B: publish W2 D5 frozen revision 2 assets`）
- `origin/main`：`fa26097e46a72a2826d960a7e1934a8885098112`
- 推送方式：普通 `git push origin main`，未强推。
- 上传锁释放时间：2026-08-02 13:38:52 +08:00

## 冻结与验证结果

- D4 manifest 67 项规范化复核：PASS。
- 资产树 SHA-256：`07fb50caf5cfd646654cedf5c038f836bbbede912c6034f4e3523deaf77183ab`
- `final-60.jsonl` SHA-256：`b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c`
- D4 候选 ZIP SHA-256：`c5164ae60834197e2b57c5a9d323754578fb530eb83bdb75bf19605864db526d`
- B 作者测试：PASS，1 文件 / 10 测试。
- typecheck：PASS。
- 全量测试：PASS，37 文件 / 389 测试。
- Extension 冒烟：PASS。
- 提交前 `git diff --cached --check`：PASS。

## 实际上传文件（47 项）

```text
A evaluation/personas/build-w2-cases.mjs
A evaluation/personas/development-20.jsonl
A evaluation/personas/final-60.jsonl
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/activities/learning-activities.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/diagnostic/private/answer-key.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/diagnostic/questions.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/known-wrong/wrong-structure.py
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/task-bundles.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/test-cases.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-practical-hidden-02.py
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-structure-hidden.py
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/public/test-cases.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/public/tests/test-structure-public.py
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/public/tests/test-types-public.py
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/quiz-fallback/private/answer-key.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/quiz-fallback/questions.json
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/01-foundations/01-structure.md
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/01-foundations/02-missing.md
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/02-normalization/01-duplicates.md
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/02-normalization/02-types.md
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/03-validation/01-invariants.md
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/03-validation/02-engineering.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/cards/basic-python-remediation.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/chapter-01-data-entry-and-inspection/section-01-read-csv.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/chapter-01-data-entry-and-inspection/section-02-inspect-dataframe.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/chapter-02-cleaning-issues/section-01-missing-values.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/chapter-02-cleaning-issues/section-02-duplicate-orders.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/chapter-03-format-and-validation/section-01-type-format-cleanup.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/chapters/chapter-03-format-and-validation/section-02-validate-result.md
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/datasets/fixtures.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/datasets/private/orders-variant-01.csv
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/datasets/private/orders-variant-02.csv
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/datasets/public/orders-learning.csv
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/goals/learning-goals.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/knowledge/knowledge-points.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/profile.json
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/c-execution-evidence.json
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/generate-diagnostic-summary.mjs
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/generate-freeze-candidate.py
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/quality-report.md
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/revision-1-to-2.md
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/run-candidate-evidence.py
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/run-diagnostic-summary-vite.mjs
M pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/reference-solutions/solution-structure.py
A pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/sources/source-map.json
D pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/sources/source-registry.json
M pi-study-helper/tests/pandas-cleaning-v2-assets.test.ts
```

## 未上传文件与本地残留

- `evaluation/golden/`：原始 gold/封存范围，未暂存、未提交、未推送。
- 四个 `__pycache__/` 目录：本地测试缓存，未暂存、未提交、未推送。
- D4 候选 ZIP、sidecar、manifest、诊断摘要及所有审计过程材料：继续保留仓库外，未入 Git。
- `gold-input-freeze.json`：负责人本地保管，未由 B 写入或上传。

## 后续交接

C 应拉取 `fa26097e46a72a2826d960a7e1934a8885098112`，仅执行内容哈希绑定与最小 V2-3 复现。B 不读取或修改 C 报告；B 原始标注仍待负责人盲标资格检查，不得上传。
