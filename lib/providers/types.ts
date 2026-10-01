// lib/providers/types.ts
import type { ModerationLevel } from '../moderation/level';
/**
 * Shared shapes for the aggregator providers (Runware, Atlas Cloud, CometAPI).
 *
 * These three are the same thing wearing different clothes: a keyed HTTP API in
 * front of hundreds of third-party models, returning media as a URL. The
 * differences — task arrays vs prediction IDs vs OpenAI shapes — stay inside the
 * adapters, so the route, the job store, and the UI speak one vocabulary.
 *
 * Dependency-free and safe to import from client components: the adapters that
 * hold `fetch` calls live in their own modules.
 */

export type ProviderId = 'runware' | 'atlas' | 'comet' | 'piapi';

export type MediaKind = 'image' | 'video';

/** What a model can be fed. Mirrors the video workspace's own mode names. */
export type ProviderMode = 'text' | 'image' | 'frames' | 'reference' | 'edit';

export type VideoInputField = 'frameImages' | 'referenceImages';
export type VideoPromptSyntax = 'image-index' | 'at-image-index' | 'at-image-underscore-index';

export interface ProviderVideoInputCapability {
  field: VideoInputField;
  maxImages: number;
  clientMaxImages?: number;
  promptSyntax?: VideoPromptSyntax;
}

/**
 * One output size a video model actually accepts. Vendors express this two
 * ways: explicit pixels (Runware publishes a table of exact width/height pairs
 * per model architecture) or a named preset (Atlas `resolution`, Comet `size`).
 * Both live here so the picker can offer whatever the model really takes.
 */
export interface ProviderSize {
  label: string;
  width?: number;
  height?: number;
  /** Vendor preset string, when the API names sizes instead of measuring them. */
  preset?: string;
}

/** `480p · 16:9` → `480p`; a bare `720p` stays `720p`. */
export function sizeTier(label: string): string {
  return label.split('·')[0].trim();
}

/**
 * The key a size's published rate is filed under.
 *
 * Two vendors name a size two ways. Atlas gives each one an API preset, and
 * its rate table is keyed by that (`1080p-SR`, not the `1080p (upscaled)` the
 * label shows). Runware publishes only a label, `480p · 16:9`, whose leading
 * tier is the thing its per-second price is quoted at. Reading the preset
 * first and the tier second lets one rate table serve both, so the two
 * families cannot drift into separate lookups.
 */
export function sizeRateKey(size: ProviderSize): string {
  return size.preset ?? sizeTier(size.label);
}

/** Published prices; a missing resolution must never fall back to the cheapest tier. */
export type ProviderRate = {
  per: 'image' | 'second' | 'video';
  /** The first reference is included; subsequent references are billed once per request. */
  extraInputImageUsd?: number;
  audioUsdByResolution?: Record<string, number>;
} & (
  | { usd: number; usdByResolution?: never }
  | { usd?: never; usdByResolution: Record<string, number> }
);

export interface ProviderModel {
  /** The vendor's own identifier, verbatim. Never construct one of these. */
  id: string;
  label: string;
  /**
   * Short code appended to download filenames, so a saved file says which model
   * made it: `neon-tiger-in-the-rain-wan-2_7.mp4`. Lowercase, hyphen-separated,
   * with a version's decimal point written as `_` (`2.7` → `2_7`) so it reads
   * apart from the word separators. Unique within a provider.
   */
  fileCode: string;
  kind: MediaKind;
  /** Input modes the model accepts. */
  modes: ProviderMode[];
  /**
   * The vendor's published price, as a display string — units differ per
   * provider (per image, per megapixel, per second of video), so this is copy,
   * not arithmetic. `undefined` means the vendor meters it without a flat rate.
   */
  price?: string;
  /**
   * Published price as arithmetic for the spend ledger. Resolution tables
   * cover only verified tiers; unsupported settings record as unknown.
   */
  rate?: ProviderRate;
  videoEdit?: {
    sizes: ProviderSize[]; rate: ProviderRate; maxImages: number;
    draftRate?: ProviderRate;
    maxSeconds: number; minSeconds?: number;
    sourceBounds?: { minEdge: number; maxEdge: number; minPixels: number; minRatio: number; maxRatio: number };
    outputLabel?: string;
    promptSyntax?: VideoPromptSyntax;
    note?: string;
  };
  /** Max reference images the model accepts, when the vendor documents one. */
  maxInputImages?: number;
  /** Per-mode video input contracts, when a model has more than the legacy frame input. */
  videoInputs?: Partial<Record<Exclude<ProviderMode, 'text'>, ProviderVideoInputCapability>>;
  /**
   * How this model takes an input image. Runware splits the two: older
   * checkpoints start from `inputs.seedImage` (with `strength`), while the
   * newer editing models require `inputs.referenceImages` and have no seedImage
   * at all. Sending the wrong one is rejected, so it is per model, not global.
   */
  imageInput?: 'seed' | 'reference';
  /**
   * Clip lengths in seconds this model actually accepts, verbatim from the
   * vendor's parameter reference. Video models reject a length they do not
   * list — Runware's LTX-2 Fast takes only 6, 8 or 10 — so this is a whitelist,
   * not a suggestion. Absent means the model has no seconds-based control at
   * all (Atlas's LTX 2.3 Quality counts frames instead), and the request must
   * leave the field off entirely.
   */
  durations?: number[];
  /** Either a whitelist of options or an integer range for video duration. */
  duration?:
    | { type: 'options'; values: number[] }
    | { type: 'range'; min: number; max: number; default: number };
  /**
   * Output sizes this model accepts, verbatim from the vendor's table. Runware
   * rejects an unlisted width/height with "Unsupported width/height combination
   * for this model architecture" — LTX-2 Fast is 16:9 only — so this is a
   * whitelist as well. First entry is the default.
   */
  sizes?: ProviderSize[];
  supportsAudio?: boolean;
  aspectRatios?: string[];
  note?: string;
}

