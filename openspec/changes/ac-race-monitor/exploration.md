## Exploration: ac-race-monitor

### Current State
The repository is a bootstrap baseline with no application code, no runtime, and no established architecture. The only domain inputs are sample Assetto Corsa session exports in `samples/results/*.json`, including one `QUALIFY` file and three `RACE` files. The `RACE` samples already contain the core data needed for an MVP: `Cars`, `Result`, `Laps`, and `Events` with `COLLISION_WITH_CAR` and `COLLISION_WITH_ENV` entries.

### Affected Areas
- `samples/results/2026_6_20_2_16_RACE.json` — proves the minimal race payload shape and shows `Events` are available in `RACE` exports.
- `samples/results/2026_6_20_3_3_RACE.json` — shows repeated collision events, including car-car pairs emitted from both drivers.
- `samples/results/2026_6_20_4_0_RACE.json` — shows valid finish data, blank driver slots, and sentinel result values like `BestLap: 999999999` and `TotalTime: 0`.
- `samples/results/2026_6_20_1_9_QUALIFY.json` — confirms non-race files exist and should be ignored by the worker MVP.
- `openspec/config.yaml` — establishes empty-repo constraints, Docker/SQLite/Discord MVP direction, and the 400-line review budget guard.

### Approaches
1. **Single worker pipeline** — one Dockerized Node.js + TypeScript worker watches the results directory, waits for file stability, validates JSON, computes race metrics, stores derived rows in SQLite, and sends one Discord webhook embed.
   - Pros: Smallest MVP, aligns with empty repo baseline, easy to run in Docker Compose and on Oracle, simplest operational model.
   - Cons: Requires careful idempotency and file-stability handling because there is no queue or external orchestrator.
   - Effort: Medium

2. **Multi-stage ingestion pipeline** — separate watcher, parser, scorer, and notifier stages with an internal queue or persisted inbox.
   - Pros: Better separation for future scale and retries.
   - Cons: Premature complexity for a repo with no existing runtime, harder to keep under the review budget, more moving parts for deployment.
   - Effort: High

### Recommendation
Use the single worker pipeline for MVP.

The sample files show the main challenge is not throughput but deterministic interpretation. The worker should process only `*RACE*.json`, wait `MIN_FILE_AGE_MS`, confirm size stability, require `json.Type === 'RACE'`, ignore placeholder slots, and derive incidents from `Events`. SQLite is sufficient for race history and rolling safety ratings at MVP scale, and a plain Discord webhook keeps outbound integration simple, with console fallback when the webhook is empty.

For grouped incidents, the worker should treat `COLLISION_WITH_CAR` as potentially duplicated symmetric records because the same contact appears once per involved driver in the samples. Grouping should use `min(CarId)` and `max(CarId)`, match within `6` meters when positions exist, or fallback to nearby array order within `2` events, and summarize the grouped contact without absolute blame. `COLLISION_WITH_ENV` should remain single-driver incidents.

### Risks
- Assetto Corsa emits blank grid slots and empty GUIDs; the parser must exclude them from driver identity and stats.
- `Result` includes sentinel values like `BestLap = 999999999` and `TotalTime = 0`; naive ranking or averages would be wrong.
- `Events` do not expose an explicit timestamp in the samples, so grouped incident logic must dedupe by participant and spatial similarity rather than time.
- File watching inside Docker can vary by host and mounted filesystem; Oracle deployment may require configurable chokidar polling instead of pure native events.
- Reprocessing the same file after container restart is likely unless the worker stores processed files in SQLite and checks them idempotently.
- Safety score math is domain-sensitive; the exact requested formula and rolling update MUST stay frozen in spec/design to avoid drift.

### Ready for Proposal
Yes — with these MVP boundaries made explicit:

- In scope: watch one results directory, detect new `*RACE*.json`, wait for stability, validate/parse deterministically, compute per-race incidents and per-driver stats, persist race and rolling safety rating in SQLite, send one Discord embed summary, package for Docker Compose and Oracle.
- Out of scope: Discord bot flows, slash commands, dashboards, AI analysis, qualification processing, live telemetry, manual stewarding UI, and cross-service orchestration.
- Constraint to carry forward: implement the already fixed safety-score weights, rolling-rating formula, categories, awards, and SQLite schema without renaming or reinterpretation.
