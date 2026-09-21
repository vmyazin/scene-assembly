// lib/spend/rates.ts
/**
 * Published vendor rates in USD. Each block names the page it was read from and
 * when; update a whole block from that page rather than one number in
 * isolation. Dependency-free so server routes and client code can both price.
 */

/**
 * https://ai.google.dev/gemini-api/docs/pricing and
 * https://ai.google.dev/gemini-api/docs/image-generation — the three Gemini
 * image models, read 2026-09-09. One block per model, keyed by the id the API
 * takes, because the three differ by a factor of four at the same resolution
 * and a ledger that priced them alike would be quietly wrong.
 *
 * The token counts are Google's own per-resolution figures, so the published
 * per-image prices fall out of the arithmetic rather than being pasted beside
 * it: Pro at 1K is 1120 × $120/M = $0.134, Lite is 1120 × $30/M = $0.0336.
 */
export interface GeminiImageRate {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  /** Output image tokens by the studio's `imageSize` control. */
  outputTokensByResolution: Record<string, number>;
}

/** Each reference image counts as this many input tokens, on every model. */
export const GEMINI_INPUT_TOKENS_PER_IMAGE = 560;

export const GEMINI_IMAGE_RATES: Record<string, GeminiImageRate> = {
  'gemini-3-pro-image-preview': {
    inputUsdPerMillionTokens: 2,
    outputUsdPerMillionTokens: 120,
    outputTokensByResolution: { '1K': 1120, '2K': 1120, '4K': 2000 },
  },
  'gemini-3.1-flash-image': {
    inputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 60,
    outputTokensByResolution: { '1K': 1120, '2K': 1680, '4K': 2520 },
  },
  'gemini-3.1-flash-lite-image': {
    inputUsdPerMillionTokens: 0.25,
    outputUsdPerMillionTokens: 30,
    outputTokensByResolution: { '1K': 1120 },
  },
};

/** The model the studio ran before it had a picker, and the fallback for an unknown id. */
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3-pro-image-preview';

function geminiRate(modelId: string | undefined): GeminiImageRate {
  return GEMINI_IMAGE_RATES[modelId ?? ''] ?? GEMINI_IMAGE_RATES[DEFAULT_GEMINI_MODEL_ID];
}

/**
 * https://ai.google.dev/gemini-api/docs/pricing — Veo video models, read
 * 2026-09-21. Video generation is priced per second of output, with audio
 * included in the base rate. Veo 3.1 Lite is the most affordable entry point,
 * at $0.05/s for 720p and $0.08/s for 1080p. 4K is not supported on Lite.
 */
export interface GeminiVideoRate {
  /** USD per second of generated video, by resolution. Audio is always included. */
  usdPerSecond: Record<string, number>;
}

export const GEMINI_VIDEO_RATES: Record<string, GeminiVideoRate> = {
  'veo-3.1-lite-generate-preview': {
    usdPerSecond: { '720p': 0.05, '1080p': 0.08 },
  },
};

export const DEFAULT_GEMINI_VIDEO_MODEL_ID = 'veo-3.1-lite-generate-preview';

function geminiVideoRate(modelId: string | undefined): GeminiVideoRate | null {
  return GEMINI_VIDEO_RATES[modelId ?? ''] ?? GEMINI_VIDEO_RATES[DEFAULT_GEMINI_VIDEO_MODEL_ID] ?? null;
}

/**
 * Cost of one Gemini video generation at the given resolution and duration.
 * Returns 0 if the model or resolution is unknown.
 */
