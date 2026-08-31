# C W4-D3 R3 Handoff

Contract: `W4-C2 / W4-R1`

- `W4_START_COMMIT`: `ac6e307e17cf84450845dfc5ffa467063dd3ae4c`
- Actual `HEAD` / `origin/main`: `c50e2c1aea19a7cf77aacbaa654f9f298b6c0dbe`
- A: `c50e2c1aea19a7cf77aacbaa654f9f298b6c0dbe`
- B: `6f8b765594cdcb34046c1c2639c973641762b605`
- D: `dc1693e5bfcc0bed226ff0f20613fc4b2ec88681`
- Revision 3: 78 entries, asset tree `d1438022a49f83df20fa865443c36f4c3442856c8b679aac989de9e61a3feb30`
- D recorded responses SHA-256: `4dc9fae61d7d179947fe24ed661b5a6826484f9c27e79a0b2fc39a55a186061c`

## C Results

- R3-01 strict GET metadata: PASS, including invalid query rejection and stale-version 409 mapping.
- R3-02 host-path removal: PASS; source and material scan found zero developer absolute paths.
- R3-03 diagnostic answer-key binding: PASS; evaluator references resolve under `assessments/diagnostic`.
- R3-04 binding refresh: D-owned stale seal assertion is updated to the current formal B seal and passes independent recalculation.
- R3-05 transport/live boundary: HTTP request shapes are validated before Facade invocation; `demo:live` uses the D SDK ModelExecutionPort with in-memory credentials and no key persistence.

`npm.cmd test -- --run tests/w4-c-d3-http.test.ts --maxWorkers=1`: 16/16.

Affected A/B/C/D tests: 9 files, 41/41.

Full test and `npm.cmd run verify`: 80 files, 750 passed, 0 failed, 1 skipped, exit 0.

`npm.cmd run typecheck`, `npm.cmd run check:docs`, `npm.cmd run build:demo`, `npm.cmd run build:web`, `npm.cmd run smoke:extension`, `npm.cmd run check:release`, and `git diff --check` exited 0.

The historical pre-fix full test and `verify` result was 79 files, 746 passed, 1 failed, 1 skipped because of the stale D seal assertion. It remains in `command-results.json` as history and is not used as the current conclusion.

The default demo uses `.demo-data` and recorded responses. `demo:live` is wired through the D SDK ModelExecutionPort but remains `LIVE_NOT_RUN`; no online model claim is made. Runtime smoke verified API-before-Vite, revision 3 Bootstrap identity, and paired shutdown. Fixed ports remain 4310/5173 and no port drift or external process termination is permitted.

The C-owned 17-file proposed list is recorded in `scripts/w4-c-validation/proposed-files.txt`; its manifest and hashes are generated for that exact list. The负责人-controlled cross-role amendments that must be uploaded together are outside the C manifest and are limited to:

- `pi-study-helper/tests/w4-d-fixed-fallback-integration.test.ts` (D seal assertion refresh);
- `pi-study-helper/src/infrastructure/live-model-execution-port.ts`;
- `pi-study-helper/tests/w4-d-live-model-execution-port.test.ts`.

No ZIP, sidecar, raw logs, `.demo-data`, `.demo-build`, `node_modules`, or private asset is proposed.

Status: `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`.
