# C W3-D2 R2 Implementation Candidate Report

## Conclusion

This report covers `W3-C3/W3-R2` at candidate HEAD `c8b4aacffccdad92338abedfd7acb3b59b716e60`. R2 is an audit candidate only: no upload lock, staging, commit, push, or Profile activation.

The five confirmed blockers are addressed: harness fault attribution, TaskBundle content and allow-list gates, Rubric structure gates, result-protocol validation, and formal D2 environment binding. B assets and frozen hashes were not modified.

## Fixed bindings

- W3-D40-ENV-1 decision SHA-256: `c06d1d77ab81a766de029e8121c695efdc39757b543276d13efc7681c7485fb4`
- B formal commit: `277805b4dc612548f4dcdf4f91189abb4ef5c8e3`
- `act-inspect-dataframe`: `bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c`
- `act-practical`: `3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c`
- formal environment hash: `sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76`
- sealed D1 ZIP SHA-256: `1cc5bb26ebf21c9e565403dc71c466eda5a753e2b5fda2df3bb54102d3dc04ac`

The lock uses the approved Node `v22.23.1`, Python `3.13.7`, Pandas `3.0.5`, `win32-10.0.26100-x64`, evaluator `node-python-evaluator-w3-c1`, only `pandas==3.0.5`, and limits `4000/8192/8192/8000/65536`. `networkIsolation=false`, `reliableMemoryLimit=false`, `processTreeTermination=true`; Profile remains `draft`.

## R2 changes

The complete mapping is in `r2-remediation-matrix.md`. Evaluator failures return public `ActivityResult` with `verdict=not_graded`, without `score` or `dimensionResults`, and do not create formal learning facts.

- R2-01: healthy frozen-test assertion/look-up misses remain learner `test_failed`; test loading, fixture, and harness `RuntimeError` or `TypeError` become `evaluator/test_asset_invalid`; real harness timeout is `evaluator/evaluator_timeout`, while a learner infinite loop is `learner/timeout`.
- R2-02: the adapter recomputes the TaskBundle digest using frozen canonicalization, excluding its own digest, and checks self-reported, caller, and frozen values. The activity allow-list must exactly equal the environment lock's single `pandas` entry.
- R2-03: preparation validates threshold, dimensions, weights, test mappings, and blocking relations. Damaged Rubric data is rejected before scoring and all scores are constrained to `0..1`.
- R2-04: harness `status/category/errorCode/tests` combinations are allow-listed. Unknown, missing, mismatched, or extra protocol fields become `evaluator/result_protocol_invalid` and are not passed through.
- R2-05: D2 evidence is `measured_node_submit`, bound to `W3-D40-ENV-1`, owner commit `c8b4aac...`, B commit, formal environment hash, and both B asset hashes. Self-check mechanically blocks pending or inconsistent bindings.
- C-R2F-01: removed one duplicate `binding.bFormalCommit` key from the D2 rerun JSON; the retained value and every other binding field are unchanged.

## Verification

These are actual final results from the R2 copy; first failures remain in `execution-log.txt`.

| Check | Command | Result |
|---|---|---|
| Existing author tests | `npm.cmd test -- --maxWorkers=1 --run tests/activity-rubric.test.ts tests/python-process-evaluation.test.ts` | 2 files, 20/20, exit 0 |
| R2 counterexamples | `npm.cmd test -- --maxWorkers=1 --run tests/python-process-evaluation-r2.test.ts` | 1 file, 8/8, exit 0 |
| C targeted with R2 | `npm.cmd test -- --maxWorkers=1 --run tests/python-process-evaluation-r2.test.ts tests/code-evaluation-port.test.ts tests/activity-rubric.test.ts tests/python-process-evaluation.test.ts` | 4 files, 44/44, exit 0 |
| Affected regression | `npm.cmd test -- --maxWorkers=1 --run tests/evaluation-protocol.test.ts tests/pandas-cleaning-v2-assets.test.ts tests/w3-b-d1-delivery.test.ts` | 3 files, 26/26, exit 0 |
| Full test suite | `npm.cmd test -- --maxWorkers=1` | 48 files, 488 passed, 1 skipped, exit 0 |
| Typecheck | `npm.cmd run typecheck` | exit 0 |
| Docs | `npm.cmd run check:docs` | 48 Markdown files valid, exit 0 |
| Verify | `npm.cmd run verify` | typecheck, 488/488, docs, smoke, release passed, exit 0 |
| Self-check | `node .\\scripts\\w3-code-evaluation\\self-check.mjs --output .\\scripts\\w3-code-evaluation\\self-check.json` | `status=PASS`, exit 0 |
| Diff check | `git diff --check` | exit 0 |

The first R2 run timed out at Vitest's default 5 seconds during real Python/Pandas preflight. Only the test-level timeout was raised to 30 seconds; the adapter and assertions were unchanged. The first self-check used a duplicated `pi-study-helper` path from the wrong working directory; the stable copy-relative command above passed on rerun. Both failures remain recorded.

## Boundaries

This is a trusted-local W3 candidate, not a production hostile-code sandbox. Network isolation and reliable memory limits are not claimed. D1 sealed files and ZIP remain byte-identical. B TaskBundle, tests, private CSV, reference implementations, Rubric source, gold, A transactions, React, Agent, SDK, `package.json`, lock files, and dependency versions were not changed. A runtime mismatch with the approved lock is `environment_mismatch`, not a B defect.

No Attempt, Evidence, KnowledgeState, PathRepository, or Session commit is created. No gold, Profile activation, or formal learning fact is produced.

## Next step

Submit this candidate ZIP and evidence to the owner for R2-01 through R2-05 review. Until the owner explicitly grants the C-D2 upload lock, do not stage, commit, or push.
