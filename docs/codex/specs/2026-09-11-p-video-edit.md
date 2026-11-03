# P-Video-Edit
Status: Approved design

## Follow-up decision — 2026-11-03
The Runware page still says "25% OFF until November 3, 2026" and names no timezone. Keep the sale ($0.0188/s draft, $0.0338/s standard) through the end of that UTC day, then show list price ($0.025/s draft, $0.045/s standard). Catalog `videoEdit` rates are the list prices. `lib/providers/p-video-edit-promo.ts` applies the sale at call time, the same window pattern as fal H3 Max Turbo, so a Worker loaded during the sale does not keep the discount. The model note says "25% off through Nov 3." only while the window is open. This supersedes the 2026-09-21 instruction to leave the sale figures as the live sticker.

## Follow-up decision — 2026-09-21
Display and estimate P-Video-Edit at the Runware promo: $0.0188/s draft, $0.0338/s std, until Nov 3, 2026. List remains $0.025 / $0.045; do not show those as the live sticker. Rates/display only — no API change.

## Context and goals
Add Pruna P-Video-Edit through Runware to the existing Edit video workspace. Accept a source up to 15 seconds and up to four optional images. Provide Standard and Draft rendering, with $0.045/s and $0.025/s estimates respectively. Output follows source duration and aspect ratio at 25fps with a fixed model-dependent size (maximum long edge 848px). Audio and prompt enhancement use provider defaults.

Source: https://runware.ai/docs/models/prunaai-p-video-edit (verified 2026-09-11).

## Non-goals
No new provider, workspace mode, timeline behavior, upscaling, or production deployment before review. Do not change Seedance generation capabilities.

## Scope and implementation boundary
Catalog capabilities and shared validation in lib/providers own model limits and edit options. ProviderVideoWorkspace and VideoSourceInput consume them; browser route and cloud aggregator validate and forward the same options. runwareCreateVideo owns the vendor payload; spend resolver owns draft estimates. Existing upload, polling, retention, download, and account ownership paths remain in place.
