# W5-D2-E R2 交付报告

生成时间：2026-08-20T14:31:30.660Z

状态：`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

## 基线与范围

- 合同：W5-C1 / W5-R1
- W5_START_COMMIT：`4e316822d343d90bdf295f37b7aaaa0131890501`
- HEAD：`127a71cce4a8423327fb5ce75d31294252b92a0b`
- origin/main：`768f3eae00c50da1c7563a7efd1447e5021f29c8`
- A-D1：`0fd1f45386682a3859d8d9f6b37904b47ae98c33`
- C-D1：`677f54c609ef3bfbe78ff6d37f6b432e9c68ff4d`
- A-D2：`127a71cce4a8423327fb5ce75d31294252b92a0b`
- 被审计旧 ZIP：`40ea7e52cef617fe1dc60771ae9d243e03db30e20165bc94e7956ff86f5f04ea`

本轮只整改证据、打包和拟提交范围。未重做 Web 实现，未执行 D3/D4，未修改公共 DTO、Facade、HTTP 服务端、Profile、seal、gold、SDK、依赖或锁文件。

## 实测结果

- 环境：Node v22.23.1；npm 10.9.8；Python 3.13.7；Pandas 3.0.5；PYTHONNOUSERSITE=1
- Web：15 files / 100 passed / 0 failed / 0 skipped
- 全量：94 files / 812 passed / 0 failed / 1 skipped
- 运行期专项：1 file / 3 passed；CDP 捕获：PASS
- 命令总状态：PASS
- 机器一致性标记：`WEB_TESTS=100/0/0`；`FULL_TESTS=812/0/1`

首次失败、Node 24 失败和最终复验历史保留在 `d2-command-results.json`。`LIVE_MODEL=LIVE_NOT_RUN`；`PYODIDE_CANDIDATE_UNAVAILABLE`；D3/D4 未执行。

## 交付闭合

- ZIP：`W5-D2-E-R2-delivery.zip`
- ZIP 大小：239936 bytes
- ZIP 文件数：43
- ZIP SHA-256：`b88d3c9c0eab9d7c4e783180c33e0cc6790b352a17fbc6beb5e3c5e2e84462d0`
- sidecar：`W5-D2-E-R2-delivery.zip.sha256`
- 正式 Git 拟提交：38 个文本/结构化文件
- AUDIT_ONLY：4 张本轮 PNG；不进入正式 Git 清单

ZIP 不含旧 ZIP、旧 sidecar、D1 历史准备材料、缓存、node_modules、dist-web、原始大日志、虚拟环境或整库副本。包内 `ZIP-MANIFEST.json` 覆盖全部非 Manifest 条目并明确自排除；`d2-zip-files.txt` 覆盖全部 ZIP 条目。

## 正式 Git 拟提交清单

- pi-study-helper/scripts/w5-e-validation/capture-d2-r2-browser.mjs
- pi-study-helper/scripts/w5-e-validation/d2-audit-only-files.txt
- pi-study-helper/scripts/w5-e-validation/d2-browser-capture.json
- pi-study-helper/scripts/w5-e-validation/d2-command-results.json
- pi-study-helper/scripts/w5-e-validation/d2-known-limitations.json
- pi-study-helper/scripts/w5-e-validation/d2-proposed-files.txt
- pi-study-helper/scripts/w5-e-validation/d2-runtime-test-results.json
- pi-study-helper/scripts/w5-e-validation/d2-screenshot-index.json
- pi-study-helper/scripts/w5-e-validation/d2-security-scan.json
- pi-study-helper/scripts/w5-e-validation/d2-sha256-manifest.json
- pi-study-helper/scripts/w5-e-validation/d2-test-mapping.json
- pi-study-helper/scripts/w5-e-validation/d2-upstream-binding.json
- pi-study-helper/scripts/w5-e-validation/d2-zip-files.txt
- pi-study-helper/scripts/w5-e-validation/generate-d2-manifest.mjs
- pi-study-helper/scripts/w5-e-validation/generate-d2-security-and-screenshots.mjs
- pi-study-helper/scripts/w5-e-validation/package-d2-r2.mjs
- pi-study-helper/scripts/w5-e-validation/run-d2-runtime-tests.mjs
- pi-study-helper/scripts/w5-e-validation/run-d2-validation.mjs
- pi-study-helper/scripts/w5-e-validation/verify-d2-r2-evidence.mjs
- pi-study-helper/src/web/app/routes.tsx
- pi-study-helper/src/web/pages/ActivityPage.tsx
- pi-study-helper/src/web/pages/DiagnosticPage.tsx
- pi-study-helper/src/web/pages/PathPage.tsx
- pi-study-helper/src/web/pages/StartPage.tsx
- pi-study-helper/src/web/pages/StudyDeepLinkPage.tsx
- pi-study-helper/src/web/preview/browser-code-runner.ts
- pi-study-helper/src/web/preview/create-browser-code-runner.ts
- pi-study-helper/src/web/preview/pyodide-preview.worker.ts
- pi-study-helper/src/web/state/activity-draft-storage.ts
- pi-study-helper/tests/web/activity-draft-storage.test.ts
- pi-study-helper/tests/web/boundary-contract.test.mjs
- pi-study-helper/tests/web/browser-code-runner.test.ts
- pi-study-helper/tests/web/fixtures/w4-api.ts
- pi-study-helper/tests/web/pages.test.tsx
- pi-study-helper/tests/web/routes.test.tsx
- pi-study-helper/tests/web/study-deep-link.test.tsx
- pi-study-helper/tests/web/w5-d2-e-runtime-evidence.test.tsx
- 新版设计文档-重写版/第五周任务/handoff-w5-e-d2.md

## AUDIT_ONLY 清单

- pi-study-helper/scripts/w5-e-validation/evidence/d2-r2/start-desktop.png
- pi-study-helper/scripts/w5-e-validation/evidence/d2-r2/start-mobile.png
- pi-study-helper/scripts/w5-e-validation/evidence/d2-r2/study-recovery-desktop.png
- pi-study-helper/scripts/w5-e-validation/evidence/d2-r2/study-recovery-mobile.png

## 当前 git status

```text
M pi-study-helper/src/web/app/routes.tsx
 M pi-study-helper/src/web/pages/ActivityPage.tsx
 M pi-study-helper/src/web/pages/DiagnosticPage.tsx
 M pi-study-helper/src/web/pages/PathPage.tsx
 M pi-study-helper/src/web/pages/StartPage.tsx
 M pi-study-helper/tests/web/boundary-contract.test.mjs
 M pi-study-helper/tests/web/fixtures/w4-api.ts
 M pi-study-helper/tests/web/pages.test.tsx
 M pi-study-helper/tests/web/routes.test.tsx
?? pi-study-helper/.demo-build/
?? pi-study-helper/scripts/w5-e-validation/
?? pi-study-helper/src/web/pages/StudyDeepLinkPage.tsx
?? pi-study-helper/src/web/preview/
?? pi-study-helper/src/web/state/activity-draft-storage.ts
?? pi-study-helper/tests/web/activity-draft-storage.test.ts
?? pi-study-helper/tests/web/browser-code-runner.test.ts
?? pi-study-helper/tests/web/study-deep-link.test.tsx
?? pi-study-helper/tests/web/w5-d2-e-runtime-evidence.test.tsx
?? "\346\226\260\347\211\210\350\256\276\350\256\241\346\226\207\346\241\243-\351\207\215\345\206\231\347\211\210/\347\254\254\344\272\224\345\221\250\344\273\273\345\212\241/handoff-w5-e-d2.md"
```

未获得负责人明确授权，不执行 commit、push、强推或申请上传锁。
