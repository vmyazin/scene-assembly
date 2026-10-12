# Seedance 2.5 draft, then finalize

Status: Approved design

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
