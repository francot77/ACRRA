# Design: AC Race Monitor MVP

## Technical Approach

Build one Dockerized Node.js + TypeScript worker with a linear pipeline: `watcher -> stability gate -> parser -> grouping -> stats -> safety -> sqlite transaction -> notifier`. The repo has no runtime yet, so the design keeps boundaries explicit and small while preserving the corrected spec as the source of truth for env vars, SQLite schema, safety math, and Discord contract.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Runtime shape | Single worker service | Multi-stage queue pipeline | Matches MVP scope, keeps Docker/ops simple, and stays reviewable from an empty repo baseline. |
| Validation | Zod schemas at file boundary | Ad-hoc parsing | Freezes the accepted Assetto Corsa payload shape, gives safe narrowing, and keeps corrupt/incomplete JSON failures explicit. |
| Duplicate strategy | `processed_files` check by `file_name`, store `file_hash` for diagnostics | Hash-only dedupe | The spec freezes SQLite processed-file tracking; filename remains the idempotency key while hash helps logs. |
| Missing GUID handling | Ephemeral race-local id `temp:{fileName}:{carId}` used only in-memory and optional `race_driver_results` rows, never in `drivers` | Merge by driver name | Prevents historical pollution and avoids false merges across races. |
| Logging | Structured stdout/stderr JSON lines with component tags | Silent worker or file logs | Best fit for Docker and Oracle Compose; logs remain inspectable without writable app FS. |

## Data Flow

`src/watcher/race-file-watcher.ts` receives `add/change` for `WATCH_GLOB` and schedules a path.

`src/watcher/file-stability.ts` waits `MIN_FILE_AGE_MS`, stats twice, and requeues when size changes or JSON is still incomplete.

`src/parsing/ac-session.schema.ts` validates the raw payload; `src/parsing/race-parser.ts` rejects `json.Type !== 'RACE'`, ignores placeholder slots, and normalizes race, lap, and event records.

`src/domain/group-incidents.ts` groups only symmetric `COLLISION_WITH_CAR` by ordered pair plus either world-distance `<= 6m` or event-index proximity `<= 2`; `COLLISION_WITH_ENV` stays per-driver.

`src/domain/build-driver-stats.ts` derives the exact per-driver stat shape; `src/domain/calculate-safety.ts` applies the frozen race score and rolling rating formulas.

`src/persistence/race-processing-service.ts` runs one SQLite transaction: skip when `processed_files.file_name` already exists, insert race, insert race driver results, upsert GUID-backed `drivers`, then mark processed.

`src/notifications/build-race-report.ts` creates awards, safety rows, incident summary, and footer deterministically; `src/notifications/discord-webhook.ts` posts once or logs the same report when the webhook is empty.

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json`, `tsconfig.json`, `.env.example` | Create | Node/TS runtime and exact env contract. |
| `Dockerfile`, `docker-compose.yml` | Create | Worker image, read-only `/app/results`, persistent `/app/data`. |
| `src/index.ts` | Create | Bootstrap env, DB, watcher, shutdown hooks. |
| `src/config/env.ts` | Create | Loads exact env vars and defaults. |
| `src/logging/logger.ts` | Create | Structured logger helper. |
| `src/watcher/*` | Create | Chokidar watcher and file-stability gate. |
| `src/parsing/*` | Create | Zod schemas and normalized parser. |
| `src/domain/*` | Create | Grouping, stats, safety, awards, categories. |
| `src/persistence/*` | Create | SQLite client, schema bootstrap, repositories, transaction service. |
| `src/notifications/*` | Create | Embed/report builder and webhook client. |
| `tests/fixtures/*`, `tests/*` | Create | Sample-driven parser, grouping, persistence, and notifier checks. |

## Interfaces / Contracts

```ts
type DriverKey = { kind: 'guid'; value: string } | { kind: 'temp'; value: `temp:${string}:${number}` };

interface ProcessedFileRepository {
  has(fileName: string): boolean;
  markProcessed(input: { fileName: string; filePath: string; fileHash?: string; processedAt: string }): void;
}
```

SQLite boundary rule: repositories expose spec-shaped operations only, never raw SQL to watcher/parser/notifier layers.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Zod parsing, placeholder filtering, grouping, safety math, awards tie-breaks | Fixture-driven tests from `samples/results/*.json` plus focused synthetic events. |
| Integration | SQLite transaction, duplicate skip, temp-id exclusion from `drivers`, console fallback | Temp DB file per test and mocked webhook transport. |
| E2E | Scan-on-start processes each sample once | Docker Compose or local process with mounted fixtures. |

## Migration / Rollout

No migration required. On startup, bootstrap the exact SQLite schema if missing.

## Open Questions

- [ ] None blocking. The next phase should split implementation into work units that respect the 400-line review budget.
