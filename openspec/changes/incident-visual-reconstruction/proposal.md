# Proposal: Incident Visual Reconstruction

## Intent

Create the first bounded foundation for reconstructing incidents visually from live snapshots plus track context so incident reports can later include a small diagram or GIF-like artifact instead of text alone.

## Scope

### In Scope
- Build a local scene contract from finalized incident snapshots, anchor position, and track-model context.
- Define a 2D tactical renderer foundation for one static diagram and a short ordered frame sequence.
- Define artifact delivery rules for attaching visuals to incident reports with safe fallback to the current text-only path.

### Out of Scope
- Replay-file parsing, official game replay dependence, 3D cameras, dashboards, safety auto-application, or a full report UX redesign.
- Rich animation tooling beyond the frame-sequencing contract needed for a later GIF/export step.

## Capabilities

### New Capabilities
- `incident-visual-reconstruction`: Local 2D incident scene assembly, tactical rendering, frame sequencing, and report artifact packaging from snapshots plus track context.

### Modified Capabilities
- None.

## Approach

Build on the existing `trackContext` and finalized live incident payloads instead of inventing a replay subsystem. The first slice SHOULD normalize incident inputs into a renderer-friendly scene, emit deterministic 2D outputs, and keep delivery additive so Discord reporting still works when no artifact can be produced or attached.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/incident-visual-reconstruction/*.md` | New | Change artifacts for exploration and proposal |
| `src/reconstruction/` | New | Future scene builder, renderer, sequencer, and artifact modules |
| `src/live/liveTypes.ts` | Modified | Future reconstruction input contract |
| `src/live/liveIncidentCaptureManager.ts` | Modified | Future reconstruction trigger point |
| `src/discord/sendIncidentReport.ts` | Modified | Future attachment and fallback delivery |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Sparse or noisy snapshots distort the scene | Med | Spec confidence/fallback markers and bounded interpolation rules |
| Artifact delivery exceeds webhook limits | Med | Define size budget and mandatory text-only fallback |
| Scope expands into replay/UX redesign | High | Keep specs centered on local tactical artifacts only |

## Rollback Plan

Remove the reconstruction trigger and artifact delivery wiring; incident reports already function as text-only embeds.

## Dependencies

- Existing finalized incident snapshots and `trackContext`
- Existing Discord incident report flow in `src/discord/sendIncidentReport.ts`

## Success Criteria

- [ ] The change defines a local reconstruction contract that does not depend on replay files or official replay data.
- [ ] The foundation supports both a static 2D diagram and an ordered frame sequence for later GIF/export work.
- [ ] Incident reporting can attach a visual artifact when available and safely fall back when it is not.
