// lib/engines/gemini-video-catalog.ts
/**
 * The Gemini video model one Google AI Studio key can run.
 *
 * Veo 3.1 Lite (`veo-3.1-lite-generate-preview`) shuts down on 2026-10-22.
 * Google's replacement is Gemini Omni Flash, generally available as
 * `gemini-omni-1.1-flash`. Capabilities from
 * https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash and
 * https://ai.google.dev/gemini-api/docs/omni, read 2026-10-19.
 * The 720p per-second figure is derived in `lib/spend/rates.ts` from
 * https://ai.google.dev/gemini-api/docs/pricing (5,792 output tokens/s × $17.50/M).
 *
 * Clip extension and first+last frame are documented, and neither is offered
 * here. Extension needs an uploaded video (or a previous interaction id) plus
 * regional and dialogue limits. First+last frame needs two stills. This
 * workspace still takes one reference image.
 *
 * The catalog is dependency-free so client components, server routes, and the
 * Worker can all read it.
 */

export interface GeminiVideoModel {
  id: string;
  label: string;
  /** Appended to download filenames. */
  fileCode: string;
  /**
   * Supported output resolutions, lowest first. The default is
   * `defaultResolution`, not the first entry, so reordering this list does
   * not change the fallback. Google's API takes '360p', '720p', '1080p', '4k'.
   * 720p is the only resolution with a published per-second price.
   */
  resolutions: string[];
  /** Documented default output. Omni's default is 720p. */
  defaultResolution: string;
  /**
   * Supported durations in seconds. Omni output is 3–10s at every resolution.
   * Sent as a duration string such as "8s".
   */
  durations: number[];
  /** Documented default length. An omitted or invalid duration uses this, not `durations[0]`. */
  defaultDuration: number;
  /**
   * Supported aspect ratios. Omni supports '16:9' (default) and '9:16'.
   */
  aspectRatios: string[];
  /** 4k is an upscaled output Omni publishes. */
  supports4K: boolean;
  /**
   * Extension is documented and not wired. A true here would offer a control
   * this workspace cannot submit.
   */
  supportsExtension: boolean;
  /**
   * USD per second of generated video, by resolution, for resolutions Google
   * prices. Audio is included in the output-token rate. Unlisted resolutions
   * are token-billed and have no published per-second figure.
   */
  usdPerSecond: Record<string, number>;
  /** The vendor's one-line description, shown under the picker. */
  note: string;
}

/**
 * 720p output tokens per second × $17.50 / 1M, from the pricing page.
 * 5792 × 17.50 / 1_000_000 = 0.10136. Google summarizes that as about $0.10/s.
 */
export const GEMINI_OMNI_720P_USD_PER_SECOND = (5792 * 17.5) / 1_000_000;

export const GEMINI_VIDEO_MODELS: GeminiVideoModel[] = [
  {
    id: 'gemini-omni-1.1-flash',
    label: 'Omni Flash',
    fileCode: 'omni-1_1-flash',
    resolutions: ['360p', '720p', '1080p', '4k'],
    defaultResolution: '720p',
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supports4K: true,
    supportsExtension: false,
    usdPerSecond: {
      '720p': GEMINI_OMNI_720P_USD_PER_SECOND,
    },
    note: 'Fast video with audio. 720p is about $0.101/s (5,792 output tokens × $17.50 per million). 360p, 1080p, and 4k are supported; Google does not publish their per-second rate.',
  },
];

/** Default model when none is specified, and the fallback for a retired id. */
export const DEFAULT_GEMINI_VIDEO_MODEL = GEMINI_VIDEO_MODELS[0].id;

/** The preview id Google shuts down on 2026-10-22. Stored settings still name it. */
export const RETIRED_GEMINI_VIDEO_MODEL_ID = 'veo-3.1-lite-generate-preview';

export function findGeminiVideoModel(modelId: string | undefined): GeminiVideoModel | undefined {
  return GEMINI_VIDEO_MODELS.find((model) => model.id === modelId);
}

/**
 * Resolve a model ID to a catalog entry, falling back to Omni for unknown or
 * retired IDs. A paid video generation should not go out under a shut-down id.
 */
export function resolveGeminiVideoModel(modelId: string | undefined): GeminiVideoModel {
  return findGeminiVideoModel(modelId) ?? GEMINI_VIDEO_MODELS[0];
}

/**
 * The chosen resolution if this model supports it, else `defaultResolution`.
 * Never returns a resolution the model would reject.
 */
export function geminiVideoResolution(model: GeminiVideoModel, resolution: string | undefined): string {
  const fallback = model.resolutions.includes(model.defaultResolution)
    ? model.defaultResolution
    : model.resolutions[0];
  return resolution && model.resolutions.includes(resolution) ? resolution : fallback;
}

/**
 * Durations the duration control may offer. Omni accepts 3–10s at every
 * resolution, so 1080p and 4k do not collapse the list the way Veo 3.1 did.
 */
export function geminiVideoDurationOptions(model: GeminiVideoModel): number[] {
  return model.durations;
}

/**
 * The chosen duration if this model supports it, else `defaultDuration` (8s).
 * Never returns a duration the model would reject. An omitted value must not
 * fall through to the shortest clip. Resolution is not an argument: every
 * published resolution accepts the same lengths.
 */
export function geminiVideoDuration(model: GeminiVideoModel, duration: number | undefined): number {
  const fallback = model.durations.includes(model.defaultDuration) ? model.defaultDuration : model.durations[0];
  return duration && model.durations.includes(duration) ? duration : fallback;
}

/**
 * The chosen aspect ratio if this model supports it, else its first supported
 * ratio. Never returns a ratio the model would reject.
 */
export function geminiVideoAspectRatio(model: GeminiVideoModel, aspectRatio: string | undefined): string {
  return aspectRatio && model.aspectRatios.includes(aspectRatio) ? aspectRatio : model.aspectRatios[0];
}
