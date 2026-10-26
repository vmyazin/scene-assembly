# Provider display ranking

Status: Approved design

## Context and goals

Order providers by overall cost, output-quality options, variety and operational confidence for the models actually exposed in Scene Assembly on October 26, 2026. This is an editorial recommendation, not a benchmark result. Treat cost and quality as co-primary, breadth next, and documented operational limitations as a tie-breaker. A cheap draft is not equivalent to a premium output. Count model families rather than inflating variety with separate edit endpoints. No comparable success-rate or blind quality dataset was available; reliability and quality remain qualitative. No paid generations were submitted.

## Image evaluation and order

| Rank | Provider | Exposed selection and value | Limitations / operational confidence |
|---|---|---|---|
| 1 | Atlas Cloud | Budget FLUX schnell/Z-Image; Qwen 3, Seedream 5 Pro, Nano Banana 2.1 Developer and GPT Image 2.5 Developer families. Broad advanced-model access plus $0.018 Nano Banana and $0.03 GPT Developer catalog rates. | Developer routes are not proven quality-equivalent to every direct tier. No image search grounding here. Rates are catalog estimates, not a blanket lowest-price claim. |
| 2 | Google Gemini | Nano Banana 2.1, Pro, Lite, and retained deprecated Nano Banana 2. Direct generation/editing with grounding and up to 4K on supported models. 2.1 output is about $0.0336 at 1K before input tokens. | One model family; token billing and quotas. Direct access avoids an extra intermediary but does not prove higher uptime. |
| 3 | Kie.ai | Eight image entries: Nano Banana Pro/2, GPT Image 2, FLUX.2 Pro, Seedream 5 Pro, Imagen 4 Ultra, Ideogram V3 and Z-Image. Strong specialist variety. | Some models are text-only; fewer references on Nano Banana than direct Gemini; credit pricing varies by model. |
| 4 | Runware | Z-Image Turbo, FLUX 3 Image Klein, FLUX.2 dev and Qwen Image Edit Plus. Excellent inexpensive drafting/editing ($0.003–$0.0166 at the catalog's example settings). | Only four image entries here, despite the vendor's much larger catalog. Less premium-model variety than the leaders. |
| 5 | fal.ai | Nano Banana 2.1 with editing, grounding and thinking. Published 1K base is $0.04 before optional charges. | Only two image entries here, one deprecated. Its platform-wide variety cannot count toward this app's image offering. Documented async queue is an operational strength. |
| 6 | PiAPI | Nano Banana 2 at 1K/2K/4K, 14 references; $0.06/$0.08/$0.12 catalog estimates. | Single older family; guest reference uploads require Creator. A recorded hosted-reference image check passed, which is evidence for that path only. |
| 7 | CometAPI | GPT Image 2 and Qwen Image give two useful text-generation families. | No reference-image editing here; catalog pricing is metered without a comparable fixed estimate. |
| 8 | Cloudflare | FLUX.1 schnell with a free daily allowance: useful low-cost drafts. | One text-only model, fixed app controls and credential setup. Free allowance is not unlimited free production. |
| 9 | Pollinations | Single FLUX text route, no-key guest entry point; useful free experimentation. | Limited controls/variety, shared-service busy failures; guest and keyed account routes differ. App's no-key route was inspected, not live-generated or availability-certified. |

## Video evaluation and order

| Rank | Provider | Exposed selection and value | Limitations / operational confidence |
|---|---|---|---|
| 1 | fal.ai | Veo Standard/Fast/Lite, Seedance Standard/Fast, Kling Standard/Pro, Hailuo, Wan, H3 Turbo, plus Kling/Wan/Aleph/H3 editing. Strong mix of quality tiers, first/last frames and edits. | No dedicated character-reference direction here. Queue status/results and retry documentation help recovery but are not measured uptime. H3 sale is temporary; placement remains defensible at regular prices. |
| 2 | Atlas Cloud | LTX/Seedance budget routes plus Seedance 2.5, H3 Developer, Veo, Luma and Kling 4, with reference and edit routes. Broadest spread of inexpensive and premium options. | Some output-size prices and edit totals are unknown. Kling 4 uses quote-derived $0.14287/s at 720p, not the $0.11 headline. Newest-model access alone does not establish quality or reliability superiority. |
| 3 | Runware | Wan 3, LTX 2.5, Seedance 2.5/Mini, Kling, Veo Lite, Aleph and inexpensive P-Video-Edit cover generation, frames, references and editing. | Veo Lite has documented capacity limits; Seedance finalization is estimated; some edits lack complete prices. Strong value, not universally cheapest. |
| 4 | Kie.ai | Veo, Kling 3, Seedance 2, Wan 2.7, Hailuo, Grok and PixVerse provide broad conventional generation choices. | UI exposes text/image and Wan edit, not frames or character-reference directions. Wan edit totals unknown. Vendor says failed tasks are not charged; this is policy, not measured success rate. |
| 5 | Gemini | Direct Omni Flash with native audio and 3–10 second generation. | Only one model and text/image modes here; about $0.101/s at 720p, other per-second totals unknown. Browser video integration needs its own live acceptance before cloud video enablement. |
| 6 | CometAPI | Seedance, Veo, Sora, Wan, Vidu, H3, HappyHorse, FLUX Video and Aleph give broad family coverage. | Most catalog prices are merely metered; less predictable budgeting pushes it below the narrower direct option. Aleph is priced, but has source-upload and guidance limits. |
| 7 | PiAPI | Veo Fast and Kling Omni, including first/last frames and character references. | Only two models, no edit direction, guest-upload plan requirement. A Kling hosted-reference check passed; do not generalize that single success to uptime. |

Cloudflare and Pollinations are not video providers in this app.

## Evidence and uncertainty

Source of exposed capabilities: `lib/engines/registry.ts`, both Gemini catalogs, `lib/fal/catalog.ts`, `lib/kie/catalog.ts`, `lib/providers/catalog.ts`, `components/VideoWorkspace.tsx`. Price examples are from `lib/spend/rates.ts` and provider catalog fields at this revision. Existing live-check evidence: `docs/superpowers/plans/2026-09-05-cloud-provider-enablement.md`; most rows there remain pending. Result-host fixes and async recovery are integration history, not provider failure-rate measurements.

Public sources checked October 26, 2026:
- [Runware pricing](https://runware.ai/pricing): published tiers depend on settings and do not represent every registry model.
- [Atlas billing units](https://www.atlascloud.ai/docs/models/price): rates depend on model, output and parameters. Kling quote evidence remains in `2026-10-26-kling4-atlas-h3-pricing.md`.
- [Kie pricing](https://kie.ai/pricing): credit conversion, variable billing units and failed-task policy. Models listed there but absent from our catalogs do not count.
- [fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue): durable submission/status/result contract; not an uptime comparison.
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing): token pricing and tier limits.
- [Cloudflare FLUX](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/): single text-to-image model.
- [PiAPI documentation index](https://piapi.ai/docs/llms.txt) and [Comet documentation](https://apidoc.cometapi.com/): both offer broader APIs than this app exposes; ranking uses the implemented subset and recorded tests. Initial docs-subdomain URLs failed; these canonical URLs were accessible. Pollinations dashboard exposed no readable model evidence, so no new availability claim is made.

## Scope and implementation boundary

Only reorder `ENGINES` in `lib/engines/registry.ts` (image choices and metadata consumers) and `VIDEO_PROVIDERS` in `components/ProviderSelector.tsx`. VideoWorkspace already falls back to the first compatible displayed provider; the new order intentionally changes that fallback. Update existing order/keyboard/fallback assertions. Keep compatible saved choices and existing defaults. Capability filtering stays intact; search grounding still offers Gemini then fal. Keep every model's internal order, settings, prices and request contract intact.

## Non-goals

Adding models, reordering model menus, changing generation defaults, paid benchmarks, telemetry collection, provider enablement, pricing corrections, styling or deployment without local review.

## Acceptance

Image and video provider rows match the tables; keyboard navigation follows the new order; incompatible video directions stay disabled and fall back correctly; image feature filtering and saved choices remain functional. Local review at `http://localhost:3341/?feature=text-to-image` and `http://localhost:3341/?workspace=video&videoMode=text`.
