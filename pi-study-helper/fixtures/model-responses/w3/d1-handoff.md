# W3 D1 offline Agent handoff

Status: `OWNER_AUTHORIZED_RECTIFIED_CANDIDATE`. Prompt/config version: `w3-d1-v1` / `w3-d1-config-v1`. This candidate proves only deterministic recorded-response behavior; network access is disabled and no live-model capability is claimed.

## Owner-authorized D3 minimal security rectification

The owner authorized one reproducible D-ownership boundary fix after the W3-D3 candidate audit. The orchestrator now requires an exact runtime `safeContext` allowlist (`knowledgePointId`, `targetDifficulty`, `sourceIds`, `publicSourceSummary`) before calling `ModelExecutionPort`; any extra field returns the fixed fallback with `permission_denied` and zero port calls. Windows drive/UNC paths, common POSIX host paths, Bearer credentials and explicit credential assignments are rejected by the shared text scan in both context and dynamic-question output fields (`prompt`, `options`, `rationale`).

This is a minimal rectification under `W3-C5/W3-R2` and `D47`; it adds no feature, live model, key, third-party dependency, or other-role change. The fixed fallback path is recorded as `MOCK_FALLBACK_USED`; live model execution remains `LIVE_NOT_RUN`.

## Scope delivered

- Strict dynamic `single_choice` and `judgment` output schemas; judgment omits options.
- Recorded normal, invalid-output, timeout and provider-error scenarios.
- One byte-stable pre-reviewed fallback for every technical failure.
- Deterministic rejection of Agent requests or outputs touching mastery, KnowledgeState, path, Rubric, ActivityResult or gold.
- Safe-context and recorded-material scans exclude hidden tests, reference implementations, private CSV data, keys and host paths.
- Offline orchestration consumes only `ModelExecutionPort`; no SDK `GraphRunResult` type crosses into the application layer.

## Reproduction

From `pi-study-helper`:

```powershell
node fixtures/model-responses/w3/validate-w3-materials.mjs
npx vitest run fixtures/model-responses/w3/offline-dynamic-question.test.ts --maxWorkers=1 --fileParallelism=false
npm.cmd run typecheck
git diff --check
```

The validation command checks and prints `candidate-manifest.sha256`, the sealed candidate file SHA-256 list. D2 must leave those files unchanged. D3 must pull latest `main`, rerun the command, compare every hash, then upload only after receiving the D3 upload lock.

## Permission statement

No mastery, KnowledgeState, path, ActivityResult, Rubric, Evidence, scoring, gold, Node evaluation, B assets, React, dependencies, SDK pin or live-model integration was modified. No secret or audit ZIP belongs in the D3 commit.
