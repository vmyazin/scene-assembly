// lib/providers/catalog.ts
import { P_VIDEO_EDIT_MODEL } from './p-video-edit-promo';
import {
  ATLAS_SEEDANCE_25_FLASH_REFERENCE_CLIPS,
  ATLAS_SEEDANCE_25_REFERENCE_CLIPS,
  SEEDANCE_20_REFERENCE_CLIPS,
  SEEDANCE_25_FLASH_REFERENCE_CLIPS,
  SEEDANCE_25_REFERENCE_CLIPS,
} from './reference-clips';
import type {
  MediaKind,
  ProviderId,
  ProviderModel,
  ProviderSize,
  ProviderMode,
  ProviderVideoInputCapability,
} from './types';

/**
 * Curated models per provider.
 *
 * Every `id` here is quoted verbatim from the vendor's own documentation or
 * public catalog endpoint, read on 2026-08-16 (sources in
 * `docs/claude/specs/2026-08-16-multi-provider-sources.md`). A wrong identifier
 * fails at the provider with an opaque error, so treat this list as a citation:
 * **do not add an entry you have not read in the vendor's docs.**
 *
 * Prices are the vendors' published rates, copied as display strings because
 * the units differ — per image, per megapixel, per second of video.
 */

/**
 * Kling VIDEO O1 edit, shared by Pro and Standard.
 * Read 2026-10-16 from
 * https://runware.ai/docs/models/klingai-video-o1-pro and
 * https://runware.ai/docs/models/klingai-video-o1-standard.
 * inputs.video publishes no duration or pixel ceiling ("dimensions and duration
 * match the input video"). The app still stops at 30 seconds, the widest
 * published edit ceiling, so an import or upload cannot run unbounded.
 * referenceImages is at most 4 once a video is set.
 * The per-second edit price is not on the page: the headline is "from", the
 * tables are text/image/reference-to-video, and the video-edit examples omit
 * duration. No rate is stored.
 */
const KLING_O1_EDIT: NonNullable<ProviderModel['videoEdit']> = {
  sizes: [],
  maxImages: 4,
  minPromptLength: 2,
  maxPromptLength: 2500,
  transport: 'kling-reference',
  controls: [{
    key: 'keepOriginalSound',
    label: 'Keep original sound',
    kind: 'boolean',
    defaultValue: true,
    description: 'Maintain the original sound from the source video.',
  }],
  plainReferences: true,
  outputLabel: 'source',
  note: 'Edits the source clip in place. The page publishes no duration or pixel cap, and no duration control is sent. This app stops at 30 seconds and trims a longer upload. Up to 4 reference images. Keep original sound is sent with the clip. The per-second edit price is not published.',
};

export const IDEOGRAM_46_MODEL = 'ideogram:4.6@0';
export const IDEOGRAM_46_PRECISE_EDIT_MODEL = 'ideogram:4.6@precise-edit';

/**
 * "Up to 2K (4.19 MP)" on Runware's rate tables. The boundary is 2048 × 2048:
 * the page's own 2048×2048 example bills the 2K rate, and Precise Edit names
 * 4,194,304 pixels as the very-low ceiling.
 */
export const IDEOGRAM_46_2K_PIXELS = 4_194_304;

/**
 * Ideogram 4.6 and Ideogram 4.6 Precise Edit on Runware. Read 2026-11-23 from
 * https://runware.ai/docs/models/ideogram-4-6,
 * https://runware.ai/docs/models/ideogram-4-6-precise-edit and the same
 * figures in the page data of https://runware.ai/pricing. Released 2026-11-19.
 * No sale is shown on either page, so these are list prices and there is no
 * window in `model-promotions.ts`.
 *
 * Both price per image by `settings.quality` and by output size, where "2K" is
 * up to 4.19 MP and "4K" is above it:
 *
 *                      very low   low            medium         high
 *   text to image      $0.008     $0.03 / $0.06  $0.06 / $0.12  $0.10 / $0.20
 *   image to image     $0.008     $0.03 / $0.06  $0.06 / $0.20  $0.22 / $0.60
 *   Precise Edit       $0.008     $0.03 / $0.06  $0.06 / $0.20  $0.22 / $0.60
 *
 * 4.6 takes `width` and `height` on a 32-pixel grid (256–4096, 1:6 to 6:1)
 * and 1–5 `inputs.referenceImages`, the first being the image that is edited.
 * Very low renders at most 4.19 MP, so it is offered at 2K only. Precise Edit
 * takes `inputs.seedImage` plus up to 4 reference images and no dimensions:
 * the result keeps the source's size, so its tier follows the source's pixels.
 *
 * Medium is the selected quality because it is the vendor's default: a
 * request that names no quality (an agent that leaves the field out) is billed
 * what this card shows. Low is half the price and one press away.
 *
 * Not offered: `settings.magicPrompt` (refused once reference images are
 * attached, so it is never written), `settings.background`, `seed`, and
 * Precise Edit's `inputs.maskImage` and `settings.editRegion` box. No Runware
 * image model here has a mask input.
 */
function ideogram46(): ProviderModel[] {
  const options = [
    { label: 'Very low', value: 'very_low' },
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
  ];
  const editTable = {
    very_low: { '2k': 0.008 },
    low: { '2k': 0.03, '4k': 0.06 },
    medium: { '2k': 0.06, '4k': 0.20 },
    high: { '2k': 0.22, '4k': 0.60 },
  };
  return [
    {
      id: IDEOGRAM_46_MODEL,
      label: 'Ideogram 4.6',
      fileCode: 'ideogram-4_6',
      kind: 'image',
      modes: ['text', 'image'],
      price: '$0.06 / image @ medium · $0.008 very low · $0.03 low · $0.10 high, up to 2K · at 4K $0.06 low · $0.12 medium · $0.20 high',
      rate: {
        per: 'image',
        usdByResolution: { '2k': 0.06, '4k': 0.12 },
        usdByQuality: {
          very_low: { '2k': 0.008 },
          low: { '2k': 0.03, '4k': 0.06 },
          medium: { '2k': 0.06, '4k': 0.12 },
          high: { '2k': 0.10, '4k': 0.20 },
        },
      },
      referenceRate: { per: 'image', usdByResolution: editTable.medium, usdByQuality: editTable },
      sizes: [{ label: '2K', preset: '2k' }, { label: '4K', preset: '4k' }],
      qualities: {
        default: 'medium',
        options: options.map((option) => (option.value === 'very_low' ? { ...option, sizes: ['2K'] } : option)),
      },
      maxInputImages: 5,
      imageInput: 'reference',
      maxPromptLength: 10_000,
      note: 'Strong with lettering and layout inside the picture. Text-to-image, or an edit from up to 5 images: the first is the one edited, the rest guide it. Priced by quality and size: medium is $0.06 up to 2K and $0.12 at 4K, or $0.20 at 4K with images attached. Very low is $0.008 and stops at 2K.',
    },
    {
      id: IDEOGRAM_46_PRECISE_EDIT_MODEL,
      label: 'Ideogram 4.6 Precise Edit',
      fileCode: 'ideogram-4_6-precise-edit',
      kind: 'image',
      modes: ['image'],
      price: '$0.06 / image @ medium · $0.008 very low · $0.03 low · $0.22 high, up to 2K · above 2K $0.06 low · $0.20 medium · $0.60 high',
      rate: {
        per: 'image',
        usdByResolution: editTable.medium,
        // Very low is one price: the vendor scales a larger source down to 4.19 MP.
        usdByQuality: { ...editTable, very_low: { '2k': 0.008, '4k': 0.008 } },
        pixelTiers: [{ key: '2k', maxPixels: IDEOGRAM_46_2K_PIXELS }, { key: '4k' }],
      },
      qualities: { default: 'medium', options },
      maxInputImages: 5,
      imageInput: 'seed',
      // Empty on purpose: the result keeps the first image's own dimensions.
      aspectRatios: [],
      maxPromptLength: 10_000,
      note: 'Editing only. It changes what the prompt names and returns the first image at its own size; up to 4 more images guide the edit. Priced by quality and by the size of that first image: medium is $0.06 up to 2K (4.19 MP) and $0.20 above it. Very low is $0.008 and returns at most 4.19 MP.',
    },
  ];
}

/** The quality a request will send: the asked-for one when the model lists it, else its default. */
export function resolveImageQuality(model: Pick<ProviderModel, 'qualities'> | undefined, requested?: unknown): string | undefined {
  const qualities = model?.qualities;
  if (!qualities) return undefined;
  return qualities.options.some((option) => option.value === requested) ? (requested as string) : qualities.default;
}

/**
 * The size tiers a quality can render. Ideogram 4.6 caps very low at 4.19 MP,
 * so 4K leaves the list while it is selected rather than being refused later.
 */
export function imageSizesForQuality(model: Pick<ProviderModel, 'qualities' | 'sizes'> | undefined, quality: string | undefined): ProviderSize[] | undefined {
  const sizes = model?.sizes;
  if (!sizes?.length) return undefined;
  const allowed = model?.qualities?.options.find((option) => option.value === quality)?.sizes;
  return allowed ? sizes.filter((size) => allowed.includes(size.label)) : sizes;
}

