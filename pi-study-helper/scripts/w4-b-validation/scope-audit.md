# W4-D1-B-3 scope audit

Allowed candidate paths only:

- `fixtures/profiles/pandas-cleaning-revision-3-draft/`
- `scripts/w4-b-validation/`
- `../../新版设计文档-重写版/第四周任务/handoff-w4-b-d1.md`

The exact proposed-submit list, raw SHA-256 and byte length are generated in the repository-external `W4-D1-B-3-proposed-submit-manifest.json`. It covers every file below the two B roots above and the B handoff. It explicitly excludes all ZIPs, SHA-256 sidecars, raw stdout/stderr logs, the B external virtual environment, A compiled audit runtime, `node_modules`, `.demo-data`, repository-external audit directories and other-role files.

No `src/`, HTTP, Agent, Web, SDK, dependency, lockfile, revision 2, formal gold, Rubric, hidden-test, TaskBundle, reference-solution, or W3 environment-lock file is modified. Revision 3 preserves copied frozen code-evaluation assets; `quality/w4-b-revision-2-immutability.json` records the original revision 2 tree independently.

This B-3 evidence remediation did not modify Profile bytes: revision 3 remains 79 files and seal asset tree SHA-256 `e118fd65c4583821f686cba4faab5990a81d2149a8f73cf89af2c376ba15b352`; revision 2 remains 71 files and tree SHA-256 `2a4538272cc47a3451b434999d620f429e5deaa0eb0f2c3f95fa76e53d80786d`.

Candidate state: `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`.

Evidence exception: B-R2-01 is `OWNER_EVIDENCE_EXCEPTION_APPROVED` by `50-W4-D1-B历史证据例外裁决与最终整改执行单.md` §3.2. The external `W4-D1-B-2-historical-reproduction-logs-v3/` is a later, separately labelled Python 3.14.4 reproduction; it is deliberately excluded from proposed Git and must not be represented as the original run.
