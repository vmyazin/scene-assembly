// lib/spend/rates.ts
/**
 * Published vendor rates in USD. Each block names the page it was read from and
 * when; update a whole block from that page rather than one number in
 * isolation. Dependency-free so server routes and client code can both price.
 */
import { DEFAULT_GEMINI_IMAGE_MODEL } from '../engines/gemini-catalog';
import { DEFAULT_GEMINI_VIDEO_MODEL, GEMINI_OMNI_720P_USD_PER_SECOND } from '../engines/gemini-video-catalog';

/**
 * https://ai.google.dev/gemini-api/docs/pricing and
 * https://ai.google.dev/gemini-api/docs/image-generation — the Gemini image
 * models, read 2026-10-15 for Nano Banana 2.1 and 2026-09-09 for the rest.
 * One block per model, keyed by the id the API takes, because they differ by
 * a factor of four at the same resolution and a ledger that priced them alike
 * would be quietly wrong.
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
  // https://ai.google.dev/gemini-api/docs/pricing — gemini-nano-banana-2.1,
  // read 2026-10-15. Image output is $30/M tokens: 1120 at 1K ($0.0336),
  // 1680 at 2K ($0.0504), 3780 at 4K ($0.113). The image-generation size table
  // still lists 2520 tokens at 4K, which would be $0.076 and contradicts the
  // pricing page's own $0.113 figure, so the pricing page wins.
  'gemini-nano-banana-2.1': {
    inputUsdPerMillionTokens: 1.5,
    outputUsdPerMillionTokens: 30,
    outputTokensByResolution: { '1K': 1120, '2K': 1680, '4K': 3780 },
  },
  'gemini-3.1-flash-lite-image': {
    inputUsdPerMillionTokens: 0.25,
    outputUsdPerMillionTokens: 30,
    outputTokensByResolution: { '1K': 1120 },
  },
};

/**
 * The model a run uses when the request names none, and the price for an id
 * this table does not know. Aliased to the catalog default: `resolveGeminiImageModel`
 * already runs that model, and a second literal here filed the 2.1 run at Pro's rate.
 */
export const DEFAULT_GEMINI_MODEL_ID = DEFAULT_GEMINI_IMAGE_MODEL;

function geminiRate(modelId: string | undefined): GeminiImageRate {
  return GEMINI_IMAGE_RATES[modelId ?? ''] ?? GEMINI_IMAGE_RATES[DEFAULT_GEMINI_MODEL_ID];
}

/**
 * https://ai.google.dev/gemini-api/docs/pricing — Gemini Omni Flash, read
 * 2026-10-19. Video output is $17.50 per 1M tokens, including thinking tokens.
 * 720p is billed at 5,792 tokens per second, so one second is
 * 5792 × 17.50 / 1_000_000 = $0.10136. Google summarizes that as about $0.10/s.
 * Input tokens are $1.50 per 1M and are not part of this per-second figure.
 * No per-second token rate is published for 360p, 1080p, or 4k, so those
 * resolutions are not given a stand-in price.
 */
export interface GeminiVideoRate {
  /** USD per second of generated video, by resolution. Audio is included in the output-token rate. */
  usdPerSecond: Record<string, number>;
}

export const GEMINI_VIDEO_RATES: Record<string, GeminiVideoRate> = {
  'gemini-omni-1.1-flash': {
    usdPerSecond: { '720p': GEMINI_OMNI_720P_USD_PER_SECOND },
  },
};

export const DEFAULT_GEMINI_VIDEO_MODEL_ID = DEFAULT_GEMINI_VIDEO_MODEL;

function geminiVideoRate(modelId: string | undefined): GeminiVideoRate | null {
  return GEMINI_VIDEO_RATES[modelId ?? ''] ?? GEMINI_VIDEO_RATES[DEFAULT_GEMINI_VIDEO_MODEL_ID] ?? null;
}

/**
 * Cost of one Gemini video generation at the given resolution and duration.
 * Returns 0 when the resolution has no published per-second rate. An unknown
 * model id is priced as Omni, because that is the model the request runs.
 * Callers that need a figure for an unpriced resolution use
 * `geminiVideoPriceNotice` (a 720p lower bound labelled unknown), not this 0.
 */
