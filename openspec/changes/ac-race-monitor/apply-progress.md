# Apply Progress: ac-race-monitor

## Implementation Progress

**Change**: ac-race-monitor
**Mode**: Standard

### Completed Tasks
- [x] 1.1 Create `package.json`, `tsconfig.json`, `.env.example`, `Dockerfile`, `src/index.ts`, and `src/config.ts` with the exact env contract and startup/shutdown wiring.
- [x] 1.2 Define raw Assetto Corsa payload and normalized race/result types in `src/types/assetto.ts` for `Cars`, `Result`, `Laps`, and `Events`.
- [x] 1.3 Implement `src/parser/parseRaceJson.ts` to load JSON, require `Type === 'RACE'`, ignore placeholder slots, and keep temp identities separate from GUID history.
- [x] 2.1 Implement `src/parser/groupIncidents.ts` for symmetric `COLLISION_WITH_CAR` dedupe by ordered pair plus distance `<= 6` or event-index tolerance `<= 2`; keep env hits single-driver.
- [x] 2.2 Implement `src/parser/formatTime.ts` and `src/parser/calculateDriverStats.ts` to derive the exact per-driver stats shape, sentinel handling, laps, cuts, tyres, and impacts.
- [x] 2.3 Implement `src/parser/calculateSafety.ts` with the frozen race score, rolling rating formula, and exact safety categories from spec.
- [x] 3.1 Create `src/db/schema.sql`, `src/db/db.ts`, and `src/db/repositories.ts` for the exact SQLite tables, schema bootstrap, race writes, driver upserts, and `processed_files` lookups.
- [x] 3.2 Implement `src/watcher.ts` to scan on start, watch `WATCH_GLOB`, enforce `MIN_FILE_AGE_MS` stability, retry invalid/incomplete JSON safely, and skip already processed files.
- [x] 3.3 Wire `src/index.ts` to orchestrate parse -> group -> stats -> safety -> SQLite transaction -> notify, with idempotent processed-file marking after successful persistence.
- [x] 4.1 Implement `src/discord/buildRaceMessage.ts` and `src/discord/sendWebhook.ts` for the fixed report title, awards, safety table, incident summary, processed filename footer, and empty-webhook console fallback.
- [x] 4.2 Create `docker-compose.yml`, `docker-compose.oracle.yml`, `data/.gitkeep`, and `README.md` with mounts, env setup, sample replay flow, and Oracle/local run instructions.
- [x] 4.3 Verify with `samples/results/`: non-`RACE` skip, stable-file retry, grouped incidents, safety persistence, duplicate-file idempotency, webhook path, and console fallback; record the exact commands in `README.md`.

### Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `package.json` | Created/Updated | Added the TypeScript runtime scripts and the `chokidar` watcher dependency. |
| `package-lock.json` | Created/Updated | Locked parser and watcher dependencies for reproducible local verification. |
| `tsconfig.json` | Created | Added strict TypeScript build configuration for `src/` -> `dist/`. |
| `.env.example` | Created | Documented the exact env contract frozen by spec. |
| `src/index.ts` | Created/Updated | Added runtime orchestration, persistence wiring, and shutdown hooks. |
| `src/config.ts` | Created | Added validated config loading with exact env defaults. |
| `src/types/assetto.ts` | Created | Added Zod payload schemas plus normalized parser/domain types. |
| `src/parser/parseRaceJson.ts` | Created | Added `RACE`-only parsing, placeholder filtering, and temp identity isolation. |
| `src/parser/groupIncidents.ts` | Created | Added deterministic mirrored collision grouping. |
| `src/parser/formatTime.ts` | Created | Added deterministic millisecond formatting helper. |
| `src/parser/calculateDriverStats.ts` | Created | Added lap, cuts, tyre, incident, and impact aggregation. |
| `src/parser/calculateSafety.ts` | Created | Added exact race-score, rolling-safety, and category calculations. |
| `src/db/schema.sql` | Created | Added the exact SQLite schema frozen by spec. |
| `src/db/db.ts` | Created | Added SQLite bootstrap that creates the DB parent directory and applies the schema. |
| `src/db/repositories.ts` | Created | Added processed-file lookups, safety-history reads, and transactional race persistence. |
| `src/watcher.ts` | Created | Added scan-on-start, stability gate, invalid-JSON retries, and duplicate-safe file scheduling. |
| `src/discord/buildRaceMessage.ts` | Created | Added deterministic Discord/embed summary generation, awards, safety table, and console-renderable text fallback. |
| `src/discord/sendWebhook.ts` | Created | Added one-shot webhook delivery with empty-webhook console fallback and non-fatal transport logging. |
| `Dockerfile` | Created | Added the Node 24 container image needed for `node:sqlite`, build, and runtime startup. |
| `docker-compose.yml` | Created | Added the local compose target with read-only results mount and persistent data mount. |
| `docker-compose.oracle.yml` | Created | Added the Oracle-targeted compose target using the requested host paths. |
| `data/.gitkeep` | Created | Added the persistent data directory scaffold expected by Compose. |
| `README.md` | Created | Documented runtime contract, local/Oracle startup, and verification commands. |
| `openspec/changes/ac-race-monitor/tasks.md` | Updated | Marked completed slice-2 persistence and watcher tasks. |
| `openspec/changes/ac-race-monitor/tasks.md` | Updated | Marked the notifier/ops/verification slice complete, including the now-finished Dockerfile portion of task 1.1. |
| `tests/parser-and-domain.test.ts` | Created | Added focused sample-driven tests for placeholder filtering, non-RACE rejection, grouped incident dedupe, and frozen safety/category formulas. |
| `tests/persistence.test.ts` | Created | Added SQLite integration tests for GUID-only persistence and duplicate filename suppression. |
| `tests/webhook.test.ts` | Created | Added notifier fallback coverage for empty-webhook console logging without crashes. |
| `package.json` | Updated | Added the repo `test` script using `tsx --test` with Node's built-in test runner. |
| `openspec/changes/ac-race-monitor/apply-progress.md` | Updated | Recorded the cumulative state through stacked PR slice 3. |

