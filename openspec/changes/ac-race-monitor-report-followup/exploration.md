## Exploration: ac-race-monitor-report-followup

### Current State
The previous safety follow-up is already partially implemented: `config.ts` exposes the min-active-driver knobs, `index.ts` threads them into `applySafetyRatings()`, and `buildRaceMessage.ts` already hides inactive/DNS rows plus renders `Safety sin cambios`. The remaining report/safety follow-up gap is in the reason model: `applySafetyRatings()` collapses multiple cases into `min-active-drivers`, and the message layer only knows how to describe blocked gains.

### Affected Areas
- `src/parser/calculateSafety.ts` — `shouldBlockChange` and `safetyChangeReason` currently merge blocked gains, blocked losses, and some no-op cases behind one reason.
- `src/types/assetto.ts` — the `safetyChangeReason` union is too coarse for accurate report wording.
- `src/discord/buildRaceMessage.ts` — unchanged-safety messaging assumes the only blocked case is "need more active drivers to gain Safety".
- `src/index.ts` — message building does not receive `allowSafetyLossBelowMinDrivers`, so report wording cannot reflect blocked-loss policy.
- `tests/parser-and-domain.test.ts` — missing regression coverage for rounded/no-op ratings below the threshold and blocked-loss behavior.
- `tests/webhook.test.ts` — missing report assertions for blocked-loss wording and no-op rows that should not be explained as blocked gains.

### Approaches
1. **Refine safety reasons at the source** — split the gating outcomes in `applySafetyRatings()` so report rendering consumes an explicit reason.
   - Pros: Keeps policy centralized; report and persistence stay aligned.
   - Cons: Touches the shared stat contract and test factories.
   - Effort: Low

2. **Patch report wording heuristically** — infer intent from `oldSafetyRating`, `newSafetyRating`, and config at render time.
   - Pros: Smaller local edit in Discord code.
   - Cons: Brittle duplication of safety policy; easy to drift from persistence behavior.
   - Effort: Low

### Recommendation
Use approach 1. Refine `safetyChangeReason` in `applySafetyRatings()`, thread any extra report-policy input needed through `index.ts`, and add focused regressions in parser/report tests.

### Risks
- Expanding `safetyChangeReason` requires synchronized updates to all test factories using `DriverRaceStats` defaults.
- If the new reason taxonomy is too granular, the report can become coupled to internal policy details; keep the enum minimal and user-facing wording in the message layer.
- Persistence behavior for inactive drivers is already correct and should stay untouched.

### Ready for Proposal
Yes — the narrow implementation slice is limited to safety reason semantics, report wording, and targeted regression tests.
