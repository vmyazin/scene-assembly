// lib/providers/output-size.ts
/**
 * What a chosen size actually produces, in pixels, and whether that is the
 * shape its label claims.
 *
 * A size control shows a **nominal** ratio — `9:16`, `480p · 9:16` — and the
 * vendor returns whatever its own table says. Those are not always the same
 * thing: Seedance 2.0 Mini publishes `480p · 9:16` as 496 × 864 (0.5741) and
 * Runware renders an image `9:16` at 768 × 1344 (0.5714), against a true
 * 0.5625. Both round, neither says so, and someone cutting an exact 9:16 film
 * finds out at the edit rather than at the control.
 *
 * Everything here is display-only and dependency-free: it decides what a label
 * reads, never what is sent. It is imported by client components *and* by the
 * server adapters that own the tables, so keep the imports relative — the
 * Worker bundles `lib/providers/*` from `cloud/src/provider-adapters/` and does
 * not resolve the `@/` alias.
 */
import type { ProviderSize } from './types';

export type Dimensions = readonly [number, number];

/** `1280x720`, `768*1344`, `1280×720` → a pair. Anything else → null. */
export function parseDimensions(value: string): Dimensions | null {
  const match = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? [width, height] : null;
}

/**
 * The pixels a catalog size stands for. Runware publishes them outright; Atlas
 * and Comet name them in the preset (`720x1280`). A preset that names a tier
 * instead (`480p`, `portrait_9_16`) publishes no pixels, and this returns null
 * rather than deriving some — a derived number would be this module's guess
 * presented as the vendor's fact.
 */
export function sizeDimensions(size: ProviderSize): Dimensions | null {
  if (size.width && size.height && size.width > 0 && size.height > 0) {
    return [size.width, size.height];
  }
  return size.preset ? parseDimensions(size.preset) : null;
}

/** `[496, 864]` → `496 × 864`, with the multiplication sign, not a letter. */
export function formatDimensions([width, height]: Dimensions): string {
  return `${width} × ${height}`;
}

