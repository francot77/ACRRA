## Exploration: incident-verdict-v2

### Current State
`src/track/` now provides runtime track-context enrichment for snapshots and finalized incidents, and `src/live/liveTypes.ts` already carries nullable `trackContext` on both. `src/incidents/analyzeIncidentVerdict.ts` still decides auto-vs-auto contacts from one recent pre-impact snapshot per car using only spline-gap and speed-delta thresholds, so it cannot defend inside/outside, overlap, usable width, or relative closing claims with geometry.

### Affected Areas
- `src/incidents/analyzeIncidentVerdict.ts` - primary consumer that needs richer geometric reasoning.
- `src/live/liveTypes.ts` - may need additive verdict-facing snapshot/incident context if current enrichment is not sufficient.
- `src/live/liveIncidentCaptureManager.ts` - likely seam for incident-level pair geometry summaries.
- `src/live/matchLiveIncidents.ts` - incident matching explanations may later reference the same anchor semantics.
- `src/track/trackTypes.ts` - possible home for reusable lateral/reference geometry fields.
- `openspec/changes/incident-track-context/specs/incident-track-context/spec.md` - existing capability likely needs a delta if verdict-facing enrichment contracts expand.

### Approaches
1. **Verdict-side geometry derivation** - derive pairwise overlap, side, width, and speed-reference facts inside verdict analysis from existing snapshot track context plus raw telemetry.
   - Pros: Smallest runtime change; keeps new logic near the verdict engine; no persistence pressure.
   - Cons: Can become dense if all geometry math lives in one file.
   - Effort: Medium

2. **Precompute incident geometry summaries** - finalize reusable pairwise metrics during incident capture, then let verdict analysis consume a compact summary.
   - Pros: Cleaner verdict code; easier future reporting reuse.
   - Cons: Risks baking verdict assumptions too early into capture-time structures.
   - Effort: Medium

3. **Persist richer geometry first** - store overlap/width/reference metrics in SQLite before revisiting verdict rules.
   - Pros: Strong audit trail for later dashboards.
   - Cons: Violates the bounded slice; schema would freeze too early.
   - Effort: High

### Recommendation
Use approach 1 with a very small helper boundary inside the verdict module layer: compute pairwise geometric facts from the latest trustworthy pre-impact snapshots and the existing track-context runtime, then map those facts to defensible heuristics for rear-end, squeeze, divebomb, and racing-incident outcomes. Keep all outputs additive and in-memory; only extend track-context contracts when the verdict engine genuinely lacks a reference quantity such as lateral offset from center, usable corridor width, or normalized overlap.

### Risks
- Existing `TrackContextEnrichment` may not expose enough reference geometry for width/inside-outside claims, forcing a narrow delta to `incident-track-context`.
- One-snapshot reasoning can still misclassify rapidly changing overlaps; the spec should define minimum recency and confidence degradation rules.
- Environment incidents already have a dedicated path; this slice must not accidentally broaden auto-vs-env behavior.

### Ready for Proposal
Yes - the next slice is clear: consume runtime track context in verdict analysis, define bounded geometric heuristics for auto-vs-auto contacts, and keep safety/reporting/schema work explicitly deferred.