const RUNWARE_MODELS: ProviderModel[] = [
  {
    id: 'runware:z-image@turbo',
    label: 'Z-Image Turbo',
    fileCode: 'z-image-turbo',
    kind: 'image',
    modes: ['text', 'image'],
    price: '~$0.003 / 1024²',
    maxInputImages: 1,
    imageInput: 'seed',
    note: 'Cheapest image model here — sub-second, photorealistic, good with text in-image.',
  },
  {
    // https://runware.ai/docs/models/bfl-flux-3-image-klein — read 2026-10-19.
    // AIR is `bfl:flux@3-image-klein`. 1024×1024 at the default 16 steps is $0.006.
    // referenceImages takes 1–4; text-to-image sends width and height instead.
    id: 'bfl:flux@3-image-klein',
    label: 'FLUX 3 Image Klein',
    fileCode: 'flux-3-image-klein',
    kind: 'image',
    modes: ['text', 'image'],
    price: '$0.006 / 1024²',
    maxInputImages: 4,
    imageInput: 'reference',
    note: 'Fast, cheap draft. Text-to-image, or an edit from up to 4 reference images.',
  },
  {
    // The model page quotes this AIR; the marketing pages' "bfl:flux@2-dev"
    // spelling is not what the API takes.
    id: 'runware:400@1',
    label: 'FLUX.2 [dev]',
    fileCode: 'flux-2-dev',
    kind: 'image',
    modes: ['text', 'image'],
    price: '$0.0077 / 1024²',
    maxInputImages: 4,
    imageInput: 'reference',
  },
  {
    id: 'runware:108@22',
    label: 'Qwen-Image-Edit-Plus',
    fileCode: 'qwen-image-edit-plus',
    kind: 'image',
    modes: ['image'],
    price: '$0.0166 / 1024²',
    maxInputImages: 3,
    imageInput: 'reference',
    note: 'Editing only — it needs at least one reference image.',
  },
  ...ideogram46(),
  {
    id: 'alibaba:wan@3.0',
    label: 'Wan 3.0',
    fileCode: 'wan-3_0',
    kind: 'video',
    modes: ['reference'],
    price: '$0.05 / s @ 480p · $0.10 @ 720p · $0.20 @ 1080p',
    rate: { usdByResolution: { '480p': 0.05, '720p': 0.10, '1080p': 0.20 }, per: 'second' },
    maxInputImages: 10,
    videoInputs: {
      reference: {
        field: 'referenceImages',
        maxImages: 10,
        clientMaxImages: 5,
        promptSyntax: 'image-index',
      },
    },
    duration: { type: 'range', min: 2, max: 30, default: 6 },
    sizes: [
      { label: '480p', preset: '480p' },
      { label: '720p', preset: '720p' },
      { label: '1080p', preset: '1080p' },
    ],
    note: 'Identity-only character and product views, with native audio.',
  },
  {
    id: 'lightricks:ltx@2.5-fast',
    label: 'LTX-2.5 Fast',
    fileCode: 'ltx-2_5-fast',
    kind: 'video',
    // frameImages takes two, and the vendor's rule for two is first and last.
    modes: ['text', 'image', 'frames'],
    price: '$0.09 / s @ 720p · $0.13 @ 1080p',
    rate: { usdByResolution: { '720p': 0.09, '1080p': 0.13 }, per: 'second' },
    maxInputImages: 2,
    durations: [6, 8, 10, 12, 14, 16, 18, 20],
    sizes: [
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '1080p · 16:9', width: 1920, height: 1080 },
      { label: '1080p · 9:16', width: 1080, height: 1920 },
      { label: '2K · 16:9', width: 2560, height: 1440 },
      { label: '2K · 9:16', width: 1440, height: 2560 },
      { label: '4K · 16:9', width: 3840, height: 2160 },
      { label: '4K · 9:16', width: 2160, height: 3840 },
    ],
  },
  {
    // List prices, re-read 2026-11-03: https://runware.ai/docs/models/prunaai-p-video-edit
    // The page still shows 25% off ($0.0338/s standard, $0.0188/s draft) until
    // November 3. Those sale figures are applied at call time by
    // pVideoEditRates — baking them in here would keep the discount after a
    // Worker that loaded during the sale outlived it.
    id: P_VIDEO_EDIT_MODEL, label: 'P-Video-Edit', fileCode: 'p-video-edit',
    kind: 'video', modes: ['edit'],
    videoEdit: {
      sizes: [], maxImages: 4, maxSeconds: 15,
      rate: {per: 'second', usd: 0.045}, draftRate: {per: 'second', usd: 0.025},
      outputLabel: '848px', promptSyntax: 'image-index',
      note: 'Duration and aspect ratio follow the source. Output is 25 fps with fixed dimensions up to 848px on the long edge (848×480 landscape, 624×624 square). Draft is faster and lower quality.',
    },
  },
  {
    // Read 2026-09-09 from https://runware.ai/docs/models/bytedance-seedance-2-5.
    id: 'bytedance:seedance@2.5',
    label: 'Seedance 2.5',
    fileCode: 'seedance-2_5',
    kind: 'video',
    modes: ['text', 'image', 'frames', 'reference', 'edit'],
    // 1080p and the video-to-video rates were read 2026-10-12 from the same page.
    // Draft is a 480p preview (settings.draft), not a separate cheaper rate.
    draftPreview: true,
    videoEdit: { minSeconds: 4, maxSeconds: 30, sourceBounds: {minEdge: 300, maxEdge: 6000, minPixels: 407696, minRatio: 0.4, maxRatio: 2.5}, draftPreview: true, sizes: [{label: '720p', preset: '720p'}, {label: '480p', preset: '480p'}, {label: '1080p', preset: '1080p'}], rate: {per: 'second', usdByResolution: {'480p': 0.131, '720p': 0.295, '1080p': 0.734}}, maxImages: 5 },
    price: '$0.102 / s @ 480p \u00b7 $0.23 @ 720p \u00b7 $0.614 @ 1080p',
    rate: { usdByResolution: { '480p': 0.102, '720p': 0.23, '1080p': 0.614 }, per: 'second' },
    maxInputImages: 30,
    videoInputs: {
      image: { field: 'frameImages', maxImages: 1 },
      frames: { field: 'frameImages', maxImages: 2 },
      // The vendor takes 30 reference images. Videos and audio are referenceClips,
      // uploaded separately, so they do not ride along inside this data-URI cap.
      reference: {
        field: 'referenceImages',
        maxImages: 30,
        clientMaxImages: 5,
        promptSyntax: 'at-image-index',
      },
    },
    referenceClips: SEEDANCE_25_REFERENCE_CLIPS,
    // Any whole 4-30. The native 30-second clip in a single pass is the reason
    // to reach for this model, so the control is a range and not 2.0's stops.
    duration: { type: 'range', min: 4, max: 30, default: 5 },
    // The vendor's own dimension table, verbatim; anything outside it comes
    // back as "Unsupported width/height combination for this model
    // architecture". The 480p and 21:9 pairs are only approximately their
    // named ratio, which is why they are copied rather than computed.
    sizes: [
      { label: '480p \u00b7 16:9', width: 854, height: 480 },
      { label: '480p \u00b7 9:16', width: 480, height: 854 },
      { label: '480p \u00b7 1:1', width: 640, height: 640 },
      { label: '480p \u00b7 4:3', width: 752, height: 560 },
      { label: '480p \u00b7 3:4', width: 560, height: 752 },
      { label: '480p \u00b7 21:9', width: 992, height: 432 },
      { label: '720p \u00b7 16:9', width: 1280, height: 720 },
      { label: '720p \u00b7 9:16', width: 720, height: 1280 },
      { label: '720p \u00b7 1:1', width: 960, height: 960 },
      { label: '720p \u00b7 4:3', width: 1112, height: 834 },
      { label: '720p \u00b7 3:4', width: 834, height: 1112 },
      { label: '720p \u00b7 21:9', width: 1470, height: 630 },
      { label: '1080p \u00b7 16:9', width: 1920, height: 1080 },
      { label: '1080p \u00b7 9:16', width: 1080, height: 1920 },
      { label: '1080p \u00b7 1:1', width: 1440, height: 1440 },
      { label: '1080p \u00b7 4:3', width: 1664, height: 1248 },
      { label: '1080p \u00b7 3:4', width: 1248, height: 1664 },
      { label: '1080p \u00b7 21:9', width: 2206, height: 946 },
    ],
    note: 'Up to 30 seconds in one pass, with native audio. Address images as @Image1, videos as @Video1, and audio as @Audio1. Frame images cannot be combined with reference video. Draft is a 480p preview you can finalize at 1080p; finalize does not send the clips again.',
  },
  {
    // Read 2026-11-19 from https://runware.ai/docs/models/bytedance-seedance-2-5-flash
    // (released on Runware 2026-11-15). Seedance 2.5 with a 720p ceiling, 10
    // reference images instead of 30, 5 reference videos and 5 audio clips
    // instead of 10, and no draft: the page has no settings.draft and no
    // inputs.draftId, so draftPreview stays off and finalize never sees this id.
    // Text/Image to Video is $0.0678 at 480p and $0.152 at 720p; Video-to-Video
    // is $0.0833 and $0.187. No sale is shown on the page.
    // "When inputs.frameImages or inputs.video is provided, width/height cannot
    // be used", so frame runs send the resolution tier (tierWithInputs).
    id: 'bytedance:seedance@2.5-flash',
    label: 'Seedance 2.5 Flash',
    fileCode: 'seedance-2_5-flash',
    kind: 'video',
    modes: ['text', 'image', 'frames', 'reference', 'edit'],
    videoEdit: { minSeconds: 4, maxSeconds: 30, sourceBounds: {minEdge: 300, maxEdge: 6000, minPixels: 407696, minRatio: 0.4, maxRatio: 2.5}, sizes: [{label: '720p', preset: '720p'}, {label: '480p', preset: '480p'}], rate: {per: 'second', usdByResolution: {'480p': 0.0833, '720p': 0.187}}, maxImages: 5 },
    price: '$0.0678 / s @ 480p · $0.152 @ 720p',
    rate: { usdByResolution: { '480p': 0.0678, '720p': 0.152 }, per: 'second' },
    maxInputImages: 10,
    videoInputs: {
      image: { field: 'frameImages', maxImages: 1 },
      frames: { field: 'frameImages', maxImages: 2 },
      reference: {
        field: 'referenceImages',
        maxImages: 10,
        clientMaxImages: 5,
        promptSyntax: 'at-image-index',
      },
    },
    referenceClips: SEEDANCE_25_FLASH_REFERENCE_CLIPS,
    tierWithInputs: 'frames',
    duration: { type: 'range', min: 4, max: 30, default: 5 },
    // The vendor's dimension table, verbatim. Same pairs as Seedance 2.5's
    // first two tiers; there is no 1080p row.
    sizes: [
      { label: '480p · 16:9', width: 854, height: 480 },
      { label: '480p · 9:16', width: 480, height: 854 },
      { label: '480p · 1:1', width: 640, height: 640 },
      { label: '480p · 4:3', width: 752, height: 560 },
      { label: '480p · 3:4', width: 560, height: 752 },
      { label: '480p · 21:9', width: 992, height: 432 },
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '720p · 1:1', width: 960, height: 960 },
      { label: '720p · 4:3', width: 1112, height: 834 },
      { label: '720p · 3:4', width: 834, height: 1112 },
      { label: '720p · 21:9', width: 1470, height: 630 },
    ],
    note: 'The lower-cost Seedance 2.5: up to 30 seconds with native audio, at 480p or 720p. Up to 10 reference images, 5 videos and 5 audio clips, cited as @Image1, @Video1 and @Audio1. With a first frame the clip keeps that image’s shape. No draft preview.',
  },
  {
    // Read 2026-11-19 from https://runware.ai/docs/models/heygen-video-1-0.
    // These are LIST prices. The page shows "50% OFF until November 30, 2026";
    // that sale is applied at call time by withModelSale (model-promotions.ts).
    // Baking it in here would keep the discount after a Worker that loaded
    // during the sale outlived it.
    //
    // From text or an image, per second: $0.02 at 480p, $0.036 at 768p, $0.10
    // at 1080p and at 2K. From references: $0.07, $0.10, $0.18, $0.18, plus
    // $0.04 for each reference image after the first two.
    //
    // Reference video is not offered: each second of it is billed on top of
    // the output at the reference rate, and this estimate has no input length.
    // Reference audio is not offered either: it needs an image or a video with
    // it, and the page publishes a 32 MB cap and no length bounds for the clip
    // limits this app checks before a job is reserved. That leaves reference
    // images, 9 of the vendor's 12 references.
    //
    // frameImages cannot be sent with width/height, and the reference example
    // sends `resolution`, so any run with input media sends the tier and the
    // input sets the shape (tierWithInputs). Text sends the pixel pair.
    // Audio is always generated; the page has no audio switch.
    id: 'heygen:video@1.0',
    label: 'HeyGen Video 1.0',
    fileCode: 'heygen-video-1_0',
    kind: 'video',
    modes: ['text', 'image', 'reference'],
    price: '$0.02 / s @ 480p · $0.036 @ 768p · $0.10 @ 1080p and 2K',
    rate: { usdByResolution: { '480p': 0.02, '768p': 0.036, '1080p': 0.10, '2K': 0.10 }, per: 'second' },
    referenceRate: {
      usdByResolution: { '480p': 0.07, '768p': 0.10, '1080p': 0.18, '2K': 0.18 },
      per: 'second',
      extraInputImageUsd: 0.04,
      includedInputImages: 2,
    },
    maxInputImages: 9,
    videoInputs: {
      image: { field: 'frameImages', maxImages: 1 },
      reference: { field: 'referenceImages', maxImages: 9, clientMaxImages: 5 },
    },
    tierWithInputs: 'media',
    // 5–30 from text or a first frame. "When inputs.referenceImages … is
    // provided, duration must be at most 15."
    duration: { type: 'range', min: 5, max: 30, default: 5 },
    maxSecondsByMode: { reference: 15 },
    // The vendor's dimension table, verbatim. 1080p and 2K publish 16:9 and
    // 9:16 only, and most pairs are only approximately their named ratio.
    sizes: [
      { label: '480p · 16:9', width: 832, height: 480 },
      { label: '480p · 9:16', width: 480, height: 832 },
      { label: '480p · 1:1', width: 480, height: 480 },
      { label: '480p · 4:3', width: 640, height: 480 },
      { label: '480p · 3:4', width: 480, height: 640 },
      { label: '480p · 21:9', width: 960, height: 416 },
      { label: '768p · 16:9', width: 1344, height: 768 },
      { label: '768p · 9:16', width: 768, height: 1344 },
      { label: '768p · 1:1', width: 768, height: 768 },
      { label: '768p · 4:3', width: 1024, height: 768 },
      { label: '768p · 3:4', width: 768, height: 1024 },
      { label: '768p · 21:9', width: 1536, height: 672 },
      { label: '1080p · 16:9', width: 1890, height: 1080 },
      { label: '1080p · 9:16', width: 1080, height: 1890 },
      { label: '2K · 16:9', width: 2856, height: 1632 },
      { label: '2K · 9:16', width: 1632, height: 2856 },
    ],
    note: 'Video with dialogue, ambience and sound effects generated in the same pass. 5–30 seconds from text or a first frame; up to 15 seconds from reference images. With an image or references, the output keeps the input’s shape and only the resolution tier is sent. References cost more: $0.07 / s at 480p, $0.10 at 768p, $0.18 at 1080p and 2K, plus $0.04 for each image after the first two. Reference video and audio are not offered here.',
  },
  {
    id: 'bytedance:seedance@2.0-mini',
    label: 'Seedance 2.0 Mini',
    fileCode: 'seedance-2_0-mini',
    kind: 'video',
    modes: ['text', 'image', 'frames'],
    price: '$0.036 / s @ 480p · $0.081 / s @ 720p',
    rate: { usdByResolution: { '480p': 0.036, '720p': 0.081 }, per: 'second' },
    maxInputImages: 2,
    durations: [4, 5, 6, 8, 10, 15],
    sizes: [
      { label: '480p · 16:9', width: 864, height: 496 },
      { label: '480p · 9:16', width: 496, height: 864 },
      { label: '480p · 1:1', width: 640, height: 640 },
      { label: '480p · 3:4', width: 560, height: 752 },
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '720p · 1:1', width: 960, height: 960 },
      { label: '720p · 3:4', width: 834, height: 1112 },
      { label: '720p · 21:9', width: 1470, height: 630 },
    ],
  },
  {
    id: 'pixverse:1@5-fast',
    label: 'PixVerse V5 Fast',
    fileCode: 'pixverse-v5-fast',
    kind: 'video',
    // One frame image only, so no first-and-last here.
    modes: ['text', 'image'],
    price: '$0.094 / 5s @ 360p · $0.248 / 5s @ 1080p',
    maxInputImages: 1,
    // The vendor lists exactly two lengths.
    durations: [5, 8],
    sizes: [
      { label: '540p · 16:9', width: 960, height: 540 },
      { label: '540p · 9:16', width: 540, height: 960 },
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '720p · 1:1', width: 720, height: 720 },
      { label: '720p · 3:4', width: 720, height: 960 },
      { label: '1080p · 16:9', width: 1920, height: 1080 },
      { label: '1080p · 9:16', width: 1080, height: 1920 },
    ],
  },
  {
    id: 'alibaba:wan@2.6-flash',
    label: 'Wan 2.6 Flash',
    fileCode: 'wan-2_6-flash',
    kind: 'video',
    modes: ['image'],
    price: '$0.025 / s @ 720p',
    rate: { usdByResolution: { '720p': 0.025 }, per: 'second' },
    maxInputImages: 1,
    // Documented as a 2–15s range; these are the useful stops inside it.
    durations: [4, 5, 6, 8, 10, 15],
    sizes: [
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '720p · 1:1', width: 960, height: 960 },
      { label: '1080p · 16:9', width: 1920, height: 1080 },
      { label: '1080p · 9:16', width: 1080, height: 1920 },
      { label: '1080p · 1:1', width: 1440, height: 1440 },
    ],
    note: 'Image-to-video only. Cheapest video option here.',
  },
  {
    // Read 2026-10-01 from https://runware.ai/docs/models/google-veo-3-1-lite.
    // Pricing on that page: 720p without audio $0.03, with audio $0.05;
    // 1080p without audio $0.05, with audio $0.08. The silent table is what
    // a run estimates while Generate audio is off. Capacity is limited.
    id: 'google:veo@3.1-lite',
    label: 'Veo 3.1 Lite',
    fileCode: 'veo-3_1-lite',
    kind: 'video',
    modes: ['text', 'image', 'frames'],
    price: '$0.03 / s silent · $0.05 / s with audio @ 720p · $0.05 / s silent · $0.08 / s with audio @ 1080p',
    rate: {
      per: 'second',
      usdByResolution: { '720p': 0.03, '1080p': 0.05 },
      audioUsdByResolution: { '720p': 0.05, '1080p': 0.08 },
    },
    maxInputImages: 2,
    videoInputs: {
      image: { field: 'frameImages', maxImages: 1 },
      frames: { field: 'frameImages', maxImages: 2 },
    },
    durations: [4, 6, 8],
    // The vendor's dimension table. Two frame images must be sent as
    // `resolution` instead of width/height; the adapter makes that switch.
    sizes: [
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '1080p · 16:9', width: 1920, height: 1080 },
      { label: '1080p · 9:16', width: 1080, height: 1920 },
    ],
    supportsAudio: true,
    aspectRatios: ['16:9', '9:16'],
    note: 'Optional audio. Silent is $0.03/s at 720p and $0.05/s at 1080p; with audio those are $0.05/s and $0.08/s. Capacity for this model is limited.',
  },
  {
    // Read 2026-10-16 from https://runware.ai/docs/models/runway-aleph-2-0
    // and the editing guide. $0.28 per second, flat. Examples cost $1.70 with
    // no duration, which is not a second rate and not a minimum. No minimumUsd.
    id: 'runway:aleph@2.0',
    label: 'Runway Aleph 2.0',
    fileCode: 'aleph-2_0',
    kind: 'video',
    modes: ['edit'],
    price: '$0.28 / s',
    videoEdit: {
      sizes: [],
      rate: { per: 'second', usd: 0.28 },
      maxImages: 5,
      minSeconds: 2,
      maxSeconds: 30,
      maxBytes: 32_000_000,
      minPromptLength: 1,
      maxPromptLength: 1000,
      requireMeasurement: true,
      measureForPrice: true,
      transport: 'frame-anchors',
      plainReferences: true,
      outputLabel: '1080p',
      sourceBounds: { maxEdge: 1920 },
      references: { images: { max: 5, wire: 'images' } },
      frameAnchors: {
        frames: ['first', 'last', '0', '-1'],
        timestamp: { min: 0, max: 30, step: 0.01 },
      },
      // The pin string is one control so the allow-list and the agent schema
      // share it. The tray draws a pin per image; Model controls skip `tray`.
      controls: [{
        key: 'frameAnchors',
        label: 'Frame anchors',
        kind: 'text',
        surface: 'tray',
        description: 'Optional. One token per reference image, comma-separated: auto, first, last, 0, -1, or t:seconds. Omit it and the model places the images.',
      }],
      note: 'Edits a 2–30 s source up to 1080p and 32 MB. The prompt is at most 1000 characters. Up to 5 reference images, each left automatic or pinned to the first frame, the last frame, frame 0, frame −1, or a timestamp. Output keeps the source shape. $0.28 per second.',
    },
  },
  {
    id: 'klingai:kling@o1',
    label: 'Kling VIDEO O1 Pro',
    fileCode: 'kling-o1',
    kind: 'video',
    modes: ['edit'],
    price: 'price unknown',
    videoEdit: KLING_O1_EDIT,
  },
  {
    id: 'klingai:kling@o1-standard',
    label: 'Kling VIDEO O1 Standard',
    fileCode: 'kling-o1-standard',
    kind: 'video',
    modes: ['edit'],
    price: 'price unknown',
    videoEdit: KLING_O1_EDIT,
  },
  {
    // Read 2026-10-16 from https://runware.ai/docs/models/klingai-video-3-0-omni-4k.
    // Source video: 700–4553 px, aspect 1:2.5–2:1, area up to 8.29 MP
    // (3840×2160 is 8,294,400), duration 3–15.5 s. $0.42 per second, flat.
    // The video-edit example sends resolution "4k" and no duration.
    // referenceImages is at most 4 with a video. Element bundles are a separate
    // input and are not offered here.
    id: 'klingai:kling-video@o3-4k',
    label: 'Kling VIDEO 3.0 Omni 4K',
    fileCode: 'kling-o3-4k',
    kind: 'video',
    modes: ['edit'],
    price: '$0.42 / s',
    videoEdit: {
      sizes: [],
      rate: { per: 'second', usd: 0.42 },
      maxImages: 4,
      minSeconds: 3,
      maxSeconds: 15.5,
      minPromptLength: 2,
      maxPromptLength: 2500,
      requireMeasurement: true,
      measureForPrice: true,
      transport: 'kling-reference',
      controls: [{
        key: 'keepOriginalSound',
        label: 'Keep original sound',
        kind: 'boolean',
        defaultValue: true,
        description: 'Maintain the original sound from the source video.',
      }],
      outputResolution: '4k',
      plainReferences: true,
      outputLabel: '4K',
      sourceBounds: { minEdge: 700, maxEdge: 4553, maxPixels: 8_294_400, minRatio: 0.4, maxRatio: 2 },
      note: 'Edits a 3–15.5 s source. Each edge is 700–4553 px, the aspect is between 1:2.5 and 2:1, and the frame is at most 8.29 MP. Up to 4 reference images. Output is the 4K preset. Keep original sound is sent with the clip. $0.42 per second. Element bundles are not offered.',
    },
  },
  {
    // Read 2026-11-09 from https://runware.ai/docs/models/klingai-video-4-0-flash
    // (released 2026-11-04, confirmed in https://runware.ai/docs/changelog).
    // These are list prices: $0.094/s without video input and $0.126/s with it.
    // The sale that ends Nov 10 is applied at call time by withKling4FlashSale,
    // which withModelSale (model-promotions.ts) calls for every price surface.
    // Reference video is not offered: it moves a reference run onto the
    // video-input rate, and this entry prices that mode from images alone.
    // The vendor allows 10 referenceImages; edit stays at the 4 every other
    // Kling edit here sends. Elements and voices are not offered.
    // Prompt limit is E/26000 + N/11000 <= 1, so 11,000 fits every language.
    id: 'klingai:kling-video@4.0-flash',
    label: 'Kling VIDEO 4.0 Flash',
    fileCode: 'kling-4_0-flash',
    kind: 'video',
    modes: ['text', 'image', 'reference', 'edit'],
    price: '$0.094 / s',
    rate: { per: 'second', usd: 0.094 },
    maxInputImages: 10,
    maxPromptLength: 11_000,
    videoInputs: {
      image: { field: 'frameImages', maxImages: 1 },
      reference: { field: 'referenceImages', maxImages: 10, clientMaxImages: 5, promptSyntax: 'triple-angle' },
    },
    duration: { type: 'range', min: 3, max: 20, default: 10 },
    sizes: [
      { label: '720p · 16:9', width: 1280, height: 720 },
      { label: '720p · 9:16', width: 720, height: 1280 },
      { label: '720p · 1:1', width: 960, height: 960 },
      { label: '720p · 21:9', width: 1464, height: 628 },
    ],
    note: 'Fast 720p Kling with audio from the prompt, in 3–20 second clips. Uses one opening frame or up to 5 reference images here. List price is $0.094 per second.',
    videoEdit: {
      sizes: [],
      rate: { per: 'second', usd: 0.126 },
      maxImages: 4,
      minSeconds: 3,
      maxSeconds: 20,
      maxPromptLength: 11_000,
      requireMeasurement: true,
      measureForPrice: true,
      transport: 'kling-preserve-audio',
      controls: [{
        key: 'keepOriginalSound',
        label: 'Keep original sound',
        kind: 'boolean',
        defaultValue: true,
        description: 'Keep the audio of the source video instead of generating new audio.',
      }],
      promptSyntax: 'triple-angle',
      namesSource: true,
      outputLabel: '720p',
      sourceBounds: { minEdge: 700, maxEdge: 4553, maxPixels: 8_294_400, minRatio: 0.4, maxRatio: 2.5 },
      note: 'Edits a 3–20 s source at 24–60 fps. Each edge is 700–4553 px, the aspect is between 1:2.5 and 2.5:1, and the frame is at most 8.29 MP. Up to 4 reference images. Output is 720p. List price is $0.126 per second.',
    },
  },
];