/** The first `A:B` a label names, which is the shape it is claiming. */
export function labelRatio(label: string): string | null {
  const match = /(\d+)\s*:\s*(\d+)/.exec(label);
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * Exact, by integer cross-product rather than a tolerance.
 *
 * `lib/draft/aspect-match.ts` already owns a "near enough to be the same
 * shape" threshold, and it exists to stop a reference image from overwriting a
 * deliberate resolution choice. Reusing it here would answer a different
 * question with the same number and quietly call 496 × 864 a 9:16 frame. The
 * reader is asking whether the label is literally true, so the test is
 * literal: 720 × 1280 is 9:16 because 720·16 = 1280·9, and 496 × 864 is not.
 */
export function isExactRatio([width, height]: Dimensions, ratio: string): boolean {
  const parsed = /^(\d+):(\d+)$/.exec(ratio);
  if (!parsed) return false;
  const ratioWidth = Number(parsed[1]);
  const ratioHeight = Number(parsed[2]);
  if (ratioWidth <= 0 || ratioHeight <= 0) return false;
  return width * ratioHeight === height * ratioWidth;
}

/** Placed immediately before a ratio the pixels only approximate. */
export const APPROXIMATE_MARK = '≈';

export const APPROXIMATE_LEGEND =
  '“≈” marks a ratio the pixels come close to without being exactly it.';

/** The value a ratio stands for: `16:9` → 1.777…. */
function ratioValue(ratio: string): number | null {
  const parsed = /^(\d+):(\d+)$/.exec(ratio);
  if (!parsed) return null;
  const width = Number(parsed[1]);
  const height = Number(parsed[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/** How far the pixels sit from the ratio they are named with, as a fraction. */
export function ratioDrift([width, height]: Dimensions, ratio: string): number | null {
  const nominal = ratioValue(ratio);
  if (nominal === null) return null;
  return Math.abs(width / height - nominal) / nominal;
}

/**
 * Below this the pixels are a rounding of the labelled ratio and `≈` tells the
 * whole story: Runware's 9:16 is 768 × 1344, 1.6% off, and calling that "close
 * to 9:16" is true. Above it the vendor has substituted a *different shape* —
 * Seedream answers 21:9 with 2048 × 1152, which is a bang-on 16:9 and 24% away
 * from what was asked for. `≈21:9` there would be the app repeating the same
 * false claim in a smaller font, so those name what actually arrives instead.
 */
const SHAPE_CHANGE_DRIFT = 0.05;

/** A ratio stops being readable well before this; 16:9 and 12:5 are fine, 111:83 is not. */
const READABLE_RATIO_TERM = 21;

/** The shapes this app names anywhere, nearest-first matching against them. */
const NAMED_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * What shape a pixel pair actually is, said in a way a reader can use.
 *
 * Reduced outright when that lands somewhere readable (2048 × 1152 → `16:9`),
 * and otherwise as the nearest ratio the app already names, marked `≈` because
 * that is a description and not an identity (1776 × 1328 → `≈4:3`; it is 111:83,
 * which tells nobody anything). A pair that is neither readable nor near
 * anything named keeps its reduced form rather than being filed under a shape
 * it is not.
 */
export function shapeName(dimensions: Dimensions): string {
  const [width, height] = dimensions;
  const divisor = greatestCommonDivisor(width, height);
  const reduced = `${width / divisor}:${height / divisor}`;
  if (width / divisor <= READABLE_RATIO_TERM && height / divisor <= READABLE_RATIO_TERM) {
    return reduced;
  }
  const nearest = NAMED_RATIOS.reduce((best, candidate) =>
    (ratioDrift(dimensions, candidate) ?? Infinity) < (ratioDrift(dimensions, best) ?? Infinity)
      ? candidate
      : best
  );
  return (ratioDrift(dimensions, nearest) ?? Infinity) <= SHAPE_CHANGE_DRIFT
    ? `${APPROXIMATE_MARK}${nearest}`
    : reduced;
}

/**
 * The shape a control should announce beside a ratio it will not honour, or
 * null when the miss is small enough that `≈` says it better.
 */
export function deliveredShape(dimensions: Dimensions, ratio: string): string | null {
  const drift = ratioDrift(dimensions, ratio);
  if (drift === null || drift <= SHAPE_CHANGE_DRIFT) return null;
  const name = shapeName(dimensions);
  // Nothing is gained by announcing the shape that was already asked for.
  return name.replace(APPROXIMATE_MARK, '') === ratio ? null : name;
}

/**
 * The one string every size control shows.
 *
 * `480p · 9:16` + [496, 864] → `480p · ≈9:16 · 496 × 864`
 * `720p · 9:16` + [720, 1280] → `720p · 9:16 · 720 × 1280`
 * `21:9 (Ultra Wide)` + [2048, 1152] → `21:9 (Ultra Wide) · delivers 16:9 · 2048 × 1152`
 * `Pro · landscape` + [1792, 1024] → `Pro · landscape · 1792 × 1024`
 * `480p` + null → `480p`
 *
 * Three different things can be true of a label and they are said three
 * different ways: exact gets the pixels alone, a rounding gets `≈` on the ratio
 * it rounds, and a substituted shape is named outright in words that need no
 * key. A label that claims no ratio claims nothing, so it gets the pixels and
 * no mark; a size with no published pixels is returned untouched rather than
 * decorated with an assertion nobody can check.
 */
export function withDimensions(label: string, dimensions: Dimensions | null): string {
  if (!dimensions) return label;
  const pixels = formatDimensions(dimensions);
  const ratio = labelRatio(label);
  if (!ratio || isExactRatio(dimensions, ratio)) return `${label} · ${pixels}`;
  const delivered = deliveredShape(dimensions, ratio);
  if (delivered) return `${label} · delivers ${delivered} · ${pixels}`;
  return `${label.replace(ratio, `${APPROXIMATE_MARK}${ratio}`)} · ${pixels}`;
}

/**
 * Whether a control needs the legend at all. Only the `≈` mark needs
 * explaining — `delivers 16:9` explains itself — so this asks the rendered
 * string rather than re-deriving the rule and drifting from it.
 */
export function isApproximateLabel(label: string, dimensions: Dimensions | null): boolean {
  return withDimensions(label, dimensions).includes(APPROXIMATE_MARK);
}

export function hasApproximateSize(sizes: ProviderSize[] | undefined): boolean {
  return (sizes ?? []).some((size) => isApproximateLabel(size.label, sizeDimensions(size)));
}

// ------------------------------------------------- the engines' own tables
//
// These were private to their adapters until 2026-09-09, when the image
// controls had to name the pixels a ratio resolves to. They live here so there
// is exactly one copy: a number retyped into a component drifts from the
// request it describes and nobody can tell which run it applied to.

/** Runware: dimensions must be multiples of 64 and paired. */
export const RUNWARE_IMAGE_DIMENSIONS: Record<string, Dimensions> = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1216, 832],
  '2:3': [832, 1216],
  '21:9': [1536, 640],
};

/** Atlas writes these with a star, not an x: `1024*1024`. */
export const ATLAS_IMAGE_DIMENSIONS: Record<string, Dimensions> = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1216, 832],
  '2:3': [832, 1216],
  '21:9': [1536, 640],
};

