// lib/engines/gemini.ts
import { GoogleGenAI } from '@google/genai';

import { RouteError } from '../providers/route-error';

import { geminiImageSize, resolveGeminiImageModel } from './gemini-catalog';
import {
  geminiVideoResolution,
  geminiVideoDuration,
  geminiVideoAspectRatio,
  resolveGeminiVideoModel,
} from './gemini-video-catalog';

/** Google's documented Omni file-poll cadence. */
export const GEMINI_VIDEO_POLL_INTERVAL_MS = 5_000;
/**
 * Omni does not publish a deadline. Eight minutes covers the background
 * interaction poll and the file poll that follows it. The create POST is
 * bounded separately by `GEMINI_VIDEO_START_TIMEOUT_MS`.
 */
export const GEMINI_VIDEO_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * How long the create POST may sit before we stop waiting. A background
 * interaction returns an id quickly; a hung socket must not occupy the
 * eight-minute poll budget.
 */
export const GEMINI_VIDEO_START_TIMEOUT_MS = 60_000;

/**
 * Shown when Omni reports a safety block. HTTP 400 blocks that return no
 * output are not charged (Interactions safety settings, and the billing note
 * for failed requests that produce no tokens).
 */
export const GEMINI_VIDEO_SAFETY_MESSAGE =
  'Gemini blocked this video for safety. You are not charged when a clip is blocked.';

const GEMINI_VIDEO_MAYBE_STARTED_MESSAGE =
  'Gemini may have started this video. Check AI Studio before trying again, so a second run is not charged.';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

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
  /** Which catalogued model runs. An unknown or absent id falls back to Nano Banana 2.1. */
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
    const feedback = response as { promptFeedback?: { blockReason?: string } };
    const reason = [response.candidates?.[0]?.finishReason, feedback.promptFeedback?.blockReason]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(', ');
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
 * Video generation result from Gemini Omni. `delivery: "uri"` returns a file
 * that is polled until ACTIVE; an inline payload is already the clip.
 */
export interface VideoOperationResult {
  /** File resource name (`files/…`) while a URI delivery is still processing. */
  operation: string;
  /** Whether the clip is ready to download. */
  done: boolean;
  /** File URI if complete, else undefined. */
  videoUri?: string;
  /** Base64 video bytes when the interaction already included them. */
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
  config?: {
    resolution?: string;
    aspectRatio?: string;
    durationSeconds?: number;
  };
  apiKey: string;
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

function readErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  const error = record.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    const message = (error as { message: string }).message.trim();
    if (message) return message;
  }
  return undefined;
}

interface OmniVideoPart {
  data?: string;
  uri?: string;
  mimeType?: string;
}

function videoPart(value: unknown): OmniVideoPart | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const part = value as Record<string, unknown>;
  if (typeof part.type === 'string' && part.type !== 'video') return undefined;
  const data = typeof part.data === 'string' && part.data.length > 0 ? part.data : undefined;
  const uri = typeof part.uri === 'string' && part.uri.trim() ? part.uri.trim() : undefined;
  const mime =
    typeof part.mime_type === 'string'
      ? part.mime_type
      : typeof part.mimeType === 'string'
        ? part.mimeType
        : undefined;
  if (!data && !uri) return undefined;
  return { data, uri, mimeType: mime };
}

/**
 * `output_video` is the SDK convenience field. The REST body puts the same
 * clip on a `model_output` step. Either shape is accepted.
 */
function readOmniVideo(body: unknown): OmniVideoPart | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const direct = videoPart(record.output_video);
  if (direct) return direct;
  if (!Array.isArray(record.steps)) return undefined;
  for (const step of record.steps) {
    if (!step || typeof step !== 'object' || !Array.isArray((step as { content?: unknown }).content)) continue;
    for (const part of (step as { content: unknown[] }).content) {
      const video = videoPart(part);
      if (video) return video;
    }
  }
  return undefined;
}

function fileNameFromUri(uri: string): string | null {
  const match = /\/files\/([^/:?]+)/.exec(uri) ?? /files\/([^/:?]+)/.exec(uri);
  return match ? `files/${match[1]}` : null;
}

