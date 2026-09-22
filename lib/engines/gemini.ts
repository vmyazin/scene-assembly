// lib/engines/gemini.ts
import { GenerateVideosOperation, GoogleGenAI } from '@google/genai';

import { RouteError } from '../providers/route-error';

import { geminiImageSize, resolveGeminiImageModel } from './gemini-catalog';
import {
  geminiVideoResolution,
  geminiVideoDuration,
  geminiVideoAspectRatio,
  resolveGeminiVideoModel,
} from './gemini-video-catalog';

/** Google's documented Veo poll cadence. */
export const GEMINI_VIDEO_POLL_INTERVAL_MS = 10_000;
/**
 * Peak Veo latency is documented at 6 minutes. Eight minutes is enough to
 * cover that without leaving a tab spinning forever after a stuck operation.
 */
export const GEMINI_VIDEO_TIMEOUT_MS = 8 * 60 * 1000;

const GEMINI_VIDEO_DOWNLOAD_HOST = 'generativelanguage.googleapis.com';

function geminiClient(apiKey: string, singleAttempt?: boolean): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    ...(singleAttempt ? { httpOptions: { retryOptions: { attempts: 1 } } } : {}),
  });
}

export interface EngineUsage {
  promptTokens: number;
  outputTokens: number;
}

export interface EngineResult {
  imageData: string; // base64, no data: prefix
  mimeType: string;
  /** Token counts from `usageMetadata`, when the API reported them. */
  usage?: EngineUsage;
}

interface GeminiOpts {
  /** Which catalogued model runs. An unknown or absent id falls back to Pro. */
  model?: string;
  prompt?: string;
  images?: string[]; // base64 (already stripped of data: prefix)
  referenceImages?: Array<{data: string; mimeType: string}>;
  /** Durable callers must never inherit the SDK's default paid retries. */
  singleAttempt?: boolean;
  config?: {
    aspectRatio?: string;
    imageSize?: string;
    useGoogleSearch?: boolean;
  };
  apiKey: string;
}


export async function geminiGenerate(opts: GeminiOpts): Promise<EngineResult> {
  const ai = geminiClient(opts.apiKey, opts.singleAttempt);

  const promptParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (opts.prompt) promptParts.push({ text: opts.prompt });
  for (const img of opts.images || []) {
    promptParts.push({ inlineData: { mimeType: 'image/png', data: img } });
  }
  for (const reference of opts.referenceImages || []) promptParts.push({inlineData:reference});

  // Generation params must be nested under `config` (not spread at top level),
  // or @google/genai silently ignores imageConfig/tools.
  const config: {
    imageConfig?: { aspectRatio?: string; imageSize?: string };
    tools?: Array<{ googleSearch: Record<string, never> }>;
  } = {};
  // Both settings are narrowed to the chosen model rather than passed through:
  // Google rejects an imageSize a model does not publish, and Lite refuses the
  // search tool outright — and either rejection costs a whole submission.
  const model = resolveGeminiImageModel(opts.model);
  if (opts.config?.aspectRatio || opts.config?.imageSize) {
    config.imageConfig = {};
    if (opts.config.aspectRatio) config.imageConfig.aspectRatio = opts.config.aspectRatio;
    if (opts.config.imageSize) config.imageConfig.imageSize = geminiImageSize(model, opts.config.imageSize);
  }
  if (opts.config?.useGoogleSearch && model.supportsGoogleSearch) config.tools = [{ googleSearch: {} }];

  const response = await ai.models.generateContent({
    model: model.id,
    contents: promptParts,
    config,
  });

  let imageData: string | null = null;
  let mimeType = 'image/png';
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.inlineData?.data) {
        imageData = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
      }
    }
  }

  if (!imageData) {
    const reason = response.candidates?.[0]?.finishReason;
    throw new Error(
      'No image data returned from the API. Please try again.' + (reason ? ` (${reason})` : '')
    );
  }

  const meta = response.usageMetadata;
  const usage: EngineUsage | undefined =
    meta && typeof meta.candidatesTokenCount === 'number'
      ? { promptTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount }
      : undefined;

  return { imageData, mimeType, usage };
}

/**
 * Video generation result from Gemini. The operation is long-running and must
 * be polled until complete.
 */