/**
 * Seedance 2.0's Mini and Fast tiers are one model behind three endpoints each —
 * Atlas gives every mode its own id — so the controls they share are written
 * once and a tier supplies only its ids and its rate. Read on 2026-09-05 from
 * `https://www.atlascloud.ai/models/bytedance/seedance-2.0-{tier}/{mode}/llms.txt`,
 * the per-model reference Atlas publishes for agents.
 *
 * Neither tier has a native 1080p: above 720p they list only the upscaled `-SR`
 * sizes, and `4k` belongs to the full Seedance 2.0 model alone.
 */
function seedance20Tier(tier: 'mini' | 'fast'): ProviderModel[] {
  // Resolution-specific Atlas prices, read 2026-09-07:
  // https://www.atlascloud.ai/models/explore/seedance-2-lowest-price
  // The endpoint llms.txt quotes only the starting rate. Fast's published
  // 1080p price does not explicitly identify the API's 1080p-SR option;
  // leave that and unlisted 1440p-SR prices unknown rather than infer them.
  const usdByResolution: Record<string, number> = tier === 'mini'
    ? { '480p': 0.0113, '720p': 0.0242, '1080p-SR': 0.0435 }
    : { '480p': 0.027, '720p': 0.0581 };
  const shared = {
    label: `Seedance 2.0 ${tier === 'mini' ? 'Mini' : 'Fast'}`,
    kind: 'video' as const,
    price: Object.entries(usdByResolution)
      .map(([resolution, usd]) => `$${usd} / s @ ${resolution}`)
      .join(' · ') + ' · other sizes: price unknown',
    rate: { usdByResolution, per: 'second' as const },
    // Documented as any whole 4–15; these are the stops worth offering.
    durations: [4, 5, 6, 8, 10, 12, 15],
    sizes: [
      { label: '480p', preset: '480p' },
      { label: '720p', preset: '720p' },
      { label: '1080p (upscaled)', preset: '1080p-SR' },
      { label: '1440p (upscaled)', preset: '1440p-SR' },
    ],
  };

  return [
    {
      ...shared,
      id: `bytedance/seedance-2.0-${tier}/text-to-video`,
      fileCode: `seedance-2_0-${tier}-t2v`,
      modes: ['text'],
    },
    {
      ...shared,
      id: `bytedance/seedance-2.0-${tier}/image-to-video`,
      fileCode: `seedance-2_0-${tier}-i2v`,
      // `last_image` is optional, so one still opens the clip and two bookend it.
      modes: ['image', 'frames'],
      maxInputImages: 2,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 1 },
        frames: { field: 'frameImages', maxImages: 2 },
      },
    },
    {
      ...shared,
      id: `bytedance/seedance-2.0-${tier}/reference-to-video`,
      fileCode: `seedance-2_0-${tier}-r2v`,
      modes: ['reference'],
      maxInputImages: 9,
      videoInputs: {
        reference: {
          field: 'referenceImages',
          maxImages: 9,
          clientMaxImages: 5,
          promptSyntax: 'image-index',
        },
      },
      referenceClips: SEEDANCE_20_REFERENCE_CLIPS,
      note: 'Up to 9 images, 3 videos and 3 audio clips. Address them as Image 1, Video 1 and Audio 1. Audio needs an image or a video with it. Videos and audio together stay within 15 seconds each.',
    },
  ];
}

/**
 * Seedance 2.5, read 2026-09-09 from
 * `https://www.atlascloud.ai/models/bytedance/seedance-2.5/{mode}/llms.txt`.
 * Same three-endpoint shape as the 2.0 tiers, so it is written the same way.
 *
 * Two things differ from 2.0 and both are load-bearing. Atlas quotes **one
 * flat per-second price for every resolution**, so this is a `usd` rate rather
 * than a table and no size can record as unpriced. And the references are
 * cited with `@Image1` here, not 2.0's `Image 1` \u2014 the model reads the tag,
 * so the wrong syntax silently ignores the reference instead of failing.
 */
function seedance25(): ProviderModel[] {
  // The API also publishes `-sr`/`-esr` upscales of each native tier. Only the
  // two that reach a size the native tiers cannot are offered; `1080p-esr &
  // 60fps` is left out because it changes the frame rate as well as the size,
  // and this control names sizes only.
  const shared = {
    label: 'Seedance 2.5',
    kind: 'video' as const,
    price: '$0.134 / s',
    rate: { usd: 0.134, per: 'second' as const },
    // Documented as any whole 4\u201330, or -1 to let the model choose. A range,
    // not 2.0's stops: the single-pass 30-second clip is the point of 2.5.
    duration: { type: 'range' as const, min: 4, max: 30, default: 5 },
    sizes: [
      { label: '480p', preset: '480p' },
      { label: '720p', preset: '720p' },
      { label: '1080p', preset: '1080p' },
      { label: '1440p (upscaled)', preset: '1440p-sr' },
      { label: '4K (upscaled)', preset: '4k-esr' },
    ],
  };
  // The endpoint also documents `adaptive`, which is what the model does when
  // no ratio is sent. It is not offered because declaring `aspectRatios` makes
  // the field always sent, and `adaptive` is not a ratio the account Worker's
  // validator accepts \u2014 so it would pass in the browser and fail in a
  // background job.
  const aspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

  return [
    {
      ...shared,
      id: 'bytedance/seedance-2.5/text-to-video',
      fileCode: 'seedance-2_5-t2v',
      modes: ['text'],
      aspectRatios,
    },
    {
      ...shared,
      id: 'bytedance/seedance-2.5/image-to-video',
      fileCode: 'seedance-2_5-i2v',
      // `last_image` is optional, so one still opens the clip and two bookend it.
      modes: ['image', 'frames'],
      maxInputImages: 2,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 1 },
        frames: { field: 'frameImages', maxImages: 2 },
      },
      // No `aspectRatios` here on purpose: this endpoint lists `adaptive` as
      // the only value, because the shape comes from the frame you supply.
    },
    {
      ...shared,
      id: 'bytedance/seedance-2.5/reference-to-video',
      fileCode: 'seedance-2_5-r2v',
      modes: ['reference'],
      maxInputImages: 30,
      aspectRatios,
      videoInputs: {
        reference: {
          field: 'referenceImages',
          maxImages: 30,
          clientMaxImages: 5,
          promptSyntax: 'at-image-index',
        },
      },
      referenceClips: ATLAS_SEEDANCE_25_REFERENCE_CLIPS,
      note: 'Up to 30 images, 10 videos and 10 audio clips, cited as @Image1, @Video1 and @Audio1. Audio can be used on its own. Native audio.',
    },
  ];
}

/**
 * Atlas's "Developer" editions: the same upstream weights behind a cheaper
 * model id. Read 2026-09-22 from the live catalog at
 * `https://api.atlascloud.ai/api/v1/models` and from each model's own
 * `https://www.atlascloud.ai/models/{id}/llms.txt`.
 *
 * **The suffix is not a rule you can apply.** Google hangs `-developer` off the
 * *mode* (`/text-to-image-developer`); OpenAI and MiniMax hang it off the
 * *model* (`h3-developer/text-to-video`). Every id below is copied from the
 * catalog endpoint, never constructed — a built one 404s at submit.
 */

/**
 * Nano Banana 2, in the tier the user picked. Atlas charges **one flat price
 * for 1K, 2K and 4K here**, which is why this is the only image family in the
 * catalog that gets a resolution control: offering 4K costs the user nothing
 * over 1K, so there is no tier to mis-bill. The `sizes` labels are the studio's
 * own `1K`/`2K`/`4K` (so a choice carries over from Gemini and PiAPI) while the
 * presets are the lowercase values the API documents — Atlas rejects `2K`.
 *
 * Lite publishes `1k` alone, so its control shows one option rather than
 * promising a resolution the endpoint refuses.
 */
/**
 * Nano Banana 2.1 Developer. The id hangs `-developer` off the model
 * (`google/nano-banana-2.1-developer/text-to-image`), not off the mode the way
 * Nano Banana 2 does. llms.txt still prints a flat $0.018. Atlas's calculator
 * on 2026-11-03 does not: 1K is $0.0175, 2K is $0.02625, 4K is $0.049
 * (35% off the tier's origin price). The ledger uses those quotes.
 */
