# B-R2-01 evidence stop report

## Blocking contract clause

`41-第四周总任务布置与权限边界.md` §7.1 requires each formal command result to retain the real command, working directory, start/end time, exit code, test statistics, and stdout/stderr SHA-256. It also requires the first real failure to remain retained after a later reverification.

## Actual files and evidence state

- Formal result: `scripts/w4-b-validation/command-results.json`.
- Retained historical fact: initial Python `3.14.4` / Pandas `3.0.5`, aggregate `670 passed / 20 failed / 1 skipped`, `npm run verify` exit `1`.
- Missing historical artifacts: the original first-run stdout/stderr files, start/end timestamps, and SHA-256 values. They are not present in the repository, prior B audit directories, or prior B delivery copies.
- Later reproduction: repository-external `W4-D1-B-2-historical-reproduction-logs-v3/` records actual Python `3.14.4` / Pandas `3.0.5` runs with complete log hashes; it reproduces `670 passed / 20 failed / 1 skipped` and exit `1` for both aggregate test and verify. It is explicitly a later reproduction, not an original-run replacement.
- Final contract environment: the final phase in the formal result records B-local Python `3.13.7` / Pandas `3.0.5`, Node `v22.23.1`, actual command logs and hashes.

## Resolved-by-decision status

The responsible person issued `50-W4-D1-B历史证据例外裁决与最终整改执行单.md` §3.2 with `OWNER_EVIDENCE_EXCEPTION_APPROVED`. The approved evidence combination is: retained initial summary, separately labelled Python 3.14.4 reproduction, and final B-local contract-environment verification. This report remains as the historical blocking record; it is not a current upload-lock blocker and is not rewritten as though the gap never existed.

## Historical impact

The candidate content, revision 2 immutability, coverage, answer isolation, inventory, seal, and final-environment test evidence remain independently verifiable. The historical initial phase still cannot satisfy every §7.1 field without inventing evidence, but the owner-approved exception closes B-R2-01 under the limited terms above.

## Status

`B-R2-01=OWNER_EVIDENCE_EXCEPTION_APPROVED / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`
