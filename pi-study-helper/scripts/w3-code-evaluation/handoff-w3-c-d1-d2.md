# C W3-D2 R2 Handoff Checklist

## Baseline and authority

- Contract: `W3-C3/W3-R2`
- `W3_START_COMMIT`: `f190326a4a906b46e4001484ffa30a7839b82ed2`
- HEAD / `origin/main`: `c8b4aacffccdad92338abedfd7acb3b59b716e60`
- W3-D40-ENV-1 SHA-256: `c06d1d77ab81a766de029e8121c695efdc39757b543276d13efc7681c7485fb4`
- B formal commit: `277805b4dc612548f4dcdf4f91189abb4ef5c8e3`
- Profile: `draft`
- Upload authorization: `not_authorized`
- Git state: candidate-only changes in the copy; no staging, commit, or push.

## Frozen bindings

- `act-inspect-dataframe`: `bcc38620bdacede9d690ee62efbedaf8f0aee8dabaa55e9b7ca5b2452d29905c`
- `act-practical`: `3273308c4c9829b263a550c2d69eb40e5098b4e0802399c2334053afb3d6815c`
- environment hash: `sha256:9e73aebc1b5191b24ee91b27994cf48d596c757695738074de6d846ee2cf5b76`
- D1 ZIP SHA-256: `1cc5bb26ebf21c9e565403dc71c466eda5a753e2b5fda2df3bb54102d3dc04ac`
- D1 sealed probe, evidence, and report remain unchanged.
- D2 rerun evidence is `measured_node_submit` and is bound to W3-D40-ENV-1, the candidate HEAD, B commit, environment hash, and both B hashes.
- C-R2F-01 duplicate binding key removed; binding values unchanged.

## Candidate files

Implementation and tests:

- `pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/environments/environment-lock.json`
- `pi-study-helper/scripts/python-evaluator.py`
- `pi-study-helper/src/infrastructure/code-evaluation-port.ts`
- `pi-study-helper/src/infrastructure/activity-rubric.ts`
- `pi-study-helper/src/infrastructure/python-process-evaluation-adapter.ts`
- `pi-study-helper/tests/activity-rubric.test.ts`
- `pi-study-helper/tests/python-process-evaluation.test.ts`
- `pi-study-helper/tests/python-process-evaluation-r2.test.ts`

Evidence and reports:

- `pi-study-helper/scripts/w3-code-evaluation/environment-prototype-rerun-d2.json`
- `pi-study-helper/scripts/w3-code-evaluation/environment-formal-binding-evidence.json`
- `pi-study-helper/scripts/w3-code-evaluation/v3-3-author-evidence.json`
- `pi-study-helper/scripts/w3-code-evaluation/v3-4-boundary-evidence.json`
- `pi-study-helper/scripts/w3-code-evaluation/v3-6-failure-matrix.json`
- `pi-study-helper/scripts/w3-code-evaluation/self-check.mjs`
- `pi-study-helper/scripts/w3-code-evaluation/self-check.json`
- `pi-study-helper/scripts/w3-code-evaluation/r2-remediation-matrix.md`
- `pi-study-helper/scripts/w3-code-evaluation/w3-d2-candidate-report.md`
- `pi-study-helper/scripts/w3-code-evaluation/handoff-w3-c-d1-d2.md`
- `pi-study-helper/scripts/w3-code-evaluation/execution-log.txt`
- `pi-study-helper/scripts/w3-code-evaluation/manifest.json`
- `pi-study-helper/scripts/w3-code-evaluation/hash-inventory.txt`

The D1 originals `probe-environment.mjs`, `environment-prototype-evidence.json`, and `environment-prototype-report.md` are included only as unchanged evidence references.

## Results

- Existing author tests: 20/20.
- R2 counterexamples: 8/8.
- C targeted suite including R2: 44/44; affected regression: 26/26.
- Full suite: 48 files, 488 passed, 1 skipped; typecheck, docs, verify, self-check, and `git diff --check` exit 0.
- First failures are retained: default 5-second R2 test timeout and an incorrect self-check working-directory path. Both passed after minimal correction.

## Boundary declaration

B assets, Rubric source, hidden tests, private CSV, reference solutions, gold, A transactions, React, Agent, SDK, `package.json`, lock files, and dependency versions were not modified. Profile remains draft. No upload lock was requested or granted. The ZIP is for owner audit only and must not enter Git; it must exclude `.git`, `node_modules`, caches, old ZIPs, full repository copies, and other-role files.

## Handoff action

Owner review is required for R2-01 through R2-05. Until explicit C-D2 upload-lock authorization is received, do not stage, commit, or push this candidate.