export interface VideoOperationResult {
  /** Operation name/ID for polling. */
  operation: string;
  /** Whether the operation is complete. */
  done: boolean;
  /** File URI if complete, else undefined. */
  videoUri?: string;
  /** Base64 video bytes when the operation already included them. */
  videoBytes?: string;
  mimeType?: string;
  /** Error message if failed, else undefined. */
  error?: string;
}

export interface GeminiVideoOpts {
  /** Which catalogued video model runs. Unknown or absent ID falls back to default. */
  model?: string;
  prompt: string;
  /** Reference image for image-to-video mode (base64, no data: prefix). */
  image?: string;
  /** MIME type of `image`. Defaults to image/png. */
  imageMimeType?: string;
  /** Durable callers must never inherit the SDK's default paid retries. */
  singleAttempt?: boolean;
  config?: {
    resolution?: string;
    aspectRatio?: string;
    durationSeconds?: number;
  };
  apiKey: string;
}

interface GeminiVideoClientOpts {
  apiKey: string;
  singleAttempt?: boolean;
}

function requireGeminiApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) throw new RouteError('A Gemini API key is required.', 401);
  return key;
}

function sanitizeGeminiMessage(message: string, fallback: string, apiKey?: string): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  if (apiKey && trimmed.includes(apiKey)) return fallback;
  return trimmed.length > 600 ? `${trimmed.slice(0, 597)}…` : trimmed;
}

function geminiRouteError(error: unknown, fallback: string, apiKey?: string): RouteError {
  if (error instanceof RouteError) return error;
  const status =
    error !== null && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number'
      ? (error as { status: number }).status
      : error instanceof TypeError
        ? 0
        : 500;
  const raw = error instanceof Error ? error.message : fallback;
  return new RouteError(sanitizeGeminiMessage(raw, fallback, apiKey), status);
}

function operationErrorMessage(error: Record<string, unknown>): string {
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  const nested = error.error;
  if (nested && typeof nested === 'object' && typeof (nested as { message?: unknown }).message === 'string') {
    const message = (nested as { message: string }).message.trim();
    if (message) return message;
  }
  return 'Gemini video generation failed.';
}

function readVideoOperation(operation: {
  name?: string;
  done?: boolean;
  error?: Record<string, unknown>;
  response?: {
    generatedVideos?: Array<{ video?: { uri?: string; videoBytes?: string; mimeType?: string } }>;
    raiMediaFilteredCount?: number;
    raiMediaFilteredReasons?: string[];
  };
}): VideoOperationResult {
  const name = typeof operation.name === 'string' ? operation.name : '';
  if (operation.error) {
    return { operation: name, done: true, error: operationErrorMessage(operation.error) };
  }
  const filtered = operation.response?.raiMediaFilteredCount;
  if (operation.done && typeof filtered === 'number' && filtered > 0) {
    const reason = operation.response?.raiMediaFilteredReasons?.find((entry) => entry.trim());
    return {
      operation: name,
      done: true,
      error: reason || 'Gemini blocked this video for safety. You are not charged when a clip is blocked.',
    };
  }
  const video = operation.response?.generatedVideos?.[0]?.video;
  if (operation.done && !video?.uri && !video?.videoBytes) {
    return { operation: name, done: true, error: 'Gemini finished without a video. Please try again.' };
  }
  return {
    operation: name,
    done: Boolean(operation.done),
    videoUri: video?.uri,
    videoBytes: video?.videoBytes,
    mimeType: video?.mimeType,
  };
}