function nanoBanana21Developer(): ProviderModel[] {
  const shared = {
    kind: 'image' as const,
    price: '$0.0175 / image @ 1K · $0.02625 @ 2K · $0.049 @ 4K',
    rate: { usdByResolution: { '1k': 0.0175, '2k': 0.02625, '4k': 0.049 }, per: 'image' as const },
    sizes: ['1K', '2K', '4K'].map((label) => ({ label, preset: label.toLowerCase() })),
  };
  return [
    {
      ...shared,
      id: 'google/nano-banana-2.1-developer/text-to-image',
      label: 'Nano Banana 2.1 Developer',
      fileCode: 'nano-banana-2_1-dev-t2i',
      modes: ['text'],
      note: 'The cheapest Nano Banana 2.1 route. Quoted 2026-11-03 at $0.0175 / $0.02625 / $0.049 for 1K / 2K / 4K. The page still prints a flat $0.018.',
    },
    {
      ...shared,
      id: 'google/nano-banana-2.1-developer/edit',
      label: 'Nano Banana 2.1 Developer Edit',
      fileCode: 'nano-banana-2_1-dev-edit',
      modes: ['image'],
      maxInputImages: 14,
      note: 'Editing only — it needs at least one reference. Up to 14. Same tier prices as generation.',
    },
  ];
}

function nanoBanana2Developer(tier: 'full' | 'lite'): ProviderModel[] {
  const lite = tier === 'lite';
  // Lite is 1K only, and the calculator still returns $0.014 there.
  // The full developer route is no longer one price: 2026-11-03 quotes are
  // $0.028 at 1K, $0.042 at 2K and $0.056 at 4K. A flat $0.028 undercharged 4K.
  const shared = lite
    ? {
        kind: 'image' as const,
        price: '$0.014 / image',
        rate: { usd: 0.014, per: 'image' as const },
        sizes: ['1K'].map((label) => ({ label, preset: label.toLowerCase() })),
      }
    : {
        kind: 'image' as const,
        price: '$0.028 / image @ 1K · $0.042 @ 2K · $0.056 @ 4K',
        rate: { usdByResolution: { '1k': 0.028, '2k': 0.042, '4k': 0.056 }, per: 'image' as const },
        sizes: ['1K', '2K', '4K'].map((label) => ({ label, preset: label.toLowerCase() })),
      };
  const family = lite ? 'nano-banana-2-lite' : 'nano-banana-2';
  const label = lite ? 'Nano Banana 2 Lite Developer' : 'Nano Banana 2 Developer';
  const editLabel = lite ? 'Nano Banana 2 Lite Developer Edit' : 'Nano Banana 2 Developer Edit';
  const code = lite ? 'nano-banana-2-lite-dev' : 'nano-banana-2-dev';

  return [
    {
      ...shared,
      id: `google/${family}/text-to-image-developer`,
      label,
      fileCode: `${code}-t2i`,
      modes: ['text'],
      ...(lite ? {} : { deprecated: true }),
      note: lite
        ? 'The cheapest image model here. 1K only — Lite publishes no larger size.'
        : 'Deprecated. Nano Banana 2.1 Developer replaces it. Still available. 1K, 2K and 4K are different prices.',
    },
    {
      ...shared,
      id: `google/${family}/edit-developer`,
      label: editLabel,
      fileCode: `${code}-edit`,
      modes: ['image'],
      ...(lite ? {} : { deprecated: true }),
      maxInputImages: 14,
      note: lite
        ? 'Editing only — it needs at least one reference. Up to 14.'
        : 'Deprecated. Editing only — it needs at least one reference. Up to 14.',
    },
  ];
}

/**
 * GPT Image 2.5, pinned to its 1K billing tier — the same decision Seedream
 * v5.0 Pro above records, and for a sharper reason.
 *
 * Atlas prices this family per tier ($0.03 / 1K, $0.05 / 2K, $0.08 / 4K), but
 * the `size` enum is tier × shape and **the 1K tier publishes no 16:9, 9:16 or
 * 21:9 size at all**. A resolution control would therefore have to answer "1K,
 * 16:9" with a 2K pixel pair and bill the user $0.05 for the $0.03 they chose.
 * Snapping those three shapes to the widest and tallest 1K sizes keeps one
 * honest price on the card; `ATLAS_GPT_IMAGE_DIMENSIONS` names the pixels each
 * ratio really resolves to, and the control marks the three that only
 * approximate.
 *
 * Sunburst and Flare are separate weights at the same price; Atlas documents no
 * difference beyond the name, so neither gets a note claiming one.
 */
function gptImage25Developer(variant: 'sunburst' | 'flare'): ProviderModel[] {
  const name = variant === 'sunburst' ? 'Sunburst' : 'Flare';
  const shared = {
    kind: 'image' as const,
    price: '$0.03 / image @ 1K',
    rate: { usd: 0.03, per: 'image' as const },
    // Transparent does not change the 1K quote (calculator, 2026-11-03).
    // 2K is $0.05 and 4K is $0.08, so those sizes stay off this card.
    backgrounds: [
      { label: 'Auto', value: 'auto' as const },
      { label: 'Opaque', value: 'opaque' as const },
      { label: 'Transparent', value: 'transparent' as const },
    ],
  };

  return [
    {
      ...shared,
      id: `openai/gpt-image-2.5-${variant}-developer/text-to-image`,
      label: `GPT Image 2.5 ${name} Developer`,
      fileCode: `gpt-image-2_5-${variant}-dev-t2i`,
      modes: ['text'],
      note: 'Prompts up to 32,000 characters. Runs at the 1K tier, where the widest published shape is 3:2.',
    },
    {
      ...shared,
      id: `openai/gpt-image-2.5-${variant}-developer/edit`,
      label: `GPT Image 2.5 ${name} Developer Edit`,
      fileCode: `gpt-image-2_5-${variant}-dev-edit`,
      modes: ['image'],
      maxInputImages: 16,
      note: 'Editing only — it needs at least one reference. Up to 16.',
    },
  ];
}

/**
 * GPT Image 2.6 on Atlas, read 2026-11-21 from
 * `https://www.atlascloud.ai/models/openai/gpt-image-2.6-{sunburst,flare}/{text-to-image,edit}/llms.txt`.
 * There is no `-developer` id for 2.6 (those four addresses return 404).
 *
 * **Token-metered, and the rate is the calculator's quote.** llms.txt prints
 * "$0.007 per image" (edit: $0.008), which is the floor. Atlas's read-only
 * quote endpoint (`POST /api/v1/model/calculate`) answers
 * `estimate_reason: settles_on_usage` and, at `quality: medium` with a short
 * prompt, $0.014536 for 1024x1024, the dearest size this card sends (1536x1024
 * $0.012232, 1024x768 $0.011224, 2048x1152 $0.012808, 2560x1088 $0.010912).
 * That figure already carries Atlas's `discount: "80"`, which has no published
 * end, so it is the rate and not a dated sale; before it the quote is $0.01817.
 * Rounding up to $0.0146 keeps an estimate from understating the quote.
 *
 * The edit adds $0.0256 for every input image, the first included: one is
 * $0.040136, two $0.065736, four $0.116936. Transparent does not move the
 * quote. Sunburst and Flare quote the same.
 *
 * `quality` is pinned to `medium` in `atlas.ts`. `high` is $0.046 and `max`
 * $0.173 at 1024x1024, and `auto` quotes as `max`, so an unpinned request
 * could cost twelve times the card. A long prompt adds text tokens on top.
 */
function gptImage26(variant: 'sunburst' | 'flare'): ProviderModel[] {
  const name = variant === 'sunburst' ? 'Sunburst' : 'Flare';
  const shared = {
    kind: 'image' as const,
    backgrounds: [
      { label: 'Auto', value: 'auto' as const },
      { label: 'Opaque', value: 'opaque' as const },
      { label: 'Transparent', value: 'transparent' as const },
    ],
  };

  return [
    {
      ...shared,
      id: `openai/gpt-image-2.6-${variant}/text-to-image`,
      label: `GPT Image 2.6 ${name}`,
      fileCode: `gpt-image-2_6-${variant}-t2i`,
      modes: ['text'],
      price: '$0.0146 / image @ medium quality',
      rate: { usd: 0.0146, per: 'image' },
      note: 'The current GPT Image. Billed by token: about $0.0146 at medium quality, which is what this sends. A very long prompt costs a little more. Prompts up to 32,000 characters.',
    },
    {
      ...shared,
      id: `openai/gpt-image-2.6-${variant}/edit`,
      label: `GPT Image 2.6 ${name} Edit`,
      fileCode: `gpt-image-2_6-${variant}-edit`,
      modes: ['image'],
      price: '$0.0146 / image @ medium quality + $0.0256 / input image',
      rate: { usd: 0.0146, per: 'image', inputImageUsd: 0.0256 },
      maxInputImages: 16,
      note: 'Editing only — it needs at least one reference. Up to 16, and every one adds about $0.0256, the first included. Billed by token at medium quality.',
    },
  ];
}

/**
 * MiniMax H3 Developer. Three endpoints, one set of controls, same shape as the
 * Seedance families above — but almost every field name differs from theirs,
 * and Atlas drops a name a model does not know in silence, so the wire mapping
 * in `atlas.ts` is what makes these work: `ratio` (not `aspect_ratio`),
 * `end_image` (not `last_image`) and `refers` (not `reference_images`).
 *
 * Only the two native tiers are priced. Atlas quotes "$0.015 per second" with
 * no table while its own announcement says "from $0.015/sec at 480P", so the
 * two `-sr` upscales are left unpriced rather than assumed to cost the same —
 * a missing tier must never fall back to the cheapest one.
 */
function minimaxH3Developer(): ProviderModel[] {
  const shared = {
    kind: 'video' as const,
    price: '$0.015 / s @ 480P · 768P · upscaled sizes: price unknown',
    rate: { usdByResolution: { '480P': 0.015, '768P': 0.015 }, per: 'second' as const },
    // Documented as any whole 4–15, with 8 the endpoint's own default.
    duration: { type: 'range' as const, min: 4, max: 15, default: 8 },
    sizes: [
      { label: '480p', preset: '480P' },
      { label: '768p', preset: '768P' },
      { label: '1440p (upscaled)', preset: '1440p-sr' },
      { label: '4K (upscaled)', preset: '4k-sr' },
    ],
    // No `supportsAudio`. That flag draws an on/off switch and puts `audio` in
    // the request, but H3 always generates its soundtrack and none of the three
    // schemas names an audio field, at one flat rate. The switch did nothing in
    // the browser and made the Worker refuse every signed-in H3 job.
    note: 'Every clip comes with a generated soundtrack; there is no silent option.',
  };
  // The endpoint publishes no 3:2 or 2:3, so those are left off rather than
  // sent and silently reshaped.
  const aspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

  return [
    {
      ...shared,
      id: 'minimax/h3-developer/text-to-video',
      fileCode: 'minimax-h3-dev-t2v',
      label: 'MiniMax H3 Developer',
      modes: ['text'],
      aspectRatios,
    },
    {
      ...shared,
      id: 'minimax/h3-developer/image-to-video',
      fileCode: 'minimax-h3-dev-i2v',
      label: 'MiniMax H3 Developer',
      // `end_image` is optional, so one frame opens the clip and two bookend it.
      modes: ['image', 'frames'],
      maxInputImages: 2,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 1 },
        frames: { field: 'frameImages', maxImages: 2 },
      },
      // No `aspectRatios`: this endpoint lists `adaptive` as its only value,
      // because the shape comes from the frame supplied.
    },
    {
      ...shared,
      id: 'minimax/h3-developer/reference-to-video',
      fileCode: 'minimax-h3-dev-r2v',
      label: 'MiniMax H3 Developer',
      modes: ['reference'],
      // The schema sets `minItems: 1` and publishes no ceiling, so 5 is this
      // app's limit rather than a number quoted from the vendor.
      maxInputImages: 5,
      aspectRatios,
      videoInputs: {
        reference: { field: 'referenceImages', maxImages: 5, clientMaxImages: 5 },
      },
      note: 'Anchors characters, products and styles to your reference images, with native audio.',
    },
  ];
}

/**
 * LTX-2 on Atlas (Lightricks' native API), four tiers × two endpoints. Read
 * 2026-09-29 from `https://api.atlascloud.ai/api/v1/models` and each
 * `https://www.atlascloud.ai/models/ltx/ltx-{version}-{tier}/{mode}/llms.txt`.
 * The field names are the ones `atlas.ts` already sends (`image`,
 * `last_image`, `duration`, `resolution`, `aspect_ratio`), so these need no
 * wire mapping of their own.
 *
 * **Only 720p is priced.** Atlas quotes one per-second figure per tier with no
 * table, and the Seedance pricing spec found that figure is the starting rate,
 * not a flat one — Runware bills the same LTX-2.5 Fast higher at 1080p. So the
 * larger sizes record as unknown rather than at the cheapest tier.
 *
 * The Fast tiers stop at 1080p on purpose. Their 12–20 s lengths are refused
 * at 1440p and 4K, and this control cannot tie a length to a size, so offering
 * both would let the two controls build a request the endpoint rejects. 4K
 * stays reachable through the Pro tiers, which publish 6–10 s at every size.
 *
 * The `audio-to-video` endpoints are left out: this studio has no audio input.
 * No `supportsAudio` either — that switch is not an Atlas setting the Worker
 * accepts, so each tier keeps its endpoint's default: 2.3 Fast silent, every
 * other tier with generated sound.
 */
function ltx2(version: '2.3' | '2.5', tier: 'fast' | 'pro'): ProviderModel[] {
  const usd = { '2.3': { fast: 0.03, pro: 0.04 }, '2.5': { fast: 0.09, pro: 0.12 } }[version][tier];
  const fast = tier === 'fast';
  const name = `LTX-${version} ${fast ? 'Fast' : 'Pro'}`;
  const code = `ltx-${version.replace('.', '_')}-${tier}`;
  const shared = {
    kind: 'video' as const,
    price: `$${usd} / s @ 720p · larger sizes: price unknown`,
    rate: { usdByResolution: { '720p': usd }, per: 'second' as const },
    // Durations above 10 s exist on the Fast tiers only (with `-1`, "let the
    // model choose", on 2.5 — not offered, since it cannot be priced).
    durations: fast ? [6, 8, 10, 12, 14, 16, 18, 20] : [6, 8, 10],
    sizes: [
      { label: '720p', preset: '720p' },
      { label: '1080p', preset: '1080p' },
      ...(fast ? [] : [{ label: '1440p', preset: '1440p' }, { label: '4K', preset: '4k' }]),
    ],
    aspectRatios: ['16:9', '9:16'],
    note: [
      fast ? 'Up to 20 seconds in one pass. 1440p and 4K are on the Pro tier.' : 'Up to 4K, in clips of 6–10 seconds.',
      version === '2.3' && fast ? 'Silent — this tier generates no audio.' : 'Comes with generated sound.',
    ].join(' '),
  };

  return [
    {
      ...shared,
      id: `ltx/ltx-${version}-${tier}/text-to-video`,
      label: name,
      fileCode: `${code}-t2v`,
      modes: ['text'],
    },
    {
      ...shared,
      id: `ltx/ltx-${version}-${tier}/image-to-video`,
      label: name,
      fileCode: `${code}-i2v`,
      // `last_image` is optional, so one still opens the clip and two bookend it.
      modes: ['image', 'frames'],
      maxInputImages: 2,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 1 },
        frames: { field: 'frameImages', maxImages: 2 },
      },
    },
  ];
}

