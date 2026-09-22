# Additional generation sources: Runware, Atlas Cloud, CometAPI

Status: Approved design

## Context

The app generates images through `/api/generate` (Gemini, Pollinations, Cloudflare)
and video through provider-specific routes and workspaces (Kie, fal). Every
credential is BYOK: the key lives in `localStorage` via `useAppStore`, is posted to
our own route, and the route calls the provider. Nothing is billed to the app.

Three more providers are wanted, in this cost order:

| Provider | Base URL | Auth | Shape |
| --- | --- | --- | --- |
| Runware | `https://api.runware.ai/v1` | `Bearer` | array of tasks, `taskType` + `taskUUID` |
| Atlas Cloud | `https://api.atlascloud.ai/api/v1` | `Bearer` | submit → `prediction_id` → poll |
| CometAPI | `https://api.cometapi.com/v1` | `Bearer` | OpenAI-compatible images, `/v1/videos` for video |

All three contracts below were read from the vendors' own current docs on
2026-08-16 (sources at the bottom). **No model identifier in this design was
guessed** — each one is quoted from a docs page or a live public catalog endpoint.

## Goals

- Runware, Atlas, and Comet as first-class image engines in the existing engine
  picker, keyed by the user's own API key, using the existing generate → gallery →
  download pipeline unchanged.
- The same three as video providers in the existing video workspace.
- Cost visible before spending: each catalog entry carries the vendor's published
  price, and the generate call asks for the actual cost back where the API returns
  one.
- Runware is the default for new users because it is the cheapest of the three for
  both image and video.

## Non-goals

- LLM/chat surfaces. Atlas and Comet both serve text models; this app generates
  media, and the micro-AI tier already covers its own small helper tasks.
- Exhaustive model catalogs. Each provider hosts 100–800 models; this ships a
  curated set per provider plus (where the vendor publishes a public catalog
  endpoint) an optional live refresh. A user who wants an exotic model can paste
  its identifier.
- Server-side keys. These providers follow the BYOK rule the app already has:
  credentials come from the browser, per request, and are never stored by us.
- Audio, 3D, upscaling, LoRA training, and the other task types Runware exposes.

## Verified provider contracts

### Runware — image (synchronous)

```json
POST https://api.runware.ai/v1
[{
  "taskType": "imageInference",
  "taskUUID": "<uuid v4>",
  "model": "runware:z-image@turbo",
  "positivePrompt": "…",
  "width": 1024, "height": 1024,
  "numberResults": 1,
  "includeCost": true,
  "inputs": { "seedImage": "<url|dataURI>", "referenceImages": ["…"] }
}]
→ { "data": [{ "taskType", "taskUUID", "imageUUID", "imageURL", "cost" }] }
→ { "errors": [{ "code", "message", "parameter", "taskUUID" }] }
```

`inputs.referenceImages` accepts 0–4 entries. `strength` requires
`inputs.seedImage`. `width`/`height` must be sent together.

### Runware — video (async + polling)

Same endpoint, `taskType: "videoInference"`, plus `duration` (seconds),
`deliveryMethod: "async"`, and `inputs.frameImages` for image-to-video. The submit
returns immediately; results come from:

```json
[{ "taskType": "getResponse", "taskUUID": "<same uuid>" }]
→ { "data": [{ "status": "processing", "progress": 47 }] }
→ { "data": [{ "status": "success", "videoUUID", "videoURL", "cost" }] }
```

Docs recommend exponential backoff starting at 1–2s.

### Atlas Cloud — image and video (async + polling)

```json
POST https://api.atlascloud.ai/api/v1/model/generateImage
{ "model": "black-forest-labs/flux-schnell", "prompt": "…",
  "image": "", "mask_image": "", "strength": 0.8,
  "size": "1024*1024", "num_images": 1, "seed": -1,
  "enable_base64_output": false, "enable_safety_checker": true,
  "enable_sync_mode": false }
→ { "data": { "id": "<prediction_id>" } }

GET https://api.atlascloud.ai/api/v1/model/prediction/{id}
→ { "id", "status": "queued|processing|succeeded|failed", "output": ["<url>"], "logs" }
```

`POST /model/generateVideo` is the same submit/poll pair; video models take
`image` (image-to-video), `resolution`, `duration`, `aspect_ratio`, `seed`.

Atlas publishes an **unauthenticated** catalog at `GET
https://api.atlascloud.ai/api/v1/models` carrying `model`, `type`
(Text/Image/Video/Audio), `categories` (`TEXT-TO-IMAGE`, `IMAGE-TO-VIDEO`, …),
`price.actual.base_price`, and a per-model JSON schema URL.

### CometAPI — image (OpenAI-compatible) and video

