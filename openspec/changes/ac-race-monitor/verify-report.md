## Verification Report

**Change**: ac-race-monitor
**Version**: N/A
**Mode**: Standard

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 12 |
| Tasks complete | 12 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: ✅ Passed
```text
npm run build
> motassettorr@0.1.0 build
> tsc -p tsconfig.json
```

**Typecheck**: ✅ Passed
```text
npm run typecheck
> motassettorr@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

**Tests**: ✅ 13 passed / ✅ 0 failed / ⚠️ 0 skipped
```text
npm test
> motassettorr@0.1.0 test
> tsx --test tests/**/*.test.ts

pass 13
fail 0
duration_ms 283.4944
```

**Coverage**: ➖ Not available

### Spec Compliance Matrix
| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| Runtime Configuration | Default environment contract | Static evidence only: `src/config.ts`, `.env.example`, compose files | ❌ UNTESTED |
| Watch, Stability, And Parse Gate | File is still being written | Static evidence only: `src/watcher.ts` age + double-stat gate | ❌ UNTESTED |
| Watch, Stability, And Parse Gate | File is invalid or not a race | `tests/parser-and-domain.test.ts` proves non-`RACE`; invalid/corrupt JSON retry path has no passing test | ⚠️ PARTIAL |
| Parsing, Identity, Grouping, And Driver Stats | Symmetric car contact is duplicated in raw events | `tests/parser-and-domain.test.ts` grouped incident dedupe | ✅ COMPLIANT |
| Parsing, Identity, Grouping, And Driver Stats | Driver has no GUID | `tests/persistence.test.ts` GUID-only persistence | ✅ COMPLIANT |
| Safety Formula, Categories, And SQLite Persistence | Historical rating is updated | `tests/parser-and-domain.test.ts` proves formula helper, but not persisted old/race/new values through repository flow | ⚠️ PARTIAL |
| Safety Formula, Categories, And SQLite Persistence | Processed file is seen again | `tests/persistence.test.ts` proves filename dedupe at SQLite boundary; watcher re-seen path remains untested | ⚠️ PARTIAL |
| Webhook Delivery And Console Fallback | Webhook is configured | No passing mocked delivery test in repo | ❌ UNTESTED |
| Webhook Delivery And Console Fallback | Webhook is empty | `tests/webhook.test.ts` fallback logs and does not crash | ✅ COMPLIANT |
| Embed Shape And Deterministic Awards | Standard classified race | Static evidence only: `src/discord/buildRaceMessage.ts` | ❌ UNTESTED |
| Embed Shape And Deterministic Awards | Webhook fallback summary | `tests/webhook.test.ts` proves title/footer presence and no crash, but not full parity of required report blocks | ⚠️ PARTIAL |

**Compliance summary**: 3/11 scenarios compliant, 4/11 partial, 4/11 untested.

### Correctness (Static And Runtime Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Exact env vars and defaults | ✅ Implemented | `src/config.ts` defaults and `.env.example` / compose values match the corrected spec, including host path vars. |
| Watcher stability gate and duplicate prevention | ⚠️ Partially proven | `src/watcher.ts` implements age gate, second stat, retry scheduling, and pre-process duplicate skip; automated tests do not exercise this path. |
| Non-RACE skip behavior | ✅ Proven | Parser test rejects `QUALIFY`; replay command returned `non-race` and did not create persistence rows for that file. |
| Parser validation and placeholder filtering | ⚠️ Partially proven | Placeholder filtering is covered by test; corrupt JSON / Zod retry behavior is only statically verified. |
| GUID-only persistence | ✅ Proven | Repository test persists only GUID-backed drivers; temp identities stay out of `drivers` and `race_driver_results`. |
| Grouped incidents behavior | ✅ Proven | Grouping test verifies mirrored event dedupe and split of distinct incidents. |
| Per-driver stats and formulas | ⚠️ Partially proven | Safety formula is covered; `calculateDriverStats.ts` exact field derivation is not directly tested. |
| Discord message contract and empty-webhook fallback | ⚠️ Partially proven | Empty-webhook fallback is tested; configured webhook path and full embed/report contract are not. |
| Docker / Compose / README contract | ✅ Implemented | Files exist and align with required mounts, defaults, and command documentation, but are not runtime-tested. |
| Persistence across restart / re-run via SQLite | ✅ Runtime-evidenced | Two-pass replay against the same DB produced counts `races=3, drivers=5, processed=3, results=15` before and after rerun, with second pass returning only duplicates. |
| New automated test layer materially covers spec | ⚠️ Partial | The prior "no tests" failure is fixed; current test layer materially covers parser/grouping/safety/persistence fallback, but not watcher, env contract, configured webhook, or full message contract. |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Single worker pipeline | ✅ Yes | `src/index.ts` wires parse -> group -> stats -> safety -> persist -> notify. |
| Zod validation at file boundary | ✅ Yes | `src/types/assetto.ts` and `parseRaceJson.ts`. |
| Duplicate strategy via `processed_files.file_name` | ✅ Yes | Repository checks filename before insert and during transaction; replay rerun stayed idempotent. |
| Missing GUID stays out of `drivers` history | ✅ Yes | GUID-less drivers are skipped during persistence. |
| Watch only files matching `WATCH_GLOB` | ⚠️ Partial | `src/watcher.ts` watches the directory and filters file names in code instead of initializing chokidar with the glob itself. |

### Runtime Replay Evidence
```text
Replay command: node -e <processor replay script>

