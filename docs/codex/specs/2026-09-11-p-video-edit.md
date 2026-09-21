# P-Video-Edit
Status: Approved design

## Context and goals
Add Pruna P-Video-Edit through Runware to the existing Edit video workspace. Accept a source up to 15 seconds and up to four optional images. Provide Standard and Draft rendering, with $0.0338/s and $0.0188/s promo estimates respectively (promo valid until Mon Nov 3, 2026; list $0.045/s std, $0.025/s draft). Output follows source duration and aspect ratio at 25fps with a fixed model-dependent size (maximum long edge 848px). Audio and prompt enhancement use provider defaults.

Source: https://runware.ai/docs/models/prunaai-p-video-edit (verified 2026-09-11).

## Non-goals
No new provider, workspace mode, timeline behavior, upscaling, or production deployment before review. Do not change Seedance generation capabilities.

## Scope and implementation boundary
Catalog capabilities and shared validation in lib/providers own model limits and edit options. ProviderVideoWorkspace and VideoSourceInput consume them; browser route and cloud aggregator validate and forward the same options. runwareCreateVideo owns the vendor payload; spend resolver owns draft estimates. Existing upload, polling, retention, download, and account ownership paths remain in place.
