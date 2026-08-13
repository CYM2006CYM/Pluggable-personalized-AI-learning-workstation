# W4-D1-B-3 revision 3 final remediation candidate handoff

## Candidate identity

- Contract/schedule: `W4-C2 / W4-R1`
- B start HEAD / `origin/main`: `00037c1aa995a0ec2aec70b097fc680e193ed08a`
- A formal upstream: `4c52eb7c78fa80007aa9a8ab4e00768d71d3f3f5`
- Candidate directory: `pi-study-helper/fixtures/profiles/pandas-cleaning-revision-3-draft/`
- Candidate seal: `78` entries; asset tree SHA-256 `e118fd65c4583821f686cba4faab5990a81d2149a8f73cf89af2c376ba15b352`
- State: `NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_REQUESTED`

## Formal evidence

- The only formal command result is `pi-study-helper/scripts/w4-b-validation/command-results.json`.
- B-R2-01 is `OWNER_EVIDENCE_EXCEPTION_APPROVED` under `50-W4-D1-B历史证据例外裁决与最终整改执行单.md` §3.2. The first Python 3.14.4 event remains a summary with `NOT_AVAILABLE` original logs/times/hashes; the later Python 3.14.4 reproduction remains explicitly `REPRODUCTION_ONLY_NOT_HISTORICAL_ORIGINAL`.
- The final B-local contract environment is proven by command output: Node `v22.23.1`, Python `3.13.7`, Pandas `3.0.5`.
- Aggregate `npm test -- --maxWorkers=1`, V2-6 direct 20+60, isolated V2-6, and `npm run verify` each take their exact exit code and statistics exclusively from the final fixed-byte `command-results.json`; this handoff does not hard-code or rewrite any of those results. In particular, a non-zero aggregate V2-6 outer-wrapper timeout is retained as non-zero and is never overwritten by a separate `verify` result. An earlier unrelated Windows temporary-file rename failure and its passing isolated retry remain repository-external audit evidence only.
- Recorded revision-2 V2-6 direct recomputation exits `0`, proves development `20` and final `60` cases plus their SHA-256 input hashes; recorded isolated V2-6 exits `0` with `1` file and `5` tests passed. Every assertion is derived from these records, not hard-coded prose.

## B content delivery

- Revision 3 remains Schema 2, `revision=3`, `revisionOf=2`, `status=draft`.
- Six target knowledge points use `all_in_order`, positive estimates, one safe card, one group-MCQ, four fixed questions, and one supplemental candidate each. `basic-python` remains auxiliary; cards are not activities; `goal.requiredActivityIds` is only `act-practical`.
- Public question groups expose only safe question surfaces. Private answers, explanations and private mappings remain server-only. Supplemental questions are dynamic candidate completion only, never a complete retry group.
- Revision 2 remains `71` files, tree SHA-256 `2a4538272cc47a3451b434999d620f429e5deaa0eb0f2c3f95fa76e53d80786d`.

## Consumption boundary

- D/C/E consume only the final contract-environment result, the formal B commit after an upload lock, and the final revision seal. They must not consume the Python 3.14.4 historical record or reproduction as runtime input.
- A recomputes the final seal before activation; C uses only the candidate directory and returned seal; D never loads private answer keys into Agent context; E consumes safe DTOs only.

## Limits

This candidate does not claim activation, HTTP/API, Web, Agent, live-model, upload authorization, or W4 GO. It must not be treated as formal upstream until the responsible person independently reviews the B-3 audit package and grants an upload lock.
