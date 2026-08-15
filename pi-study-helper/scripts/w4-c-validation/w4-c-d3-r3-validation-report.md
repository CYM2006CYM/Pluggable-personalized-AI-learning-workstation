# C W4-D3 R3 Validation Report

Contract: `W4-C2 / W4-R1`

Current binding: `HEAD = origin/main = c50e2c1aea19a7cf77aacbaa654f9f298b6c0dbe`.

## Result

`C_R3_01` through `C_R3_05` PASS in the current worktree. The D-owned stale seal assertion is bound to the current revision 3 tree hash, HTTP transport shapes are rejected before Facade invocation, and `demo:live` selects the D SDK ModelExecutionPort while keeping credentials in memory.

## Implemented

- Strict query construction for `next-step` and Attempt GET routes, including duplicate and extra-key rejection.
- Diagnostic evaluator references resolve relative to the diagnostic blueprint directory.
- HTTP tests use contract environment/PATH behavior and contain no developer Python path.
- Demo composition root activates or reuses revision 3 without copying or rewriting Profile assets.
- Real recommended and chapter HTTP traces cover questionnaire persistence, diagnostic completion, path confirmation, helper single-question activity, quiz opening/submission, refresh recovery, and safe public output.
- Unknown POST resources return 404 before body parsing; malformed, extra, and private request fields return 400; business/evaluator outcomes retain the 200/422 taxonomy.
- D live binding uses an isolated SDK graph host and an in-memory credential store; online model execution remains unrun.

## Verification

- C HTTP: 16/16.
- A/B/C/D affected tests: 9 files, 41/41.
- Full test: 80 files, 750 passed, 0 failed, 1 skipped, exit 0.
- `npm.cmd run verify`: 80 files, 750 passed, 0 failed, 1 skipped, exit 0.
- `typecheck`, `check:docs`, `build:demo`, `build:web`, and `git diff --check`: exit 0.
- Extension smoke and release check: exit 0.
- Runtime smoke: PASS; API bootstrap was validated as a revision 3 response before Vite, both fixed-port processes closed after the harness lifecycle check. The harness termination code is retained as a non-product exit detail.
- Historical pre-fix full test and `verify`: 79 files, 746 passed, 1 failed, 1 skipped due to the stale D seal assertion; retained as history only.
- Live model: `LIVE_NOT_RUN`.

All command timestamps, exit codes, counts, and stdout/stderr hashes are in `command-results.json`. Raw logs stay outside the candidate.

## Scope

Profile remains `draft`. No A contracts/Facade, B revision 3 assets or private answers, D implementation/recordings, E web files, SDK, dependencies, lockfiles, gold, or W3 environment lock were modified.

Status: `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`.