/**
 * Luma Ray 3.2, read 2026-09-29 from
 * `https://www.atlascloud.ai/models/luma/ray-3.2/{mode}/llms.txt`. Priced at
 * 540p alone for the reason LTX is priced at 720p alone above; Atlas's own
 * announcement quotes a 720p clip above the per-second figure, which is what
 * that rule is there for.
 *
 * `loop` and `hdr` are not offered. Restyle and reframe are separate catalog
 * entries below (`lumaRay32Edits`). The 540p-only rate on these two generation
 * endpoints is the one recorded in 2026-09; the calculator now prices 720p and
 * 1080p, and 10s is not twice 5s. Those generation rates stay as recorded
 * here rather than being rewritten from a non-linear table in the edit work.
 */

function lumaRay32(): ProviderModel[] {
  const shared = {
    label: 'Luma Ray 3.2',
    kind: 'video' as const,
    price: '$0.06 / s @ 540p · 720p, 1080p: price unknown',
    rate: { usdByResolution: { '540p': 0.06 }, per: 'second' as const },
    durations: [5, 10],
    sizes: [
      { label: '540p', preset: '540p' },
      { label: '720p', preset: '720p' },
      { label: '1080p', preset: '1080p' },
    ],
  };

  return [
    {
      ...shared,
      id: 'luma/ray-3.2/text-to-video',
      fileCode: 'luma-ray-3_2-t2v',
      modes: ['text'],
      // The endpoint also lists 9:21, which the account Worker's ratio check
      // does not accept, so it would pass in the browser and fail as a job.
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    },
    {
      ...shared,
      id: 'luma/ray-3.2/image-to-video',
      fileCode: 'luma-ray-3_2-i2v',
      modes: ['image', 'frames'],
      maxInputImages: 2,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 1 },
        frames: { field: 'frameImages', maxImages: 2 },
      },
      // No `aspectRatios`: this endpoint has no ratio field; the frame sets it.
    },
  ];
}

/**
 * Luma Uni 1 and Uni 1 Max, read 2026-09-29 from
 * `https://www.atlascloud.ai/models/luma/{uni-1,uni-1-max}/{mode}/llms.txt`.
 * One flat price per image, and edits cost slightly more than generation.
 * `atlas.ts` sends these a ratio from Luma's own enum and a single `image`,
 * never the `size` the older models take.
 */
function lumaUni1(variant: 'standard' | 'max'): ProviderModel[] {
  const max = variant === 'max';
  const family = max ? 'uni-1-max' : 'uni-1';
  const label = max ? 'Luma Uni 1 Max' : 'Luma Uni 1';
  const generate = max ? 0.1 : 0.04;
  const edit = max ? 0.103 : 0.043;
  // 9:21 is published too, and left off for the Worker reason given on Ray.
  const aspectRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'];

  return [
    {
      id: `luma/${family}/text-to-image`,
      label,
      fileCode: `luma-${family}`,
      kind: 'image',
      modes: ['text'],
      price: `$${generate} / image`,
      rate: { usd: generate, per: 'image' },
      aspectRatios,
      note: '3:2 and 2:3 are not published, so they render as 4:3 and 3:4.',
    },
    {
      id: `luma/${family}/edit`,
      label: `${label} Edit`,
      fileCode: `luma-${family}-edit`,
      kind: 'image',
      modes: ['image'],
      price: `$${edit} / image`,
      rate: { usd: edit, per: 'image' },
      maxInputImages: 1,
      aspectRatios,
      note: 'Editing only — it needs one reference image.',
    },
  ];
}

/**
 * Verified 2026-10-26 against /models/kwaivgi/kling-v4.0/{mode}/llms.txt.
 * The public catalog advertises $0.11/s, but Atlas's own /model/calculate
 * quotes $0.71435 / $1.06925 for 5s at 720p / 1080p (10s doubles both).
 * Use those resolution-specific quotes so the estimate does not understate
 * the provider's current calculator. No published promotion end date.
 */
function kling40(): ProviderModel[] {
  // Calculator, 2026-11-03, linear in duration: 720p $0.14287/s, 1080p
  // $0.21385/s, 1080p-esr $0.182/s, 2k-esr $0.273/s, 4k-esr $0.364/s.
  // The page still prints $0.11/s. Labels stay human; presets are the API enum.
  const sizes = [
    { label: '720p', preset: '720p' },
    { label: '1080p', preset: '1080p' },
    { label: '1080p upscale', preset: '1080p-esr' },
    { label: '2K upscale', preset: '2k-esr' },
    { label: '4K upscale', preset: '4k-esr' },
  ];
  const usdByResolution = {
    '720p': 0.14287,
    '1080p': 0.21385,
    '1080p-esr': 0.182,
    '2k-esr': 0.273,
    '4k-esr': 0.364,
  };
  const shared = {
    kind: 'video' as const,
    label: 'Kling 4.0',
    price: '$0.14287 / s @ 720p · $0.21385 / s @ 1080p · $0.182 / s @ 1080p upscale · $0.273 / s @ 2K upscale · $0.364 / s @ 4K upscale',
    rate: { per: 'second' as const, usdByResolution },
    duration: { type: 'range' as const, min: 3, max: 30, default: 5 },
    sizes,
    // Atlas describes 26,000 English / 11,000 non-English characters.
    // One conservative cap keeps mixed-language prompts inside both limits.
    maxPromptLength: 11_000,
  };
  const pricing = 'Atlas advertises $0.11/s (30% off, no end date). Its calculator, read 2026-11-03, quotes $0.14287/s at 720p, $0.21385/s at 1080p, $0.182/s at 1080p upscale, $0.273/s at 2K upscale and $0.364/s at 4K upscale. Estimates use the calculator.';
  return [
    {
      ...shared,
      id: 'kwaivgi/kling-v4.0/text-to-video',
      fileCode: 'kling-4_0-t2v',
      modes: ['text'],
      aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
      note: `Premium Kling with generated audio and 3–30 second clips. ${pricing}`,
    },
    {
      ...shared,
      id: 'kwaivgi/kling-v4.0/image-to-video',
      aspectRatios: [], // The output shape comes from the opening image.
      fileCode: 'kling-4_0-i2v',
      modes: ['image', 'frames'],
      maxInputImages: 10,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 10, orderedKeyframes: true },
        // Same bookends as Image mode: first, up to eight middle frames, last.
        frames: { field: 'frameImages', maxImages: 10, orderedKeyframes: true },
      },
      note: `Premium Kling with generated audio. In Image or First & last frame, add an opening frame, up to eight middle frames, then a closing frame. The opening frame sets the output shape. ${pricing}`,
    },
    {
      ...shared,
      id: 'kwaivgi/kling-v4.0/reference-to-video',
      fileCode: 'kling-4_0-r2v',
      modes: ['reference'],
      maxInputImages: 10,
      aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
      videoInputs: { reference: { field: 'referenceImages', maxImages: 10, clientMaxImages: 10, promptSyntax: 'at-image-underscore-index' } },
      note: `Up to 10 image references with generated audio. Atlas's 15-reference limit includes mixed media; this integration accepts images. ${pricing}`,
    },
    {
      id: 'kwaivgi/kling-v4.0/video-edit',
      label: 'Kling 4.0 Edit',
      fileCode: 'kling-4_0-edit',
      kind: 'video',
      modes: ['edit'],
      price: 'price unknown',
      videoEdit: {
        sizes,
        // Atlas bills input duration too but publishes no complete formula.
        // Omitting the rate keeps both budget and spend estimates unknown.
        maxImages: 10,
        minSeconds: 3,
        maxSeconds: 30,
        maxBytes: 200_000_000, // App upload ceiling; Atlas itself accepts 300 MB.
        mimes: ['video/mp4', 'video/quicktime'],
        requireMeasurement: true,
        sourceBounds: { minEdge: 700, maxEdge: 4553 },
        maxPromptLength: 11_000,
        promptSyntax: 'at-image-underscore-index',
        namesSource: true,
        controls: [{
          key: 'outputDuration', label: 'Output duration', kind: 'select', defaultValue: 5,
          options: Array.from({ length: 28 }, (_, index) => ({ label: `${index + 3} seconds`, value: index + 3 })),
          description: 'Choose 3–30 seconds; this can differ from the source length.',
        }],
        note: 'Premium Kling editing in a background job. Address the source as @video_1 and images as @image_1. Choose an output length of 3–30 seconds, including an upscale size. Input video duration is billed too; the full pricing formula is unverified, so the total estimate is unavailable even when the generation calculator quotes that size. Source files are limited to 200 MB in this app.',
      },
    },
  ];
}

/**
 * Seedream 5.5 (ByteDance version 261028, GA 2026-11-10): the current Seedream.
 * On Atlas, not Runware. Read 2026-11-12:
 *
 * - Ids and bodies: https://www.atlascloud.ai/models/bytedance/seedream-v5.5/text-to-image
 *   and https://www.atlascloud.ai/models/bytedance/seedream-v5.5/edit, with
 *   their schemas under static.atlascloud.ai/model/schema/.
 * - Rates: Atlas's public calculator (`POST /api/v1/model/calculate`), the same
 *   source as Seedream 5.0 Pro's $0.036. It quotes `discount: "80"` on the
 *   page's SKU table: $0.016 up to 2.61 MP (list $0.02), $0.028 above it
 *   (list $0.035), and $0.0064 per input image (list $0.008). The SKU table is
 *   the list price; `SEEDREAM_55_LIST_USD` keeps it for the day the discount ends.
 * - Every input image is billed, the first included. That is not Seedream 5.0
 *   Pro's rule (first included, $0.003 per extra), so the rate carries
 *   `inputImageUsd`, not `extraInputImageUsd`.
 * - Runware lists `bytedance:seedream@5.5` at the list prices and marks the
 *   model page `coming-soon`, so there is no second copy of this model there.
 *
 * 2K is first because it is the vendor default (`2048*2048`): a request with
 * no size renders, and is priced at, 2K. Layer decomposition is a separate
 * endpoint and is not offered.
 */
export const SEEDREAM_55_LIST_USD = { '2k': 0.035, '1.5k': 0.02, '1k': 0.02, inputImage: 0.008 } as const;

function seedream55(): ProviderModel[] {
  const tiers = { '2k': 0.028, '1.5k': 0.016, '1k': 0.016 };
  const shared = {
    kind: 'image' as const,
    sizes: ['2K', '1.5K', '1K'].map((label) => ({ label, preset: label.toLowerCase() })),
    backgrounds: [
      { label: 'Auto', value: 'auto' as const },
      { label: 'Opaque', value: 'opaque' as const },
      { label: 'Transparent', value: 'transparent' as const },
    ],
  };
  return [
    {
      ...shared,
      id: 'bytedance/seedream-v5.5/text-to-image',
      label: 'Seedream 5.5',
      fileCode: 'seedream-v5_5',
      modes: ['text'],
      price: '$0.016 / image @ 1K–1.5K · $0.028 @ 2K',
      rate: { usdByResolution: tiers, per: 'image' },
      note: 'The current Seedream. 1K and 1.5K cost $0.016, 2K costs $0.028 (20% under Atlas’s $0.02 / $0.035 list). Transparent backgrounds are PNG. Seedream v5.0 Pro stays below as a fallback.',
    },
    {
      ...shared,
      id: 'bytedance/seedream-v5.5/edit',
      label: 'Seedream 5.5 Edit',
      fileCode: 'seedream-v5_5-edit',
      modes: ['image'],
      price: '$0.016 / image @ 1K–1.5K · $0.028 @ 2K + $0.0064 / input image',
      rate: { usdByResolution: tiers, per: 'image', inputImageUsd: 0.0064 },
      maxInputImages: 10,
      note: 'Editing only — it needs at least one reference. Up to 10, and every one adds $0.0064, the first included. The picture keeps the shape you choose, not the reference’s.',
    },
  ];
}

/**
 * Seedream 5.0 Flash. Calculator, 2026-11-03: $0.018 at every published size,
 * including 2048×2048 and 3136×1344. The edit takes 1–10 images and
 * `background` of opaque or transparent. Transparent cannot be JPEG, so the
 * adapter forces PNG. Text-to-image publishes no background field.
 */
function seedream50Flash(): ProviderModel[] {
  const shared = {
    kind: 'image' as const,
    price: '$0.018 / image',
    rate: { usd: 0.018, per: 'image' as const },
  };
  return [
    {
      ...shared,
      id: 'bytedance/seedream-v5.0-flash/text-to-image',
      label: 'Seedream 5.0 Flash',
      fileCode: 'seedream-v5_0-flash',
      modes: ['text'],
      note: 'One price at every size. Faster than Seedream v5.0 Pro, which stays on its own 1.5K tier.',
    },
    {
      ...shared,
      id: 'bytedance/seedream-v5.0-flash/edit',
      label: 'Seedream 5.0 Flash Edit',
      fileCode: 'seedream-v5_0-flash-edit',
      modes: ['image'],
      maxInputImages: 10,
      backgrounds: [
        { label: 'Opaque', value: 'opaque' },
        { label: 'Transparent', value: 'transparent' },
      ],
      note: 'Editing only — it needs at least one reference. Up to 10. Transparent backgrounds are PNG.',
    },
  ];
}

/**
 * MAI-Image-2.6, not the Flash variant. Calculator, 2026-11-03: text $0.0792,
 * edit $0.0891 (the catalog API rounds those to 0.079 and 0.089). The edit
 * takes `reference_images` (1–5) and `size` of default or auto, not a pixel pair.
 * Web search is a separate flag and is not offered.
 */
