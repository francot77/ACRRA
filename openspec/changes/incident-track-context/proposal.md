# Proposal: Incident Track Context

## Intent

Add a minimal runtime track-context foundation so live incidents and future verdict logic can reference defensible geometry instead of only spline-gap heuristics.

## Scope

### In Scope
- Load a configured `track-model.json` at runtime and validate a documented schema subset compatible with the checked-in Monza model.
- Build an in-memory query/projection layer for progress, nearest sample, local direction, width, and incident-anchor lookup.
- Add nullable snapshot/incident enrichment foundations that carry derived track context into the verdict pipeline without changing safety application.

### Out of Scope
- Safety auto-application changes, GIF generation, dashboards, uploads, or remote track-model storage.
- Final advanced verdict taxonomy beyond the foundation and fallback-safe plumbing.

## Capabilities

### New Capabilities
- `incident-track-context`: Runtime loading of track-model geometry plus reusable projection/enrichment contracts for live snapshots, incidents, and later verdict logic.

### Modified Capabilities
- None.

## Approach

Wire a startup loader from `src/index.ts` into a small runtime module that normalizes the accepted track-model subset and precomputes lookup structures in memory. Enrichment stays additive: snapshots and finalized incidents MAY carry projected sample/segment/corridor metadata when track identity resolves; otherwise the current matching and verdict flow MUST continue unchanged. Treat the checked-in Monza file as the primary compatibility target and isolate schema drift behind one adapter.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/incident-track-context/*.md` | New | Exploration and proposal for the runtime geometry slice |
| `src/index.ts` | Modified | Future startup wiring for loader/query service |
| `src/live/` | Modified | Future snapshot and incident enrichment seams |
| `src/incidents/analyzeIncidentVerdict.ts` | Modified | Future consumer of geometric context |
| `track-models/monza/track-model.json` | Existing input | Runtime compatibility target |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Builder/test schema and checked-in model diverge | High | Define a narrow runtime subset and one adapter boundary |
| Projection picks wrong local point in ambiguous areas | Med | Spec deterministic nearest/tie-break rules and fallback confidence behavior |
| Enrichment shape ossifies too early | Med | Keep fields nullable/additive and defer DB persistence |

## Rollback Plan

Remove the loader/query wiring and enrichment fields; the current incident matching and verdict pipeline already works without track context.

## Dependencies

- Existing `track-models/monza/track-model.json`
- Track identity from parsed race sessions (`trackName`, `trackConfig`)

## Success Criteria

- [ ] The runtime can load the checked-in Monza track model without ingesting it repeatedly during incident processing.
- [ ] A reusable projection API exists for snapshot and incident enrichment with deterministic fallbacks when no model matches.
- [ ] Existing incident matching, safety behavior, and reporting continue working when track context is unavailable.
