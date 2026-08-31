# W5-D4 E 交付报告

生成时间：2026-08-22T11:20:15.296Z

状态：`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 正式绑定

- 合同：`W5-C1/W5-R1`
- HEAD：`aaf588202b3ae92ed72c63994b912d78977516bb`
- origin/main：`aaf588202b3ae92ed72c63994b912d78977516bb`
- 开发基线：`aaf588202b3ae92ed72c63994b912d78977516bb`
- revision 3 seal：`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d`
- Pyodide：`PYODIDE_DISABLED_WITH_NODE_FALLBACK`
- Live model：`LIVE_NOT_RUN`

## 实测结果

- 环境：Node v22.23.1，npm 10.9.8，Python 3.13.7，Pandas 3.0.5，PYTHONNOUSERSITE=1
- Web：16 files / 104 passed / 0 failed / 0 skipped
- 受影响回归：8 files / 33 passed / 0 failed / 0 skipped
- 全量：104 files / 841 passed / 0 failed / 1 skipped
- 独立路径合法率：3/3（100%）
- 三对实际差异：32 / 12 / 21
- Edge/CDP：6 张页面证据，桌面与移动均通过
- DOM、网络、Worker、缓存、日志和构建产物：PASS

## 交付闭合

- ZIP：`W5-D4-E-delivery.zip`
- ZIP 大小：449123 bytes
- ZIP 文件数：46
- ZIP SHA-256：`70548e73d244e2a5ca8fa9b1c921dbde6f32cf7ce5e25be45dca05def50f5934`
- sidecar：`W5-D4-E-delivery.zip.sha256`
- 正式 Git 拟提交：39 个文本/结构化文件
- AUDIT_ONLY：6 张 PNG，不进入正式 Git 清单

ZIP 不包含旧 ZIP、sidecar、D1/D2 历史材料、`node_modules`、`dist-web`、`.demo-build`、原始大日志、虚拟环境或整库副本。包内 `ZIP-MANIFEST.json` 覆盖全部非 Manifest 条目并明确自排除。

## 精确拟提交清单

- pi-study-helper/scripts/w5-e-validation/capture-d4-browser.mjs
- pi-study-helper/scripts/w5-e-validation/d4-audit-only-files.txt
- pi-study-helper/scripts/w5-e-validation/d4-browser-capture.json
- pi-study-helper/scripts/w5-e-validation/d4-command-results.json
- pi-study-helper/scripts/w5-e-validation/d4-independent-validation.json
- pi-study-helper/scripts/w5-e-validation/d4-known-limitations.json
- pi-study-helper/scripts/w5-e-validation/d4-page-state-copy.json
- pi-study-helper/scripts/w5-e-validation/d4-proposed-files.txt
- pi-study-helper/scripts/w5-e-validation/d4-screenshot-index.json
- pi-study-helper/scripts/w5-e-validation/d4-security-scan.json
- pi-study-helper/scripts/w5-e-validation/d4-sha256-manifest.json
- pi-study-helper/scripts/w5-e-validation/d4-test-mapping.json
- pi-study-helper/scripts/w5-e-validation/d4-upstream-binding.json
- pi-study-helper/scripts/w5-e-validation/d4-zip-files.txt
- pi-study-helper/scripts/w5-e-validation/evidence/d4/activity-closed-desktop.projection.json
- pi-study-helper/scripts/w5-e-validation/evidence/d4/activity-closed-mobile.projection.json
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-high-foundation-desktop.projection.json
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-non-computer-beginner-desktop.projection.json
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-practice-mobile.projection.json
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-practice-oriented-desktop.projection.json
- pi-study-helper/scripts/w5-e-validation/generate-d4-evidence.mjs
- pi-study-helper/scripts/w5-e-validation/generate-d4-manifest.mjs
- pi-study-helper/scripts/w5-e-validation/package-d4.mjs
- pi-study-helper/scripts/w5-e-validation/run-d4-independent-validation.mjs
- pi-study-helper/scripts/w5-e-validation/run-d4-validation.mjs
- pi-study-helper/scripts/w5-e-validation/verify-d4-evidence.mjs
- pi-study-helper/scripts/w5-e-validation/w5-e-d4-validation-report.md
- pi-study-helper/src/web/app/AppShell.tsx
- pi-study-helper/src/web/app/routes.tsx
- pi-study-helper/src/web/pages/ActivityPage.tsx
- pi-study-helper/src/web/pages/ShowcasePage.tsx
- pi-study-helper/src/web/raw-imports.d.ts
- pi-study-helper/src/web/showcase/formal-showcase-data.ts
- pi-study-helper/src/web/styles.css
- pi-study-helper/tests/web/pages.test.tsx
- pi-study-helper/tests/web/routes.test.tsx
- pi-study-helper/tests/web/w5-d2-e-runtime-evidence.test.tsx
- pi-study-helper/tests/web/w5-d4-e-showcases.test.tsx
- 新版设计文档-重写版/第五周任务/handoff-w5-e-d4.md

## AUDIT_ONLY 清单

- pi-study-helper/scripts/w5-e-validation/evidence/d4/activity-closed-desktop.png
- pi-study-helper/scripts/w5-e-validation/evidence/d4/activity-closed-mobile.png
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-high-foundation-desktop.png
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-non-computer-beginner-desktop.png
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-practice-mobile.png
- pi-study-helper/scripts/w5-e-validation/evidence/d4/showcase-practice-oriented-desktop.png

## 当前 git status

```text
M pi-study-helper/src/web/app/AppShell.tsx
 M pi-study-helper/src/web/app/routes.tsx
 M pi-study-helper/src/web/pages/ActivityPage.tsx
 M pi-study-helper/src/web/styles.css
 M pi-study-helper/tests/web/pages.test.tsx
 M pi-study-helper/tests/web/routes.test.tsx
 M pi-study-helper/tests/web/w5-d2-e-runtime-evidence.test.tsx