function maiImage26(): ProviderModel[] {
  return [
    {
      id: 'microsoft/mai-image-2.6/text-to-image',
      label: 'MAI-Image-2.6',
      fileCode: 'mai-image-2_6',
      kind: 'image',
      modes: ['text'],
      price: '$0.0792 / image',
      rate: { usd: 0.0792, per: 'image' },
      note: 'Microsoft’s image model. Each edge stays between 768 and 2346 pixels, and the picture stays under 2.36 megapixels.',
    },
    {
      id: 'microsoft/mai-image-2.6/edit',
      label: 'MAI-Image-2.6 Edit',
      fileCode: 'mai-image-2_6-edit',
      kind: 'image',
      modes: ['image'],
      price: '$0.0891 / image',
      rate: { usd: 0.0891, per: 'image' },
      maxInputImages: 5,
      // Empty on purpose: the edit sends `size: 'default'` and ignores a ratio.
      aspectRatios: [],
      note: 'Editing only — it needs at least one reference. Up to 5. The output size stays the model’s own default.',
    },
  ];
}

const LUMA_STRENGTH = [
  ['adhere_1', 'Adhere 1'],
  ['adhere_2', 'Adhere 2'],
  ['adhere_3', 'Adhere 3'],
  ['flex_1', 'Flex 1'],
  ['flex_2', 'Flex 2'],
  ['flex_3', 'Flex 3'],
  ['reimagine_1', 'Reimagine 1'],
  ['reimagine_2', 'Reimagine 2'],
  ['reimagine_3', 'Reimagine 3'],
].map(([value, label]) => ({ value, label }));

/**
 * Luma Ray 3.2 restyle and reframe. Read 2026-11-03.
 *
 * Restyle (`video-to-video`) is linear: $0.1584/s at 540p, $0.2376/s at 720p,
 * $0.4752/s at 1080p. The llms page’s $0.54/s is not what the calculator returns.
 * Duration 5 or 10 is the generated length, so a short source does not clip the
 * bill. HDR is omitted: it needs upstream HDR access and only 720p/1080p at 5s.
 * The page publishes no source ceiling; this app stops at 10 seconds, the
 * longest output.
 *
 * Reframe is billed from the source. A 5.366667s sample quoted $0.3542 / $0.7084
 * / $2.1252 at 540p / 720p / 1080p, which is $0.066 / $0.132 / $0.396 per second.
 * The llms page’s $0.03/s is not that quote. 9:21 is in the schema and left off
 * because the account worker does not accept it. The schema default is 9:16.
 */
function lumaRay32Edits(): ProviderModel[] {
  const sizes = [
    { label: '540p', preset: '540p' },
    { label: '720p', preset: '720p' },
    { label: '1080p', preset: '1080p' },
  ];
  return [
    {
      id: 'luma/ray-3.2/video-to-video',
      label: 'Luma Ray 3.2 Restyle',
      fileCode: 'luma-ray-3_2-restyle',
      kind: 'video',
      modes: ['edit'],
      price: '$0.1584 / s @ 540p · $0.2376 / s @ 720p · $0.4752 / s @ 1080p',
      videoEdit: {
        sizes,
        rate: { usdByResolution: { '540p': 0.1584, '720p': 0.2376, '1080p': 0.4752 }, per: 'second' },
        maxImages: 0,
        maxSeconds: 10,
        maxBytes: 100_000_000,
        mimes: ['video/mp4', 'video/quicktime'],
        requireMeasurement: true,
        outputDurationIsGenerated: true,
        controls: [
          {
            key: 'outputDuration', label: 'Output duration', kind: 'select', defaultValue: 5,
            options: [{ label: '5 seconds', value: 5 }, { label: '10 seconds', value: 10 }],
            description: 'The model generates this length. It does not have to match the source.',
          },
          {
            key: 'strength', label: 'Strength', kind: 'select', defaultValue: 'flex_2',
            options: LUMA_STRENGTH,
            description: 'Flex 2 is Luma’s default. Adhere stays closer to the source; Reimagine moves further.',
          },
        ],
        note: 'Restyle in a background job. Motion can change with the new look. The clip is silent. Output is 5 or 10 seconds at the size you pick, and that length is what is billed. This app accepts sources up to 10 seconds. HDR is not offered.',
      },
    },
    {
      id: 'luma/ray-3.2/reframe',
      label: 'Luma Ray 3.2 Reframe',
      fileCode: 'luma-ray-3_2-reframe',
      kind: 'video',
      modes: ['edit'],
      price: '$0.066 / s @ 540p · $0.132 / s @ 720p · $0.396 / s @ 1080p',
      videoEdit: {
        sizes,
        rate: { usdByResolution: { '540p': 0.066, '720p': 0.132, '1080p': 0.396 }, per: 'second' },
        aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'],
        requireAspectRatio: true,
        maxImages: 0,
        maxSeconds: 10,
        maxBytes: 100_000_000,
        mimes: ['video/mp4', 'video/quicktime'],
        requireMeasurement: true,
        measureForPrice: true,
        note: 'Reframe a clip, including 16:9 into 9:16, in a background job. The result stays the source length and is silent. Billed from that length at the size you pick. Sources up to 10 seconds. 9:21 is published by Atlas and left off here.',
      },
    },
  ];
}

/**
 * FLUX 3 edit-video. The page and the newsletter say $0.03/s. A 5.366667s
 * sample quoted $0.1771 on 2026-11-03, which is $0.033/s, and that is the
 * rate used here. Output follows the source: no duration, resolution, or
 * aspect field. MP4 under 50 MB and 15 seconds. No reference images.
 * `safety_tolerance` stays at the vendor default (2) and is not a control.
 */
function flux3EditVideo(): ProviderModel {
  return {
    id: 'black-forest-labs/flux-3/edit-video',
    label: 'FLUX 3 Edit Video',
    fileCode: 'flux-3-edit-video',
    kind: 'video',
    modes: ['edit'],
    price: '$0.033 / s',
    videoEdit: {
      sizes: [],
      rate: { usd: 0.033, per: 'second' },
      maxImages: 0,
      maxSeconds: 15,
      maxBytes: 50_000_000,
      mimes: ['video/mp4'],
      requireMeasurement: true,
      measureForPrice: true,
      note: 'Restyle that keeps the source motion, in a background job. Length and frame follow the clip. MP4 under 50 MB and 15 seconds. The page prints $0.03/s; the calculator quoted $0.033/s on 2026-11-03, which is the estimate used here.',
    },
  };
}

/**
 * Seedance 2.5 Flash on Atlas, read 2026-11-19 from
 * `https://www.atlascloud.ai/models/bytedance/seedance-2.5-flash/{mode}/llms.txt`
 * and the public catalog at `https://api.atlascloud.ai/api/v1/models`.
 * Same three endpoints and the same `ratio` / `@Image1` dialect as 2.5, with
 * 480p and 720p only, 10 images, 5 videos and 5 audio clips, and no draft.
 *
 * **These are LIST prices, and they are the calculator's, not the headline's.**
 * llms.txt and the catalog print one flat $0.109/s (35% off $0.167). Atlas's
 * own quote endpoint (`POST /api/v1/model/calculate`, read-only, no key) does
 * not: it meters tokens (`estimate_reason: settles_on_usage`) at $11.20 per
 * million before the discount, which is $0.24446/s at 720p and $0.11296/s at
 * 480p for the largest frame (`adaptive`, 10 s). 16:9 is under 1% lower. This
 * is the 2026-10-26 rule again: a headline that disagrees with the calculator
 * is not the catalog rate, so an estimate never understates the quote.
 *
 * The 35% sale ("through Nov 30") is applied at call time by `withModelSale`
 * in `model-promotions.ts`, never stored here.
 */
function seedance25Flash(): ProviderModel[] {
  const usdByResolution = { '480p': 0.113, '720p': 0.2445 };
  const shared = {
    label: 'Seedance 2.5 Flash',
    kind: 'video' as const,
    price: '$0.113 / s @ 480p · $0.2445 @ 720p',
    rate: { usdByResolution, per: 'second' as const },
    duration: { type: 'range' as const, min: 4, max: 30, default: 5 },
    sizes: [
      { label: '480p', preset: '480p' },
      { label: '720p', preset: '720p' },
    ],
  };
  // `adaptive` is left out for the Worker reason given on Seedance 2.5.
  const aspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
  const pricing = 'List price is the quote from Atlas’s calculator, which meters tokens: about $0.113 / s at 480p and $0.2445 at 720p. Atlas’s page prints a flat $0.167.';

  return [
    {
      ...shared,
      id: 'bytedance/seedance-2.5-flash/text-to-video',
      fileCode: 'seedance-2_5-flash-t2v',
      modes: ['text'],
      aspectRatios,
      note: `The lower-cost Seedance 2.5: up to 30 seconds with native audio, at 480p or 720p. ${pricing}`,
    },
    {
      ...shared,
      id: 'bytedance/seedance-2.5-flash/image-to-video',
      fileCode: 'seedance-2_5-flash-i2v',
      // `last_image` is optional, so one still opens the clip and two bookend it.
      modes: ['image', 'frames'],
      maxInputImages: 2,
      videoInputs: {
        image: { field: 'frameImages', maxImages: 1 },
        frames: { field: 'frameImages', maxImages: 2 },
      },
      // No `aspectRatios`: this endpoint lists `adaptive` alone, as 2.5's does.
      note: `The lower-cost Seedance 2.5 from a first frame, or a first and last frame. The clip keeps the image’s shape. ${pricing}`,
    },
    {
      ...shared,
      id: 'bytedance/seedance-2.5-flash/reference-to-video',
      fileCode: 'seedance-2_5-flash-r2v',
      modes: ['reference'],
      maxInputImages: 10,
      aspectRatios,
      videoInputs: {
        reference: {
          field: 'referenceImages',
          maxImages: 10,
          clientMaxImages: 5,
          promptSyntax: 'at-image-index',
        },
      },
      referenceClips: ATLAS_SEEDANCE_25_FLASH_REFERENCE_CLIPS,
      note: `Up to 10 images, 5 videos and 5 audio clips, cited as @Image1, @Video1 and @Audio1. Audio can be used on its own. Native audio. ${pricing}`,
    },
  ];
}

/**
 * Kling 4.0 Flash on Atlas, read 2026-11-19 from
 * `/models/kwaivgi/kling-v4.0-flash/{text,image,reference}-to-video/llms.txt`,
 * their schemas under static.atlascloud.ai/model/schema/, and the catalog API.
 * 720p only, 3–20 seconds, default 10. Image mode is one first frame with no
 * `aspect_ratio`; reference mode takes 10 images cited as `@image_1`.
 *
 * **The rate is the LIST price, and no sale is applied.** Three figures are
 * published and none carries an end date:
 * - llms.txt and the catalog API: $0.066/s, `discount: "70"` on $0.094.
 * - The home page card: "standard price of $0.094 per second".
 * - The calculator (`POST /api/v1/model/calculate`): 5 s is $0.42861 on an
 *   origin of $0.6123, so $0.085722/s on $0.12246/s. That is the same 1.2988×
 *   over the headline that Kling 4.0's quote carries.
 * An undated discount is not a catalog rate (the P-Video-Edit lesson), and a
 * headline that disagrees with the calculator is not one either, so this
 * stores the calculator's origin price. While Atlas's 30% runs, a job costs
 * less than the estimate. Give `model-promotions.ts` a window only when Atlas
 * publishes an end date.
 *
 * Not offered: `video-edit` (input seconds are billed and the formula is
 * unpublished, as on Kling 4.0 Edit), reference videos (billed as input),
 * subjects and voices.
 */
export const ATLAS_KLING_40_FLASH_QUOTED_USD = 0.085722;

function kling40Flash(): ProviderModel[] {
  const shared = {
    kind: 'video' as const,
    label: 'Kling 4.0 Flash',
    price: '$0.12246 / s',
    rate: { per: 'second' as const, usd: 0.12246 },
    duration: { type: 'range' as const, min: 3, max: 20, default: 10 },
    sizes: [{ label: '720p', preset: '720p' }],
    // 26,000 English / 11,000 non-English characters, as on Kling 4.0.
    maxPromptLength: 11_000,
  };
  const pricing = 'List price from Atlas’s calculator is $0.12246 / s. Atlas currently quotes 30% off ($0.0857 / s) with no end date, so a run can cost less than this estimate. Its page prints $0.094 / s.';
  return [
    {
      ...shared,
      id: 'kwaivgi/kling-v4.0-flash/text-to-video',
      fileCode: 'kling-4_0-flash-t2v',
      modes: ['text'],
      aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
      note: `Fast 720p Kling in 3–20 second clips. ${pricing}`,
    },
    {
      ...shared,
      id: 'kwaivgi/kling-v4.0-flash/image-to-video',
      aspectRatios: [], // The output shape comes from the first frame.
      fileCode: 'kling-4_0-flash-i2v',
      modes: ['image'],
      maxInputImages: 1,
      videoInputs: { image: { field: 'frameImages', maxImages: 1 } },
      note: `Fast 720p Kling from one first frame, which sets the output shape. ${pricing}`,
    },
    {
      ...shared,
      id: 'kwaivgi/kling-v4.0-flash/reference-to-video',
      fileCode: 'kling-4_0-flash-r2v',
      modes: ['reference'],
      maxInputImages: 10,
      aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
      videoInputs: { reference: { field: 'referenceImages', maxImages: 10, clientMaxImages: 10, promptSyntax: 'at-image-underscore-index' } },
      note: `Up to 10 image references, cited as @image_1. Atlas’s 15-reference limit includes videos and subjects; this integration accepts images. ${pricing}`,
    },
  ];
}

/**
 * Kling Image 4.0 on Atlas, read 2026-11-19 from
 * `/models/kwaivgi/kling-image-v4.0/text-to-image/llms.txt`, its schema and
 * its readme under static.atlascloud.ai/model/. There is no `/edit` endpoint:
 * `text-to-image` itself takes up to 10 `reference_images`, so one entry
 * covers both modes. The body is `resolution` (`2k`/`4k`/`8k`), `aspect_ratio`
 * and `num_images`, with no pixel pair.
 *
 * **These are LIST prices**, from the readme's rate table and the calculator's
 * `origin_price`: $0.063 at 2K, $0.094 at 4K, and $0.003 per reference image,
 * every one billed (one reference at 2K quotes $0.066, three quote $0.072).
 * Atlas currently takes 10% off all of it (`discount: "90"`: $0.0567, $0.0846,
 * $0.0027; llms.txt rounds 2K to $0.057) and names no end date, so the
 * discount is not stored. `KLING_IMAGE_40_QUOTED_USD` keeps what was quoted.
 *
 * Not offered: 8K ($0.157 list), `image-set` (2–10 related images in one
 * request; every image path here returns one result) and `long-image`.
 * Runware lists the same model as `klingai:kling-image@4.0` at the same list
 * prices, so there is no second copy of it there.
 */