function omniDownloadUrl(fileName: string, uri?: string): string {
  if (uri) {
    try {
      const url = new URL(uri);
      if (url.protocol === 'https:' && url.hostname === GEMINI_VIDEO_DOWNLOAD_HOST) return url.toString();
    } catch {
      // Fall through to the documented files download path.
    }
  }
  const id = fileName.replace(/^files\//, '');
  return `https://${GEMINI_VIDEO_DOWNLOAD_HOST}/v1beta/files/${id}:download?alt=media`;
}

function readFileState(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const state = (body as { state?: unknown }).state;
  if (typeof state === 'string') return state;
  if (state && typeof state === 'object' && typeof (state as { name?: unknown }).name === 'string') {
    return (state as { name: string }).name;
  }
  return '';
}

async function readGeminiJson(response: Response, apiKey: string, fallback: string): Promise<unknown> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const fault = readInteractionFault(body);
    if (isSafetyFault(fault)) throw new RouteError(GEMINI_VIDEO_SAFETY_MESSAGE, response.status);
    throw new RouteError(sanitizeGeminiMessage(fault?.message ?? readErrorMessage(body) ?? fallback, fallback, apiKey), response.status);
  }
  return body;
}

/** Documented 5s wait between Omni file polls. Tests replace this with a no-op. */
export function geminiVideoWait(ms: number = GEMINI_VIDEO_POLL_INTERVAL_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Codes that mean a safety filter rejected the prompt or the clip.
 * `safety`, `jailbreak`, `prohibited_content`, and `blocklist` are the
 * Interactions safety-settings codes. `content_blocked` is the code Omni
 * returns for a blocked video (confirmed on the Gemini API forum).
 */
const GEMINI_VIDEO_SAFETY_CODES = new Set([
  'safety',
  'jailbreak',
  'prohibited_content',
  'blocklist',
  'content_blocked',
]);

interface InteractionFault {
  code?: string;
  message?: string;
}

function faultOf(value: unknown): InteractionFault | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' && record.code.trim() ? record.code.trim() : undefined;
  const message = typeof record.message === 'string' && record.message.trim() ? record.message.trim() : undefined;
  if (!code && !message) return undefined;
  return { code, message };
}

/** `error` on an HTTP failure, or the first entry of a background interaction's `errors`. */
function readInteractionFault(body: unknown): InteractionFault | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const direct = faultOf(record.error);
  if (direct) return direct;
  if (!Array.isArray(record.errors)) return undefined;
  for (const item of record.errors) {
    const fault = faultOf(item);
    if (fault) return fault;
  }
  return undefined;
}

function isSafetyFault(fault: InteractionFault | undefined): boolean {
  if (!fault) return false;
  if (fault.code && GEMINI_VIDEO_SAFETY_CODES.has(fault.code)) return true;
  const message = fault.message ?? '';
  return message.startsWith('Input blocked:') || message.startsWith('Request blocked due to safety');
}

function safetyOrMessage(fault: InteractionFault | undefined, fallback: string): string {
  if (isSafetyFault(fault)) return GEMINI_VIDEO_SAFETY_MESSAGE;
  return fault?.message || fallback;
}

/**
 * Turn one Interactions resource into a poll result.
 *
 * `completed` with no video is the only "finished without a video" case.
 * `in_progress`, `queued`, and `requires_action` stay open so the caller
 * keeps the interaction id. `failed` on a background job carries the block
 * in `errors`.
 */
function resultFromInteraction(body: unknown, fallbackId: string): VideoOperationResult {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const status = typeof record.status === 'string' ? record.status : '';
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
  const fault = readInteractionFault(body);
  if (status === 'failed' || status === 'cancelled') {
    return { operation: id, done: true, error: safetyOrMessage(fault, 'Gemini video generation failed.') };
  }
  const video = readOmniVideo(body);
  if (video) return videoResult(id, video);
  if (status === 'completed' || status === 'incomplete') {
    return {
      operation: id,
      done: true,
      error: isSafetyFault(fault) ? GEMINI_VIDEO_SAFETY_MESSAGE : 'Gemini finished without a video. Please try again.',
    };
  }
  if (!id) {
    throw new RouteError(
      'Gemini did not return a job id. The video may still be running. Check AI Studio before trying again.',
      502
    );
  }
  return { operation: id, done: false };
}

function videoResult(operation: string, video: OmniVideoPart): VideoOperationResult {
  if (video.data && !video.uri) {
    return { operation, done: true, videoBytes: video.data, mimeType: video.mimeType };
  }
  const fileName = video.uri ? fileNameFromUri(video.uri) : null;
  if (!fileName) throw new RouteError('Gemini returned an unusable video address.', 502);
  return {
    operation: fileName,
    done: false,
    videoUri: omniDownloadUrl(fileName, video.uri),
    videoBytes: video.data,
    mimeType: video.mimeType,
  };
}