export interface ImageRequest {
  resolution?: string;
  apiKey: string;
  model: string;
  prompt: string;
  /** Reference images as data URLs (`data:image/png;base64,…`). */
  images?: string[];
  aspectRatio?: string;
  /** Which input field this model's references belong in. */
  imageInput?: 'seed' | 'reference';
  /**
   * Standard omits provider moderation keys. Relaxed asks the adapter to add
   * the one documented key for this model. References force Standard.
   */
  moderation?: ModerationLevel;
}

export interface ImageResult {
  /** Where the provider put the image. Fetched to bytes before the UI sees it. */
  url?: string;
  /** Base64 payload, when the provider returns bytes directly (Comet's GPT models). */
  base64?: string;
  mimeType?: string;
  /** Actual spend, when the provider reports it. */
  cost?: number;
}

export interface VideoRequest {
  draft?: boolean;
  sourceVideo?: string;
  audio?: boolean;
  apiKey: string;
  model: string;
  prompt: string;
  /** Frame/reference images as data URLs, in order. */
  images?: string[];
  durationSeconds?: number;
  /** Explicit pixels, when the model publishes a table of exact sizes. */
  width?: number;
  height?: number;
  /** Vendor preset, when the model names its sizes instead. */
  resolution?: string;
  aspectRatio?: string;
  /** Semantic mode selected by the client; optional for legacy adapter callers. */
  inputMode?: ProviderMode;
  /** Trusted field resolved from the provider catalog; never taken from browser JSON. */
  inputField?: VideoInputField;
  /** See ImageRequest. No video route in v1 is relaxable; the field is ignored there. */
  moderation?: ModerationLevel;
}

export type TaskState = 'queued' | 'running' | 'success' | 'error';

export interface ProviderTask {
  taskId: string;
  state: TaskState;
  /** 0–1 when the provider reports progress. */
  progress?: number;
  urls: string[];
  cost?: number;
  error?: string;
}

/**
 * One adapter per provider. Video is optional only in principle — all three
 * support it today — but the interface keeps image-only providers expressible.
 */
export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  generateImage(request: ImageRequest): Promise<ImageResult>;
  createVideo(request: VideoRequest): Promise<{ taskId: string }>;
  pollVideo(args: { apiKey: string; taskId: string }): Promise<ProviderTask>;
}

/** Thrown by adapters so the route can pass a status through unchanged. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: ProviderId
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Credential and quota failures read the same across vendors, and the raw text
 * ("no token provided (request id: …)") is not something to show a user.
 */
export function readableProviderError(
  provider: ProviderId,
  status: number,
  raw: string
): string {
  const name = provider === 'runware' ? 'Runware' : provider === 'atlas' ? 'Atlas Cloud' : provider === 'piapi' ? 'PiAPI' : 'CometAPI';
  const text = raw.toLowerCase();

  if (status === 401 || status === 403 || text.includes('token') || text.includes('api key')) {
    return `Your ${name} API key is invalid or has expired.`;
  }
  if (status === 402 || text.includes('credit') || text.includes('balance') || text.includes('insufficient')) {
    return `Your ${name} account is out of credits.`;
  }
  if (status === 429 || text.includes('rate limit')) {
    return `${name} is rate limiting requests. Wait a moment and try again.`;
  }
  if (text.includes('content policy') || text.includes('safety') || text.includes('nsfw')) {
    return `${name} rejected this prompt or reference image under its content policy.`;
  }
  if (status >= 500) {
    return `${name} is temporarily unavailable. Please try again.`;
  }
  return raw || `${name} rejected the request.`;
}
