# Discord Race Notifications Specification

## Purpose

Define the exact Discord summary contract for the MVP worker, including webhook fallback behavior and deterministic awards.

## Requirements

### Requirement: Webhook Delivery And Console Fallback

Each persisted race MUST emit exactly one summary. If `DISCORD_WEBHOOK_URL` is empty, the worker MUST log the summary to console and MUST NOT crash.

#### Scenario: Webhook is configured

- GIVEN a race was persisted and the webhook URL is non-empty
- WHEN notification delivery runs
- THEN exactly one Discord webhook request MUST be produced for that race

#### Scenario: Webhook is empty

- GIVEN a race was persisted and the webhook URL is empty
- WHEN notification delivery runs
- THEN no HTTP request MUST be attempted, the summary MUST be logged to console, and the worker MUST continue running

### Requirement: Embed Shape And Deterministic Awards

The Discord message MUST use title `🏁 Race Report - {TrackName}` and include main car used, laps, podium, fastest lap, awards, a short updated safety table, an incident summary, and a footer with the processed filename. Awards MUST be deterministic and exactly these labels: `⚡ Vuelta rápida`, `🧼 Más limpio`, `🧱 Albañil del día`, `💥 Misil nuclear`, `🚜 Cono del día`, `🪦 DNF destructivo`, `📈 Más consistente`, and optional `🐢 Tortuga digna`. Award wording and incident summary language MUST avoid absolute blame.

#### Scenario: Standard classified race

- GIVEN a race has classified finishers and incidents
- WHEN the embed is composed
- THEN the title, content blocks, footer, and deterministic award labels MUST match this contract

#### Scenario: Webhook fallback summary

- GIVEN a race was persisted and `DISCORD_WEBHOOK_URL` is empty
- WHEN the summary is rendered for console output
- THEN it MUST preserve the same race report content required for the Discord message

## Acceptance Criteria

- The notification contract MUST freeze the exact race report title, required content blocks, deterministic award set, processed-filename footer, and empty-webhook fallback requested by the user.
- Reviewers MUST be able to verify webhook and console behavior from the spec without inferring missing fields or renamed awards.
