# Variant G — data manifest

Reference: `image-workspace-layout-G.reference.html` (F's rail with E's 2-up results).
Counts are from the catalogs at `d4460c3`, across the 9 engines that serve text-to-image
(gemini, pollinations, cloudflare, kie, runware, atlas, comet, fal, piapi). Kie renders its own
workspace (`KieGenerationWorkspace`), so its rail is a separate decision.

| Element | Field path | Class | Count | Decision |
|---|---|---|---|---|
| Engine control "Google Gemini · 9 engines · 2 free" | `enginesForFeature(feature)`, `ENGINES[].free` | ✅ Real | 9/9 engines | — |
| Model rows: name | catalog `label` | ✅ Real | 32/32 keyed-engine models | — |
| Model rows: price | first spec cell (`geminiImageSpecs` / `falImageSpecs` / `providerImageSpecs`) | ✅ Real | 30/32 priced; CometAPI 2/2 read "metered" | — |
| Tag: tier (4K / 1K only) | spec cell `tier` / `sizes` | ✅ Real | Gemini 4/4, fal 2/2, providers per `sizes` | — |
| Tag: Search | `supportsGoogleSearch` (Gemini), fal `web_search` field | ⚠️ Sometimes | Gemini 3/4, fal 2/2, others 0 | **Derive**: shown where the catalog says so, absent otherwise (a tag, not a hole) |
| Tag: Default | `DEFAULT_GEMINI_IMAGE_MODEL`, fal default | ✅ Real | one per engine with a rack | — |
| Tags: "Text in images", "Fastest" | prose in `note` only | ❌ Aspirational | 0/32 as a field | **Cut**: only catalog-derived tags ship |
| Tag: "Retired · use 2.1" | `deprecated` + `replacedBy` | ⚠️ Sometimes | 2 retired models, both with a successor | — |
| Shape chip pixels "1024 × 1024" | `imageDimensions(engine, model, ratio)` | ⚠️ Sometimes | 4/9 engines publish tables | **Derive**: pixels where published (and the M6 free-tier size for keyless Pollinations), ratio only elsewhere |
| Size chip 1K/2K/4K | Gemini `sizes`, fal resolution, provider sizes | ⚠️ Sometimes | engines without a size control show none | — |
| Generate button price "$0.034" | existing cost line | ⚠️ Sometimes | metered/unpriced engines have no figure | — |
| Result cards 2-up, Newest / Earlier | `useImageResultFeed` / cloud assets, order | ✅ Real | up to 4 on screen | — |
| Card meta: model, pixels, took, cost | `ResultMeta` inputs | ⚠️ Sometimes | took: cloud only while the job row exists; cost: browser runs only | keep as today (`ResultMeta` omits what it lacks) |
| Collapse rail | — | ❌ Aspirational | new UI state | **Source**: build it, remembered per browser |
| Controls not drawn in the mock: search grounding, fal thinking / web search, provider output size, Relaxed filter, reference images for editing modes | existing setup panels | ✅ Real | present today | **More settings chip** for the rest; reference images above the prompt in the main column |

Base: stacked on `claude/nifty-mestorf-0a623d` (provider unify), with `origin/main` merged in.

## Deliberate deviations from the reference

| Where | Reference | Built | Why |
|---|---|---|---|
| Kie engine | rail like every engine | Kie image uses the same rail (`components/ImageRail.tsx`), chips and grid; its model list has no price column and gets a search box; Kie video keeps its own layout | Kie's catalog publishes no per-image price; video was out of scope |
| Engine menu | dropdown | floats in a portal over the rail | The rail scrolls inside itself and would clip a menu anchored in it |
| Model note | not drawn | kept under the list, smaller | It carries price and retirement detail the tags cannot; the Replace button for a retired model stays with it |
| Mode chip "Text to Image" | static chip | cut | It repeats the page title and opens nothing |
| Search grounding | not drawn | its own on/off chip, search-grounding mode only | A switch, so the chip is the whole control |
| Image format (PNG/JPG…) | not drawn | inside More settings, once a browser result exists | It applies only to a browser download |
| Prompt stickiness | n/a | the prompt no longer sticks; the rail does | Prompt and results share one column now, so nothing scrolls away from it |
| Cloudflare / Pollinations model | list | a one-line card naming the single model | A list of one is not a choice |