```json
POST https://api.cometapi.com/v1/images/generations
{ "model": "gpt-image-2", "prompt": "…", "n": 1, "size": "1024x1024" }
→ { "data": [{ "b64_json" | "url" }] }
```

GPT image models return `b64_json` and ignore `response_format`. Video is a
multipart submit against a single route for every video family:

```
POST https://api.cometapi.com/v1/videos     (multipart/form-data)
  model=seedance-2-5  prompt=…  seconds=4  size=1280x720
  input_reference=@file            (image-to-video)
→ { "id": "…" }
GET https://api.cometapi.com/v1/videos/{id}
→ { "status": "queued|in_progress|completed|failed|error", "progress", "video_url" }
```

Comet's catalog is public too: `GET https://api.cometapi.com/api/models`.

## Curated models (all quoted from vendor docs / catalogs)

| Provider | Model ID | Kind | Published price |
| --- | --- | --- | --- |
| Runware | `runware:z-image@turbo` | text→image | ~$0.0032 / 1024² |
| Runware | `runware:400@1` | text→image, image→image (FLUX.2 dev) | $0.0077 / 1024² |
| Runware | `runware:108@22` | image→image (Qwen-Image-Edit-Plus) | $0.0166 / 1024² |
| Runware | `lightricks:ltx@2.5-fast` | text→video, image→video, first+last frame | $0.09 / s @720p |
| Runware | `bytedance:seedance@2.0-mini` | text→video, image→video | $0.036/s @480p, $0.081/s @720p |
| Runware | `bytedance:seedance@2.5` | text→video, image→video, first+last frame, reference→video | $0.102/s @480p, $0.23/s @720p, $0.614/s @1080p |
| Runware | `pixverse:1@5-fast` | text→video, image→video | $0.094 / 5s @360p |
| Runware | `alibaba:wan@2.6-flash` | image→video | $0.025 / s @720p |
| Atlas | `black-forest-labs/flux-schnell` | text→image | $0.003 / image |
| Atlas | `z-image/turbo` | text→image | $0.005 / image |
| Atlas | `qwen-image-3.0/text-to-image` | text→image | $0.04 / image |
| Atlas | `qwen-image-3.0/edit` | image→image | $0.04 / image |
| Atlas | `ltx-2.3-quality/text-to-video` | text→video | $0.002 / s |
| Atlas | `bytedance/seedance-v1-pro-fast/image-to-video` | image→video | $0.009 / s |
| Atlas | `bytedance/seedream-v5.0-pro/text-to-image` | text→image | $0.036 / image |
| Atlas | `bytedance/seedream-v5.0-pro/edit` | image→image | $0.036 / image (+$0.003 per extra reference) |
| Atlas | `bytedance/seedance-2.0-mini/{text,image,reference}-to-video` | text→video, image→video, first+last frame, reference→video | $0.011 / s |
| Atlas | `bytedance/seedance-2.0-fast/{text,image,reference}-to-video` | text→video, image→video, first+last frame, reference→video | $0.027 / s |
| Atlas | `bytedance/seedance-2.5/{text,image,reference}-to-video` | text→video, image→video, first+last frame, reference→video | $0.134 / s, every resolution |
| Atlas | `google/nano-banana-2/{text-to-image,edit}-developer` | text→image, image→image (14 refs) | $0.028 / image, every tier |
| Atlas | `google/nano-banana-2-lite/{text-to-image,edit}-developer` | text→image, image→image (14 refs) | $0.014 / image, 1K only |
| Atlas | `openai/gpt-image-2.5-{sunburst,flare}-developer/{text-to-image,edit}` | text→image, image→image (16 refs) | $0.03 / image @ 1K |
| Atlas | `minimax/h3-developer/{text,image,reference}-to-video` | text→video, image→video, first+last frame, reference→video | $0.015 / s @ 480P and 768P |
| Comet | `gpt-image-2` | text→image | metered |
| Comet | `qwen-image` | text→image (n must be 1) | metered |
| Comet | `seedance-2-5`, `doubao-seedance-2-0-mini` | text→video, image→video | metered |
| Comet | `veo3.1-fast`, `veo3.1` | text→video, image→video | metered |
| Comet | `sora-2`, `sora-2-pro` | text→video, image→video | metered |
| Comet | `wan2.7` | text→video, image→video | metered |
| Comet | `viduq3-turbo` | text→video, image→video | metered |
| Comet | `minimax-h3` | text→video, image→video | metered |
| Comet | `happyhorse-1.1` | text→video, image→video | metered |
| Comet | `flux-3` | text→video, image→video | metered |

