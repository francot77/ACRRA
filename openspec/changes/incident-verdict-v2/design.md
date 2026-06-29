# Design: Incident Verdict V2

## Technical Approach

Add a bounded verdict-evidence layer on top of the existing incident pipeline. `analyzeIncidentVerdict` stays the public entry point, but it will build one pre-impact evidence pair from the latest trustworthy snapshots, resolve a local track frame for each car, derive geometric facts, and then map those facts to `possible_rear_end`, `possible_squeeze`, `possible_divebomb`, `racing_incident`, or `unknown`. The design reuses the `incident-track-context` runtime foundation instead of adding persisted geometry: live snapshots may use attached `trackContext`, while persisted snapshots are deterministically reprojected through `TrackQueryService` from stored `normalizedSplinePos` or `pos`.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Verdict boundary | Keep `src/incidents/analyzeIncidentVerdict.ts` as the orchestration seam and add one focused geometry helper module | Replace the whole verdict path with a new service tree | Matches the repo's small-module style and keeps the slice reviewable under 400 lines. |
| Geometry source | Prefer live `trackContext`; otherwise rehydrate from persisted snapshot telemetry via `TrackQueryService` | Persist `trackContext` or precomputed facts in SQLite | Existing snapshots already store enough raw evidence, so reprojection avoids schema work while preserving the same runtime contract. |
| Turn-side support | Add a narrow runtime helper for neighboring point lookup so the verdict layer can infer local corner side when needed for inside/outside and divebomb checks | Add broad new persisted fields or guess from spline only | Current enrichment has center/forward/edges, but corner-side reasoning needs one bounded neighborhood seam, not a persistence redesign. |
| Confidence model | Derive facts first, then downgrade confidence per stale samples, mixed projection sources, or progress-vs-geometry contradiction | Emit hard verdicts directly from thresholds | The spec requires unsupported claims to degrade to low-confidence or `unknown`, not forced blame. |

## Data Flow

`processRaceFile` -> `matchLiveIncidentsToRaceEvents` -> `analyzeIncidentVerdict(incident, verdictTrackInput?)`

`analyzeIncidentVerdict` performs:

1. Select the latest pre-impact snapshot per car inside the existing recency window.
2. Resolve local context for each snapshot: attached live `trackContext`, else `projectByProgress`, else `projectByWorldPosition`.
3. Build a shared local frame from the anchor segment: forward axis, lateral axis, track edges, and local turn side from neighboring runtime points.
4. Derive bounded facts: longitudinal order, overlap, lateral separation/overlap, available width to the relevant edge, inside/outside assignment, and forward-axis speed delta.
5. Score contradictions between spline order and local geometry before heuristic mapping.
6. Map facts to verdicts, with legacy spline-gap fallback only for rear-end checks when geometry is weak.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/incident-verdict-v2/design.md` | Create | Technical design for the bounded verdict upgrade. |
| `openspec/changes/incident-verdict-v2/state.yaml` | Modify | Mark design complete and advance the change to tasks-ready. |
| `src/index.ts` | Modify | Pass track-runtime-backed verdict dependencies into the race-processing path. |
| `src/incidents/analyzeIncidentVerdict.ts` | Modify | Orchestrate evidence gating, geometry derivation, confidence degradation, and heuristic mapping. |
| `src/incidents/incidentVerdictGeometry.ts` | Create | Pure helpers for local-frame reprojection, fact derivation, contradiction checks, and thresholds. |
| `src/track/trackQueryService.ts` | Modify | Add a narrow neighboring-point lookup used for corner-side inference. |
| `tests/live/analyzeIncidentVerdict.test.ts` | Modify | Cover rear-end fallback, squeeze, divebomb, contradiction downgrade, and null-safe unknown behavior. |
| `tests/track/trackQueryService.test.ts` | Modify | Cover deterministic neighboring-point lookup and corner-side edge cases. |

## Interfaces / Contracts

```ts
type VerdictTrackContextInput = Readonly<{
  queryService: TrackQueryService;
  sessionTrackIdentity: TrackIdentityInput;
}>;

type PairwiseVerdictFacts = Readonly<{
  overlapRatio: number | null;
  longitudinalOrder: 'car_ahead' | 'car_beside' | 'other_ahead' | 'unknown';
  sideRelation: 'inside' | 'outside' | 'same_lane' | 'unknown';
  availableWidthM: number | null;
  lateralOverlapM: number | null;
  closingDeltaKmh: number | null;
  confidencePenalty: number;
}>;
```

`analyzeIncidentVerdict` will accept an optional second parameter with `VerdictTrackContextInput`. When absent or unresolved, only the existing rear-end path remains eligible.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Local-axis projection, overlap math, width-to-edge math, turn-side inference | Small synthetic geometry fixtures against pure helpers. |
| Unit | Contradiction gating between spline order and local placement | Targeted cases where progress says ahead but local frame disagrees. |
| Integration | Race-processing path injects verdict track dependencies without affecting persistence or matching | `node:test` around `createRaceProcessor` with track runtime fixture and stub repositories. |
| Integration | Existing environment crash and null-track cases remain unchanged | Extend current verdict tests with no-track and env-contact coverage. |

## Migration / Rollout

No migration required. This slice stays runtime-only and uses existing persisted snapshot telemetry.

## Open Questions

- [ ] Tune the first-pass width and late-overlap thresholds against more than the current Monza sample set before treating `possible_squeeze` or `possible_divebomb` as high-confidence outputs.
