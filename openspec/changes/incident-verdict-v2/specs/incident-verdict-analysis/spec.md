# Incident Verdict Analysis Specification

## Purpose

Define a bounded auto-vs-auto verdict contract that consumes existing runtime `trackContext` to explain relative position, overlap, available width, and local closing pace without expanding into safety, reporting, or persistence work.

## Requirements

### Requirement: Track-Context Evidence Gate

The verdict engine MUST evaluate auto-vs-auto contacts from the latest trustworthy pre-impact snapshot for each car. A snapshot pair SHALL be trustworthy only when both samples are recent enough for verdict use and both carry the telemetry needed for the selected heuristic. If `trackContext` is missing, stale, or contradictory, the engine MUST degrade confidence and MAY fall back to the legacy spline-gap path only for rear-end style checks; otherwise it MUST return `unknown` rather than invent geometry.

#### Scenario: Geometry evidence is usable

- GIVEN both cars have recent pre-impact snapshots with `trackContext`, velocity, and position/progress inputs
- WHEN verdict analysis starts
- THEN the engine MUST use those snapshots as the sole geometric evidence base

#### Scenario: Geometry evidence is weak

- GIVEN one or both cars lack trustworthy `trackContext` evidence before impact
- WHEN verdict analysis starts
- THEN confidence MUST degrade and unsupported geometry claims MUST NOT be emitted

### Requirement: Pairwise Geometric Facts

The engine MUST derive bounded pairwise facts from the snapshot pair and existing `trackContext`: longitudinal order and overlap, inside/outside side assignment relative to the local turn corridor, available width between a car and the relevant track edge, physical overlap or separation across the local lateral axis, and speed delta against a local reference by projecting each car's motion onto the local forward direction. The engine SHALL use only the current runtime enrichment fields plus existing snapshot telemetry; it SHALL NOT require new persisted geometry.

#### Scenario: Alongside geometry is measurable

- GIVEN both cars project into the same local track segment before contact
- WHEN the engine compares their local longitudinal and lateral placement
- THEN it MUST determine whether they are overlapping, who is inside or outside, and how much corridor width remains

#### Scenario: Inputs disagree across references

- GIVEN spline progress and local geometric placement disagree beyond the engine's bounded tolerance
- WHEN pairwise facts are derived
- THEN the disputed fact MUST be treated as low-confidence instead of decisive blame evidence

### Requirement: Verdict Heuristic Mapping

The engine MUST map pairwise facts to bounded verdicts for `possible_rear_end`, `possible_squeeze`, `possible_divebomb`, `racing_incident`, or `unknown`. Rear-end blame SHALL require a clear trailing car plus meaningful local closing pace. Squeeze blame SHALL require overlap plus insufficient remaining width for the squeezed car. Divebomb blame SHALL require the blamed car to arrive from behind with excess local closing pace and late overlap that does not establish corner rights before contact. When neither car has a decisive bounded advantage, the engine SHOULD return `racing_incident` instead of forced blame.

#### Scenario: Rear-end remains decisive

- GIVEN one car is clearly behind with no material overlap and is closing faster along the local forward axis
- WHEN contact is analyzed
- THEN the engine MUST return `possible_rear_end` blaming the closing car

#### Scenario: Side-by-side squeeze is identified

- GIVEN the cars overlap longitudinally and one car leaves less than the bounded usable width on the other car's side
- WHEN contact is analyzed
- THEN the engine MUST return `possible_squeeze` blaming the car that removed the corridor

#### Scenario: Late lunge is identified

- GIVEN the blamed car approaches from behind with a materially higher local closing pace and only achieves overlap too late to claim the inside
- WHEN contact occurs near turn-in or apex approach
- THEN the engine MUST return `possible_divebomb` blaming the late-arriving car

#### Scenario: Balanced fight stays neutral

- GIVEN both cars have overlapping position, comparable local pace, and adequate remaining width without a decisive late-arrival signal
- WHEN contact is analyzed
- THEN the engine SHOULD return `racing_incident`

### Requirement: Bounded Outputs And Non-Goals

Verdict explanations MUST state only the bounded facts actually supported by the evidence, including relative position, overlap state, width, or local closing pace when available. This slice SHALL NOT auto-apply safety penalties, generate diagrams/GIFs, add dashboard behavior, redesign persistence, or broaden environment-crash logic beyond preserving the current dedicated path.

#### Scenario: Scope stays verdict-only

- GIVEN a verdict is produced from track-context-aware analysis
- WHEN downstream reporting and storage continue
- THEN no new safety automation, media output, or broad schema change MUST be required