**2026-09-05 addition:** Atlas cut Seedance 2.0 Mini to $0.011/s (from $0.056),
Seedance 2.0 Fast to $0.027/s (from $0.09), and Seedream v5.0 Pro to $0.036/image
(from $0.045), so all three were added. Ids, prices, resolutions, and durations
come from `https://www.atlascloud.ai/models/{model}/llms.txt` — the per-model
machine-readable reference Atlas publishes for agents, and the one it names as
authoritative for its own pricing over the vendor blurb on the HTML page.

**2026-09-09 addition:** Seedance 2.5 on both aggregators, read from
`https://www.atlascloud.ai/models/bytedance/seedance-2.5/{text,image,reference}-to-video/llms.txt`
and `https://runware.ai/docs/models/bytedance-seedance-2-5`. It is the same
model at two very different prices, and neither is simple:

- **Atlas quotes one flat $0.134/s for every resolution**, including the `-sr`
  and `-esr` upscales, so nothing it offers records as unpriced. Of those
  upscales only `1440p-sr` and `4k-esr` are offered — the rest duplicate a
  native tier, and `1080p-esr & 60fps` changes the frame rate as well as the
  size, which the size control has no way to say.
- **Runware bills per tier** — $0.102/$0.23/$0.614 per second at 480p/720p/1080p
  — so 480p undercuts Atlas and 720p costs nearly twice as much. It publishes
  explicit width/height pairs rather than a preset, so its eighteen documented
  sizes are transcribed verbatim; the rate is found through the leading tier of
  the label (`sizeRateKey`).

Duration is a genuine 4–30 range on both, not the short stops the 2.0 tiers
list: the single-pass 30-second clip is what the model is for. References are
cited in the prompt as `@Image1` (2.0 uses the bare `Image 1`), and a wrong tag
is ignored rather than rejected, so the syntax is declared per model. Atlas's
image-to-video endpoint documents `adaptive` as its only `ratio` value — the
shape comes from the frame — so that entry offers no aspect-ratio control;
`adaptive` is left out of the other two because declaring `aspectRatios` makes
the field always sent, and the account Worker's validator accepts real ratios
only.

Two field names differ from the rest of the Atlas catalog and are handled in the
adapter: Seedance 2.0 and 2.5 spell the aspect field `ratio` where Seedance v1
spells it `aspect_ratio`, and Seedream's editor takes an `images` array where the FLUX
endpoints take a single `image`. Seedream also refuses the shared size table —
it requires 1,048,576–4,194,304 output pixels and every size in that table is
smaller — so it carries its own.

**2026-08-16 correction:** `bfl:flux@2-dev` and `runware:101@1` were dropped. The
first appears only on Runware's marketing pages — the FLUX.2 [dev] model page
quotes `runware:400@1`, which is what the API takes. The second appeared only in
a docs example with no model page to confirm what it is. Model pages are the
authority; a summary page is not.

**2026-08-17 correction:** `lightricks:2@1` was dropped — its model page now
404s and today's LTX pages quote different identifiers, so it can no longer be
verified. Replaced by `lightricks:ltx@2.5-fast`, read the same day. Runware
retires and renames AIRs, so a checked-in catalog needs re-reading, not trust.

First-and-last-frame is a per-model capability: `inputs.frameImages` taking two
entries, which the vendor documents as "2 images: first and last frames".
LTX-2.5 Fast and Seedance 2.0 Mini take two; PixVerse V5 Fast and Wan 2.6 Flash
take one.

Per-model constraints that failed in production and are now catalog data:
clip lengths (LTX-2 Fast takes 6/8/10 only), output sizes (LTX-2 Fast is 16:9
only; Seedance 2.0 Mini and PixVerse V5 Fast publish portrait and square), and
the input-image field (`seedImage` on checkpoints vs required `referenceImages`
on the editing models).

## Scope and implementation boundary

New code lives in:

- `lib/providers/` — `types.ts`, `catalog.ts`, and one adapter per provider, plus
  an `index.ts` registry. Server-only HTTP; no React, no SDKs.
- `app/api/providers/video/route.ts` — create/status for the three new video
  providers.
- `store/useProviderJobsStore.ts` — one job store shared by the three, mirroring
  `useKieJobsStore`.

Existing files change only at their seams:

- `lib/engines/registry.ts` — three new `EngineMeta` entries.
- `app/api/generate/route.ts` — a branch that hands the new engine ids to the
  provider layer.
- `store/useAppStore.ts` — three keys plus per-provider model preferences.
- `components/ApiKeyConfig.tsx` — three credential cards.
- `components/GenerationInterface.tsx` — key gating and the cost line.
- `components/ProviderLogo.tsx`, `lib/engines/docs.ts` — marks and doc links.

Must not touch: the Gemini/Pollinations/Cloudflare engines, the fal and Kie
clients, catalogs, stores or workspaces, the gallery pipeline, or the auth guard.

## Decisions