First pass results:
- 2026_6_20_1_9_QUALIFY.json -> non-race
- 2026_6_20_2_16_RACE.json -> processed
- 2026_6_20_3_3_RACE.json -> processed
- 2026_6_20_4_0_RACE.json -> processed

Counts after first pass:
- races=3
- drivers=5
- processed_files=3
- race_driver_results=15

Second pass results:
- 2026_6_20_1_9_QUALIFY.json -> non-race
- all three RACE files -> duplicate

Counts after second pass:
- races=3
- drivers=5
- processed_files=3
- race_driver_results=15
```

### Issues Found
**CRITICAL**
- The previous FAIL reason is resolved: the repo now has a real automated test layer and `npm test` passes. However, the change still fails SDD verify because 8 of 11 spec scenarios remain only partial or untested, including core watcher-gate behavior, configured-webhook delivery, the standard Discord report contract, and the exact env/default scenario.
- `src/watcher.ts` implements the stability and invalid-JSON retry logic, but there is still no passing automated test that proves the worker delays a still-growing file and retries corrupt JSON without crashing. That is a core ingestion safety requirement, not optional polish.
- `src/discord/buildRaceMessage.ts` and `src/discord/sendWebhook.ts` still lack a passing in-repo verification of the configured-webhook path and the full embed contract. The fallback path is tested; the actual delivery contract is not proven.
- Historical safety persistence is only partially verified. The helper formula is tested, but there is no passing test proving `oldSafety`, `raceScore`, and `newSafety` are persisted correctly through the repository or end-to-end processor flow for an existing GUID-backed driver.

**WARNING**
- `src/watcher.ts` watches `RESULTS_DIR` and filters `WATCH_GLOB` in code instead of watching the glob directly. Processing behavior is correct, but this is still a spec/design drift.
- `calculateDriverStats.ts` is not directly covered by tests for exact output shape or formulas such as `avgLap`, `idealLap`, `consistency`, tyre mode, and raw collision counting. The hardest domain math is still inferred rather than proved.
- `README.md`, `docker-compose.yml`, and `docker-compose.oracle.yml` match the contract statically, but there is no automated ops verification. A future edit could silently drift these files without a test failing.
- Node 24 `node:sqlite` emits an experimental warning during tests and replay. It does not fail verification today, but it remains an operational dependency risk.

**SUGGESTION**
- Add a watcher integration test that writes a JSON file in multiple chunks and proves the age gate, size-stability recheck, invalid-JSON retry, and duplicate suppression logs/behavior.
- Add a notifier test with mocked `fetch` for the non-empty webhook path and assert exactly one HTTP request plus the expected embed title, required fields, footer, and deterministic awards.
- Add at least one processor-level integration test that seeds an existing driver safety rating, processes a real sample, and asserts persisted `old_safety`, `race_score`, and `new_safety` rows.
- Add a thin config/ops contract test that snapshots the exact env defaults and required compose values so the operational contract cannot drift silently.

### Verdict
FAIL

The prior FAIL was materially improved and the verification-hardening slice succeeded in adding real tests. But this is still not a full SDD pass: too many corrected-spec scenarios remain unproven by passing runtime tests.
