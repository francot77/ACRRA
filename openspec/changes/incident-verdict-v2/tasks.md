# Tasks: Incident Verdict V2

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 420-560 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 geometry seam -> PR 2 verdict mapping/wiring -> PR 3 verification polish |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add verdict geometry seam and narrow track query support | PR 1 | `src/track/trackQueryService.ts`, new geometry helper, focused unit tests |
| 2 | Map bounded facts to verdicts and inject track dependencies | PR 2 | Depends on PR 1; keep fallback and non-goals intact |
| 3 | Finish contradiction/fallback coverage and processor verification | PR 3 | Depends on PR 2; no safety, GIFs, dashboard, or persistence redesign |

## Phase 1: Geometry Foundation

- [x] 1.1 Create `src/incidents/incidentVerdictGeometry.ts` with pure helpers that resolve snapshot-local track frames, project positions/velocity onto forward-lateral axes, and return nullable pairwise fact inputs.
- [x] 1.2 Modify `src/track/trackQueryService.ts` to expose only the narrow neighboring-point lookup needed for local turn-side inference, keeping deterministic wraparound behavior.
- [x] 1.3 Add `tests/track/trackQueryService.test.ts` cases for neighboring-point lookup, wraparound, and tie-safe corner-side inputs used by verdict geometry.

## Phase 2: Fact Derivation And Confidence

- [x] 2.1 Modify `src/incidents/analyzeIncidentVerdict.ts` to accept optional `VerdictTrackContextInput`, select the latest trustworthy pre-impact pair, and resolve live-or-rehydrated track context per snapshot.
- [x] 2.2 Use `src/incidents/incidentVerdictGeometry.ts` to derive longitudinal order, overlap ratio, inside/outside, available width, lateral overlap, and local closing delta without requiring new persisted fields.
- [x] 2.3 Add contradiction and confidence-degradation rules in `src/incidents/analyzeIncidentVerdict.ts` for stale samples, mixed projection sources, and spline-vs-geometry disagreement; allow legacy rear-end fallback only when geometry is weak.

## Phase 3: Verdict Mapping And Wiring

- [x] 3.1 Modify `src/incidents/analyzeIncidentVerdict.ts` to map bounded facts to `possible_rear_end`, `possible_squeeze`, `possible_divebomb`, `racing_incident`, or `unknown`, with explanations limited to supported evidence.
- [x] 3.2 Modify `src/index.ts` and the race-processing seam that calls `analyzeIncidentVerdict` to inject `TrackQueryService` plus session track identity without changing persistence contracts.
- [x] 3.3 Verify in touched verdict call paths that non-goals stay explicit: no safety auto-application, no GIF/diagram generation, no dashboard behavior, and no broad persistence redesign.

## Phase 4: Verification

- [x] 4.1 Extend `tests/live/analyzeIncidentVerdict.test.ts` for decisive rear-end fallback, squeeze, divebomb, balanced side-by-side, contradiction downgrade, and null-track `unknown` scenarios from `incident-verdict-analysis`.
- [ ] 4.2 Add integration coverage around the race-processing path proving verdict dependency injection works with runtime track identity and leaves environment-contact handling unchanged.
- [x] 4.3 Run the targeted verdict and track test suites, record expected failures/fixes during apply, and confirm explanations never claim unsupported geometry.
