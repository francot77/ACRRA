# Proposal: Incident Verdict V2

## Intent

Strengthen auto-vs-auto incident verdicts so they can justify blame with track-context-aware geometry instead of mostly spline-gap and raw speed thresholds.

## Scope

### In Scope
- Consume track-context-enriched snapshots and finalized incidents during verdict analysis.
- Add bounded geometric reasoning for relative position, inside/outside, overlap, available width, and speed delta against a local track reference.
- Define confidence/fallback behavior when telemetry recency or track-context quality is insufficient.

### Out of Scope
- Safety auto-application, GIF/diagram generation, dashboard/report UX, or persistence schema changes unless strictly required.
- Environment-report redesign unless a minimal change is required to support the verdict engine.

## Capabilities

### New Capabilities
- `incident-verdict-analysis`: Track-context-aware auto-vs-auto verdict heuristics with defensible geometric explanations and bounded confidence rules.

### Modified Capabilities
- `incident-track-context`: Extend the additive runtime enrichment contract only if verdict analysis needs extra local reference geometry beyond the current sample/edge fields.

## Approach

Build the next verdict slice on top of the runtime track context already introduced by `incident-track-context`. The verdict engine should derive pairwise geometric facts from the latest trustworthy pre-impact snapshots, then classify rear-end, squeeze, divebomb, or racing-incident cases from those facts. Any new enrichment MUST stay nullable and runtime-only so the existing pipeline still works when track context is absent.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/incident-verdict-v2/*.md` | New | Exploration and proposal for the verdict upgrade |
| `src/incidents/analyzeIncidentVerdict.ts` | Modified | Future geometric verdict reasoning |
| `src/live/liveIncidentCaptureManager.ts` | Modified | Possible incident-level geometry summary seam |
| `src/live/liveTypes.ts` | Modified | Possible additive verdict-facing context |
| `src/track/trackTypes.ts` | Modified | Possible extra runtime geometry references |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Current enrichment lacks one or two key reference fields | Med | Keep a narrow delta to `incident-track-context` only where justified |
| Heuristics overfit a single track/sample set | Med | Spec reusable geometry rules and confidence degradation, not Monza-only constants |
| Slice expands into safety/reporting work | High | Keep non-goals explicit in specs and reject persistence/UI scope creep |

## Rollback Plan

Revert the verdict-engine changes and any additive runtime-only enrichment extensions; the current spline-gap verdict path remains a viable fallback baseline.

## Dependencies

- Completed runtime track-context foundation from `incident-track-context`
- Existing live incident snapshots with `normalizedSplinePos`, speed, and `trackContext`

## Success Criteria

- [ ] Auto-vs-auto verdict analysis can explain relative position and overlap using track-context-aware geometry.
- [ ] Verdict confidence degrades cleanly when pre-impact telemetry or track context is weak, without breaking the current pipeline.
- [ ] The slice lands without adding safety automation, diagrams, dashboards, or durable schema changes.