?? pi-study-helper/.demo-build/
?? pi-study-helper/scripts/w5-e-validation/capture-d4-browser.mjs
?? pi-study-helper/scripts/w5-e-validation/d4-audit-only-files.txt
?? pi-study-helper/scripts/w5-e-validation/d4-browser-capture.json
?? pi-study-helper/scripts/w5-e-validation/d4-command-results.json
?? pi-study-helper/scripts/w5-e-validation/d4-independent-validation.json
?? pi-study-helper/scripts/w5-e-validation/d4-known-limitations.json
?? pi-study-helper/scripts/w5-e-validation/d4-page-state-copy.json
?? pi-study-helper/scripts/w5-e-validation/d4-proposed-files.txt
?? pi-study-helper/scripts/w5-e-validation/d4-screenshot-index.json
?? pi-study-helper/scripts/w5-e-validation/d4-security-scan.json
?? pi-study-helper/scripts/w5-e-validation/d4-sha256-manifest.json
?? pi-study-helper/scripts/w5-e-validation/d4-test-mapping.json
?? pi-study-helper/scripts/w5-e-validation/d4-upstream-binding.json
?? pi-study-helper/scripts/w5-e-validation/d4-zip-files.txt
?? pi-study-helper/scripts/w5-e-validation/evidence/
?? pi-study-helper/scripts/w5-e-validation/generate-d4-evidence.mjs
?? pi-study-helper/scripts/w5-e-validation/generate-d4-manifest.mjs
?? pi-study-helper/scripts/w5-e-validation/package-d4.mjs
?? pi-study-helper/scripts/w5-e-validation/run-d4-independent-validation.mjs
?? pi-study-helper/scripts/w5-e-validation/run-d4-validation.mjs
?? pi-study-helper/scripts/w5-e-validation/verify-d4-evidence.mjs
?? pi-study-helper/scripts/w5-e-validation/w5-e-d4-validation-report.md
?? pi-study-helper/src/web/pages/ShowcasePage.tsx
?? pi-study-helper/src/web/raw-imports.d.ts
?? pi-study-helper/src/web/showcase/
?? pi-study-helper/tests/web/w5-d4-e-showcases.test.tsx
?? "\346\226\260\347\211\210\350\256\276\350\256\241\346\226\207\346\241\243-\351\207\215\345\206\231\347\211\210/\347\254\254\344\272\224\345\221\250\344\273\273\345\212\241/handoff-w5-e-d4.md"
```

未获得负责人 commit、push 或上传锁授权。