### Deviations From Design
- The implementation uses `src/discord/*` instead of the earlier design draft's `src/notifications/*`, matching the corrected slice scope and tasks artifact.
- The watcher still observes `RESULTS_DIR` and filters `WATCH_GLOB` in code instead of watching the glob directly, because direct glob initialization did not emit the expected initial `add` events during verification.

### Issues Found
- Real sample payloads contain `OtherDriver.GuidsList: null` on some collision events, so the schema now tolerates nullable values at the boundary.
- Slice-1 drift was found in `calculateDriverStats.ts`: `consistency` had been converted into a normalized 0-100 score instead of the raw LapTime standard deviation required by the contract.
- The spec's `race_driver_results.guid TEXT NOT NULL` contract means GUID-less temporary drivers can be calculated in-memory but cannot be persisted into history tables; the repository now skips those rows while keeping them out of `drivers` as required.
- `node:sqlite` is available on the current Node 24 runtime, but it emits an experimental warning during verification.
- Discord transport failures now log and continue instead of throwing after persistence, so processed-file idempotency never causes a crash-loop after a successful race write.
- Final slice-3 drift: `README.md` had indirect startup/deploy guidance instead of the exact user-requested command blocks, and `buildRaceMessage.ts` used proxy heuristics for `💥 Misil nuclear` / `🚜 Cono del día` while allowing `📈 Más consistente` with fewer than 2 laps.
- The lightest stable test setup for this repo is `node:test` executed through `tsx`, which adds automated verification without bringing in Vitest/Jest or changing the runtime structure.

### Remaining Tasks
- [ ] None in apply scope. Slice 3 completed the assigned notifier/ops/verification boundary.

### Workload / PR Boundary
- Mode: stacked PR slice
- Current work unit: PR 3 notifier/ops/verification
- Boundary: Discord report builder + webhook/fallback delivery + Docker/Compose packaging + README/scaffolding + final persistence-to-notify integration verification
- Estimated review budget impact: This slice stays focused but may land slightly above the 400-line target because Docker/Compose and README are required packaging artifacts for the same user-visible work unit

### Status
12/12 tasks complete. Final verification-gap closure slice added the remaining runtime proofs and is ready for re-verify.

## Repair Notes

- Repaired the final slice-3 contract drift without expanding scope beyond `README.md`, `src/discord/buildRaceMessage.ts`, and this progress record.
- `💥 Misil nuclear` now requires an impact above `120` and prefers grouped incident pair wording when a qualifying car-vs-car incident exists.
- `🚜 Cono del día` now uses the worst `raceScore` among active drivers instead of incident-count proxies.
- `📈 Más consistente` now only considers drivers with `2+` completed laps.
- `README.md` now exposes the requested local run, sample test, Docker local, Oracle deploy, and Oracle env edit commands directly.

## Verification Hardening Slice

