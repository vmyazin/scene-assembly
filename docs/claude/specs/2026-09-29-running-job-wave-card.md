# Running jobs as cards with a wave thumbnail

Status: Approved design (requested directly by the owner, 2026-09-29)

## Context

A job in flight is drawn as a card on the Account page's Active tab
(`CloudJobCardGrid`), but the studio's library picker (`AccountLibrary`) and the
result rail (`CloudJobPanel`) still drew it as a one-line `CloudJobList` row, so a
running job looked like a log entry beside finished cards. The card's own well was
a pulsing icon over a sheen.

## Goals

- Every surface that lists jobs draws an active job as the card it will become.
- The well shows a field of short strokes swinging out of step — a wave standing in
  for the finished thumbnail (owner's reference: a grid of oriented line segments).

## Non-goals

- No progress percentage (no provider reports one). The stage bar stays as is.
- No change to how jobs waiting on a person or stopped are drawn (`CloudJobList`).
- `JobQueueOverlay` stays an awareness list of rows.

## Scope and implementation boundary

- New `components/account/JobWaveField.tsx` (SVG + CSS, no per-frame JS) and its
  `.job-wave-*` rules in `app/globals.css`, replacing `.job-card-sheen/.job-card-mark`.
- `CloudJobCardGrid` uses it and accepts `columns={1}` (via `libraryGridClass`).
- `AccountLibrary` (browse mode) and `CloudJobPanel` split `isActiveJob` jobs to the
  card grid. The panel drops `ResultStack`'s spinner frame and the video placeholder
  while a card is showing.
- Must not touch: job state logic, `cloud/`, `ResultStack`, `JobQueueOverlay`.
