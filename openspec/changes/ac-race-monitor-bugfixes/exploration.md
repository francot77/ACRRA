## Exploration: ac-race-monitor-bugfixes

### Current State
`parseRaceJson()` validates the raw Assetto payload with Zod and builds `drivers`, `lapsByCarId`, and `events`. `calculateDriverStats()` derives per-driver stats from parsed laps and events. `applySafetyRatings()` updates safety for every driver stat row with no participation guard. `buildRaceMessage()` derives podium, awards, safety lines, and incident summary from those stats using ad hoc predicates like `finished`, `completedLaps > 0`, and `totalTime > 0`.

### Affected Areas
- `src/types/assetto.ts` — raw schema currently rejects `Events: null`; stat types also expose only `finished` and one `maxImpact`, which is too coarse for the reported bugs.
- `src/parser/parseRaceJson.ts` — `session.Events.forEach(...)` assumes a non-null array and only normalizes placeholder results, not nullable events.
- `src/parser/calculateDriverStats.ts` — current status derivation is only `finished: driver.totalTime > 0`; no explicit inactive/DNS/DNF classification and only one aggregated `maxImpact`.
- `src/parser/calculateSafety.ts` — safety is applied to every stat row; inactive/DNS drivers are not excluded.
- `src/discord/buildRaceMessage.ts` — podium, awards, safety table, and incident summary all depend on implicit status logic and the single `maxImpact` field.
- `src/parser/formatTime.ts` — only one lap-style formatter exists; no helper for consistency/gap/status-oriented presentation.
- `tests/parser-and-domain.test.ts` — covers placeholder filtering and safety math, but not nullable `Events`, classification states, or inactive safety skips.
- `tests/webhook.test.ts` — covers field presence, but not DNS/DNF podium/report wording, award eligibility filtering, or split impact presentation.
- `samples/results/*.json` — needs one new fixture with `"Events": null` to freeze parser behavior.

### Approaches
1. **Centralize classification in stats** — add explicit derived participation/status flags once, then reuse them in safety and Discord rendering.
   - Pros: Fixes the root cause of several bugs together; avoids repeating different DNS/DNF rules in each module.
   - Cons: Touches shared stat/type contracts and several tests at once.
   - Effort: Medium

2. **Patch each consumer locally** — keep types mostly as-is and add separate filters/formatting rules inside parser, safety, and Discord code.
   - Pros: Smaller local edits per file.
   - Cons: Keeps status logic duplicated and increases drift risk.
   - Effort: Medium

### Recommendation
Use approach 1 with a narrow scope: normalize `Events` at parse time, derive explicit participation/classification flags in the stats layer, reuse those flags in safety and Discord rendering, and keep `groupIncidents()` unchanged.

### Risks
- `groupIncidents()` pair-key and dedupe rules must stay untouched while adding split impact fields; otherwise car-car grouping behavior can regress.
- `buildRaceMessage()` currently assumes every `position` row is podium-eligible; changing status wording may affect both embed and console summary snapshots.
- `applySafetyRatings()` is used by persistence tests; if inactive rows stop updating safety, expected persisted values must be recalculated carefully.
- If new helper fields are added to `DriverRaceStats`, test factories in `tests/webhook.test.ts` and `tests/persistence.test.ts` will need synchronized defaults.

### Ready for Proposal
Yes — the narrow implementation slice is clear and does not require schema or grouping-rule changes if classification and formatting stay in parser/domain/message layers.
