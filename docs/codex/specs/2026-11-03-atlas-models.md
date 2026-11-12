# Atlas models verified 2026-11-03

Status: Approved design

**Follow-up decision, 2026-11-12:** Seedream 5.5 and Seedream 5.5 Edit are added ahead of Seedream 5.0 Pro. See `docs/claude/specs/2026-11-12-seedream-5-5.md` for the ids, the calculator quotes and why every input image is billed. Nothing below is overridden.

## Context

Extend the Atlas provider from PR #15 with Kling 4.0 multi-keyframe on the existing first-and-last mode, three video edits, and the cheaper image models Atlas actually sells. Newsletter prices were checked against Atlas’s public calculator (`POST https://api.atlascloud.ai/api/v1/model/calculate`) and each model’s schema on 2026-11-03. A headline that disagreed with the calculator is not the catalog rate.

## Goals

- Kling 4.0 First & last frame accepts an opening frame, up to eight middle frames, and a closing frame, 3–30s, with the quoted upscale sizes.
- FLUX 3 Edit Video, Luma Ray 3.2 restyle, and Luma Ray 3.2 reframe are `videoEdit` entries with the calculator’s rates.
- GPT Image 2.5 Developer can request a transparent background at the existing 1K price. Seedream 5.0 Flash and MAI-Image-2.6 are added. Nano Banana 2 and 2.1 Developer stop using a flat rate that undercharges 2K and 4K.

## Non-goals

No new provider. No change to default model selections. No repricing of existing Luma Ray 3.2 text-to-video or image-to-video (the calculator is non-linear there and those endpoints were not part of this request). No Kling 4 edit total: the calculator quotes output seconds the same way it quotes a generation, and the input-duration formula is still unverified. No GPT 2K/4K sizes, no Luma HDR, no `safety_tolerance` control, no 9:21 reframe ratio, no MAI-Image-2.6-Flash, no Seedream layer-decomposition, no FLUX 3 generation endpoints.

## Scope and implementation boundary

Catalog entries live in `lib/providers/catalog.ts`. Wire bodies live in `lib/providers/atlas.ts`. Pixel tables live in `lib/providers/output-size.ts`. The frames cap is capability-driven in `lib/account/model-schema.ts`, `cloud/src/provider-adapters/aggregators.ts`, and `components/ProviderVideoWorkspace.tsx`, and only when `orderedKeyframes` is set, so every other first-and-last model stays at two images. Spend goes through `resolveCatalogRate`. Luma restyle sets `outputDurationIsGenerated` so the ledger bills the selected length. Image transparency is a catalog `backgrounds` list and a chip on the existing image workspace.

## Verified prices

Calculator, 2026-11-03, unless noted.

| Model | Id | Rate used |
| --- | --- | --- |
| Kling 4.0 generation | `kwaivgi/kling-v4.0/{text,image,reference}-to-video` | $0.14287/s 720p, $0.21385/s 1080p, $0.182/s 1080p-esr, $0.273/s 2k-esr, $0.364/s 4k-esr. Page still says $0.11/s. |
| Kling 4.0 edit | `kwaivgi/kling-v4.0/video-edit` | Unknown. Upscale sizes can be requested. |
| FLUX 3 Edit Video | `black-forest-labs/flux-3/edit-video` | $0.033/s from a 5.366667s sample ($0.1771). Page says $0.03/s. |
| Luma Ray 3.2 restyle | `luma/ray-3.2/video-to-video` | $0.1584/s 540p, $0.2376/s 720p, $0.4752/s 1080p. Page’s $0.54/s does not match. |
| Luma Ray 3.2 reframe | `luma/ray-3.2/reframe` | $0.066/s 540p, $0.132/s 720p, $0.396/s 1080p, from the same sample clip. Page’s $0.03/s does not match. |
| GPT Image 2.5 Developer | existing sunburst and flare ids | $0.03 at 1K, including transparent. 2K is $0.05 and 4K is $0.08, left off the card. |
| Nano Banana 2 Developer | existing ids, full tier still deprecated | $0.028 / $0.042 / $0.056 at 1K / 2K / 4K. |
| Nano Banana 2 Lite Developer | existing ids | $0.014 at 1K only. |
| Nano Banana 2.1 Developer | existing ids | $0.0175 / $0.02625 / $0.049. Page still says a flat $0.018. |
| Seedream 5.0 Flash | `bytedance/seedream-v5.0-flash/{text-to-image,edit}` | $0.018 flat. |
| MAI-Image-2.6 | `microsoft/mai-image-2.6/{text-to-image,edit}` | $0.0792 text, $0.0891 edit. |

## Dropped

MAI-Image-2.6-Flash is a different model and was not requested. Seedream layer-decomposition, FLUX 3 generation, keyframes, and extend were not requested. Luma HDR needs upstream HDR access. `safety_tolerance` stays at Atlas’s default. Reframe’s 9:21 ratio is not in the account worker’s ratio list. GPT’s 2K and 4K sizes would bill a higher tier than the pinned 1K card.

Existing Luma Ray 3.2 text and image generation stay at the recorded $0.06/s for 540p only. The calculator now prices 720p and 1080p, and 10s is not twice 5s. That correction is out of scope here.
