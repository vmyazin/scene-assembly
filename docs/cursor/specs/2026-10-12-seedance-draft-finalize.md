# Seedance 2.5 draft, then finalize

Status: Approved design

## Follow-up decision (2026-10-12, review on PR #10)

Overrides the agent edit-size default and the shared `draft` control key.

- Agent edit resolution stays the catalog default (720p). `checkValues` forces a 480p size when `draft` is true and the caller did not pass a size, and refuses an explicit non-480p size. The schema test still passes.
- The studio's Seedance toggle is stored as `draftPreview`. P-Video-Edit keeps `draft`. The request sent to Runware is still `draft: true`.
- `finalize_draft` with a `jobId` prices from the saved draft's `durationSeconds` or `sourceDurationSeconds` and refuses a difference of more than one second. A bare `draftId` still requires `durationSeconds`.
- An edit draft's `sourceDurationSeconds` is not the price. The Worker reads the clip (MP4/MOV `mvhd`, WebM Duration) before reserving. A claim more than a second off is refused. If the length cannot be read, the draft is refused instead of reserved as an unknown cost.
- The expired-draft sentence is only for a request that sends `inputs.draftId`. Poll errors stay as the provider wrote them.
- `generate` and `finalize_draft` share `submitPrepared`, including the guarded re-read of a token whose `acceptJob` threw.
- Guest and workspace polling share `followProviderVideo`. A timeout or a thrown status call marks the job failed. A successful task is still recorded to the gallery and ledger if a later step throws; the job is not put back to error once it has a URL.
- A Seedance draft with no size is rejected in `validateAggregatorRequest` before a reservation. Edit drafts rely on `editSettingsError` for the same 480p rule.
- Finalize still runs the content floor. The block is a minor mention together with a suggestive term, at every moderation level, so a prompt that only passes under Relaxed is not blocked here, and a blocked prompt could not have been accepted as a draft either. The prompt is a library label and is not sent to Runware. Skipping the floor would store a disallowed label.

## Context

Runware's Seedance 2.5 page (read 2026-10-12, https://runware.ai/docs/models/bytedance-seedance-2-5) lets a request set `settings.draft: true`. That preview is 480p only and returns `outputs.draftId`. A later request sends `inputs.draftId` and `resolution: "1080p"` and must not resend the prompt, duration, audio, operation, or media. The page lists video-to-video at $0.131/s (480p), $0.295/s (720p) and $0.734/s (1080p), and text/image at $0.102 / $0.23 / $0.614. It does not publish a separate finalize price. The notes paragraph still says resolution is 480p/720p; the resolution enum, the dimension table, the 1080p video-to-video price, and the video-extend example all include 1080p.

P-Video-Edit `draftRate` is a different feature: a cheaper render with nothing to finalize.

## Goals

- A Draft control on Seedance 2.5 for text, image, frames, reference, and edit.
- Draft results keep `draftId` on the guest job, the gallery record, the cloud job result, and the library asset.
- Finalize is a new job. The button shows the documented 1080p price and charges only after Approve.
- Seedance edit accepts 1080p.
- Drafts and finalizes are priced. A provider cost on the task stays exact.
- Agents can draft and finalize as separate budget-checked steps. Draft stays off by default.

## Non-goals

- A live paid Runware call.
- Reusing P-Video-Edit `draftRate` for Seedance.
- Defaulting agents to draft. That would fail the one-option schema test, which turns `draft` on while the other defaults, including 720p and 1080p, stay in place.

## Scope

Lives in `lib/providers/seedance-draft.ts`, the Runware create/poll path, the video route, the aggregator adapter, the spend resolvers, the model schema, the MCP `finalize_draft` tool, and the existing result surfaces (workspace result, gallery card, cloud job panel, cloud library card).

Does not change layout, P-Video-Edit behavior, or the unknown-price path for Runware jobs that are neither a draft nor a finalize.