export function geminiVideoCost(
  modelId: string | undefined,
  resolution: string | undefined,
  durationSeconds: number | undefined
): number {
  const rate = geminiVideoRate(modelId);
  if (!rate) return 0;
  const usd = rate.usdPerSecond[resolution ?? '720p'] ?? rate.usdPerSecond['720p'] ?? 0;
  const duration = durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const cost = usd * duration;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/**
 * Rate label for Gemini video models. Shows the price range across supported
 * resolutions, or the specific resolution's price if provided.
 */
export function geminiVideoRateLabel(modelId: string | undefined, resolution?: string): string | null {
  const rate = geminiVideoRate(modelId);
  if (!rate) return null;
  const rates = resolution
    ? [rate.usdPerSecond[resolution] ?? rate.usdPerSecond['720p']]
    : Object.values(rate.usdPerSecond);
  const range = usdRange(rates);
  return range && `${range} / s`;
}

/** https://kie.ai/pricing — "1 credit ≈ $0.005", read 2026-09-03. */
export const KIE_USD_PER_CREDIT = 0.005;

export function geminiTokenCost(
  modelId: string | undefined,
  promptTokens: number,
  outputTokens: number
): number {
  const rate = geminiRate(modelId);
  const cost =
    (promptTokens / 1_000_000) * rate.inputUsdPerMillionTokens +
    (outputTokens / 1_000_000) * rate.outputUsdPerMillionTokens;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/** The estimate the studio has always shown: one output image plus its references. */
export function geminiResolutionCost(
  modelId: string | undefined,
  resolution: string | undefined,
  inputImages: number
): number {
  const table = geminiRate(modelId).outputTokensByResolution;
  const outputTokens = table[resolution ?? '1K'] ?? table['1K'] ?? Object.values(table)[0];
  const safeImages = Number.isFinite(inputImages) && inputImages > 0 ? inputImages : 0;
  return geminiTokenCost(modelId, safeImages * GEMINI_INPUT_TOKENS_PER_IMAGE, outputTokens);
}

/**
 * fal list prices, read 2026-09-04 from the pricing note on each model page
 * (https://fal.ai/models/<endpoint id>). Only a fallback: fal's estimate API
 * knows an account's negotiated pricing and this table does not, so it prices a
 * run only when that call could not. Every entry is keyed by the endpoint the
 * catalog submits to, so a new fal model needs a line here to stay priced.
 */
export type FalRate =
  | {
      unit: 'image';
      usd: number;
      /** By the `resolution` control; an absent key means we cannot price it. */
      resolutionMultiplier: Record<string, number>;
      /** Added when the `enable_web_search` control is on. */
      webSearchUsd: number;
    }
  | {
      unit: 'second';
      /**
       * By the `resolution` control, then by `generate_audio`. `'*'` covers an
       * endpoint with no resolution control; a table never mixes the two.
       */
      usdPerSecond: Record<string, { audioOff: number; audioOn: number }>;
    }
  | {
      unit: 'video';
      /** Flat price per run by the `duration` control, or `'*'` for one price. */
      usdPerRun: Record<string, number>;
    };

/** $0.08 an image, 2K at 1.5x and 4K at 2x, plus $0.015 when web search runs. */
const NANO_BANANA_2_RATE: FalRate = {
  unit: 'image',
  usd: 0.08,
  resolutionMultiplier: { '0.5K': 0.75, '1K': 1, '2K': 1.5, '4K': 2 },
  webSearchUsd: 0.015,
};

const perSecond = (
  usdPerSecond: Record<string, { audioOff: number; audioOn: number }>
): FalRate => ({ unit: 'second', usdPerSecond });

const veoRate = (standard: [number, number], uhd: [number, number]): FalRate =>
  perSecond({
    '720p': { audioOff: standard[0], audioOn: standard[1] },
    '1080p': { audioOff: standard[0], audioOn: standard[1] },
    '4k': { audioOff: uhd[0], audioOn: uhd[1] },
  });

/** Seedance bills 480p and 4K per output token, which needs a frame size we do not have. */
const seedanceRate = (usdPerSecond: Record<string, number>): FalRate =>
  perSecond(
    Object.fromEntries(
      Object.entries(usdPerSecond).map(([resolution, usd]) => [
        resolution,
        { audioOff: usd, audioOn: usd },
      ])
    )
  );

const klingRate = (audioOff: number, audioOn: number): FalRate =>
  perSecond({ '*': { audioOff, audioOn } });

export const FAL_RATES: Record<string, FalRate> = {
  'fal-ai/nano-banana-2': NANO_BANANA_2_RATE,
  'fal-ai/nano-banana-2/edit': NANO_BANANA_2_RATE,

  'fal-ai/veo3.1': veoRate([0.2, 0.4], [0.4, 0.6]),
  'fal-ai/veo3.1/image-to-video': veoRate([0.2, 0.4], [0.4, 0.6]),
  'fal-ai/veo3.1/first-last-frame-to-video': veoRate([0.2, 0.4], [0.4, 0.6]),
  'fal-ai/veo3.1/fast': veoRate([0.1, 0.15], [0.3, 0.35]),
  'fal-ai/veo3.1/fast/image-to-video': veoRate([0.1, 0.15], [0.3, 0.35]),
  'fal-ai/veo3.1/fast/first-last-frame-to-video': veoRate([0.1, 0.15], [0.3, 0.35]),

  'bytedance/seedance-2.0/text-to-video': seedanceRate({ '720p': 0.3034, '1080p': 0.682 }),
  'bytedance/seedance-2.0/image-to-video': seedanceRate({ '720p': 0.3034, '1080p': 0.682 }),
  'bytedance/seedance-2.0/fast/text-to-video': seedanceRate({ '720p': 0.2419 }),
  'bytedance/seedance-2.0/fast/image-to-video': seedanceRate({ '720p': 0.2419 }),

  'fal-ai/kling-video/v3/standard/text-to-video': klingRate(0.084, 0.126),
  'fal-ai/kling-video/v3/standard/image-to-video': klingRate(0.084, 0.126),
  'fal-ai/kling-video/v3/pro/text-to-video': klingRate(0.112, 0.168),
  'fal-ai/kling-video/v3/pro/image-to-video': klingRate(0.112, 0.168),

  'fal-ai/minimax/hailuo-2.3/standard/text-to-video': { unit: 'video', usdPerRun: { '6': 0.28, '10': 0.56 } },
  'fal-ai/minimax/hailuo-2.3/standard/image-to-video': { unit: 'video', usdPerRun: { '6': 0.28, '10': 0.56 } },
  'fal-ai/minimax/hailuo-2.3/pro/text-to-video': { unit: 'video', usdPerRun: { '*': 0.49 } },
  'fal-ai/minimax/hailuo-2.3/pro/image-to-video': { unit: 'video', usdPerRun: { '*': 0.49 } },

  'fal-ai/wan/v2.7/text-to-video': seedanceRate({ '720p': 0.1, '1080p': 0.15 }),
  'fal-ai/wan/v2.7/image-to-video': seedanceRate({ '720p': 0.1, '1080p': 0.15 }),
};

/** The run controls that move a fal price, read from a job's control values. */
export interface FalRunControls {
  resolution?: string;
  audio?: boolean;
  durationSeconds?: number;
  webSearch?: boolean;
}

export interface FalPublishedCost {
  costUsd: number;
  unit: 'image' | 'second' | 'video';
  quantity: number;
}

/**
 * What fal's published note says this run costs, or null when the endpoint is
 * unlisted or its controls do not pin a price — a Seedance run at 480p, or a
 * per-second model whose duration we never learned.
 */
export function falPublishedCost(
  endpointId: string,
  controls: FalRunControls
): FalPublishedCost | null {
  const rate = FAL_RATES[endpointId];
  if (!rate) return null;

  if (rate.unit === 'image') {
    const multiplier = rate.resolutionMultiplier[controls.resolution ?? '1K'];
    if (multiplier === undefined) return null;
    const costUsd = rate.usd * multiplier + (controls.webSearch ? rate.webSearchUsd : 0);
    return { costUsd, unit: 'image', quantity: 1 };
  }

  const duration = controls.durationSeconds;
  const hasDuration = duration !== undefined && Number.isFinite(duration) && duration > 0;

  if (rate.unit === 'second') {
    if (!hasDuration) return null;
    const price = rate.usdPerSecond[controls.resolution ?? '*'] ?? rate.usdPerSecond['*'];
    if (!price) return null;
    const perSecondUsd = controls.audio === false ? price.audioOff : price.audioOn;
    return { costUsd: perSecondUsd * duration, unit: 'second', quantity: duration };
  }

  const usd = rate.usdPerRun[hasDuration ? String(duration) : '*'] ?? rate.usdPerRun['*'];
  if (usd === undefined) return null;
  return { costUsd: usd, unit: 'video', quantity: 1 };
}

/** `$0.08` → `$0.08`; `$0.081` → `$0.081`. Trailing zeros carry no information. */
function usd(value: number): string {
  const fixed = value >= 0.01 ? value.toFixed(3) : value.toFixed(4);
  return `$${fixed.replace(/0+$/, '').replace(/\.$/, '')}`;
}

/** `0.1`–`0.4` → `$0.1–0.4`, or a single figure when the range collapses. */
function usdRange(values: number[]): string | null {
  const finite = values.filter(value => Number.isFinite(value) && value > 0);
  if (finite.length === 0) return null;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  return low === high ? usd(low) : `${usd(low)}–${usd(high).replace('$', '')}`;
}

/**
 * A model's published rate, short enough to sit in a picker beside its name.
 *
 * The figures were always here — the spend ledger writes them down after every
 * run — but only the aggregator catalogues carried a `price` string, so the fal
 * pickers listed Veo 3.1 and Kling 3 Pro by name alone and gave no way to stay
 * inside a budget without leaving the app. Ranges rather than one number where
 * the rate genuinely moves with resolution, audio or duration: a single figure
 * would be a guess presented as a fact.
 */
export function falRateLabel(endpointId: string): string | null {
  const rate = FAL_RATES[endpointId];
  if (!rate) return null;

  if (rate.unit === 'image') {
    const multipliers = Object.values(rate.resolutionMultiplier);
    const range = usdRange(multipliers.map(multiplier => rate.usd * multiplier));
    return range && `${range} / image`;
  }

  if (rate.unit === 'second') {
    const perSecond = Object.values(rate.usdPerSecond).flatMap(entry => [entry.audioOff, entry.audioOn]);
    const range = usdRange(perSecond);
    return range && `${range} / s`;
  }

  const range = usdRange(Object.values(rate.usdPerRun));
  return range && `${range} / clip`;
}

/**
 * What one image costs on a Gemini model at a given resolution, or across all
 * of them when no resolution is fixed yet. The picker's From column shows the
 * cheapest — the same question the aggregator rows answer — while the cost line
 * under the Generate button passes the resolution actually selected.
 */
export function geminiRateLabel(modelId: string | undefined, resolution?: string): string | null {
  const rate = GEMINI_IMAGE_RATES[modelId ?? ''];
  if (!rate) return null;
  const tokens = resolution
    ? [rate.outputTokensByResolution[resolution] ?? rate.outputTokensByResolution['1K']]
    : Object.values(rate.outputTokensByResolution);
  const range = usdRange(tokens.map((count) => geminiTokenCost(modelId, 0, count)));
  return range && `${range} / image`;
}
