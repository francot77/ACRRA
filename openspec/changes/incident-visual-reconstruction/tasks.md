# Tasks: Incident Visual Reconstruction

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 520-720 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts/scene -> PR 2 renderer/sequence -> PR 3 Discord wiring/verification |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add reconstruction contracts and local scene builder | PR 1 | `src/reconstruction/*`, `src/index.ts`; no replay or persistence redesign |
| 2 | Add deterministic SVG renderer and short frame sequencing | PR 2 | Depends on PR 1; keep output tactical, 2D, and bounded |
| 3 | Add Discord attachment wiring and fallback verification | PR 3 | Depends on PR 2; preserve current text-only report path |

## Phase 1: Reconstruction Foundation

- [x] 1.1 Create `src/reconstruction/reconstructionTypes.ts` for normalized scene, corridor bounds, evidence markers, frame contracts, and artifact delivery states, keeping replay/3D/dashboard scope out of the API.
- [x] 1.2 Create `src/reconstruction/buildIncidentReconstruction.ts` to turn `PersistedLiveIncident` plus `TrackQueryService` and session track identity into an anchor-centered local scene with explicit missing/weak evidence handling.
- [x] 1.3 Modify `src/index.ts` and `src/discord/sendIncidentReport.ts` input contracts so incident reporting receives reconstruction dependencies without adding new persisted replay/state requirements.

## Phase 2: Tactical Rendering

- [x] 2.1 Create `src/reconstruction/renderIncidentSvg.ts` with fixed canvas, deterministic draw order, rounded coordinates, corridor-only output, anchor marker, and degraded-evidence styling.
- [x] 2.2 Create `src/reconstruction/buildIncidentFrameSequence.ts` to emit at most 3-5 chronological frames from observed snapshots, allowing only bounded linear interpolation marked as `derived`.
- [x] 2.3 Create `src/reconstruction/createIncidentArtifacts.ts` to package `incident.svg`, frame metadata, delivery mode (`static_only` / `sequence_ready` / `omitted`), and local byte-budget rejection notes.

## Phase 3: Discord Wiring

- [x] 3.1 Modify `src/discord/sendWebhook.ts` to support optional multipart webhook attachments while preserving the existing JSON-only race-report path unchanged.
- [x] 3.2 Modify `src/discord/sendIncidentReport.ts` to build reconstruction artifacts additively, append visual-status metadata, and fall back to the existing text-only send on build, size, or webhook failure.
- [x] 3.3 Verify touched report paths keep non-goals explicit: no replay parsing, official replay dependence, 3D camera system, dashboard, safety automation, or broad UX redesign.

## Phase 4: Verification

- [x] 4.1 Add `tests/reconstruction/buildIncidentReconstruction.test.ts` for anchor selection, corridor cropping, context-car inclusion, and sparse-evidence markers from the bounded local scene scenarios.
- [x] 4.2 Add `tests/reconstruction/renderIncidentSvg.test.ts` and `tests/reconstruction/buildIncidentFrameSequence.test.ts` for deterministic output, bounded context exclusion, frame chronology, and derived-gap marking.
- [x] 4.3 Extend `tests/incidentWebhook.test.ts` and `tests/webhook.test.ts` for multipart attachment success, oversize omission, render failure fallback, unchanged race webhook behavior, and run `npm test` plus `npm run typecheck` during verify.