export function geminiVideoCost(
  modelId: string | undefined,
  resolution: string | undefined,
  durationSeconds: number | undefined
): number {
  const rate = geminiVideoRate(modelId);
  if (!rate || !resolution) return 0;
  const usd = rate.usdPerSecond[resolution];
  if (usd == null) return 0;
  const duration = durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const cost = usd * duration;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/**
 * What to show beside Generate when this resolution has no published
 * per-second rate. 1080p and 4k are upscales, so the 720p figure is a labelled
 * lower bound. 360p is not claimed to cost at least that much. Returns null
 * when the selection is priced.
 */
export function geminiVideoPriceNotice(
  modelId: string | undefined,
  resolution: string | undefined,
  durationSeconds: number | undefined
): string | null {
  if (geminiVideoCost(modelId, resolution, durationSeconds) > 0) return null;
  const floor = geminiVideoCost(modelId, '720p', durationSeconds);
  if (!resolution || !(floor > 0)) {
    return 'Price unknown. Google does not publish a per-second rate for this resolution.';
  }
  const dollars = `~$${floor.toFixed(2)}`;
  if (resolution === '1080p' || resolution === '4k') {
    return `Price unknown for ${resolution}. A 720p clip of this length is at least ${dollars}.`;
  }
  return `Price unknown for ${resolution}. Google only publishes a 720p rate (${dollars} for this length).`;
}

/**
 * Rate label for Gemini video models. Shows the price range across supported
 * resolutions, or the specific resolution's price if provided.
 */
export function geminiVideoRateLabel(modelId: string | undefined, resolution?: string): string | null {
  const rate = geminiVideoRate(modelId);
  if (!rate) return null;
  const specific = resolution ? rate.usdPerSecond[resolution] : undefined;
  const rates = resolution ? (specific == null ? [] : [specific]) : Object.values(rate.usdPerSecond);
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
      /**
       * Per reference image, when the vendor bills input-image tokens on top of
       * the short-prompt output price. Absent means references are included.
       */
      inputImageUsd?: number;
      /**
       * Added when `thinking_level` is `high`, keyed by resolution. Absent means
       * thinking does not move the published figure.
       */
      highThinkingUsd?: Record<string, number>;
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

/**
 * $0.040 / $0.059 / $0.134. Multipliers keep falPublishedCost exact at those three
 * for a short prompt at minimal or medium thinking, which fal's 2026-10-07
 * measurements billed the same. Each reference image is about 1,120 input
 * tokens at the published $1.764/M. High thinking adds the gap up to those
 * measured high totals ($0.0490 / $0.0732 / $0.1435), so a reservation at high
 * sits on or above them.
 * https://fal.ai/models/google/nano-banana-2.1/llms.txt — read 2026-10-15.
 */
const NANO_BANANA_21_INPUT_IMAGE_USD = (1120 * 1.764) / 1_000_000;
const NANO_BANANA_21_RATE: FalRate = {
  unit: 'image',
  usd: 0.04,
  resolutionMultiplier: { '1K': 1, '2K': 1.475, '4K': 3.35 },
  webSearchUsd: 0,
  inputImageUsd: NANO_BANANA_21_INPUT_IMAGE_USD,
  highThinkingUsd: { '1K': 0.0094, '2K': 0.0142, '4K': 0.01 },
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

/**
 * https://fal.ai/models/fal-ai/veo3.1/lite — read 2026-10-01, and the same
 * sentence on the image-to-video and first-last-frame pages. Lite has no 4K
 * tier. 720p is $0.03/s silent and $0.05/s with audio; 1080p is $0.05/s silent
 * and $0.08/s with audio.
 */
const veoLiteRate = (): FalRate =>
  perSecond({
    '720p': { audioOff: 0.03, audioOn: 0.05 },
    '1080p': { audioOff: 0.05, audioOn: 0.08 },
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
  // https://fal.ai/models/google/nano-banana-2.1 — token rates, read 2026-10-15.
  // Canonical short-prompt text-to-image figures: $0.040 at 1K, $0.059 at 2K,
  // $0.134 at 4K. Web search has no separate fee. Edits add input-image tokens
  // on top of this output price; the edit endpoint uses the same baseline.
  'google/nano-banana-2.1': NANO_BANANA_21_RATE,
  'google/nano-banana-2.1/edit': NANO_BANANA_21_RATE,

  'fal-ai/veo3.1': veoRate([0.2, 0.4], [0.4, 0.6]),
  'fal-ai/veo3.1/image-to-video': veoRate([0.2, 0.4], [0.4, 0.6]),
  'fal-ai/veo3.1/first-last-frame-to-video': veoRate([0.2, 0.4], [0.4, 0.6]),
  'fal-ai/veo3.1/fast': veoRate([0.1, 0.15], [0.3, 0.35]),
  'fal-ai/veo3.1/fast/image-to-video': veoRate([0.1, 0.15], [0.3, 0.35]),
  'fal-ai/veo3.1/fast/first-last-frame-to-video': veoRate([0.1, 0.15], [0.3, 0.35]),
  'fal-ai/veo3.1/lite': veoLiteRate(),
  'fal-ai/veo3.1/lite/image-to-video': veoLiteRate(),
  'fal-ai/veo3.1/lite/first-last-frame-to-video': veoLiteRate(),

  'bytedance/seedance-2.0/text-to-video': seedanceRate({ '720p': 0.3034, '1080p': 0.682 }),
  'bytedance/seedance-2.0/image-to-video': seedanceRate({ '720p': 0.3034, '1080p': 0.682 }),
  'bytedance/seedance-2.0/fast/text-to-video': seedanceRate({ '720p': 0.2419 }),
  'bytedance/seedance-2.0/fast/image-to-video': seedanceRate({ '720p': 0.2419 }),

  'fal-ai/kling-video/v3/standard/text-to-video': klingRate(0.084, 0.126),
  'fal-ai/kling-video/v3/standard/image-to-video': klingRate(0.084, 0.126),
  'fal-ai/kling-video/v3/pro/text-to-video': klingRate(0.112, 0.168),
  'fal-ai/kling-video/v3/pro/image-to-video': klingRate(0.112, 0.168),
  // https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/llms.txt — $0.168/s.
  // keep_audio does not change the published rate.
  'fal-ai/kling-video/o1/video-to-video/edit': klingRate(0.168, 0.168),
  // https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/edit/llms.txt — $0.126/s.
  'fal-ai/kling-video/o3/standard/video-to-video/edit': klingRate(0.126, 0.126),
  // https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/llms.txt — $0.168/s.
  'fal-ai/kling-video/o3/pro/video-to-video/edit': klingRate(0.168, 0.168),
  // https://fal.ai/models/fal-ai/kling-video/o3/4k/video-to-video/edit/llms.txt — $0.42/s, audio or not.
  'fal-ai/kling-video/o3/4k/video-to-video/edit': klingRate(0.42, 0.42),
  // https://fal.ai/models/fal-ai/wan/v2.7/edit-video/llms.txt — $0.10/s at 720p, $0.15/s at 1080p.
  'fal-ai/wan/v2.7/edit-video': seedanceRate({ '720p': 0.1, '1080p': 0.15 }),
  // https://fal.ai/models/luma/agent/ray/v3.2/video-to-video/llms.txt
  // $0.72 / $1.08 / $2.16 per 5 seconds, written here per second. HDR is not offered.
  'luma/agent/ray/v3.2/video-to-video': seedanceRate({ '540p': 0.144, '720p': 0.216, '1080p': 0.432 }),
  // https://fal.ai/models/minimax/h3-max/recast/llms.txt — $0.30/s at 768P, $0.45/s at 1080P.
  'minimax/h3-max/recast': seedanceRate({ '768P': 0.3, '1080P': 0.45 }),
  // https://fal.ai/models/minimax/h3-max/relight/llms.txt
  'minimax/h3-max/relight': seedanceRate({ '480P': 0.05, '768P': 0.08, '1080P': 0.16, '2K': 0.32 }),

  'fal-ai/minimax/hailuo-2.3/standard/text-to-video': { unit: 'video', usdPerRun: { '6': 0.28, '10': 0.56 } },
  'fal-ai/minimax/hailuo-2.3/standard/image-to-video': { unit: 'video', usdPerRun: { '6': 0.28, '10': 0.56 } },
  'fal-ai/minimax/hailuo-2.3/pro/text-to-video': { unit: 'video', usdPerRun: { '*': 0.49 } },
  'fal-ai/minimax/hailuo-2.3/pro/image-to-video': { unit: 'video', usdPerRun: { '*': 0.49 } },

  'fal-ai/wan/v2.7/text-to-video': seedanceRate({ '720p': 0.1, '1080p': 0.15 }),
  'fal-ai/wan/v2.7/image-to-video': seedanceRate({ '720p': 0.1, '1080p': 0.15 }),

  // https://fal.ai/models/minimax/h3-max-turbo/image-to-video — read 2026-10-26.
  // Regular prices; falRateAt applies the 35% offer through October 31.
  // One endpoint covers text, image and frames.
  // fal bills output seconds, and the clip can run up to about 0.7 s longer
  // than requested; falPublishedCost adds that overrun for this endpoint.
  'minimax/h3-max-turbo/image-to-video': seedanceRate({ '480P': 0.025, '768P': 0.04, '1080P': 0.08 }),
};

/**
 * Verified 2026-10-26 on fal's H3 Max Turbo page. The provider names October 31
 * but no timezone; this app expires the offer at November 1, 00:00 UTC. The
 * known window starts on the verification date so late capture never invents
 * a discount for older jobs. H3 Max Recast/Relight are different endpoints and
 * still publish full prices; the generation offer does not cover those edits.
 */
export const FAL_H3_TURBO_PROMOTION = {
  startsAt: Date.parse('2026-10-26T00:00:00Z'),
  endsAt: Date.parse('2026-11-01T00:00:00Z'),
  rate: seedanceRate({ '480P': 0.01625, '768P': 0.026, '1080P': 0.052 }),
};

function falPromotionActive(endpointId: string, at: number): boolean {
  return endpointId === 'minimax/h3-max-turbo/image-to-video'
    && at >= FAL_H3_TURBO_PROMOTION.startsAt && at < FAL_H3_TURBO_PROMOTION.endsAt;
}

export function falPromotionNote(endpointId: string, at = Date.now()): string | null {
  return falPromotionActive(endpointId, at) ? '35% off through Oct 31.' : null;
}

/** Resolve at call time, never module load: a long-running Worker outlives a sale. */
function falRateAt(endpointId: string, at: number): FalRate | undefined {
  return falPromotionActive(endpointId, at) ? FAL_H3_TURBO_PROMOTION.rate : FAL_RATES[endpointId];
}

/**
 * fal's H3 page: "The output can run up to about 0.7 s longer than requested."
 * Keyed by endpoint so the published table and fal's live estimate price the
 * same overrun.
 */
const FAL_OUTPUT_OVERRUN_SECONDS: Record<string, number> = {
  'minimax/h3-max-turbo/image-to-video': 0.7,
};

/**
 * The seconds fal bills for a requested duration. Pass the requested length,
 * never a measured one, or the overrun is added twice.
 */
export function falBilledSeconds(endpointId: string, requestedSeconds: number): number {
  return requestedSeconds + (FAL_OUTPUT_OVERRUN_SECONDS[endpointId] ?? 0);
}

/** The run controls that move a fal price, read from a job's control values. */
export interface FalRunControls {
  /** Submission time for saved jobs; omitted for a current run estimate. */
  pricedAt?: number;
  resolution?: string;
  audio?: boolean;
  durationSeconds?: number;
  webSearch?: boolean;
  /** fal `thinking_level`. Only `high` moves the Nano Banana 2.1 figure. */
  thinkingLevel?: string;
  /** Reference images on a rate that bills them per input image. */
  inputImages?: number;
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
  const rate = falRateAt(endpointId, controls.pricedAt ?? Date.now());
  if (!rate) return null;

  if (rate.unit === 'image') {
    const resolution = controls.resolution ?? '1K';
    const multiplier = rate.resolutionMultiplier[resolution];
    if (multiplier === undefined) return null;
    const images = controls.inputImages;
    const imageUsd =
      rate.inputImageUsd && Number.isFinite(images) && images !== undefined && images > 0
        ? rate.inputImageUsd * images
        : 0;
    const thinkingUsd =
      controls.thinkingLevel === 'high' ? rate.highThinkingUsd?.[resolution] ?? 0 : 0;
    const costUsd = rate.usd * multiplier + (controls.webSearch ? rate.webSearchUsd : 0) + imageUsd + thinkingUsd;
    return { costUsd, unit: 'image', quantity: 1 };
  }

  const requested = controls.durationSeconds;
  const hasDuration = requested !== undefined && Number.isFinite(requested) && requested > 0;
  const duration = hasDuration ? falBilledSeconds(endpointId, requested) : requested;

  if (rate.unit === 'second') {
    if (!hasDuration || duration === undefined) return null;
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
function usd(value: number, precision?: number): string {
  const fixed = value.toFixed(precision ?? (value >= 0.01 ? 3 : 4));
  return `$${fixed.replace(/0+$/, '').replace(/\.$/, '')}`;
}

/** `0.1`–`0.4` → `$0.1–0.4`, or a single figure when the range collapses. */
function usdRange(values: number[], precision?: number): string | null {
  const finite = values.filter(value => Number.isFinite(value) && value > 0);
  if (finite.length === 0) return null;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  return low === high ? usd(low, precision) : `${usd(low, precision)}–${usd(high, precision).replace('$', '')}`;
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
export function falRateLabel(endpointId: string, at = Date.now()): string | null {
  const rate = falRateAt(endpointId, at);
  if (!rate) return null;

  if (rate.unit === 'image') {
    const multipliers = Object.values(rate.resolutionMultiplier);
    const range = usdRange(multipliers.map(multiplier => rate.usd * multiplier));
    return range && `${range} / image`;
  }

  if (rate.unit === 'second') {
    const perSecond = Object.values(rate.usdPerSecond).flatMap(entry => [entry.audioOff, entry.audioOn]);
    // Keep the full promotional $0.01625, rather than rounding it to $0.016.
    const range = usdRange(perSecond, falPromotionActive(endpointId, at) ? 5 : undefined);
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
