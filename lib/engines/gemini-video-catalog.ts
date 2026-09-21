// lib/engines/gemini-video-catalog.ts
/**
 * The Gemini video models one Google AI Studio key can run.
 *
 * Veo models generate video with native audio through the Gemini API. Each has
 * different speed, quality, and pricing tradeoffs. The catalog is
 * dependency-free so client components, server routes, and the Worker can all
 * read it.
 *
 * Labels match Google's marketing names. Capabilities and pricing from
 * https://ai.google.dev/gemini-api/docs/pricing and
 * https://ai.google.dev/gemini-api/docs/models/veo-3.1-lite-generate-preview,
 * read 2026-09-21.
 */

export interface GeminiVideoModel {
  id: string;
  label: string;
  /** Appended to download filenames. */
  fileCode: string;
  /**
   * Supported output resolutions in the order the control should show them.
   * Google's API takes '720p', '1080p', '4k'.
   */
  resolutions: string[];
  /**
   * Supported durations in seconds. Veo 3.1 Lite supports 4s, 6s, and 8s.
   */
  durations: number[];
  /**
   * Supported aspect ratios. Veo supports '16:9' and '9:16'.
   */
  aspectRatios: string[];
  /**
   * Whether this model supports 4K output. Lite does not.
   */
  supports4K: boolean;
  /**
   * Whether this model supports Extension (video-to-video continuation).
   * Lite does not.
   */
  supportsExtension: boolean;
  /**
   * USD per second of generated video, by resolution. Audio is included.
   */
  usdPerSecond: Record<string, number>;
  /** The vendor's one-line description, shown under the picker. */
  note: string;
}

export const GEMINI_VIDEO_MODELS: GeminiVideoModel[] = [
  {
    id: 'veo-3.1-lite-generate-preview',
    label: 'Veo 3.1 Lite',
    fileCode: 'veo-3_1-lite',
    resolutions: ['720p', '1080p'],
    durations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    supports4K: false,
    supportsExtension: false,
    usdPerSecond: {
      '720p': 0.05,
      '1080p': 0.08,
    },
    note: 'High-efficiency video generation at less than 50% the cost of Veo 3.1 Fast. Supports text-to-video and image-to-video at 720p and 1080p.',
  },
];

/** Default model when none is specified. */
export const DEFAULT_GEMINI_VIDEO_MODEL = GEMINI_VIDEO_MODELS[0].id;

export function findGeminiVideoModel(modelId: string | undefined): GeminiVideoModel | undefined {
  return GEMINI_VIDEO_MODELS.find((model) => model.id === modelId);
}

/**
 * Resolve a model ID to a catalog entry, falling back to the default for
 * unknown or retired IDs. A paid video generation shouldn't fail with an
 * unhelpful 404.
 */
export function resolveGeminiVideoModel(modelId: string | undefined): GeminiVideoModel {
  return findGeminiVideoModel(modelId) ?? GEMINI_VIDEO_MODELS[0];
}

/**
 * The chosen resolution if this model supports it, else its first (smallest)
 * supported resolution. Never returns a resolution the model would reject.
 */
export function geminiVideoResolution(model: GeminiVideoModel, resolution: string | undefined): string {
  return resolution && model.resolutions.includes(resolution) ? resolution : model.resolutions[0];
}

/**
 * Google's Veo 3.1 family only accepts 8s at 1080p/4k. Sending 4 or 6 is a
 * paid rejection, so the workspace and the request helper both go through this.
 */
function veoLocksDurationTo8(model: GeminiVideoModel, resolution?: string): boolean {
  return (resolution === '1080p' || resolution === '4k') && model.durations.includes(8);
}

/**
 * Durations the duration control may offer for this resolution. 1080p/4k
 * collapse to `[8]` so the UI cannot pick a length Google will reject.
 */
export function geminiVideoDurationOptions(
  model: GeminiVideoModel,
  resolution?: string
): number[] {
  return veoLocksDurationTo8(model, resolution) ? [8] : model.durations;
}

/**
 * The chosen duration if this model supports it, else its first supported
 * duration. Never returns a duration the model would reject.
 */
export function geminiVideoDuration(
  model: GeminiVideoModel,
  duration: number | undefined,
  resolution?: string
): number {
  if (veoLocksDurationTo8(model, resolution)) return 8;
  return duration && model.durations.includes(duration) ? duration : model.durations[0];
}

/**
 * The chosen aspect ratio if this model supports it, else its first supported
 * ratio. Never returns a ratio the model would reject.
 */
export function geminiVideoAspectRatio(model: GeminiVideoModel, aspectRatio: string | undefined): string {
  return aspectRatio && model.aspectRatios.includes(aspectRatio) ? aspectRatio : model.aspectRatios[0];
}
