# W4-D1-A Remediation Test Mapping

| Finding | Implementation closure | Primary verification |
| --- | --- | --- |
| A-W4-D1-01 | Required diagnostic CAS; draft-only versions; fixed/background formal completion and idempotency | `diagnostic-runtime.test.ts`, `file-learning-session-repository.test.ts` |
| A-W4-D1-02 | Outer-kind code/quiz open, submit, result and Attempt unions; exhaustive dispatch | `w4-contracts.test.ts`, `composed-learning-runtime-facade.test.ts` |
| A-W4-D1-03 | Exact diagnostic envelope and shared nested allowlists; required path fields; recoverable Attempt reference | `app-bootstrap-facade.test.ts`, `code-activity-facade-adapter.test.ts`, `file-learning-session-repository.test.ts` |
| A-W4-D1-04 | Goal-target union identifies revision 3 core set; auxiliary prerequisites remain optional | `profile-v2-schema.test.ts`, revision 2 Profile tests |
| A-W4-D1-05 | Pure contracts leaf; one domain type authority; browser-safe imports | three independent `tsc` commands, `w4-contracts.test.ts`, `tests/web/dto-contract.test.ts` |
| A-W4-D1-06 | Real asset card IDs, transactional acknowledgement/open, lifecycle conflict and replay | `code-activity-facade-adapter.test.ts`, `quiz-activity-runtime.test.ts`, `path-runtime.test.ts` |
| A-W4-D1-07 | One strict `BackgroundQuestionnaire` shape across save, restart, Bootstrap and completion | `diagnostic-runtime.test.ts`, `app-bootstrap-facade.test.ts` |
| A-W4-D1-08 | Approved isolated environment, native gates, exit-code-correct evidence, LF tracked patch and complete manifest | `command-results.json`, audit manifest and clean-baseline `git apply --check` record |

| A-W4-D1-R2-01 | Recommended mode requires a persisted questionnaire before answer submission or fixed completion; failure is `diagnostic_incomplete` and preserves all formal facts | `diagnostic-runtime.test.ts` |
| A-W4-D1-R2-02 | Capability snapshot status is limited to `complete | partial | unverified` | `w4-contracts.test.ts`, TypeScript gates |
| A-W4-D1-R2-03 | A terminal no-Evidence `insufficient` completion enqueues the post-commit node event with the unchanged evidence version | `composed-learning-runtime-facade.test.ts` |
| A-W4-D1-R2-04 | All path cards share one preparation window and bind full safe snapshots in the confirmation transaction; replay, restart, recovery and late dynamic completion cannot replace them | `path-runtime.test.ts` uses fake timers to assert all preparations start before resolution and exactly one deadline controls fallback; `path-session-boundary.test.ts`, `file-learning-session-repository.test.ts`; five consecutive path-runtime runs |
| A-W4-D1-R2-05 | Wrong, stale, previous-node and unknown card IDs use `activity_lifecycle_conflict`; locked nodes retain `prerequisite_violation` | `code-activity-facade-adapter.test.ts`, `quiz-activity-runtime.test.ts` |
| A-W4-D1-R2-06 | The only W2 change is the approved test-local Chinese-value adapter and W4 call order; both frozen JSONL files remain byte-identical | `scripts/w2-verification/v2-6-preconditions.test.mjs`, direct and isolated V2-6 logs |

The final A targeted suite contains 17 files and 143 tests. The original candidate result (17 files / 131 tests), earlier remediation results, and failed/environment-blocked command records remain in `command-results.json` as historical evidence.
