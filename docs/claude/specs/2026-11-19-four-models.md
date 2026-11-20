# HeyGen Video 1.0, Kling Image 4.0, Seedance 2.5 Flash, Atlas Kling 4.0 Flash

Status: Implemented, awaiting review

## Context

Four additions from the 2026-11-16 and 2026-11-19 model watch: HeyGen Video 1.0
on Runware (50% off through Nov 30), Kling Image 4.0 on Atlas, Seedance 2.5
Flash on Runware and on Atlas (35% off through Nov 30), and Kling 4.0 Flash on
Atlas beside the existing Runware entry.

## Goals

- Every id, parameter and price is read from the vendor's public pages on
  2026-11-19. No credentials, no generation, no paid request.
- The catalog stores list prices. A sale with a published end is applied at
  call time inside its window, so a Worker that outlives it returns to list.
- An estimate never understates the vendor's own quote.

## Non-goals

No change to a provider default or to a saved selection. No change to Seedance
2.5 draft and finalize. No repricing of an existing entry (see "Found, not
changed"). No Kling Image 4.0 on Runware. No multi-image output.

## Scope and implementation boundary

- Entries: `lib/providers/catalog.ts` (two Runware entries; `seedance25Flash()`,
  `kling40Flash()`, `klingImage40()` on Atlas).
- Sales: `lib/providers/model-promotions.ts`. `withModelSale(model, at)` is the
  one call every price surface makes; it also applies the older Kling VIDEO 4.0
  Flash window from `kling-4-flash-promo.ts`, which is unchanged.
- Wire: `applyTierWithInputs` and the Seedance edit table in
  `lib/providers/runware.ts`; the `isKlingImage4` body and
  `SHAPE_FROM_FIRST_FRAME` in `lib/providers/atlas.ts`.
- Rate type: `referenceRate`, `includedInputImages`, `maxSecondsByMode`,
  `tierWithInputs` in `lib/providers/types.ts`; `modeDuration` in the catalog.

## Verified evidence (read 2026-11-19)

| Source | What it says |
| --- | --- |
| [Runware HeyGen Video 1.0](https://runware.ai/docs/models/heygen-video-1-0) | Id `heygen:video@1.0`, live, released 2026-09-30. "50% OFF until November 30, 2026". From text or an image, per second: $0.01 / $0.018 / $0.05 / $0.05 at 480p / 768p / 1080p / 2K, struck-through list $0.02 / $0.036 / $0.10 / $0.10. From references: $0.035 / $0.05 / $0.09 / $0.09, list $0.07 / $0.10 / $0.18 / $0.18. Each second of reference video is added at the reference rate. Each reference image after the first two: $0.02, list $0.04. `duration` 5–30, at most 15 with references. `frameImages` cannot be sent with `width`/`height`. 9 reference images, 3 videos, 3 audio. 16 published pixel pairs. No audio switch. |
| [Runware Seedance 2.5 Flash](https://runware.ai/docs/models/bytedance-seedance-2-5-flash) | Id `bytedance:seedance@2.5-flash`, live, released 2026-11-15. Text/Image to Video $0.0678 at 480p, $0.152 at 720p. Video-to-Video $0.0833 and $0.187. No sale shown. 4–30 s, 12 pixel pairs, 10 reference images, 5 videos, 5 audio, edit and extend through `inputs.video`. No `settings.draft`, no `inputs.draftId`. Width/height are refused with `frameImages` or `video`. |
| Atlas llms.txt for `bytedance/seedance-2.5-flash/{text,image,reference}-to-video` | Three ids. "$0.109 per second of generated video". `resolution` 480p or 720p, `duration` 4–30 or -1, `ratio`, `image`/`last_image`, `reference_images` (10), `reference_videos` (5), `reference_audios` (5). |
| Atlas llms.txt for `kwaivgi/kling-v4.0-flash/{text,image,reference}-to-video` | Three ids (a fourth, `video-edit`, is in the catalog API). "$0.066 per second". 720p only, 3–20 s, default 10. Image mode: one `image`, no `aspect_ratio`. Reference: 10 images, 5 videos, 7 subjects, `@image_N`. |
| Atlas llms.txt and readme for `kwaivgi/kling-image-v4.0/{text-to-image,image-set,long-image}` | `/edit` is 404: "Model not found". `text-to-image` takes `reference_images` (10), `num_images` 1–9, `resolution` 2k/4k/8k, `aspect_ratio`. "$0.057 per image". Readme rate table: 2K $0.063, 4K $0.094, 8K $0.157, references $0.003 each, "Discounts may apply". `image-set` is 2–10 related images at the same per-image price. `long-image` is $0.212. |
| [Atlas catalog API](https://api.atlascloud.ai/api/v1/models) | Seedance 2.5 Flash: actual 0.109, origin 0.167, discount "65". Kling 4.0 Flash: actual 0.066, origin 0.094, discount "70". Kling Image 4.0: actual 0.057, origin 0.063, discount "90". No end dates. |
| [Atlas calculator](https://api.atlascloud.ai/api/v1/model/calculate), the read-only quote its site calls | Kling 4.0 Flash, 5 s 720p: origin 0.6123, price 0.42861 (10 s doubles both; text, image, reference and edit agree). Seedance 2.5 Flash is token-metered (`estimate_reason: settles_on_usage`), origin $11.20 per million: 10 s 720p `adaptive` origin 2.444579, price 1.588976; 10 s 720p 16:9 origin 2.42928, price 1.579032; 10 s 480p origin 1.12961, price 0.734246; 30 s 720p 16:9 origin 7.26768, price 4.723992. Kling Image 4.0: 2k origin 0.063, price 0.0567; 4k 0.094 / 0.0846; 8k 0.157 / 0.1413; 2k with 1 reference 0.066 / 0.0594, with 3 references 0.072 / 0.0648; `num_images: 3` triples the 2k figure. |
| [Atlas home page](https://www.atlascloud.ai/) | "Get 35% off Seedance 2.5 Flash — up from 20%, through Nov 30", countdown `endAt: 1796054340000` (2026-11-30 15:59:00 UTC). Kling 4.0 Flash: "all four model variants at a standard price of $0.094 per second", cards show $0.094 struck through beside $0.066. Black Friday on Nov 26 (UTC) is a top-up bonus, not a model discount. |
| [Runware Kling IMAGE 4.0](https://runware.ai/docs/models/klingai-image-4-0) and changelog | Id `klingai:kling-image@4.0`, added 2026-11-17. 2K $0.063, plus $0.003 per input image. |

## Decisions

**The calculator quote is the rate, again.** The 2026-10-26 and 2026-11-03 Atlas
specs settled that a headline that disagrees with the calculator is not the
catalog rate. Two of the three Atlas additions disagree:

- Seedance 2.5 Flash prints a flat $0.109/s (list $0.167). The calculator
  meters tokens, which is $0.2445/s list and $0.1589/s on sale at 720p, and
  $0.113/s list and $0.0734/s on sale at 480p, for the largest frame. Those are
  the figures used. On them Atlas is not the cheaper Flash: Runware is $0.152
  and $0.0678 with no sale to expire.
- Kling 4.0 Flash prints $0.066/s (list $0.094). The calculator quotes
  $0.085722/s on an origin of $0.12246/s, the same 1.2988× that Kling 4.0
  carries.

**A dated sale is a window; an undated discount is not a rate.** This is the
P-Video-Edit lesson applied to Atlas.

| Model | Catalog (list) | Sale | Window |
| --- | --- | --- | --- |
| Runware HeyGen Video 1.0 | $0.02 / $0.036 / $0.10 / $0.10 per second; references $0.07 / $0.10 / $0.18 / $0.18 + $0.04 per image after two | Half of each | 2026-11-19 00:00 UTC to 2026-12-01 00:00 UTC. The page says "until November 30, 2026" with no timezone, so the sale runs through the end of that UTC day, the convention the Kling VIDEO 4.0 Flash and fal H3 offers use. |
| Atlas Seedance 2.5 Flash | $0.113 at 480p, $0.2445 at 720p | $0.0734 and $0.1589 | 2026-11-19 00:00 UTC to 2026-11-30 15:59:00 UTC, the countdown instant Atlas publishes. |
| Runware Seedance 2.5 Flash | $0.0678 at 480p, $0.152 at 720p; edit $0.0833 and $0.187 | None published | — |
| Atlas Kling 4.0 Flash | $0.12246 per second | None applied. Atlas quotes 30% off with no end date. | — |
| Atlas Kling Image 4.0 | $0.063 at 2K, $0.094 at 4K, $0.003 per reference | None applied. Atlas quotes 10% off with no end date. | — |

`startsAt` is the day the offer was read, not the day it began, so a late read
never invents a discount for an older job. The two undated discounts are kept
as `ATLAS_KLING_40_FLASH_QUOTED_USD` and `KLING_IMAGE_40_QUOTED_USD` for the
record and are charged nowhere. While they run, a job costs less than its
estimate. Add a window to `model-promotions.ts` only when Atlas publishes an end.

**$0.109 against $0.167 × 0.65.** $0.167 × 0.65 is $0.10855, which Atlas rounds
to $0.109. The difference is $0.00045/s and does not matter here, because
neither headline figure is used.

**Kling Image 4.0 on Atlas, not Runware.** Both list $0.063 at 2K and $0.003
per input image. Atlas quotes 10% less today and the Atlas image path already
speaks this body (tier, ratio, `reference_images`). Runware's
`klingai:kling-image@4.0` is the alternative; it is not added, to avoid two
copies of one model.

**One Kling Image entry for both modes.** Atlas has no `/edit` endpoint.
`text-to-image` takes the references, so the entry lists `text` and `image`.

**HeyGen sends the tier once media is attached.** `frameImages` cannot ride
with `width`/`height`, and the vendor's reference example sends `resolution`.
`tierWithInputs: 'media'` makes any run with images send the tier. Seedance 2.5
Flash has the same rule for frame images only (`'frames'`).

**HeyGen references stop at 15 seconds.** `maxSecondsByMode` narrows the range
for that mode in the control, the guest route, the Worker validator and the
agent schema.

## Gaps, stated

- HeyGen reference video and reference audio are not offered. Reference video
  seconds are billed on top of the output and this estimate has no input
  length; reference audio publishes a 32 MB cap and no length bounds for the
  clip checks. So 9 of the vendor's 12 references are reachable, images only,
  and the browser sends at most 5.
- HeyGen `duration: auto`, `settings.promptEnhancement` and `numberResults`
  are not exposed.
- Kling Image 4.0 image sets (2–10 related images) are not offered: every
  image path returns one result. 8K and `long-image` are not offered.
- Atlas Kling 4.0 Flash `video-edit`, reference videos, subjects and voices
  are not offered. Input seconds are billed and the formula is unpublished.
- Seedance 2.5 Flash extend is not offered; edit is.
- In image and reference mode the HeyGen size control still lists shapes. Only
  its tier is sent, and the note says so.

## Found, not changed

- Atlas Seedance 2.5 (the existing entry) is stored at a flat $0.134/s. The
  calculator now quotes about $0.304/s at 720p, $0.140/s at 480p and $0.598/s
  at 1080p on its discount. That entry understates today's quote and should be
  re-read in its own change.
- Runware Seedance 2.5 sends `width`/`height` with frame images, which its page
  now says cannot be used. It was left alone so draft and finalize are
  untouched; whether Runware rejects it needs a live run.

## Could not verify

- That any provider bills what it quotes. No paid request was made.
- That Atlas bills Seedance 2.5 Flash at the calculator's token quote and not
  the $0.109 headline, and Kling 4.0 Flash at $0.0857 and not $0.066.
- How long Atlas's Kling 4.0 Flash (30%) and Kling Image 4.0 (10%) discounts
  last, and what Atlas charges for Seedance 2.5 Flash after Nov 30 ("up from
  20%" suggests a smaller discount may return).
- Which timezone Runware's "until November 30, 2026" ends in.
- The result hosts. Atlas Kling 4.0 reference-to-video began returning a
  temp-24h bucket on 2026-11-13; whether Kling 4.0 Flash, Kling Image 4.0 or
  Seedance 2.5 Flash return a host outside `RESULT_DOMAINS` can only be seen on
  a live job. No host was added on a guess. `canRetryResultLocation` re-checks
  a stuck job once one is approved.
- That Runware accepts `resolution` with `referenceImages` for HeyGen exactly
  as its example shows, and Seedance 2.5 Flash's edit body, end to end.
- HeyGen's prompt syntax for citing a reference. The page names none, so no
  token is suggested.

## Tests

`tests/spend/model-promotions.test.ts` (ids, list rates, both windows at their
boundaries, estimate math, saved-job pricing) and
`tests/providers/four-models-wire.test.ts` (request bodies, per-mode length,
Seedance 2.5 unchanged). `tests/spend/catalog-rates.test.ts` gains the Atlas rows.