- Added a maintainable in-repo automated verification layer with no new test framework dependency.
- `npm test` now covers the verify-blocking scenarios: parser validation and placeholder filtering, grouped incident dedupe, safety formula and categories, GUID-only persistence, duplicate suppression via SQLite, and empty-webhook fallback behavior.
- Also covered the optional non-RACE skip scenario through `NonRaceSessionError` assertions.

## Final Verification-Gap Closure Slice

- Added real watcher integration tests for delayed processing of growing files, corrupt-JSON retry then skip, and duplicate suppression after a successful run.
- Added configured-webhook coverage that proves exactly one request is sent and the Discord embed title, footer, and required fields match the contract materially.
- Added processor-level persistence coverage that seeds an existing GUID-backed driver, proves `oldSafety` is read from history, and verifies `raceScore` / `newSafety` persistence in both `race_driver_results` and `drivers`.
- No production code changes were required for this slice; the existing implementation satisfied the corrected spec once the missing runtime tests were added.
- Verification after this slice: `npm test` (18/18 passing), `npm run typecheck`, and `npm run build` all pass.

## AC Race Monitor Bugfix Repair Slice

- Normalized `Events: null | undefined` to `[]` before Zod validation so clean race exports are accepted instead of rejected.
- Centralized participation flags in `calculateDriverStats.ts`: `hasValidResult`, `active`, `inactive`, `finished`, and `destructiveDnf` now drive safety and reporting consistently.
- `finished` now follows `completedLaps >= raceLaps`; DNF/DNS labels are rendered without changing official result order.
- Inactive/DNS entries now keep `raceScore = 0`, preserve `oldSafetyRating === newSafetyRating`, are excluded from awards, and no longer mutate the historical `drivers` table.
- Destructive DNF now remains active and receives the frozen extra penalty via `destructiveDnf` instead of grouped-incident heuristics.
- Discord presentation no longer emits raw `ms` values for consistency; it uses `formatLapTime`, `formatGap`, and `formatConsistency` helpers while keeping internal calculations in milliseconds.
- Incident summary now reports separate max car-car, max environment, and max total impact values.
- Added regression coverage for null events, inactive/DNS award exclusion, inactive safety no-op, destructive DNF penalty, formatted Discord output, and separated impact summary lines.

## Award Cleanup Bugfix Slice

- `buildRaceMessage.ts` now omits invalid award rows entirely instead of rendering `Sin datos` / `No aplica` placeholders.
- `🧼 Más limpio` and `📈 Más consistente` now require real competition: at least two active finished candidates, with `completedLaps >= 2` for consistency.
- `🐢 Tortuga digna` now only considers active finished drivers with `raceScore >= 60`, hides on a sole finisher, and is suppressed when the fastest-lap winner would also take tortoise in a sub-3-finisher race.
- Negative awards now render only when backed by real data: `envHits > 0` for `🧱 Albañil`, `maxImpact > 0` for `💥 Misil`, `destructiveDnf === true` for `🪦 DNF destructivo`, and `🚜 Cono` only when the worst active driver was actually poor/incident-prone.
- `tests/webhook.test.ts` now covers the cleanup cases explicitly, including the one-finisher `Kanus` + DNF `ramen` scenario and the absence of `No aplica` lines.
- Test fixture helper `createStat()` was corrected to preserve explicit `null` lap/consistency values instead of coercing them back to default times, which previously created false-positive award candidates.

## Live UDP Smoke Protocol Repair Slice

- Replaced the live smoke parser's fake JSON/delimited assumption with the real Assetto Corsa server plugin binary layout for packet `53` (`car_update`) and client-event packet `130` with event types `10` (`collision_with_car`) and `11` (`collision_with_env`).
- `car_update` smoke parsing now reads `carId`, `worldPos`, `velocity`, `gear`, `engineRPM`, and `normalizedSplinePos`, plus derives `speedKmh` from the velocity vector for readable logs.
- Collision smoke parsing now reads real `impactSpeed`, `worldPos`, and `relPos` fields for both car-vs-car and env impacts.
- The realtime report enable command now uses packet id `200` with `intervalMs` encoded as `uint16le`, matching the verified protocol.
- `src/live/acUdpClient.ts` smoke logs now expose protocol-aligned semantics (`car_update`, `collision_with_car`, `collision_with_env`) with useful numeric fields like `carId`, `otherCarId`, `impact`, `spline`, `gear`, and `engineRpm`.
- Added focused regression coverage for binary live packet parsing, smoke-gate completion after all three packet kinds, and realtime-enable command/log behavior.
- Batch `RACE.json` ingestion, persistence, matching, snapshots, verdicts, and later phases were intentionally left untouched.
