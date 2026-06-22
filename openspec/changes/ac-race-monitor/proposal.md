# Proposal: AC Race Monitor MVP

## Intent

Create a deterministic MVP worker that turns new Assetto Corsa `RACE` result exports into persisted safety data and one Discord summary, without manual intervention.

## Scope

### In Scope
- Watch a results mount, process only stable `*RACE*.json` files, and ignore non-`RACE` exports.
- Run one deterministic pipeline: watcher -> stable file -> parser -> incident grouping -> stats -> safety -> SQLite persistence -> Discord webhook.
- Persist processed-race state so duplicate files are not reprocessed and restarts resume safely.
- Support local Docker Compose and Oracle Compose deployment with read-only results mount and separate persistent data mount.

### Out of Scope
- QUALIFY handling, live telemetry, dashboards, Discord bot commands, stewarding UI, AI analysis.
- Multi-service orchestration, external queues, or non-SQLite storage.

## Capabilities

### New Capabilities
- `race-result-monitoring`: End-to-end ingestion, normalization, incident grouping, driver/race stats, safety scoring, idempotent SQLite writes.
- `discord-race-notifications`: Webhook-based race summary delivery from persisted race results with configuration-only endpoint management.

### Modified Capabilities
- None.

## Approach

Use a single Node.js/TypeScript worker. It watches `*RACE*.json`, waits `MIN_FILE_AGE_MS`, verifies file size stability before parsing, requires `json.Type === 'RACE'`, skips placeholder slots, groups symmetric `COLLISION_WITH_CAR` deterministically, keeps `COLLISION_WITH_ENV` per driver, stores race + rolling safety state in SQLite using the requested schema, then posts one webhook summary or logs it when the webhook is empty.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/ac-race-monitor/proposal.md` | New | MVP intent, scope, constraints, and capability contract |
| `openspec/changes/ac-race-monitor/specs/` | New | Future delta specs for monitoring and webhook behavior |
| `docker-compose*` | New | Local and Oracle deployment targets |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate symmetric collision events distort incidents | High | Spec a deterministic grouping key before implementation |
| Restart/file-watch behavior causes duplicate processing | High | Persist processed files in SQLite and make duplicate detection idempotent |
| Safety formula drifts during implementation | Med | Lock the exact requested weights, thresholds, and rolling formula in spec/design |

## Rollback Plan

Remove the worker service and change artifacts; no existing runtime behavior is replaced because the repo is still bootstrap-only.

## Dependencies

- Mounted Assetto Corsa result exports
- Configured Discord webhook via environment variable
- Persistent SQLite storage volume

## Success Criteria

- [ ] New stable `RACE` files are processed once, non-`RACE` files are skipped, and restarts do not duplicate work.
- [ ] Parsing, incident grouping, stats, safety output, SQLite persistence, and Discord delivery are deterministic for the provided sample inputs.
- [ ] Deployment assumptions for local Docker Compose and Oracle Compose are documented without hardcoded secrets.

## Resolved Decisions

- Safety score weights, thresholds, finish bonuses, and destructive-DNF penalty are fixed in spec.
- Processed-file tracking uses SQLite via `PROCESSED_FILE_STRATEGY=sqlite`.
- Discord summary shape is fixed, including title, awards, safety table, incident summary, and processed filename footer.
