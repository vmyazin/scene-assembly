import { GoogleGenAI } from '@google/genai';

import { geminiImageSize, resolveGeminiImageModel } from './gemini-catalog';
import {
  geminiVideoResolution,
  geminiVideoDuration,
  geminiVideoAspectRatio,
  resolveGeminiVideoModel,
} from './gemini-video-catalog';

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
  const ai = new GoogleGenAI({ apiKey: opts.apiKey, ...(opts.singleAttempt ? {httpOptions:{retryOptions:{attempts:1}}} : {}) });

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
 * 
 * Note: This is a placeholder implementation. The actual Gemini SDK video API
 * will be integrated in a future update.
 */
export interface VideoOperationResult {
  /** Operation name/ID for polling. */
  operation: string;
  /** Whether the operation is complete. */
  done: boolean;
  /** File URI if complete, else undefined. */
  videoUri?: string;
  /** Error message if failed, else undefined. */
  error?: string;
}

interface GeminiVideoOpts {
  /** Which catalogued video model runs. Unknown or absent ID falls back to default. */
  model?: string;
  prompt: string;
  /** Reference image for image-to-video mode (base64, no data: prefix). */
  image?: string;
  /** Durable callers must never inherit the SDK's default paid retries. */
  singleAttempt?: boolean;
  config?: {
    resolution?: string;
    aspectRatio?: string;
    durationSeconds?: number;
  };
  apiKey: string;
}

/**
 * Start a Gemini video generation job.
 * 
 * Note: Placeholder implementation - will be completed with actual SDK integration.
 */
export async function geminiGenerateVideo(opts: GeminiVideoOpts): Promise<VideoOperationResult> {
  // Placeholder - actual SDK integration coming soon
  throw new Error('Gemini video generation SDK integration in progress. Use other providers for now.');
}

/**
 * Poll a Gemini video generation operation.
 * 
 * Note: Placeholder implementation - will be completed with actual SDK integration.
 */
export async function geminiPollVideoOperation(
  apiKey: string,
  operationName: string
): Promise<VideoOperationResult> {
  // Placeholder - actual SDK integration coming soon
  throw new Error('Video polling not yet implemented');
}

/**
 * Download a completed Gemini video.
 * 
 * Note: Placeholder implementation - will be completed with actual SDK integration.
 */
export async function geminiDownloadVideo(
  apiKey: string,
  videoUri: string
): Promise<Blob> {
  // Placeholder - actual SDK integration coming soon
  throw new Error('Video download not yet implemented');
}
