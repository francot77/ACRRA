# Incident Track Context Specification

## Purpose

Define the runtime contract for loading the authoritative Monza `track-model.json` once at startup and exposing deterministic track-context projection/enrichment for live snapshots, incidents, and later verdict work.

## Requirements

### Requirement: Startup Track Model Loading

The system MUST load the configured track-model file during bootstrap, before UDP capture or race-file watching starts. If the configured file is missing, unreadable, invalid JSON, or fails runtime subset validation, startup MUST fail fast and MUST NOT continue with a partially initialized track-context service.

#### Scenario: Valid model boots once

- GIVEN the configured model file matches the accepted runtime subset
- WHEN the application starts
- THEN the model SHALL be parsed once, normalized into an in-memory query service, and reused for later incident processing

#### Scenario: Invalid model blocks startup

- GIVEN the configured model file is missing or violates the accepted subset
- WHEN the application starts
- THEN bootstrap MUST stop before watcher and UDP runtime startup

### Requirement: Accepted Runtime Schema Subset

The runtime adapter MUST treat `track-models/monza/track-model.json` as the only authoritative contract reference for this slice. The accepted subset SHALL require top-level `schemaVersion`, `track`, `layout`, `totalLengthMeters`, `pointCount`, and `points[]`. Each accepted point SHALL require `index`, `s`, `normalized`, `x`, `y`, `z`, `forwardX`, `forwardY`, `forwardZ`, `sideLeft`, `sideRight`, `width`, `leftX`, `leftY`, `leftZ`, `rightX`, `rightY`, and `rightZ`. Extra fields MAY exist and MUST be ignored.

#### Scenario: Authoritative subset is accepted

- GIVEN the Monza sample includes the required top-level fields and point fields
- WHEN the runtime adapter validates the file
- THEN the model SHALL be accepted even if additional sample-only fields are present

#### Scenario: Required geometry field is missing

- GIVEN any required top-level field or required point field is absent or non-numeric where numeric is required
- WHEN validation runs
- THEN the file MUST be rejected as incompatible

### Requirement: Deterministic Projection Queries

The query service MUST provide deterministic projection by normalized progress and by world position. Progress projection SHALL choose the point with the smallest circular absolute delta from the query `normalizedSplinePos`; exact ties MUST resolve to the lower `index`. World-position projection SHALL choose the point with the smallest Euclidean distance to the query position; exact ties MUST resolve to the lower `index`. Snapshot enrichment SHOULD use progress projection when `normalizedSplinePos` is present, with world-position projection only as fallback; incident-anchor enrichment SHALL use world-position projection.

#### Scenario: Progress tie resolves deterministically

- GIVEN two candidate points are equally near in circular normalized distance
- WHEN a snapshot is projected by `normalizedSplinePos`
- THEN the lower `index` point MUST win

#### Scenario: World-position tie resolves deterministically

- GIVEN two candidate points are equally near in Euclidean distance
- WHEN an incident anchor is projected by world position
- THEN the lower `index` point MUST win

### Requirement: Additive Enrichment Outputs

The system MAY attach nullable in-memory track-context enrichment to live snapshots and finalized incidents, but SHALL NOT persist that enrichment in this slice. When enrichment resolves, it MUST include the matched track identity, projection source, sample `index`, sample `s`, sample `normalized`, center point, local `forward` vector, `width`, `sideLeft`, `sideRight`, left edge point, and right edge point. When track identity does not resolve or projection input is unavailable, the existing matching, persistence, reporting, and verdict flow MUST continue unchanged with null enrichment.

#### Scenario: Snapshot receives additive context

- GIVEN a live snapshot belongs to the loaded track and has valid projection input
- WHEN enrichment runs
- THEN the snapshot MAY carry the required in-memory context fields without altering existing behavior

#### Scenario: No matching track leaves flow unchanged

- GIVEN the current session track identity does not resolve to the loaded model
- WHEN snapshots or incidents are processed
- THEN enrichment MUST remain null and the current pipeline MUST still complete normally

### Requirement: Explicit Non-Goals

This slice SHALL NOT change safety scoring, matched-incident persistence schema, Discord/report payloads, or verdict classification rules. It SHALL NOT introduce remote model storage, uploads, multi-track catalogs, or durable storage of projected geometry.

#### Scenario: Track context foundation stays bounded

- GIVEN the runtime model loads successfully
- WHEN race processing and verdict analysis run
- THEN only additive in-memory context SHALL be new in this slice
