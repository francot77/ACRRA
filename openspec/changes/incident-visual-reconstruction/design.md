# Design: Incident Visual Reconstruction

## Technical Approach

Add a small reconstruction pipeline on the existing incident-report path, not on live capture finalization. `sendIncidentReports` already owns Discord delivery, while persisted incidents already contain the bounded snapshot window needed for reconstruction. The design therefore builds a local scene from persisted snapshots plus runtime track reprojection, renders one deterministic SVG tactical diagram, derives a short ordered frame sequence from the same scene evidence, and attaches the static artifact additively with explicit fallback metadata when generation or upload fails.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Orchestration seam | Build artifacts during incident report sending | Trigger and persist artifacts in `src/live/liveIncidentCaptureManager.ts` | Discord delivery happens after JSON matching, so keeping reconstruction in the report path avoids new persistence and keeps fallback local to one seam. |
| Geometry source | Reproject persisted snapshots through `TrackQueryService`, reusing the verdict-style context resolution rules | Persist `trackContext` in SQLite now | Current DB snapshots already have `pos` and `normalizedSplinePos`; reprojection keeps the slice additive and aligned with the runtime foundation. |
| Static output format | Canonical renderer emits SVG bytes for the first slice | Add canvas/native PNG or GIF dependency now | SVG is deterministic, dependency-light, reviewable, and sufficient for Discord attachment plus later raster/export seams. |
| Sequence scope | Build max 3-5 ordered frame models and mark interpolated positions as `derived` | Full replay timeline or immediate GIF encoder | The spec asks for a short ordered sequence foundation, not playback tooling; frame data can later feed a GIF/export step without redesign. |

## Data Flow

`processRaceFile` -> `sendIncidentReports(reconstructionInput?)` -> `buildIncidentReconstruction()` -> `buildIncidentReportMessage()` -> `postDiscordWebhook()`

1. `src/index.ts` passes the same track runtime dependency used by verdict analysis into incident reporting.
2. `src/reconstruction/buildIncidentReconstruction.ts` resolves per-snapshot context from attached data when present, else from progress/world-position reprojection.
3. The builder selects an anchor frame, crops a fixed local corridor around the anchor track point, and includes only involved cars plus optional nearby context cars that enter the corridor.
4. `src/reconstruction/renderIncidentSvg.ts` projects the local scene into a top-down SVG with fixed canvas, fixed draw order, rounded coordinates, anchor marker, and degraded-evidence markers.
5. `src/reconstruction/buildIncidentFrameSequence.ts` emits a short chronological frame list from observed snapshots; only bounded gaps may be linearly interpolated and each such placement is marked `derived`.
6. `src/reconstruction/createIncidentArtifacts.ts` packages `incident.svg`, frame metadata, and delivery status for Discord.
7. `src/discord/sendIncidentReport.ts` adds visual-status fields and attempts attachment; any build, size, or webhook failure preserves the current text-only report.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/incident-visual-reconstruction/design.md` | Create | Technical design for the change. |
| `openspec/changes/incident-visual-reconstruction/state.yaml` | Modify | Mark design complete and advance to tasks-ready. |
| `src/index.ts` | Modify | Pass reconstruction dependencies into incident reporting. |
| `src/reconstruction/reconstructionTypes.ts` | Create | Shared scene, frame, evidence, and artifact contracts. |
| `src/reconstruction/buildIncidentReconstruction.ts` | Create | Pure orchestration from persisted incident + track runtime to scene and artifacts. |
| `src/reconstruction/buildIncidentFrameSequence.ts` | Create | Ordered observed/derived frame selection with bounded interpolation rules. |
| `src/reconstruction/renderIncidentSvg.ts` | Create | Deterministic local tactical SVG renderer. |
| `src/reconstruction/createIncidentArtifacts.ts` | Create | Attachment packaging, byte budgets, and delivery metadata. |
| `src/discord/sendWebhook.ts` | Modify | Support optional multipart webhook attachments. |
| `src/discord/sendIncidentReport.ts` | Modify | Attach reconstruction artifacts additively and surface fallback/status metadata. |
| `tests/reconstruction/*.test.ts`, `tests/discord/*.test.ts` | Create/Modify | Coverage for scene bounds, deterministic SVG, frame order, and fallback delivery. |

## Interfaces / Contracts

```ts
type ReconstructionEvidenceState = 'observed' | 'derived' | 'missing';

type IncidentSceneFrame = Readonly<{
  atRelativeMs: number;
  source: 'observed' | 'derived';
  cars: readonly Array<{ carId: number; forwardM: number; lateralM: number; evidence: ReconstructionEvidenceState }>;
}>;

type IncidentVisualArtifacts = Readonly<{
  delivery: 'static_only' | 'sequence_ready' | 'omitted';
  staticSvg?: { filename: string; contentType: 'image/svg+xml'; bytes: Buffer };
  frames: readonly IncidentSceneFrame[];
  notes: readonly string[];
}>;
```

Corridor rule: crop to a fixed anchor-centered forward/back range in track meters and one local track width per side; cars outside that window are excluded.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Scene cropping, anchor selection, evidence degradation, context-car inclusion | Synthetic persisted-incident fixtures plus track-runtime stubs. |
| Unit | Deterministic SVG layout and draw order | Snapshot-style string assertions against identical scene input. |
| Unit | Frame chronology and derived-gap marking | Ordered snapshot fixtures with sparse windows and interpolation edges. |
| Integration | Discord attachment success and text-only fallback on artifact/webhook failure | Extend webhook tests to cover multipart send, oversize reject, and omitted metadata. |

## Migration / Rollout

No migration required. This slice is runtime-only and attachment-optional.

## Open Questions

- [ ] Confirm the first-slice attachment budget to enforce before webhook upload so large SVG output falls back locally instead of relying on Discord rejection.