- **Provider images return URLs; we return bytes.** All three hand back a URL
  (Comet's GPT models hand back base64). The route fetches the URL server-side and
  returns base64 the way every existing engine does, so the gallery, download,
  drop-to-reuse, and library paths keep working untouched. It costs one extra hop
  and keeps ~600 lines of client code unchanged.
- **One job store for all three video providers**, not three. Their contracts are
  the same shape — submit, poll, read a URL — and the differences are confined to
  the adapters.
- **Curated catalogs are checked-in constants, not live fetches, for the default
  set.** A live catalog is a network dependency on first paint and its 400–800
  entries are unusable as a picker. The public catalog endpoints stay available
  for a later "browse all models" surface.

**2026-09-22 addition — Atlas "Developer" editions.** Atlas began publishing a
second id for models it already carried: same weights, lower price. Ids and
prices are from the live catalog at `https://api.atlascloud.ai/api/v1/models`
(which carries `price.actual` / `price.origin` per model) and from each model's
`https://www.atlascloud.ai/models/{id}/llms.txt`. Four things are worth
recording, because each one was a way to get this wrong:

- **The suffix is not derivable.** Google hangs `-developer` off the *mode*
  (`google/nano-banana-2/text-to-image-developer`); OpenAI and MiniMax hang it
  off the *model* (`minimax/h3-developer/text-to-video`). Every id was copied
  from the catalog endpoint. A constructed one 404s at submit.
- **Atlas drops a field the upstream schema does not name, silently.** None of
  these three speak the dialect `atlasCreateImage` had been sending. Nano Banana
  2 has no `size` at all — it takes `aspect_ratio` plus `resolution`
  (`1k`/`2k`/`4k`, lowercase). GPT Image 2.5 takes `size` as `WIDTHxHEIGHT` from
  a fixed enum, with an `x`, and `n` rather than `num_images`. MiniMax H3 renames
  `aspect_ratio` → `ratio`, `last_image` → `end_image`, and `reference_images` →
  `refers: [{url, type}]`. Sent in the old dialect every one of these returns a
  plausible image at the default size instead of failing, so `atlas.ts`
  dispatches per model and `tests/providers/atlas-comet.test.ts` asserts the
  field names rather than just a successful call.
- **Only Nano Banana 2 gets a resolution control.** Atlas prices it flat at
  $0.028 for 1K, 2K *and* 4K, so there is no tier to mis-bill. GPT Image 2.5 is
  tiered ($0.03 / $0.05 / $0.08) and its enum is tier × shape, and **the 1K tier
  publishes no 16:9, 9:16 or 21:9 size** — a tier control there would answer
  "1K, 16:9" with a 2K pixel pair and bill $0.05 for the $0.03 on the card. It is
  pinned to 1K, with those three shapes snapped to the widest and tallest sizes
  the tier does publish, the same call Seedream v5.0 Pro records above.
- **H3's two `-sr` upscales are left unpriced.** The llms.txt quotes one flat
  "$0.015 per second" with no table, while Atlas's own announcement says "from
  $0.015/sec at 480P". Rather than assume the upscales cost the same, only
  `480P` and `768P` carry a rate — a missing tier must never fall back to the
  cheapest one.

## Sources

- Runware: `https://runware.ai/docs/llms.txt`, `/docs/platform/task-polling`,
  `/docs/platform/task-details`, `/docs/models/alibaba-z-image-turbo`,
  `/docs/models/lightricks-ltx-2-fast`, `/docs/models/alibaba-wan2-6-flash`,
  `/docs/models/bytedance-seedance-2-5` (+ its `/guides/multi-reference-production`)
- Atlas: `https://atlascloud.ai/docs/models/image`, `/docs/models/video`,
  `https://www.atlascloud.ai/models/black-forest-labs/flux-schnell/llms.txt`,
  `https://www.atlascloud.ai/models/bytedance/seedance-v1-pro-fast/image-to-video/llms.txt`,
  `https://www.atlascloud.ai/models/bytedance/seedance-2.5/{text,image,reference}-to-video/llms.txt`,
  `https://www.atlascloud.ai/models/google/nano-banana-2{,-lite}/{text-to-image,edit}-developer/llms.txt`,
  `https://www.atlascloud.ai/models/openai/gpt-image-2.5-{sunburst,flare}-developer/{text-to-image,edit}/llms.txt`,
  `https://www.atlascloud.ai/models/minimax/h3-developer/{text,image,reference}-to-video/llms.txt`,
  `https://api.atlascloud.ai/api/v1/models`
- Comet: `https://apidoc.cometapi.com/llms.txt`, `/api/image/openai/images.md`,
  `/api/video/seedance/create.md`, `/api/video/seedance/query.md`,
  `/overview/models.md`