/**
 * Seedream v5.0 Pro will not take any of the sizes above: it requires
 * 1,048,576–4,194,304 output pixels and every one of them is smaller. These are
 * its own published sizes, all inside its 1.5K billing tier (≤2.36M pixels), so
 * a run costs the $0.036 the catalog quotes rather than the 2K tier's price. It
 * publishes no 3:2 or 21:9 size, so those snap to the nearest shape it does —
 * which is why picking either one is worth marking in the control.
 */
export const ATLAS_SEEDREAM_DIMENSIONS: Record<string, Dimensions> = {
  '1:1': [1536, 1536],
  '16:9': [2048, 1152],
  '9:16': [1152, 2048],
  '4:3': [1776, 1328],
  '3:4': [1328, 1776],
  '3:2': [1776, 1328],
  '2:3': [1328, 1776],
  '21:9': [2048, 1152],
};

/** Comet takes OpenAI-style sizes: a literal WxH, not a ratio. */
export const COMET_IMAGE_DIMENSIONS: Record<string, Dimensions> = {
  '1:1': [1024, 1024],
  '16:9': [1536, 864],
  '9:16': [864, 1536],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '3:2': [1216, 832],
  '2:3': [832, 1216],
  '21:9': [1536, 640],
};

/** Comet video: exact pixel pairs the vendor documents per model tier. */
export const COMET_VIDEO_DIMENSIONS: Record<string, Dimensions> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [960, 960],
};

/** FLUX runs near 1 MP, so Pollinations maps a ratio to ~1 MP dimensions. */
export const POLLINATIONS_IMAGE_DIMENSIONS: Record<string, Dimensions> = {
  '1:1': [1024, 1024],
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '3:2': [1080, 720],
  '21:9': [1280, 548],
};

/**
 * GPT Image 2.5, at its 1K billing tier. Every pair here is a member of the
 * endpoint's own `size` enum — it accepts nothing else — and every one of them
 * sits under the $0.03 tier, so the price on the card is the price charged.
 *
 * The tier publishes no 16:9, 9:16 or 21:9 size, so those three snap to the
 * widest and tallest shapes it does publish, and the control marks them
 * approximate. Atlas writes this one with an `x`, not the star its other image
 * models take; `atlas.ts` owns that formatting.
 */
export const ATLAS_GPT_IMAGE_DIMENSIONS: Record<string, Dimensions> = {
  '1:1': [1024, 1024],
  '16:9': [1536, 1024],
  '9:16': [1024, 1536],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '3:2': [1536, 1024],
  '2:3': [1024, 1536],
  '21:9': [1536, 1024],
};

/** Atlas picks a table per model, since not every model shares one. */
export const isSeedream = (model: string) => model.startsWith('bytedance/seedream-');

export const isGptImage25 = (model: string) => model.startsWith('openai/gpt-image-2.5-');

/**
 * Nano Banana 2 takes a ratio and a tier (`1k`/`2k`/`4k`) and publishes no
 * pixel pair for either, so this app has no number to show. It belongs with
 * Gemini and fal below, not with the models that name their own sizes.
 */
export const isNanoBanana2 = (model: string) => model.startsWith('google/nano-banana-2');

/**
 * Look up a ratio in a table the way an adapter does, including its fallback,
 * so a control promises exactly what the request will send. The fallback is a
 * parameter because it is not the same everywhere: an image with no ratio is
 * square, while Comet's video route lands on landscape.
 */
export function ratioDimensions(
  table: Record<string, Dimensions>,
  aspectRatio: string | undefined,
  fallback: string = '1:1'
): Dimensions {
  return table[aspectRatio ?? fallback] ?? table[fallback];
}

/**
 * The pixels an image engine will actually render for a ratio, or null when
 * the vendor decides and we have no published table. Gemini, fal, Kie, PiAPI
 * and Cloudflare are all in the second group; showing them a number would be
 * this app inventing one.
 */
export function imageDimensions(
  engine: string,
  modelId: string | undefined,
  aspectRatio: string | undefined
): Dimensions | null {
  if (engine === 'runware') return ratioDimensions(RUNWARE_IMAGE_DIMENSIONS, aspectRatio);
  if (engine === 'comet') return ratioDimensions(COMET_IMAGE_DIMENSIONS, aspectRatio);
  if (engine === 'pollinations') return ratioDimensions(POLLINATIONS_IMAGE_DIMENSIONS, aspectRatio);
  if (engine === 'atlas') {
    if (modelId && isNanoBanana2(modelId)) return null;
    const table = modelId && isSeedream(modelId)
      ? ATLAS_SEEDREAM_DIMENSIONS
      : modelId && isGptImage25(modelId)
        ? ATLAS_GPT_IMAGE_DIMENSIONS
        : ATLAS_IMAGE_DIMENSIONS;
    return ratioDimensions(table, aspectRatio);
  }
  return null;
}
