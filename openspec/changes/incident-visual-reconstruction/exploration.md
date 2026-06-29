## Exploration: incident-visual-reconstruction

### Current State
The runtime already captures finalized live incidents with per-car snapshots and optional `trackContext`, and the track layer can project by progress or world position through `src/track/trackQueryService.ts`. Incident reports already ship to Discord via `src/discord/sendIncidentReport.ts`, but they are text-only embeds: there is no local scene model, no 2D renderer, no frame timeline contract, and no artifact attachment flow for diagrams or GIF-like outputs.

### Affected Areas
- `src/live/liveTypes.ts` - finalized incident payloads are the natural seam for a reconstruction input contract.
- `src/live/liveIncidentCaptureManager.ts` - incident finalization is where a bounded reconstruction job can be seeded.
- `src/track/trackQueryService.ts` - existing projection helpers can anchor cars and incident points onto a tactical scene.
- `src/discord/sendIncidentReport.ts` - current report delivery has no attachment/fallback contract for visual artifacts.
- `src/reconstruction/` - new local scene, rendering, sequencing, and artifact packaging modules fit here cleanly.

### Approaches
1. **Local scene builder plus 2D renderer pipeline** - derive a compact incident scene from snapshots plus track context, render static frames, and package one image plus a short animation-ready sequence.
   - Pros: Matches current local-first runtime; reuses existing snapshot and track context foundations; keeps artifact scope bounded.
   - Cons: Needs explicit contracts for missing snapshots, frame cadence, and Discord-safe delivery.
   - Effort: Medium

2. **Static diagram only** - build one tactical image from the anchor moment and defer any sequencing contract.
   - Pros: Smallest first slice.
   - Cons: Under-specifies animation foundations, so a later GIF step will likely rework core contracts.
   - Effort: Low

3. **Replay-style timeline engine** - treat reconstruction as a generalized playback subsystem from the start.
   - Pros: Flexible long-term base.
   - Cons: Pulls the change toward replay parsing, UX, and 3D-style concerns that are explicitly out of scope.
   - Effort: High

### Recommendation
Use approach 1. Create a local reconstruction pipeline that consumes finalized incident snapshots plus resolved track context, builds a normalized 2D scene model, emits a static tactical diagram, and defines a short frame-sequence contract that is GIF-ready without committing to a full animation stack yet. Keep delivery additive: reports SHOULD attach an artifact when available and MUST fall back to the current text-only report when rendering or upload constraints fail.

### Risks
- Snapshot sparsity around the impact window can make rendered positions look authoritative when they are actually interpolated or missing.
- Discord/webhook attachment limits may force a fallback path even when rendering succeeds locally.
- Scope can easily sprawl into replay parsing, verdict UX, or 3D camera work unless the spec keeps the pipeline strictly tactical and local.

### Ready for Proposal
Yes - the slice is bounded around local scene assembly, 2D tactical rendering, frame sequencing foundations, and report artifact delivery considerations, with replay parsing and UX expansion explicitly deferred.
