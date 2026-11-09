// lib/engines/gemini-video-catalog.ts
/**
 * The Gemini video model one Google AI Studio key can run.
 *
 * Gemini Omni 1.2 Flash (`gemini-omni-1.2-flash`, released 2026-11-05) replaces
 * Omni 1.1, and Veo 3.1 Lite before it. Google routes `gemini-omni-1.1-flash`
 * to 1.2 on 2026-12-03, so this stays a one-model list: stored 1.1 ids migrate
 * to the default rather than staying selectable for four weeks. Capabilities from
 * https://aistudio.google.com/docs/models/gemini-omni-flash and
 * https://aistudio.google.com/docs/omni, read 2026-11-09. Per-second figures
 * are derived below from https://aistudio.google.com/docs/pricing, read the
 * same day (published tokens per second × $12.00/M).
 *
 * Omni 1.2 also accepts 11–15s. This catalog still offers Omni 1.1's 3–10s, a
 * valid subset, because a longer clip is a product change and not a repricing.
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

const OMNI_1_2_USD_PER_MILLION_TOKENS = 12;
const omni12UsdPerSecond = (tokensPerSecond: number) => (tokensPerSecond * OMNI_1_2_USD_PER_MILLION_TOKENS) / 1_000_000;

/**
 * Published output tokens per second × $12.00 / 1M. Google rounds these to
 * about $0.023, $0.07, $0.104, and $0.209. 1080p and 4k are upscaled outputs.
 */
export const GEMINI_OMNI_USD_PER_SECOND: Record<string, number> = {
  '360p': omni12UsdPerSecond(1931),
  '720p': omni12UsdPerSecond(5792),
  '1080p': omni12UsdPerSecond(8688),
  '4k': omni12UsdPerSecond(17376),
};

/** 5792 × 12 / 1_000_000 = 0.069504. */
export const GEMINI_OMNI_720P_USD_PER_SECOND = GEMINI_OMNI_USD_PER_SECOND['720p'];

/**
 * Omni 1.1 at 720p: 5792 × 17.50 / 1_000_000 = 0.10136. Saved 1.1 jobs keep
 * this rate. Google never published a per-second rate for its other resolutions.
 */
export const GEMINI_OMNI_1_1_720P_USD_PER_SECOND = (5792 * 17.5) / 1_000_000;

export const GEMINI_VIDEO_MODELS: GeminiVideoModel[] = [
  {
    id: 'gemini-omni-1.2-flash',
    label: 'Omni 1.2 Flash',
    fileCode: 'omni-1_2-flash',
    resolutions: ['360p', '720p', '1080p', '4k'],
    defaultResolution: '720p',
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supports4K: true,
    supportsExtension: false,
    usdPerSecond: GEMINI_OMNI_USD_PER_SECOND,
    note: 'Fast video with audio. 720p is about $0.070/s (5,792 output tokens × $12 per million). 360p is about $0.023/s, 1080p about $0.104/s, and 4k about $0.209/s.',
  },
];

/** Default model when none is specified, and the fallback for a retired id. */
export const DEFAULT_GEMINI_VIDEO_MODEL = GEMINI_VIDEO_MODELS[0].id;

/** The preview id Google shuts down on 2026-10-22. Stored settings still name it. */
export const RETIRED_GEMINI_VIDEO_MODEL_ID = 'veo-3.1-lite-generate-preview';

/** Google routes this id to Omni 1.2 on 2026-12-03. Saved jobs and stored settings still name it. */
export const GEMINI_OMNI_1_1_MODEL_ID = 'gemini-omni-1.1-flash';

/**
 * How finished clips from a model that has left the catalog are still named.
 * Not selectable, and `resolveGeminiVideoModel` sends these ids to the default.
 */
const PAST_GEMINI_VIDEO_MODELS: Record<string, Pick<GeminiVideoModel, 'label' | 'fileCode'>> = {
  [GEMINI_OMNI_1_1_MODEL_ID]: { label: 'Omni 1.1 Flash', fileCode: 'omni-1_1-flash' },
};

export function pastGeminiVideoModel(modelId: string | undefined): Pick<GeminiVideoModel, 'label' | 'fileCode'> | undefined {
  return modelId ? PAST_GEMINI_VIDEO_MODELS[modelId] : undefined;
}

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
