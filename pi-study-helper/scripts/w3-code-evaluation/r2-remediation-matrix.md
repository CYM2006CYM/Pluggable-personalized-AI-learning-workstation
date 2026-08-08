# W3-D2 R2 Remediation and Test Matrix

| Item | Implementation | Counterexample / check | Expected and actual |
|---|---|---|---|
| R2-01 harness and test fault attribution | `scripts/python-evaluator.py`; `src/infrastructure/python-process-evaluation-adapter.ts` | assertion miss, test RuntimeError/TypeError, real learner timeout, real harness timeout | learner/test_failed, evaluator/test_asset_invalid, learner/timeout, evaluator/evaluator_timeout; passed |
| R2-02 TaskBundle digest and allow-list | `src/infrastructure/python-process-evaluation-adapter.ts` | content changed with old digest; add `os`, remove `pandas`, duplicate `pandas` | prepare returns evaluator/test_asset_invalid; passed in 8/8 R2 tests |
| R2-03 Rubric gates | `src/infrastructure/activity-rubric.ts`; R2 test | threshold out of range, weight sum, duplicate dimension, dangling mapping, no test dimension | reject before scoring; no out-of-range score; passed |
| R2-04 result protocol | adapter and `code-evaluation-port.ts`; R2 test | unknown code, learner/evaluator mismatch, missing fields, extra fields | evaluator/result_protocol_invalid without score or dimensionResults; passed |
| R2-05 D2 binding and self-check | `environment-prototype-rerun-d2.json`, formal binding evidence, `self-check.mjs` | restore D2 to pending and execute self-check | pending is BLOCKED; correct W3-D40-ENV-1 binding is PASS; passed |

Cross-cutting checks cover stage ordering, separate public/hidden processes, process-tree termination, temporary-directory cleanup, public `ActivityResult` boundaries, hidden-asset containment, and absence of negative Evidence writes. This matrix is candidate audit material only.
