## Exploration: ac-race-monitor-safety-followup

### Current State
`calculateDriverStats()` already classifies `active` and `inactive`, `repositories.races.persist()` already skips inactive rows, and `buildRaceMessage()` still renders every driver in `Safety actualizada`. Safety updates are always applied to every active driver because `applySafetyRatings()` has no active-driver threshold or gain/loss gating, and `formatLapTime()` currently reuses a zero-padded clock formatter (`MM:SS.mmm`) instead of lap-style `M:SS.mmm`.

### Affected Areas
- `src/discord/buildRaceMessage.ts` — `Safety actualizada` includes inactive/DNS rows and has no wording for unchanged safety caused by low active-driver count.
- `src/parser/calculateSafety.ts` — no minimum-active-driver rule, no distinction between blocked gains and allowed losses, and no way to surface why safety stayed unchanged.
- `src/config.ts` — missing config fields for minimum active drivers and whether losses remain allowed below that threshold.
- `src/index.ts` — passes only memory/default config into `applySafetyRatings()`, so any new safety gating config must be threaded here.
- `src/parser/formatTime.ts` — `formatLapTime()` currently inherits `MM:SS.mmm` formatting, which is wrong for lap-style output.
- `tests/webhook.test.ts` — current expectations still require DNS in `Safety actualizada` and do not cover the low-player unchanged-safety message or tortoise lap formatting.
- `tests/persistence.test.ts` — already covers SQLite skip behavior for inactive/DNS, but needs a follow-up assertion set only if message/persistence expectations are expanded around low-player races.
- `tests/parser-and-domain.test.ts` — needs coverage for minimum-active-driver safety gain prevention and optional loss allowance below the threshold.

### Approaches
1. **Add safety gating inside `applySafetyRatings()`** — count active drivers once, block positive deltas below the configured threshold, optionally allow negative deltas, and annotate rows for report rendering.
   - Pros: Keeps safety policy centralized and consistent for persistence plus reporting.
   - Cons: Adds a small contract change to `DriverRaceStats` or a parallel report metadata shape.
   - Effort: Medium

2. **Handle low-player rules only in message/persistence layers** — keep safety math untouched and patch consumers locally.
   - Pros: Smaller local edits.
   - Cons: Wrong abstraction; persistence and Discord can drift from each other fast.
   - Effort: Medium

### Recommendation
Use approach 1. Add the threshold/allow-loss config in `config.ts`, thread it through `index.ts`, centralize the gating in `applySafetyRatings()`, then make `buildRaceMessage()` hide inactive/DNS safety rows and explain unchanged safety when gains were blocked.

### Risks
- Changing `formatLapTime()` globally will affect fastest-lap, podium gap-adjacent text, and any future callers, not just `🐢 Tortuga digna`.
- If safety gating adds new fields to `DriverRaceStats`, all test factories must be updated together to avoid silent default mismatches.
- Persistence already skips inactive drivers in SQLite; changing that logic by accident would regress a behavior that is already covered and currently correct.
- The active-driver count policy depends on `calculateDriverStats()` classification; if `active` semantics change later, safety gating behavior will also shift.

### Ready for Proposal
Yes — the implementation slice is narrow: config, safety gating, report wording/filtering, lap-time formatting, and targeted regression tests.
