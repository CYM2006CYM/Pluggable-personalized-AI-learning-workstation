# W4 A D1 Remediation Handoff

## Candidate identity

- Base HEAD / `origin/main`: `dc23504c3f353883d4f665e64a47cee9afb5723a`
- W4 start commit: `ac6e307e17cf84450845dfc5ffa467063dd3ae4c`
- Contract/schedule: `W4-C2 / W4-R1`
- State: `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED`

This is the complete owner-ruling-48 remediation candidate. A new owner-review audit ZIP is generated, but no commit, push or upload-lock action is performed here.

## Delivered boundary

- Canonical browser-safe contracts: `pi-study-helper/src/contracts/index.ts`, `domain.ts`, and `facade.ts`.
- W3 compatibility import: `pi-study-helper/src/application/learning-runtime-facade.ts`.
- 17-method composition: `ComposedLearningRuntimeFacade`.
- Strict read-only bootstrap: `FileAppBootstrapFacade`.
- Deterministic code/quiz bridges and path-suffix recomputation.
- A-owned deterministic validation for `AdaptiveContentPort` and post-commit isolation for `CapabilityTaskPort`.
- Strict revision 3 draft seal verification and conflict-blocking activation.

Only `src/web/mocks/safe-dtos.ts` and `tests/web/dto-contract.test.ts` are changed under the owner's explicit Web exception. No other Web, HTTP, dependency, lock, SDK or formal content boundary is touched.

## Remediation result

- A-W4-D1-01: diagnostic CAS and formal completion semantics closed.
- A-W4-D1-02: activity DTOs and Attempt views are compile-time discriminated unions with exhaustive dispatch.
- A-W4-D1-03: exact diagnostic envelope and shared nested allowlist projections; three Attempt states recover safely.
- A-W4-D1-04: goal targets identify core revision 3 points; auxiliary prerequisites are not forced into card/quiz closure.
- A-W4-D1-05: contracts are a pure type leaf; native root/test/Web type gates pass independently.
- A-W4-D1-06: real card IDs gate Attempt creation and acknowledgement/open replay atomically.
- A-W4-D1-07: background questionnaire has one strict save/recover/complete shape.
- A-W4-D1-08: approved environment and corrected per-command evidence; audit patch/manifest are self-contained.
- A-W4-D1-R2-01..06: questionnaire precondition, snapshot/task status separation, no-Evidence node trigger, transactional card binding, lifecycle conflict code and test-local W2 compatibility are closed according to ruling 48.

The detailed mapping is `pi-study-helper/scripts/w4-a-validation/remediation-test-mapping.md`.

## Downstream handoff

- B: provide formal `pandas-cleaning-revision-3-draft`, private answer bindings and revision seal. A did not create or edit them.
- D: implement the public ports. Dynamic output remains candidate content until A validates it; task failure never rolls back a formal session commit.
- C: import contracts and Facade implementations without copying DTOs or exposing repository candidates.
- E: consume only contracts-safe Bootstrap/recovery/activity views; correct answers remain post-submit only.

## Verification

- Original audit fact retained: A suite `17 files / 131 tests PASS`; Python/Pandas and native type gates were previously reported blocked.
- Final A suite: `17 files / 143 tests PASS`.
- Approved runtime: Node `v22.23.1`, Python `3.13.7`, Pandas `3.0.5` from repository-external locations.
- Python evaluator/delivery: `3 files / 35 tests PASS`.
- Native `tsc --noEmit`, test config, Web config and `npm.cmd run typecheck` are recorded separately.
- W2 V2-6 direct 20+60 recomputation and isolated runtime test pass; frozen JSONL hashes are unchanged. Only the explicitly authorized `v2-6-preconditions.test.mjs` contains the compatibility adapter.
- Final closeout reruns A's 17-file suite, the six-file Web affected suite, the complete three-file Python evaluator/delivery group, full Vitest, three TypeScript compilers, `typecheck`, `build:web`, docs, release and diff gates. Exact outcomes are recorded in `command-results.json`.
- A suite: `17 files / 143 tests PASS`; Web affected: `6 files / 81 tests PASS`; Python evaluator/delivery: `3 files / 35 tests PASS`.
- The first final full run is `689 passed / 1 failed / 1 skipped`, with only the frozen V2-6 outer 30-second wrapper timing out. Direct 20+60 and isolated `5/5` pass. The later full suite inside `verify` is `690 passed / 1 skipped`, and `verify` exits `0`.
- The card preparation regression uses fake timers to prove concurrent start and one shared deadline without a machine-speed threshold.
- The final A-4 smoke run passes. Extension smoke still has mixed historical outcomes on both A-4 and clean `dc23504`; each command retains its actual exit status. The aggregate classification is `FLAKY_BASELINE_REPRODUCIBLE`, which excludes an A-4-only regression but does not rewrite prior failures as PASS.

Exact timestamps, exit codes, test counts and output hashes are in `pi-study-helper/scripts/w4-a-validation/command-results.json`. The validation report, export inventory and transaction matrix are in the same directory.

The candidate is ready for A/owner review as a complete candidate set. Until an explicit upload lock is granted, it remains uncommitted and unpushed.
