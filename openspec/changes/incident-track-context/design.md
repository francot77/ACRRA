# Design: Incident Track Context

## Technical Approach

Load one authoritative track model during bootstrap, normalize it into an immutable runtime shape, and inject a small query service into the live pipeline. `track-models/monza/track-model.json` is the only contract source for this slice, so the adapter accepts its real top-level fields plus the required `points[]` subset and ignores producer-only extras. The runtime then projects snapshots by `normalizedSplinePos`, projects incident anchors by world position, and attaches nullable in-memory context without touching SQLite, safety, Discord, or verdict behavior.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Runtime boundary | New `src/track/` adapter + query service | Parse the JSON directly inside live modules | Keeps schema drift isolated to one filesystem boundary and matches the repo's small typed-module style. |
| Track identity | Match AC `trackName` to model `track`; normalize blank `trackConfig` to `null` before comparing with model `layout` | Require exact raw string match | The real Monza contract has `layout: null`, while AC sessions may emit an empty config string. Canonicalizing both sides avoids false negatives without widening scope. |
| Query algorithm | Immutable point array with deterministic linear scans | KD-tree / segment index | The checked-in model has `pointCount: 3750`; one startup load plus bounded in-memory scans is simple, testable, and fast enough for this slice. |
| Enrichment scope | Add nullable context only to live snapshots and finalized incidents in memory | DB columns now | The spec explicitly defers persistence; keeping context additive prevents locking the wrong schema too early. |

## Data Flow

Bootstrap sequence:

`loadConfig` -> `loadTrackContextRuntime` -> `openDatabase` -> `startAcUdpClient` -> `watchRaceResults`

Runtime sequence:

1. `src/index.ts` loads the configured model path before UDP/watcher startup.
2. `src/track/trackModelAdapter.ts` validates the accepted Monza subset and returns immutable `TrackModelPoint[]`.
3. `src/track/trackQueryService.ts` exposes `resolveTrack`, `projectByProgress`, and `projectByWorldPosition`.
4. `src/live/liveSnapshotRecorder.ts` enriches each `LiveCarSnapshot` with progress-first context when the active track resolves.
5. `src/live/liveIncidentCaptureManager.ts` derives incident-level anchor context from the finalized anchor world position and preserves per-snapshot enrichment.
6. Existing matching and verdict code keeps running unchanged when enrichment is `null`.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/incident-track-context/design.md` | Create | Technical design for the change. |
| `src/config.ts` | Modify | Add `TRACK_MODEL_PATH`, `TRACK_MODEL_TRACK`, and `TRACK_MODEL_LAYOUT` config surface. |
| `src/index.ts` | Modify | Fail-fast bootstrap wiring for the runtime track context service. |
| `src/track/trackModelAdapter.ts` | Create | Zod-backed subset validator and normalizer for the authoritative Monza contract. |
| `src/track/trackQueryService.ts` | Create | Immutable query service and deterministic projection helpers. |
| `src/track/trackTypes.ts` | Create | Shared runtime types for points, projections, and enrichment. |
| `src/live/liveTypes.ts` | Modify | Add optional `trackContext` fields to snapshots and finalized incidents. |
| `src/live/liveSnapshotRecorder.ts` | Modify | Attach progress-first additive snapshot enrichment. |
| `src/live/liveIncidentCaptureManager.ts` | Modify | Attach incident-anchor enrichment during finalization. |
| `tests/track/*.test.ts`, `tests/live/*.test.ts` | Create | Adapter, projection, bootstrap, and enrichment coverage. |

## Interfaces / Contracts

```ts
type TrackProjectionSource = 'progress' | 'world_position';

type TrackContextEnrichment = {
  track: string;
  layout: string | null;
  source: TrackProjectionSource;
  index: number;
  s: number;
  normalized: number;
  center: Vector3;
  forward: Vector3;
  width: number;
  sideLeft: number;
  sideRight: number;
  leftEdge: Vector3;
  rightEdge: Vector3;
};

interface TrackQueryService {
  resolveTrack(input: { trackName: string; trackConfig: string | null }): boolean;
  projectByProgress(normalizedSplinePos: number): TrackContextEnrichment;
  projectByWorldPosition(position: Vector3): TrackContextEnrichment;
}
```

Tie-break rule: equal circular progress distance or equal Euclidean world distance MUST return the lower point `index`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Subset validation, `layout` null normalization, deterministic tie-breaks | Focused sample-derived tests around the Monza head shape and synthetic equal-distance cases. |
| Integration | Bootstrap fail-fast on invalid model; successful one-time runtime wiring | `tsx --test` with temp config/env and fixture copies of the model file. |
| Integration | Snapshot and incident enrichment remain additive/null-safe | Drive `LiveSnapshotRecorder` and `LiveIncidentCaptureManager` with resolved and unresolved track identities. |

## Migration / Rollout

No migration required. The change is runtime-only and startup-gated.

## Open Questions

- [ ] None blocking. `sdd-tasks` should keep implementation split so bootstrap wiring and live enrichment remain reviewable within the 400-line budget.
