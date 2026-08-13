# W4-A D1 Remediation Validation Report

## Identity and authority

- Contract/schedule: `W4-C2 / W4-R1`
- Actual base HEAD and `origin/main`: `dc23504c3f353883d4f665e64a47cee9afb5723a`
- W4 start commit: `ac6e307e17cf84450845dfc5ffa467063dd3ae4c`
- State: `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`
- Deliverable: owner-review audit ZIP only; no formal submission package was generated or uploaded.

Changes stay inside the A-authorized contracts/application/domain/repositories/tests/validation/handoff scope, plus the owner's two explicit Web exceptions: `src/web/mocks/safe-dtos.ts` and `tests/web/dto-contract.test.ts`. HTTP/bootstrap servers, other Web files, B formal Profile/private assets, prompts/recordings/agents, W3 environment locks, TaskBundle, Rubric, hidden tests, reference solutions, gold, SDK, dependencies, `package.json` and `package-lock.json` remain unchanged.

## Remediation closure

1. Diagnostic draft and answer writes require client `diagnosticDraftVersion`; stale/missing CAS cannot write. Draft writes only advance the draft version. Fixed and `background_only` completion use a formal session transaction, advance `sessionVersion`, and enter `path`; background completion preserves Evidence, evidence version and existing KnowledgeState.
2. Activity open, submit, submission result and Attempt views are outer-`kind` discriminated unions. Composition dispatch is exhaustive; code and quiz fields cannot cross branches.
3. Bootstrap parses the diagnostic asset strictly and constructs Profile, session, draft, progress, Attempt and path outputs from explicit allowlists. Unknown question fields fail; extensions and internal snapshot fields cannot flow to the DTO.
4. Revision 3 core points are the deterministic union of `goals[].targetKnowledgePointIds`. Only that set requires full cards/question groups/`all_in_order`; prerequisite-only auxiliary points remain auxiliary. Revision 2 behavior is unchanged.
5. `src/contracts/domain.ts` is the sole shared domain type source and contracts have no Node/runtime reverse imports. The W3 application path is compatibility re-export only.
6. Pending cards require the real bound asset `cardId`. Missing or wrong IDs fail before Attempt creation; correct acknowledgement and open share a transaction and replay idempotently. No Evidence is created by acknowledgement.
7. `BackgroundQuestionnaire` is one strict three-field object through public input, persistence, restart recovery, Bootstrap and `background_only` completion.
8. Evidence collection binds the approved isolated Node/Python environment and records each command separately with cwd, UTC timestamps, real exit code, counts and stdout/stderr SHA-256. The tracked patch is generated separately as LF/no-BOM and describes tracked files only.

The exact finding-to-test mapping is `remediation-test-mapping.md`; exports are in `public-exports.md`; crash boundaries are in `transaction-failure-matrix.json`.

## Runtime composition and downstream boundary

All 17 `LearningRuntimeFacade` methods have an importable composition. Code and quiz submissions derive Evidence, KnowledgeState, activity progress and path suffix internally. `evaluator_error` leaves formal session state unchanged. Capability tasks are triggered only after a formal commit and cannot roll back it. Context questions use a fixed safe fallback.

B remains owner of formal revision 3 content, private answers and seal. D remains owner of live model/task adapters. C owns HTTP/process bootstrap. E consumes contracts only; the two approved Web edits restore that boundary and do not implement E behavior.

## Owner ruling 48 closure

1. Recommended-mode answer submission and fixed completion now require a previously saved legal questionnaire. Missing preconditions return `diagnostic_incomplete` without changing draft/session/evidence versions, stage, answers or recovery position.
2. `CapabilityProfileRevision.status` only accepts `complete | partial | unverified`; task statuses remain separate.
3. A second terminal `insufficient` without Evidence still triggers `node_completed` after the formal commit using the current unchanged Evidence version.
4. `confirmPath()` prepares every node concurrently inside one shared deadline, validates and binds each complete safe card snapshot in the confirmation transaction. `getNextStep()` is read-only. Recovery and replay retain the same binding; late dynamic completion cannot replace an already bound fixed card.
5. Card lifecycle mismatches use `activity_lifecycle_conflict`; `prerequisite_violation` is reserved for locked nodes.
6. W2 compatibility exists only in `scripts/w2-verification/v2-6-preconditions.test.mjs`. The main verifier, frozen 20/60 JSONL, scoring and KnowledgeState assertions are unchanged.

## Verification record

Canonical machine-readable results are in `command-results.json`. The file preserves historical failures and records the final owner-assisted closeout separately. Reports use native process exit codes and do not relabel a failed command as PASS.

- Original candidate A suite: `17 files / 131 tests PASS`.
- Final A suite: `17 files / 143 tests PASS`.
- Approved environment: Node `v22.23.1`, Python `3.13.7`, Pandas `3.0.5`; exact executables are recorded.
- Python evaluator/delivery group: `3 files / 35 tests PASS` in the approved environment.
- The deterministic path-runtime test passed five consecutive runs (`5 x 1 file / 8 tests`); the final A suite is `17 files / 143 tests PASS`, and the Web affected suite is `6 files / 81 tests PASS`.
- Root, test and Web TypeScript commands are recorded independently, followed by the repository `typecheck` script and `build:web`; all passed.
- W2 V2-6 direct recomputation passes all 20+60 cases. The frozen input SHA-256 values remain `1b238dfae09e5c6ea942329a3a0fd952ad9c190edd9666335ad735301cb27876` and `4fcc7c3e2c605f912890ddec5af7d4fa875c861d1636dcaf425a63ddb17f4b9d`; the isolated runtime test is `1 file / 5 tests PASS`.
- The first final full test run is `689 passed / 1 failed / 1 skipped`; its only failure is the frozen V2-6 comprehensive wrapper exceeding its outer 30-second budget. Direct 20+60 recomputation and the isolated runtime test pass. The later unmodified full suite inside `verify` completed as `690 passed / 1 skipped`, so `verify` exited `0`.
- The card preparation test no longer uses a wall-clock `<100ms` assertion. Fake timers deterministically prove that all node requests start before any pending candidate resolves and that one shared deadline controls fallback.
- Three independent TypeScript compilations, `typecheck`, Web affected tests, `build:web`, `check:docs`, final `smoke:extension`, `check:release` and `git diff --check` passed.
- Extension smoke history is mixed: A-4 and clean `dc23504` have both timeout and successful runs under the approved environment. The final A-4 smoke run passed, while every historical timeout remains recorded with exit code `1`. The aggregate classification is `FLAKY_BASELINE_REPRODUCIBLE`, not an assertion that every run passed and not an A-4-only regression.

The audit ZIP contains the corrected evidence, complete candidate file set, manifest, per-file SHA-256/byte counts, tracked-only patch, clean-baseline patch check and owner-review message. Its SHA-256 is supplied beside the ZIP and in the package metadata.

## Remaining downstream work

- Formal revision 3 content/seal activation still requires B's assets and owner approval.
- Live D adapters, C HTTP integration and E product integration remain outside this candidate.
- Full-suite and smoke conclusions follow the final closeout records. Historical timeout and Windows `EPERM` evidence remains preserved and is not silently rewritten.
- This audit artifact does not itself grant an upload lock. It remains uncommitted and unpushed for A/owner-controlled upload.