/** Documented 10s wait between Veo polls. Tests replace this with a no-op. */
export function geminiVideoWait(ms: number = GEMINI_VIDEO_POLL_INTERVAL_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a Gemini / Veo video generation job.
 *
 * Uses `ai.models.generateVideos` from `@google/genai`. The returned operation
 * is usually incomplete; poll with `geminiPollVideoOperation` until `done`.
 */
export async function geminiGenerateVideo(opts: GeminiVideoOpts): Promise<VideoOperationResult> {
  const apiKey = requireGeminiApiKey(opts.apiKey);
  const prompt = opts.prompt.trim();
  if (!prompt) throw new RouteError('Enter a prompt for your video.', 400);

  const model = resolveGeminiVideoModel(opts.model);
  const resolution = geminiVideoResolution(model, opts.config?.resolution);
  const durationSeconds = geminiVideoDuration(model, opts.config?.durationSeconds, resolution);
  const aspectRatio = geminiVideoAspectRatio(model, opts.config?.aspectRatio);

  try {
    const ai = geminiClient(apiKey, opts.singleAttempt);
    const operation = await ai.models.generateVideos({
      model: model.id,
      prompt,
      ...(opts.image
        ? {
            image: {
              imageBytes: opts.image,
              mimeType: opts.imageMimeType?.trim() || 'image/png',
            },
          }
        : {}),
      config: {
        numberOfVideos: 1,
        resolution,
        aspectRatio,
        durationSeconds,
        // Lite publishes different personGeneration enums per input mode; the
        // wrong one is a paid rejection.
        personGeneration: opts.image ? 'allow_adult' : 'allow_all',
      },
    });
    const result = readVideoOperation(operation);
    if (!result.operation && !result.done) {
      throw new RouteError('Gemini did not return a video operation to poll.', 502);
    }
    return result;
  } catch (error) {
    throw geminiRouteError(error, 'Gemini could not start video generation.', apiKey);
  }
}

/**
 * Poll a Gemini video generation operation via `ai.operations.getVideosOperation`.
 */
export async function geminiPollVideoOperation(
  apiKey: string,
  operationName: string,
  opts: Pick<GeminiVideoClientOpts, 'singleAttempt'> = {}
): Promise<VideoOperationResult> {
  const key = requireGeminiApiKey(apiKey);
  const name = operationName.trim();
  if (!name) throw new RouteError('Missing Gemini video operation.', 400);

  try {
    const ai = geminiClient(key, opts.singleAttempt);
    // Must be a real GenerateVideosOperation: the SDK converts the wire payload
    // by calling `_fromAPIResponse` on this object, so an object literal
    // type-checks and then throws at runtime.
    const pending = new GenerateVideosOperation();
    pending.name = name;
    const operation = await ai.operations.getVideosOperation({ operation: pending });
    return readVideoOperation(operation);
  } catch (error) {
    throw geminiRouteError(error, 'Gemini could not check this video job.', key);
  }
}

function geminiVideoDownloadUrl(videoUri: string): URL {
  let url: URL;
  try {
    url = new URL(videoUri);
  } catch {
    throw new RouteError('Gemini returned an unusable video address.', 502);
  }
  if (url.protocol !== 'https:' || url.hostname !== GEMINI_VIDEO_DOWNLOAD_HOST) {
    throw new RouteError('Gemini returned an unusable video address.', 502);
  }
  return url;
}

function blobFromBase64(base64: string, mimeType?: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'video/mp4' });
}

/**
 * Download a completed Gemini video.
 *
 * `ai.files.download({ downloadPath })` is Node-only. The documented browser
 * path is GET on `video.uri` with the API key (header first, query fallback
 * for the known 403 project-mismatch responses).
 */
export async function geminiDownloadVideo(
  apiKey: string,
  videoUri: string,
  opts: Pick<GeminiVideoClientOpts, 'singleAttempt'> & { videoBytes?: string; mimeType?: string } = {}
): Promise<Blob> {
  const key = requireGeminiApiKey(apiKey);
  const uri = videoUri.trim();
  if (opts.videoBytes && !uri) return blobFromBase64(opts.videoBytes, opts.mimeType);

  const url = geminiVideoDownloadUrl(uri);
  const headers = { 'x-goog-api-key': key };

  const fetchOnce = (target: URL, withQueryKey: boolean) => {
    const next = new URL(target.toString());
    if (withQueryKey && !next.searchParams.has('key')) next.searchParams.set('key', key);
    return fetch(next.toString(), { headers });
  };

  try {
    let response = await fetchOnce(url, false);
    if (response.status === 403) response = await fetchOnce(url, true);
    if (!response.ok) {
      if (opts.videoBytes) return blobFromBase64(opts.videoBytes, opts.mimeType);
      throw new RouteError(
        response.status === 401 || response.status === 403
          ? 'Gemini refused to download this video. Check the API key and try again.'
          : 'Gemini could not download this video.',
        response.status
      );
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      if (opts.videoBytes) return blobFromBase64(opts.videoBytes, opts.mimeType);
      throw new RouteError('Gemini returned an empty video file.', 502);
    }
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim() || 'video/mp4';
    return new Blob([buffer], { type: mimeType.startsWith('video/') ? mimeType : 'video/mp4' });
  } catch (error) {
    if (error instanceof RouteError) throw error;
    if (opts.videoBytes) return blobFromBase64(opts.videoBytes, opts.mimeType);
    throw geminiRouteError(error, 'Gemini could not download this video.', key);
  }
}
