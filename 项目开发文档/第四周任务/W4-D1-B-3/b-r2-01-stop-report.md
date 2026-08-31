# B-R2-01 evidence stop report

## Blocking contract clause

`41-第四周总任务布置与权限边界.md` §7.1 requires each formal command result to retain the real command, working directory, start/end time, exit code, test statistics, and stdout/stderr SHA-256. It also requires the first real failure to remain retained after a later reverification.

## Actual files and evidence state

- Formal result: `scripts/w4-b-validation/command-results.json`.
- Retained historical fact: initial Python `3.14.4` / Pandas `3.0.5`, aggregate `670 passed / 20 failed / 1 skipped`, `npm run verify` exit `1`.
- Missing historical artifacts: the original first-run stdout/stderr files, start/end timestamps, and SHA-256 values. They are not present in the repository, prior B audit directories, or prior B delivery copies.
- Later reproduction: repository-external `W4-D1-B-2-historical-reproduction-logs-v3/` records actual Python `3.14.4` / Pandas `3.0.5` runs with complete log hashes; it reproduces `670 passed / 20 failed / 1 skipped` and exit `1` for both aggregate test and verify. It is explicitly a later reproduction, not an original-run replacement.
- Final contract environment: the final phase in the formal result records B-local Python `3.13.7` / Pandas `3.0.5`, Node `v22.23.1`, actual command logs and hashes.

## Impact

The candidate content, revision 2 immutability, coverage, answer isolation, inventory, seal, and final-environment test evidence remain independently verifiable. However, the historical initial phase cannot satisfy every §7.1 field without inventing evidence. Therefore B cannot truthfully claim B-R2-01 fully closed or request an upload lock.

## Minimal authorized resolution

One of the following is required from the responsible person:

1. Provide the original first-run stdout/stderr artifacts (and, if archived separately, their run timestamps) so B can hash and bind them without changing the recorded result; or
2. Issue a written evidence exception that accepts the retained historical fact plus separately labelled reproduction as sufficient for this candidate.

No A/C/D/E code, shared contract, revision 2 asset, environment lock, question, answer, source, or seal algorithm change is proposed or authorized.

## Status

`CONTENT_PASS / B-R2-01_OWNER_DECISION_OR_ORIGINAL_LOG_ARCHIVE_REQUIRED / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`
