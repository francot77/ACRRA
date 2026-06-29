# Incident Visual Reconstruction Specification

## Purpose

Define a bounded local pipeline that turns finalized incident snapshots plus `trackContext` into tactical 2D scene artifacts for incident reports, without introducing replay, 3D, dashboard, safety, or broad UX scope.

## Requirements

### Requirement: Bounded Local Scene Assembly

The system MUST assemble a reconstruction scene only from a finalized incident payload, its selected anchor moment, involved-car snapshots, and resolved `trackContext`. The scene SHALL include only the local corridor needed to explain the incident and MUST mark missing or weak evidence instead of inventing unsupported positions. It MUST NOT require replay files or official replay data.

#### Scenario: Finalized incident produces a local scene

- GIVEN a finalized incident has anchor data, involved-car snapshots, and resolved `trackContext`
- WHEN reconstruction starts
- THEN the system MUST build a bounded local scene centered on the incident area

#### Scenario: Sparse evidence stays explicit

- GIVEN one or more expected snapshots or projection fields are missing or weak
- WHEN reconstruction starts
- THEN the scene MUST preserve the incident with explicit degraded evidence markers

### Requirement: Tactical 2D Rendering Foundation

The renderer MUST emit a deterministic top-down tactical output from the local scene, including track corridor context, incident anchor reference, and involved-car placement. It SHOULD support optional non-involved context cars only when they fit within the same bounded local scene. The renderer SHALL NOT introduce 3D cameras or cinematic presentation rules.

#### Scenario: Same scene renders identically

- GIVEN the same normalized local scene input
- WHEN the tactical renderer runs multiple times
- THEN it MUST produce the same 2D layout each time

#### Scenario: Rendering stays locally bounded

- GIVEN cars outside the incident corridor are present in the finalized incident data
- WHEN the tactical renderer builds the frame
- THEN only the bounded local context MAY appear in the output

### Requirement: Ordered Frame Sequencing Basics

The system MUST support a short ordered frame sequence derived from the same local scene evidence used for the static diagram. Each frame SHALL preserve chronological order relative to the finalized incident window and MAY reuse bounded interpolation only when the frame is marked as derived rather than directly observed. This slice SHALL NOT require full replay-style playback controls.

#### Scenario: Frames preserve incident order

- GIVEN a finalized incident contains multiple ordered snapshots around contact
- WHEN the frame sequence is built
- THEN the emitted frames MUST remain in incident chronology

#### Scenario: Derived positions stay bounded

- GIVEN a requested frame falls between two trustworthy observations
- WHEN the sequencer fills the gap
- THEN the frame MAY use bounded derived placement but MUST keep it distinguishable from observed data

### Requirement: Report Artifact Delivery And Fallback

The incident report flow MUST attempt to attach available reconstruction artifacts additively and MUST preserve the current text-report path when scene assembly, rendering, sequencing, encoding, or upload constraints fail. Report delivery SHOULD include enough metadata to tell whether the visual is static-only, sequence-ready, or omitted. The flow SHALL NOT require dashboard changes or automated safety actions.

#### Scenario: Visual artifact is attached

- GIVEN reconstruction completes within delivery constraints
- WHEN the incident report is sent
- THEN the report MUST include the generated visual artifact alongside the existing report content

#### Scenario: Visual artifact falls back safely

- GIVEN reconstruction or attachment fails for any reason
- WHEN the incident report is sent
- THEN the existing text-only report flow MUST still complete successfully

### Requirement: Explicit Non-Goals

This slice SHALL NOT parse replay files, depend on official replay exports, build a 3D camera system, create a dashboard experience, auto-apply safety outcomes, or perform a broad incident-report UX redesign.

#### Scenario: Scope remains tactical and additive

- GIVEN the reconstruction foundation is implemented
- WHEN downstream report and verdict flows continue
- THEN no replay subsystem, 3D viewer, dashboard, safety automation, or broad UX redesign MUST be required
