# Tasks: Incident Track Context

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500-750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 bootstrap/adapter -> PR 2 query/snapshot enrichment -> PR 3 incident enrichment/verification |
| Delivery strategy | ask-always |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Load and validate the Monza runtime model once at startup | PR 1 | `src/config.ts`, `src/index.ts`, `src/track/trackModelAdapter.ts`, bootstrap tests |
| 2 | Add immutable projection service and snapshot enrichment | PR 2 | Depends on PR 1; include tie-break and null-safe snapshot tests |
| 3 | Add incident-anchor enrichment and full verification | PR 3 | Depends on PR 2; keep persistence, safety, dashboards, GIFs out |

## Phase 1: Bootstrap Foundation

- [x] 1.1 Modify `src/config.ts` to add `TRACK_MODEL_PATH`, `TRACK_MODEL_TRACK`, and `TRACK_MODEL_LAYOUT`, normalizing blank layout input to `null`.
- [x] 1.2 Create `src/track/trackTypes.ts` for immutable runtime point/projection/enrichment types shared by loader and live modules.
- [x] 1.3 Create `src/track/trackModelAdapter.ts` to validate the accepted Monza subset, ignore extra fields, and freeze/normalize the loaded model shape.
- [x] 1.4 Modify `src/index.ts` to load the track runtime before `openDatabase`, `startAcUdpClient`, and `watchRaceResults`, failing fast on missing or invalid model input.

## Phase 2: Query And Snapshot Enrichment

- [x] 2.1 Create `src/track/trackQueryService.ts` with `resolveTrack`, `projectByProgress`, and `projectByWorldPosition`, using deterministic lower-`index` tie-breaks.
- [x] 2.2 Modify `src/live/liveTypes.ts` to add nullable `trackContext` on `LiveCarSnapshot` and `FinalizedLiveIncidentPackage` without touching persisted shapes.
- [x] 2.3 Modify `src/live/liveSnapshotRecorder.ts` so `recordCarUpdate` accepts an optional query service/session track identity and enriches snapshots by progress first, world position fallback second.

## Phase 3: Incident Enrichment Wiring

- [x] 3.1 Modify `src/live/liveIncidentCaptureManager.ts` to attach nullable incident-anchor context from finalized `anchorPosition` while preserving per-car snapshot enrichment.
- [x] 3.2 Modify `src/live/acUdpClient.ts` and any bootstrap call sites to pass the resolved track runtime into snapshot and incident capture without changing repository persistence behavior.
- [x] 3.3 Verify unchanged fallbacks in `src/incidents/analyzeIncidentVerdict.ts` call flow: no track match or missing projection input keeps current verdict, safety, and reporting behavior intact.

## Phase 4: Verification

- [x] 4.1 Add `tests/track/trackModelAdapter.test.ts` and `tests/track/trackQueryService.test.ts` for accepted Monza subset, layout normalization, and both deterministic tie-break scenarios.
- [x] 4.2 Add `tests/live/liveSnapshotRecorder.test.ts` and `tests/live/liveIncidentCaptureManager.test.ts` coverage for resolved-track enrichment, unresolved-track null behavior, and incident-anchor projection.
- [x] 4.3 Add bootstrap/runtime integration coverage under `tests/track/` or `tests/live/` proving valid model loads once and invalid model blocks startup before UDP/watcher initialization.
