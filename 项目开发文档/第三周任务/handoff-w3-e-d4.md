# W3-D4 岗位E最终交接单

## 交接结论

```text
candidateConclusion = PASS
ownerFinalReview = PENDING
NOT_COMMITTED
NOT_PUSHED
uploadLock = NOT_REQUESTED
```

## 负责人优先复核

1. D2-R2外层ZIP SHA-256是否为`678bb456f824d90d7eed3c7a71a71666bdd44a9fbf302e690c95603d1a72525e`。
2. 候选工作树是否满足27/27匹配、0缺失、0非预期不一致、0额外E文件。
3. `test:web`是否为6文件、81/81通过并包含`boundary-contract.test.mjs`。
4. 两组DTO/fixture泄漏扫描是否分别为0命中，页面fixture是否未越出`src/web`。
5. V3-1至V3-8总表、D1封存哈希、60例只读候选证据及固定轨迹说明是否完整。
6. 拟提交清单是否只包含E拥有文件和负责人允许的D4记录。

## 上传锁前置

负责人审核通过后，E再申请第一把上传锁。按白名单暂存后必须先运行：

```text
git diff --cached --check
npm.cmd run check:release
npm.cmd run verify
```

随后把暂存区实际文件清单和三项结果再次交负责人确认。当前没有执行上述暂存区门禁，因为未取得上传锁且不得提前暂存。

## 明确排除

审核ZIP、截图、`node_modules`、`dist-web`、隔离运行时、下载文件、原始日志、OWNER-ONLY材料、B原始标注、机械差异、正式gold、SDK副本及A/B/C/D文件不进入Git拟提交清单。
