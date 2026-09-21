# P-Video-Edit
Status: Approved design

## Follow-up decision — 2026-09-21
Display and estimate P-Video-Edit at the Runware promo: $0.0188/s draft, $0.0338/s std, until Nov 3, 2026. List remains $0.025 / $0.045; do not show those as the live sticker. Rates/display only — no API change.

## Context and goals
Add Pruna P-Video-Edit through Runware to the existing Edit video workspace. Accept a source up to 15 seconds and up to four optional images. Provide Standard and Draft rendering, with $0.045/s and $0.025/s estimates respectively. Output follows source duration and aspect ratio at 25fps with a fixed model-dependent size (maximum long edge 848px). Audio and prompt enhancement use provider defaults.

Source: https://runware.ai/docs/models/prunaai-p-video-edit (verified 2026-09-11).

## Non-goals
No new provider, workspace mode, timeline behavior, upscaling, or production deployment before review. Do not change Seedance generation capabilities.

## Scope and implementation boundary
Catalog capabilities and shared validation in lib/providers own model limits and edit options. ProviderVideoWorkspace and VideoSourceInput consume them; browser route and cloud aggregator validate and forward the same options. runwareCreateVideo owns the vendor payload; spend resolver owns draft estimates. Existing upload, polling, retention, download, and account ownership paths remain in place.
