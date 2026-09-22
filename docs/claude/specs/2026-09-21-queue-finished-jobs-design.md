# Job queue: finished jobs, and where each row points

Status: Approved design
Date: 2026-09-21

## Context

`JobQueueOverlay` is the standing answer to "is anything still running?" for
background cloud jobs, which outlive the page that started them. Today it drops a
job the moment it succeeds: `shown` keeps only `isActiveJob(job) || needsAttention(job)`,
and `isListedJob` (used by `CloudJobPanel`) excludes `saved` for the same reason.

The argument for dropping them was that a saved job's output is already a card in
the library, so its row only repeats the prompt with a "Saved" tag. That holds for
the account page, where the asset grid is right there. It does not hold for the
overlay, which is the only surface a person watches *while a run is in progress* —
and there, a job vanishing on success is indistinguishable from a job vanishing
because tracking broke. A run of four images reads as "three left" rather than
"one done, three running".

## Goals

- A succeeded job keeps its row in the overlay, with the same
  `JOB_STATE_LABELS` + `JobElapsed` treatment every other row gets, so the reader
  can see how long it took.
- A succeeded row is a link into `/account`'s cloud library that **highlights the
  asset this job produced** with an accent outline, so the row points at something
  specific rather than at a page. `CloudAsset.jobId` is the join; `/account#jobs`
  is the existing deep-link precedent.
- A row still in flight is a link back to the studio form it was started from —
  the page whose `CloudJobPanel` already renders that job's spinner and will
  render its result.
- Succeeded rows **linger only while the card is otherwise alive**. They never
  keep the overlay on screen by themselves, and they never appear in the
  collapsed "N jobs need attention" pill.

## Non-goals

- No change to `CloudJobPanel` / `CloudJobList` on `/account` or in the
  workspaces. `isListedJob` keeps excluding `saved` there: on those pages the
  result card *is* on screen, which is the case the original rule was written for.
- No cancel/resume/stop-tracking in the overlay. Awareness only, as today.
- No new polling, no new account request. The overlay reads `useAccountStore`,
  which `AccountSessionProvider` already fills with both jobs and assets.
- No persistence of the highlight. It lives in the URL hash and nowhere else.

## Design

### Which rows the overlay holds

Three predicates, not one list:

- **alive** — `isActiveJob || needsAttention`, minus dismissed. This is what
  decides whether the overlay renders at all, and it is unchanged. Nothing alive,
  nothing on screen; nothing active but something needing attention, the collapsed
  pill.
- **succeeded** — `state === 'saved'`, minus dismissed. Added to the expanded
  card's list only.
- Ordering puts unfinished business first, then succeeded, each keeping store
  order. The list is capped at `LIMIT`, and a truncation that hid the running job
  behind four finished ones would defeat the point of the card.

A succeeded row therefore appears only in the expanded card, which only exists
while something is in flight — it is context for a run in progress, not a
standing receipt.

### Where a row points

`lib/account/job-location.ts` is the one place that answers "where is this job
looked at". It has two halves because a job has two lives:

- **Finished** → `/account#asset-<assetId>`, resolved through
  `CloudAsset.jobId`. With no matching asset loaded it degrades to `/account`.
- **In flight** → the studio form whose `CloudJobPanel` matches the job's
  `provider` / `modelId` / `mediaType` / `inputMode`. The URL carries only the
  workspace and mode (`?feature=…` for image, `?workspace=video&videoMode=…` for
  video); the engine and model live in `useAppStore`, so the link's `onClick`
  writes them before the navigation. A link that only set the URL would land on
  whatever engine was last selected, and the panel there would be filtering for a
  different provider — an empty rail with no explanation.

`inputMode` is lossy for image jobs: the six features collapse to
`requiresImage ? 'image' : 'text'`, so the link picks `image-editing` or
`text-to-image`. That is the right target anyway — `CloudJobPanel` filters on
`inputMode`, so every feature sharing it shows the same job.

### The highlight

`/account#asset-<id>` is read by `AccountConsole` the same way `#jobs` already is:
in the state initializer, plus a `hashchange` listener for the case where the
reader is already on `/account`. It forces the `all` filter (the asset lives in
the grid, not the job list) and hands the id to `CloudAssetGrid` as
`highlightAssetId`.

`CloudAssetGrid` gives that card an accent ring and scrolls it into view. The
anchor `id` is set only when the grid is given a `highlightAssetId`, so the
picker overlays that render a second grid on the same page cannot duplicate it.

## Scope and implementation boundary

Lives in:

- `lib/account/job-location.ts` (new)
- `lib/account/job-status.ts` — one added predicate
- `components/account/JobQueueOverlay.tsx`
- `components/account/AccountConsole.tsx` — hash read + prop
- `components/account/CloudAssetGrid.tsx` — `highlightAssetId` prop

Must not touch: `CloudJobPanel`, `CloudJobList`, `isListedJob`'s meaning,
`AccountSessionProvider`'s polling, `useAccountStore`'s shape, the Worker.
