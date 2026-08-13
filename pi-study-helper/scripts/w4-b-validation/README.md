# W4-B-D1 asset validation

`validate-w4-b-d1.mjs` validates only B-owned revision 3 assets: core coverage, cards, MCQ group shape, ordered private keys, source anchors, public leakage, and the frozen revision 2 asset tree.

`generate-delivery-evidence.mjs` writes the candidate inventory, revision 2 immutability proof, six-point coverage matrix, and answer-isolation report beneath the revision 3 `quality/` directory. Run it before final seal generation. `generate-revision-seal.mjs` then creates the seal with A's W4-C2 algorithm; rerun the validator and the generator after any content-byte change.

`run-historical-environment-reproduction.mjs` is an external-log helper only. It can reproduce the prior Python 3.14.4 environment mismatch with current timestamps and raw hashes, but it never replaces missing historical originals. `b-r2-01-stop-report.md` retains that historical gap; `50-W4-D1-B历史证据例外裁决与最终整改执行单.md` §3.2 approves the limited evidence exception.

`build-formal-command-results.mjs` requires complete V2-6 direct and isolated revision-2 records before it will generate a PASS claim. Missing records, a revision-3 profile path, absent log hashes, or a non-zero V2-6 record make it exit non-zero.
