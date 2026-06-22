# Tasks: AC Race Monitor MVP

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900-1300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation/parser -> PR 2 persistence/watcher -> PR 3 notifier/ops/verification |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Bootstrap runtime, types, parser, calculations | PR 1 | Base can be tracker branch; include sample replay checks |
| 2 | Add SQLite schema, repositories, processed-file idempotency, watcher orchestration | PR 2 | Depends on PR 1; verification must cover duplicate skip |
| 3 | Add Discord delivery, Docker/Compose, README, end-to-end verification | PR 3 | Depends on PR 2; include empty-webhook fallback |

## Phase 1: Foundation

- [x] 1.1 Create `package.json`, `tsconfig.json`, `.env.example`, `Dockerfile`, `src/index.ts`, and `src/config.ts` with the exact env contract and startup/shutdown wiring.
- [x] 1.2 Define raw Assetto Corsa payload and normalized race/result types in `src/types/assetto.ts` for `Cars`, `Result`, `Laps`, and `Events`.
- [x] 1.3 Implement `src/parser/parseRaceJson.ts` to load JSON, require `Type === 'RACE'`, ignore placeholder slots, and keep temp identities separate from GUID history.

## Phase 2: Domain Calculations

- [x] 2.1 Implement `src/parser/groupIncidents.ts` for symmetric `COLLISION_WITH_CAR` dedupe by ordered pair plus distance `<= 6` or event-index tolerance `<= 2`; keep env hits single-driver.
- [x] 2.2 Implement `src/parser/formatTime.ts` and `src/parser/calculateDriverStats.ts` to derive the exact per-driver stats shape, sentinel handling, laps, cuts, tyres, and impacts.
- [x] 2.3 Implement `src/parser/calculateSafety.ts` with the frozen race score, rolling rating formula, and exact safety categories from spec.

## Phase 3: Persistence And Orchestration

- [x] 3.1 Create `src/db/schema.sql`, `src/db/db.ts`, and `src/db/repositories.ts` for the exact SQLite tables, schema bootstrap, race writes, driver upserts, and `processed_files` lookups.
- [x] 3.2 Implement `src/watcher.ts` to scan on start, watch `WATCH_GLOB`, enforce `MIN_FILE_AGE_MS` stability, retry invalid/incomplete JSON safely, and skip already processed files.
- [x] 3.3 Wire `src/index.ts` to orchestrate parse -> group -> stats -> safety -> SQLite transaction -> notify, with idempotent processed-file marking after successful persistence.

## Phase 4: Notifications, Ops, And Verification

- [x] 4.1 Implement `src/discord/buildRaceMessage.ts` and `src/discord/sendWebhook.ts` for the fixed report title, awards, safety table, incident summary, processed filename footer, and empty-webhook console fallback.
- [x] 4.2 Create `docker-compose.yml`, `docker-compose.oracle.yml`, `data/.gitkeep`, and `README.md` with mounts, env setup, sample replay flow, and Oracle/local run instructions.
- [x] 4.3 Verify with `samples/results/`: non-`RACE` skip, stable-file retry, grouped incidents, safety persistence, duplicate-file idempotency, webhook path, and console fallback; record the exact commands in `README.md`.