function startFailure(error: unknown, apiKey: string): RouteError {
  if (error instanceof RouteError) return error;
  const name = error instanceof Error ? error.name : '';
  // A dropped socket or an aborted create can land after Google accepted the
  // job. Say so, instead of a "could not start" that invites a second charge.
  if (error instanceof TypeError || name === 'TimeoutError' || name === 'AbortError') {
    return new RouteError(GEMINI_VIDEO_MAYBE_STARTED_MESSAGE, 0);
  }
  return geminiRouteError(error, 'Gemini could not start video generation.', apiKey);
}

/**
 * Start a Gemini Omni video.
 *
 * POST `/v1beta/interactions` with `background: true`. The response is an
 * interaction id, not the finished clip. `store: true` because that id is
 * fetched again; `store: false` is for a unary response that is not retrieved.
 * Duration is an integer from 3 to 10 followed by `s` (`"8s"`). URI delivery
 * avoids the 4MB inline cap.
 */
export async function geminiGenerateVideo(opts: GeminiVideoOpts): Promise<VideoOperationResult> {
  const apiKey = requireGeminiApiKey(opts.apiKey);
  const prompt = opts.prompt.trim();
  if (!prompt) throw new RouteError('Enter a prompt for your video.', 400);

  const model = resolveGeminiVideoModel(opts.model);
  const resolution = geminiVideoResolution(model, opts.config?.resolution);
  const durationSeconds = geminiVideoDuration(model, opts.config?.durationSeconds);
  const aspectRatio = geminiVideoAspectRatio(model, opts.config?.aspectRatio);
  const mimeType = opts.imageMimeType?.trim() || 'image/png';

  try {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(GEMINI_VIDEO_START_TIMEOUT_MS),
      body: JSON.stringify({
        model: model.id,
        input: opts.image
          ? [
              { type: 'image', data: opts.image, mime_type: mimeType },
              { type: 'text', text: prompt },
            ]
          : prompt,
        response_format: {
          type: 'video',
          aspect_ratio: aspectRatio,
          resolution,
          duration: `${durationSeconds}s`,
          delivery: 'uri',
        },
        background: true,
        store: true,
        stream: false,
      }),
    });
    const body = await readGeminiJson(response, apiKey, 'Gemini could not start video generation.');
    return resultFromInteraction(body, '');
  } catch (error) {
    throw startFailure(error, apiKey);
  }
}

async function pollOmniFile(apiKey: string, fileName: string): Promise<VideoOperationResult> {
  const response = await fetch(`https://${GEMINI_VIDEO_DOWNLOAD_HOST}/v1beta/${fileName}`, {
    headers: { 'x-goog-api-key': apiKey },
  });
  const body = await readGeminiJson(response, apiKey, 'Gemini could not check this video job.');
  const state = readFileState(body);
  const fault = readInteractionFault(body);
  const videoUri = omniDownloadUrl(fileName);
  if (state === 'FAILED') {
    return {
      operation: fileName,
      done: true,
      error: safetyOrMessage(fault, readErrorMessage(body) || 'Gemini video generation failed.'),
    };
  }
  if (state === 'ACTIVE') {
    return { operation: fileName, done: true, videoUri };
  }
  return { operation: fileName, done: false, videoUri };
}

async function pollOmniInteraction(apiKey: string, interactionId: string): Promise<VideoOperationResult> {
  const response = await fetch(
    `${GEMINI_INTERACTIONS_URL}/${encodeURIComponent(interactionId)}`,
    { headers: { 'x-goog-api-key': apiKey } }
  );
  const body = await readGeminiJson(response, apiKey, 'Gemini could not check this video job.');
  return resultFromInteraction(body, interactionId);
}

/**
 * Poll a background Omni interaction, then its file.
 *
 * An interaction id is GET `/v1beta/interactions/{id}` until the status is
 * terminal or the clip has a file URI. A `files/…` operation is GET
 * `/v1beta/files/{id}` until `state` is `ACTIVE` or `FAILED`.
 */
export async function geminiPollVideoOperation(
  apiKey: string,
  operationName: string
): Promise<VideoOperationResult> {
  const key = requireGeminiApiKey(apiKey);
  const name = operationName.trim();
  if (!name) throw new RouteError('Missing Gemini video job.', 400);
  const fileName = name.startsWith('files/') ? name : fileNameFromUri(name);

  try {
    if (fileName && (name.startsWith('files/') || name.includes('/files/'))) return await pollOmniFile(key, fileName);
    return await pollOmniInteraction(key, name.replace(/^.*\/interactions\//, '').replace(/[/?].*$/, ''));
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
  opts: { videoBytes?: string; mimeType?: string } = {}
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