export const KLING_IMAGE_40_QUOTED_USD = { '2k': 0.0567, '4k': 0.0846, inputImage: 0.0027 } as const;

function klingImage40(): ProviderModel[] {
  return [
    {
      id: 'kwaivgi/kling-image-v4.0/text-to-image',
      label: 'Kling Image 4.0',
      fileCode: 'kling-image-4_0',
      kind: 'image',
      modes: ['text', 'image'],
      price: '$0.063 / image @ 2K · $0.094 @ 4K + $0.003 / input image',
      rate: { usdByResolution: { '2k': 0.063, '4k': 0.094 }, per: 'image', inputImageUsd: 0.003 },
      sizes: [{ label: '2K', preset: '2k' }, { label: '4K', preset: '4k' }],
      maxInputImages: 10,
      note: 'Kling’s image model: legible text in the picture and up to 10 references, cited as @image_1. List price is $0.063 at 2K and $0.094 at 4K, plus $0.003 for every reference. Atlas currently quotes 10% off with no end date, so a run can cost a little less. Image sets and 8K are not offered here.',
    },
  ];
}

const ATLAS_MODELS: ProviderModel[] = [
  {
    id: 'black-forest-labs/flux-schnell',
    label: 'FLUX.1 [schnell]',
    fileCode: 'flux-1-schnell',
    kind: 'image',
    modes: ['text', 'image'],
    price: '$0.003 / image',
    rate: { usd: 0.003, per: 'image' },
    maxInputImages: 1,
  },
  {
    id: 'z-image/turbo',
    label: 'Z-Image Turbo',
    fileCode: 'z-image-turbo',
    kind: 'image',
    modes: ['text', 'image'],
    price: '$0.005 / image',
    rate: { usd: 0.005, per: 'image' },
    maxInputImages: 1,
  },
  {
    id: 'qwen-image-3.0/text-to-image',
    label: 'Qwen-Image 3.0',
    fileCode: 'qwen-image-3_0',
    kind: 'image',
    modes: ['text'],
    price: '$0.04 / image',
    rate: { usd: 0.04, per: 'image' },
  },
  {
    id: 'qwen-image-3.0/edit',
    label: 'Qwen-Image 3.0 Edit',
    fileCode: 'qwen-image-3_0-edit',
    kind: 'image',
    modes: ['image'],
    price: '$0.04 / image',
    rate: { usd: 0.04, per: 'image' },
    maxInputImages: 1,
  },
  // Ahead of 5.0 Pro so the current Seedream is the first one in the list.
  ...seedream55(),
  {
    id: 'bytedance/seedream-v5.0-pro/text-to-image',
    label: 'Seedream v5.0 Pro',
    fileCode: 'seedream-v5_0-pro',
    kind: 'image',
    modes: ['text'],
    // atlas.ts always submits the 1.5K size tier, regardless of the shared
    // studio imageSize setting. Do not charge the unused 2K tier here.
    price: '$0.036 / image @ 1.5K',
    rate: { usd: 0.036, per: 'image' },
    note: 'The previous Seedream flagship, kept as a fallback for Seedream 5.5. Strong prompt adherence and in-image typography, at one 1.5K size.',
  },
  {
    id: 'bytedance/seedream-v5.0-pro/edit',
    label: 'Seedream v5.0 Pro Edit',
    fileCode: 'seedream-v5_0-pro-edit',
    kind: 'image',
    modes: ['image'],
    price: '$0.036 / image @ 1.5K + $0.003 / extra reference',
    // https://www.atlascloud.ai/docs/more-models/bytedance/seedream-v5.0-pro-edit/generateImage
    // First input is included; additional inputs are charged (read 2026-09-07).
    rate: { usd: 0.036, per: 'image', extraInputImageUsd: 0.003 },
    maxInputImages: 10,
    note: 'The previous Seedream editor, kept as a fallback for Seedream 5.5 Edit. It needs at least one reference. The first is included in the price; each one after it adds $0.003.',
  },
  {
    id: 'ltx-2.3-quality/text-to-video',
    label: 'LTX 2.3 Quality',
    fileCode: 'ltx-2_3-quality',
    kind: 'video',
    modes: ['text'],
    price: '$0.002 / s',
    rate: { usd: 0.002, per: 'second' },
    // No durations on purpose: this model takes num_frames, not seconds, so the
    // control is hidden and no duration is sent.
    sizes: [
      { label: 'Landscape 16:9', preset: 'landscape_16_9' },
      { label: 'Portrait 9:16', preset: 'portrait_9_16' },
      { label: 'Square', preset: 'square_hd' },
    ],
    note: 'Length is fixed by the model — it counts frames rather than seconds.',
  },
  {
    id: 'bytedance/seedance-v1-pro-fast/image-to-video',
    label: 'Seedance v1 Pro Fast',
    fileCode: 'seedance-v1-pro-fast',
    kind: 'video',
    modes: ['image'],
    price: '$0.009 / s',
    rate: { usd: 0.009, per: 'second' },
    maxInputImages: 1,
    // Documented options run 2–12; these are the stops worth offering.
    durations: [4, 5, 6, 8, 10, 12],
    sizes: [
      { label: '480p', preset: '480p' },
      { label: '720p', preset: '720p' },
      { label: '1080p', preset: '1080p' },
    ],
  },
  // The only models here with native audio and a character-reference mode.
  ...seedance20Tier('mini'),
  ...seedance20Tier('fast'),
  ...seedance25(),
  // The cheaper 2.5 lane. List rates; its dated sale is applied at call time.
  ...seedance25Flash(),
  // Developer editions — same weights, cheaper ids. See the block above.
  ...nanoBanana21Developer(),
  ...nanoBanana2Developer('full'),
  ...nanoBanana2Developer('lite'),
  ...gptImage26('sunburst'),
  ...gptImage26('flare'),
  ...gptImage25Developer('sunburst'),
  ...gptImage25Developer('flare'),
  ...seedream50Flash(),
  ...maiImage26(),
  ...klingImage40(),
  ...minimaxH3Developer(),
  ...kling40(),
  ...kling40Flash(),
  // Added 2026-09-29 from Atlas's LTX-2 / Luma drop. See each block above.
  ...ltx2('2.3', 'fast'),
  ...ltx2('2.3', 'pro'),
  ...ltx2('2.5', 'fast'),
  ...ltx2('2.5', 'pro'),
  ...lumaRay32(),
  ...lumaRay32Edits(),
  flux3EditVideo(),
  ...lumaUni1('standard'),
  ...lumaUni1('max'),
  // Read 2026-10-16 from
  // https://www.atlascloud.ai/models/kwaivgi/kling-video-o3-pro/video-edit/llms.txt
  // Authoritative price is $0.143/s. The $0.168 figure on that page is fal's
  // vendor rate, which Atlas says does not apply. Source MP4/MOV, 3–10s,
  // 700–4553px, ratio 0.4–2.5, 200MB, 24–60 fps (fps is not measured here).
  // Output is 1080P. Images ≤ 4. Prompt syntax <<<video_1>>> / <<<image_1>>>.
  {
    id: 'kwaivgi/kling-video-o3-pro/video-edit',
    label: 'Kling O3 Pro Edit',
    fileCode: 'kling-o3-pro-edit',
    kind: 'video',
    modes: ['edit'],
    price: '$0.143 / s',
    rate: { per: 'second', usd: 0.143 },
    videoEdit: {
      sizes: [],
      rate: { per: 'second', usd: 0.143 },
      maxImages: 4,
      minSeconds: 3,
      maxSeconds: 10,
      maxBytes: 200_000_000,
      mimes: ['video/mp4', 'video/quicktime'],
      requireMeasurement: true,
      sourceBounds: { minEdge: 700, maxEdge: 4553, minRatio: 0.4, maxRatio: 2.5 },
      maxPromptLength: 2500,
      promptSyntax: 'triple-angle',
      namesSource: true,
      outputLabel: '1080P',
      references: { images: { max: 4, wire: 'images' } },
      controls: [{
        key: 'keepOriginalSound',
        label: 'Keep original sound',
        kind: 'boolean',
        defaultValue: true,
        description: 'Leaves the source audio in the edit. On unless you turn it off.',
      }],
      note: 'Address the source as <<<video_1>>> and images as <<<image_1>>>. Output is 1080P. Frame rate 24–60 is required by the model and is not read from the file here. $0.143 per second.',
    },
  },
  // https://www.atlascloud.ai/models/kwaivgi/kling-video-o3-std/video-edit/llms.txt
  // Authoritative price is $0.107/s, not the $0.126 vendor figure. Output is 720P.
  {
    id: 'kwaivgi/kling-video-o3-std/video-edit',
    label: 'Kling O3 Standard Edit',
    fileCode: 'kling-o3-std-edit',
    kind: 'video',
    modes: ['edit'],
    price: '$0.107 / s',
    rate: { per: 'second', usd: 0.107 },
    videoEdit: {
      sizes: [],
      rate: { per: 'second', usd: 0.107 },
      maxImages: 4,
      minSeconds: 3,
      maxSeconds: 10,
      maxBytes: 200_000_000,
      mimes: ['video/mp4', 'video/quicktime'],
      requireMeasurement: true,
      sourceBounds: { minEdge: 700, maxEdge: 4553, minRatio: 0.4, maxRatio: 2.5 },
      maxPromptLength: 2500,
      promptSyntax: 'triple-angle',
      namesSource: true,
      outputLabel: '720P',
      references: { images: { max: 4, wire: 'images' } },
      controls: [{
        key: 'keepOriginalSound',
        label: 'Keep original sound',
        kind: 'boolean',
        defaultValue: true,
        description: 'Leaves the source audio in the edit. On unless you turn it off.',
      }],
      note: 'Address the source as <<<video_1>>> and images as <<<image_1>>>. Output is 720P. Frame rate 24–60 is required by the model and is not read from the file here. $0.107 per second.',
    },
  },
  // https://www.atlascloud.ai/models/alibaba/wan-2.7/video-edit/llms.txt
  // Authoritative price is a flat $0.10/s. The 1.5× 1080P line is in the
  // vendor section Atlas says does not apply, so both tiers use $0.10.
  // Images ≤ 3. Optional driving audio. Resolution 720P or 1080P.
  // The ratio field is `ratio`. Duration 0 matches the source; otherwise 2–10.
  {
    id: 'alibaba/wan-2.7/video-edit',
    label: 'Wan 2.7 Edit',
    fileCode: 'wan-2_7-edit',
    kind: 'video',
    modes: ['edit'],
    price: '$0.10 / s',
    rate: { per: 'second', usd: 0.1 },
    videoEdit: {
      sizes: [{ label: '1080P', preset: '1080P' }, { label: '720P', preset: '720P' }],
      rate: { per: 'second', usd: 0.1 },
      maxImages: 3,
      minSeconds: 2,
      maxSeconds: 10,
      maxBytes: 100_000_000,
      mimes: ['video/mp4', 'video/quicktime'],
      requireMeasurement: true,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      // The video-edit page names `audio` and publishes no size. The bound is
      // Wan 2.7 driving audio from the image-to-video reference: wav/mp3,
      // 2–30s, 15 MB.
      // https://help.aliyun.com/en/model-studio/image-to-video-general-api-reference
      references: {
        images: { max: 3, wire: 'images' },
        audio: true,
        audioLimit: {
          max: 1,
          minSeconds: 2,
          maxSeconds: 30,
          maxTotalSeconds: 30,
          maxBytes: 15_000_000,
          accept: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'],
          formatsLabel: 'MP3 or WAV',
          token: 'Audio',
        },
      },
      controls: [
        {
          key: 'outputDuration',
          label: 'Output duration',
          kind: 'select',
          defaultValue: 0,
          description: 'Match source keeps the input length. Any other value clips from the start.',
          options: [
            { label: 'Match source', value: 0 },
            ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ label: `${value} seconds`, value })),
          ],
        },
        {
          key: 'promptExtend',
          label: 'Expand prompt',
          kind: 'boolean',
          defaultValue: true,
        },
        {
          key: 'negativePrompt',
          label: 'Negative prompt',
          kind: 'text',
          maxLength: 500,
          description: 'Up to 500 characters. Leave blank to omit it.',
        },
      ],
      note: 'Up to 3 reference images, and an optional driving audio clip. $0.10 per second at 720P and at 1080P. A background job is required so the source has a hosted address.',
    },
  },
];

/**
 * GPT Image 2.6 on Comet, read 2026-11-21 from the public catalog at
 * `https://api.cometapi.com/api/models`. It lists `gpt-image-2.6-sunburst` on
 * `/v1/images/generations` and `/v1/images/edits`, and its pricing note names
 * `gpt-image-2.6-flare` beside it at the same token rates: text input $4.00,
 * image input $6.40 and image output $24.00 per million, 20% under OpenAI's.
 * No per-image price is published, so these stay `metered` with no rate, as
 * GPT Image 2 was. It replaces GPT Image 2, which OpenAI retires on 2027-02-10.
 */
const cometGptImage26 = (variant: 'sunburst' | 'flare'): ProviderModel => ({
  id: `gpt-image-2.6-${variant}`,
  label: `GPT Image 2.6 ${variant === 'sunburst' ? 'Sunburst' : 'Flare'}`,
  fileCode: `gpt-image-2_6-${variant}`,
  kind: 'image',
  modes: ['text'],
  price: 'metered',
  note: `${variant === 'sunburst' ? 'Detailed compositions.' : 'The faster of the two.'} Billed by token: $24 per million image-output tokens. Returns base64 directly rather than a URL.`,
});

