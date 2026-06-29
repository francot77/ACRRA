## Exploration: incident-track-context

### Current State
The runtime already captures live snapshots with `worldPosition` and `normalizedSplinePos`, groups and persists live incidents, matches them against race JSON by type/car/distance/impact, and derives verdicts from pre-impact spline gap plus speed delta only. There is no track-model loader, no geometry query layer, and no enrichment contract attached to snapshots or incidents. A prior OpenSpec change created an offline track-model builder, but the checked-in Monza file under `track-models/monza/track-model.json` uses a larger runtime-facing shape than the builder's current v2 test contract, so schema drift is already a real integration risk.

### Affected Areas
- `src/index.ts` - bootstrap point where a startup loader and runtime wiring would enter.
- `src/live/liveTypes.ts` - live snapshots/incidents need optional track-context enrichment fields.
- `src/live/liveIncidentCaptureManager.ts` - finalized incidents are the natural seam for incident-level context seeding.
- `src/live/matchLiveIncidents.ts` - current matching is geometric-distance only; track projections can later explain location/segment context.
- `src/incidents/analyzeIncidentVerdict.ts` - current verdict logic has no turn/edge/corridor context.
- `src/db/repositories.ts`, `src/db/schema.sql` - persistence may need future enrichment storage, but hard DB coupling is avoidable in this slice.
- `track-models/monza/track-model.json` - existing runtime input; only schema-level understanding was reviewed.
- `tools/track-model-builder/` - current producer contract must be reconciled with the checked-in model shape.

### Approaches
1. **Startup loader plus in-memory projection** - load one configured track model, normalize schema differences, build nearest-point/segment/corridor helpers, and enrich snapshots/incidents in memory.
   - Pros: Smallest runtime slice; keeps verdict foundation close to current pipeline; no mandatory DB migration.
   - Cons: Requires careful schema adapter and deterministic projection rules.
   - Effort: Medium

2. **Persist projected geometry into SQLite first** - import track points/segments into DB tables, then query during matching/verdict work.
   - Pros: Strong audit trail and future multi-track support.
   - Cons: Too much infrastructure for one checked-in model; adds migration/query complexity before usefulness is proven.
   - Effort: High

3. **Direct point-array lookups inside verdict code** - parse JSON and query raw arrays where needed.
   - Pros: Lowest upfront code count.
   - Cons: Spreads geometry knowledge across the codebase; hard to test; no reusable enrichment contract.
   - Effort: Low

### Recommendation
Use approach 1. Add a startup loader that accepts the existing checked-in file, projects it into a narrow runtime model, and exposes deterministic query helpers such as nearest sample by normalized progress, nearest sample by world position, local direction/width lookup, and incident anchor projection. Then add optional enrichment containers on snapshots/incidents so later verdict rules can consume context without re-reading the large JSON or changing safety/webhook behavior yet.

Recommended boundaries:
- Load from filesystem only; no upload, dashboard, or remote storage.
- Support the checked-in model via a schema adapter or documented runtime subset, rather than assuming builder v2 shape.
- Keep enrichment additive and nullable so races still process when the track model is missing or unmatched.
- Prefer in-memory enrichment first; defer durable storage until a later verdict/reporting slice proves which fields matter.

### Risks
- The checked-in Monza model shape and the builder's v2 contract are not aligned; the runtime must not hardcode one blindly.
- World-position projection can be ambiguous near long straights/chicanes if the query layer lacks explicit tie-break rules.
- Over-eager DB changes would lock the wrong enrichment shape before verdict rules are validated.
- `openspec/config.yaml` is stale relative to the real TypeScript runtime, so later phases must restate actual repo context.

### Ready for Proposal
Yes - the slice is bounded: startup loader, schema-aware projection/query layer, additive enrichment hooks for snapshots/incidents, and explicit fallback behavior when no model applies.