const COMET_MODELS: ProviderModel[] = [
  cometGptImage26('sunburst'),
  cometGptImage26('flare'),
  {
    id: 'qwen-image',
    label: 'Qwen-Image',
    fileCode: 'qwen-image',
    kind: 'image',
    modes: ['text'],
    price: 'metered',
    note: 'One image per request — the provider rejects n > 1.',
  },
  {
    id: 'seedance-2-5',
    label: 'Seedance 2.5',
    fileCode: 'seedance-2_5',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Vendor table: 4–30 seconds.
    durations: [4, 5, 6, 8, 10, 15, 20],
    // Comet takes an exact WxH string; these are the pairs its examples use.
    sizes: [
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
    ],
  },
  {
    id: 'veo3.1-fast',
    label: 'Veo 3.1 Fast',
    fileCode: 'veo-3_1-fast',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    durations: [4, 6, 8],
    sizes: [
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
      { label: '1080p · 16:9', preset: '1920x1080' },
      { label: '4K · 16:9', preset: '3840x2160' },
    ],
    note: 'Google Veo 3.1 on the faster route — the vendor’s default pick for short clips.',
  },
  {
    id: 'veo3.1',
    label: 'Veo 3.1',
    fileCode: 'veo-3_1',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    durations: [4, 6, 8],
    sizes: [
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
      { label: '1080p · 16:9', preset: '1920x1080' },
      { label: '4K · 16:9', preset: '3840x2160' },
    ],
  },
  {
    id: 'sora-2',
    label: 'Sora 2',
    fileCode: 'sora-2',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    durations: [4, 8, 12, 16, 20],
    sizes: [
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
    ],
    note: 'Longest clips here — up to 20 seconds.',
  },
  {
    id: 'sora-2-pro',
    label: 'Sora 2 Pro',
    fileCode: 'sora-2-pro',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    durations: [4, 8, 12, 16, 20],
    // The Pro sizes plus the standard Sora pair, which Pro also accepts.
    sizes: [
      { label: 'Pro · landscape', preset: '1792x1024' },
      { label: 'Pro · portrait', preset: '1024x1792' },
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
    ],
  },
  {
    id: 'wan2.7',
    label: 'Wan 2.7',
    fileCode: 'wan-2_7',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Documented as an integer 2–15; these are the stops worth offering.
    durations: [4, 5, 6, 8, 10, 15],
    sizes: [
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
      { label: '1080p · 16:9', preset: '1920x1080' },
      { label: '1080p · 9:16', preset: '1080x1920' },
      { label: '1080p · 1:1', preset: '1440x1440' },
    ],
  },
  {
    id: 'viduq3-turbo',
    label: 'Vidu Q3 Turbo',
    fileCode: 'vidu-q3-turbo',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Documented as an integer 1–16.
    durations: [4, 5, 6, 8, 10, 16],
    sizes: [
      { label: '540p · 16:9', preset: '960x528' },
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '1080p · 16:9', preset: '1920x1080' },
    ],
    note: 'Landscape only — the vendor lists no portrait size for Vidu Q3.',
  },
  {
    id: 'minimax-h3',
    label: 'MiniMax H3',
    fileCode: 'minimax-h3',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Documented as an integer 5–15.
    durations: [5, 6, 8, 10, 15],
    sizes: [
      { label: '768P · 16:9', preset: '1344x768' },
      { label: '768P · 9:16', preset: '768x1344' },
      { label: '768P · 1:1', preset: '768x768' },
      { label: '768P · 3:4', preset: '768x1024' },
      { label: '768P · 21:9', preset: '1536x672' },
      { label: '2K · 16:9', preset: '2560x1440' },
      { label: '2K · 9:16', preset: '1440x2560' },
      { label: '2K · 1:1', preset: '1440x1440' },
    ],
    note: 'The widest choice of shapes here, including 21:9 and vertical 2K.',
  },
  {
    id: 'happyhorse-1.1',
    label: 'HappyHorse 1.1',
    fileCode: 'happyhorse-1_1',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Documented as an integer 3–15.
    durations: [4, 5, 6, 8, 10, 15],
    sizes: [
      { label: 'Landscape · 720p', preset: '1280x720' },
      { label: 'Landscape · 1080p', preset: '1920x1080' },
      { label: 'Portrait · 720p', preset: '720x1280' },
      { label: 'Portrait · 1080p', preset: '1080x1920' },
      { label: 'Square', preset: '1440x1440' },
      { label: 'Classic landscape', preset: '1440x1080' },
      { label: 'Classic portrait', preset: '1080x1440' },
      { label: 'Wide landscape 21:9', preset: '2520x1080' },
      { label: 'Wide portrait', preset: '1080x2520' },
    ],
  },
  {
    id: 'flux-3',
    label: 'FLUX 3 Video',
    fileCode: 'flux-3-video',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Documented as an integer 5–20, default 10.
    durations: [5, 6, 8, 10, 15, 20],
    sizes: [
      { label: '720p', preset: '1280x720' },
      { label: '1080p', preset: '1920x1080' },
    ],
  },
  {
    id: 'doubao-seedance-2-0-mini',
    label: 'Seedance 2.0 Mini',
    fileCode: 'seedance-2_0-mini',
    kind: 'video',
    modes: ['text', 'image'],
    price: 'metered',
    maxInputImages: 1,
    // Vendor table: 4–15 seconds.
    durations: [4, 5, 6, 8, 10, 15],
    sizes: [
      { label: '720p · 16:9', preset: '1280x720' },
      { label: '720p · 9:16', preset: '720x1280' },
    ],
  },
  {
    // Read 2026-10-13 from
    // https://apidoc.cometapi.com/api/video/runway/official-format/generate-a-video-from-a-video
    // Price from https://www.cometapi.com/models/runway/aleph2/ : $0.224/s standard,
    // $0.448 minimum. ProRes, PNG sequences and 10-bit are published higher and
    // are not offered here. The API reference itself does not list a price.
    id: 'aleph2',
    label: 'Runway Aleph 2',
    fileCode: 'aleph-2',
    kind: 'video',
    modes: ['edit'],
    price: '$0.224 / s · $0.448 minimum',
    rate: { per: 'second', usd: 0.224, minimumUsd: 0.448 },
    videoEdit: {
      sizes: [],
      rate: { per: 'second', usd: 0.224, minimumUsd: 0.448 },
      protocol: 'runway',
      maxImages: 0,
      maxSeconds: 30,
      requireMeasurement: true,
      aspectRatios: ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '21:9'],
      maxPromptLength: 1000,
      note: 'Edits a source clip of up to 30 seconds. An optional target aspect ratio letterboxes the frame. Standard output is $0.224 per second with a $0.448 minimum; a short clip still costs the minimum. Timed guidance images are not a control here. A browser upload is a data URI up to 5 MB; a larger clip runs as a background job.',
    },
  },
];

/** PiAPI PAYG rates, https://piapi.ai/docs/llms.txt (2026-09-07). */
export const PIAPI_MODELS: ProviderModel[] = [
  {
    id: 'nano-banana-2', label: 'Nano Banana 2', fileCode: 'nano-banana-2', kind: 'image',
    modes: ['text', 'image'], maxInputImages: 14,
    sizes: ['1K', '2K', '4K'].map(preset => ({ label: preset, preset })),
    price: '$0.06 / 1K · $0.08 / 2K · $0.12 / 4K',
    rate: { per: 'image', usdByResolution: { '1K': 0.06, '2K': 0.08, '4K': 0.12 } },
    note: 'Up to 14 references. Browser reference uploads require PiAPI Creator or higher.',
  },
  {
    id: 'veo-3.1-fast', label: 'Veo 3.1 Fast', fileCode: 'veo-3_1-fast', kind: 'video',
    modes: ['text', 'image', 'frames'], maxInputImages: 2, durations: [8, 6, 4],
    videoInputs: { image: { field: 'frameImages', maxImages: 1 }, frames: { field: 'frameImages', maxImages: 2 } },
    sizes: ['720p', '1080p'].map(preset => ({ label: preset, preset })),
    supportsAudio: true, aspectRatios: ['16:9', '9:16'],
    price: '$0.06/sec silent · $0.09/sec with audio',
    rate: { per: 'second', usdByResolution: { '720p': 0.06, '1080p': 0.06 }, audioUsdByResolution: { '720p': 0.09, '1080p': 0.09 } },
  },
  {
    id: 'kling-3-omni', label: 'Kling 3 Omni', fileCode: 'kling-3-omni', kind: 'video',
    modes: ['text', 'image', 'frames', 'reference'], maxInputImages: 5,
    duration: { type: 'range', min: 3, max: 15, default: 5 },
    videoInputs: { image: { field: 'frameImages', maxImages: 1 }, frames: { field: 'frameImages', maxImages: 2 }, reference: { field: 'referenceImages', maxImages: 5, promptSyntax: 'at-image-underscore-index' } },
    sizes: ['720p', '1080p'].map(preset => ({ label: preset, preset })),
    supportsAudio: true, aspectRatios: ['16:9', '9:16', '1:1'],
    price: '$0.10/sec silent / $0.15/sec audio at 720p · $0.15/sec silent / $0.20/sec audio at 1080p',
    rate: { per: 'second', usdByResolution: { '720p': 0.10, '1080p': 0.15 }, audioUsdByResolution: { '720p': 0.15, '1080p': 0.20 } },
    note: 'Address subjects as @image_1, @image_2, etc. Browser uploads require PiAPI Creator or higher.',
  },
];

export const PROVIDER_MODELS: Record<ProviderId, ProviderModel[]> = {
  runware: RUNWARE_MODELS,
  atlas: ATLAS_MODELS,
  comet: COMET_MODELS,
  piapi: PIAPI_MODELS,
};

/** Default per provider and media kind — the cheapest entry that covers both modes. */
export const DEFAULT_MODELS: Record<ProviderId, Record<MediaKind, string>> = {
  runware: { image: 'runware:z-image@turbo', video: 'lightricks:ltx@2.5-fast' },
  atlas: { image: 'black-forest-labs/flux-schnell', video: 'ltx-2.3-quality/text-to-video' },
  comet: { image: 'gpt-image-2.6-sunburst', video: 'seedance-2-5' },
  piapi: { image: 'nano-banana-2', video: 'veo-3.1-fast' },
};

/**
 * Models that have left a catalog. Saved jobs, library cards and stored
 * settings still name them, so the label and filename code are kept; none is
 * selectable, and `resolveModel` sends a stored selection to `replacedBy`.
 *
 * Comet's `gpt-image-2` is retired by OpenAI on 2027-02-10 and was replaced
 * here on 2026-11-21.
 */
const PAST_PROVIDER_MODELS: Partial<Record<ProviderId, Record<string, Pick<ProviderModel, 'label' | 'fileCode'> & { replacedBy: string }>>> = {
  comet: {
    'gpt-image-2': { label: 'GPT Image 2', fileCode: 'gpt-image-2', replacedBy: 'gpt-image-2.6-sunburst' },
  },
};

export function pastProviderModel(provider: ProviderId, id: string | undefined) {
  return id ? PAST_PROVIDER_MODELS[provider]?.[id] : undefined;
}

export function modelsFor(provider: ProviderId, kind: MediaKind): ProviderModel[] {
  return PROVIDER_MODELS[provider].filter((model) => model.kind === kind);
}

export function findModel(provider: ProviderId, id: string): ProviderModel | undefined {
  return PROVIDER_MODELS[provider].find((model) => model.id === id);
}

/**
 * Seconds a generated-length edit renders when the request names one, or the
 * catalog default when it does not. Luma restyle's body sends that default, so
 * the button and the ledger have to as well: billing the source length instead
 * charges a 10s file for a 5s render.
 */
export function generatedEditSeconds(model: ProviderModel | undefined, outputDuration: number | undefined): number | undefined {
  if (!model?.videoEdit?.outputDurationIsGenerated) return undefined;
  if (typeof outputDuration === 'number' && outputDuration > 0) return outputDuration;
  const fallback = model.videoEdit.controls?.find((entry) => entry.key === 'outputDuration')?.defaultValue;
  return typeof fallback === 'number' && fallback > 0 ? fallback : 5;
}

/** Resolve only the catalog-advertised video input contract for a model/mode. */
export function resolveVideoInput(
  provider: ProviderId,
  modelId: string,
  mode: ProviderMode
): ProviderVideoInputCapability | undefined {
  if (mode === 'text' || mode === 'edit') return undefined;
  const model = findModel(provider, modelId);
  if (!model || model.kind !== 'video' || !model.modes.includes(mode)) return undefined;
  const declared = model.videoInputs?.[mode];
  if (declared) return declared;
  if (model.maxInputImages === undefined) return undefined;
  return {
    field: 'frameImages',
    maxImages: mode === 'frames' ? Math.min(2, model.maxInputImages) : model.maxInputImages,
  };
}

/**
 * The duration control as one input mode sees it. Only a `range` narrows, and
 * only where the model names a tighter ceiling for that mode: HeyGen Video 1.0
 * is 5–30 seconds from text and 5–15 from references.
 */
export function modeDuration(
  model: Pick<ProviderModel, 'duration' | 'maxSecondsByMode'> | undefined,
  mode?: ProviderMode
): ProviderModel['duration'] {
  const duration = model?.duration;
  const cap = mode ? model?.maxSecondsByMode?.[mode] : undefined;
  if (duration?.type !== 'range' || cap === undefined || cap >= duration.max) return duration;
  return { ...duration, max: cap, default: Math.min(duration.default, cap) };
}

/**
 * The clip length to actually send. A model that lists lengths rejects anything
 * outside the list, so a stale or foreign value snaps to the closest one it
 * does accept rather than failing at the vendor. `undefined` means this model
 * has no seconds control and the field must be omitted.
 */
export function resolveDuration(
  provider: ProviderId,
  modelId: string,
  requested?: number,
  /** The input mode, for a model whose ceiling depends on it. */
  mode?: ProviderMode
): number | undefined {
  const metadata = findModel(provider, modelId);
  const duration = modeDuration(metadata, mode);
  if (duration?.type === 'options' && duration.values.length > 0) {
    if (requested === undefined) return duration.values[0];
    return duration.values.reduce((best, value) =>
      Math.abs(value - requested) < Math.abs(best - requested) ? value : best
    );
  }
  if (duration?.type === 'range') {
    const value = requested === undefined ? duration.default : Math.round(requested);
    return Math.min(duration.max, Math.max(duration.min, value));
  }
  const allowed = metadata?.durations;
  if (!allowed || allowed.length === 0) return undefined;
  if (requested === undefined) return allowed[0];
  return allowed.reduce((best, value) =>
    Math.abs(value - requested) < Math.abs(best - requested) ? value : best
  );
}

/**
 * Resolve a requested model to one this provider actually serves for the kind.
 * A stale persisted preference (model retired, or copied from another provider)
 * falls back to the default rather than failing at the vendor.
 */
/**
 * The output size to actually send, by its label. An unknown or stale label
 * falls back to the model's first documented size rather than to a
 * general-purpose default the model may not accept.
 */
export function resolveSize(
  provider: ProviderId,
  modelId: string,
  requestedLabel?: string
): ProviderSize | undefined {
  const model = findModel(provider, modelId);
  // Edit models such as Atlas Wan publish sizes only on `videoEdit`. Falling
  // back to the first top-level size would drop a 720P choice and let the
  // vendor render its own default.
  const sizes = model?.sizes?.length ? model.sizes : model?.videoEdit?.sizes;
  if (!sizes || sizes.length === 0) return undefined;
  return sizes.find((size) => size.label === requestedLabel) ?? sizes[0];
}

export function resolveModel(provider: ProviderId, kind: MediaKind, requested?: string): string {
  const current = requested && (pastProviderModel(provider, requested)?.replacedBy ?? requested);
  const known = current && findModel(provider, current);
  if (known && known.kind === kind) return known.id;
  return DEFAULT_MODELS[provider][kind];
}
