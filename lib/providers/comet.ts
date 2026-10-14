// lib/providers/comet.ts
import { applyProviderModeration } from '../moderation/capabilities';
import { effectiveModerationLevel } from '../moderation/floors';
import {
  ProviderError,
  readableProviderError,
  type ImageRequest,
  type ImageResult,
  type ProviderAdapter,
  type ProviderTask,
  type VideoRequest,
} from './types';
import {
  COMET_IMAGE_DIMENSIONS,
  COMET_VIDEO_DIMENSIONS,
  ratioDimensions,
  type Dimensions,
} from './output-size';

/**
 * CometAPI — OpenAI-compatible for images, and a single multipart route for
 * every video family (Seedance, Veo, Kling, Wan, Sora all submit to /v1/videos
 * and poll /v1/videos/{id}).
 *
 * Contract read from https://apidoc.cometapi.com on 2026-08-16:
 * /api/image/openai/images.md, /api/video/seedance/{create,query}.md.
 */
export const COMET_API = 'https://api.cometapi.com';

/**
 * OpenAI-style sizes: a literal WxH, not a ratio. Both tables live in
 * `output-size.ts` so the size controls can name the pixels a ratio resolves
 * to; only the `WxH` spelling belongs here.
 */
const sizeString = (
  table: Record<string, Dimensions>,
  aspectRatio: string | undefined,
  fallback?: string
): string => {
  const [width, height] = ratioDimensions(table, aspectRatio, fallback);
  return `${width}x${height}`;
};

interface CometImageEnvelope {
  output_format?: string;
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
}

interface CometVideoEnvelope {
  id?: string;
  status?: string;
  progress?: number;
  video_url?: string;
  error?: { message?: string } | string;
}

function errorText(payload: { error?: { message?: string } | string }, status: number): string {
  if (typeof payload.error === 'string') return payload.error;
  return payload.error?.message ?? `CometAPI returned ${status}.`;
}

export async function cometGenerateImage(request: ImageRequest): Promise<ImageResult> {
  const images = request.images ?? [];
  const hasReferences = images.length > 0;
  const body = applyProviderModeration(
    {
      model: request.model,
      prompt: request.prompt,
      // Documented constraint: qwen-image rejects n > 1, and one image per run is
      // what this UI asks for anyway.
      n: 1,
      size: sizeString(COMET_IMAGE_DIMENSIONS, request.aspectRatio),
    },
    {
      provider: 'comet',
      modelId: request.model,
      level: effectiveModerationLevel({ level: request.moderation, prompt: request.prompt, hasReferences }),
      hasReferences,
    }
  );
  const response = await fetch(`${COMET_API}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as CometImageEnvelope;
  if (!response.ok) {
    throw new ProviderError(
      readableProviderError('comet', response.status, errorText(payload, response.status)),
      response.status,
      'comet'
    );
  }

  const first = payload.data?.[0];
  // GPT image models answer with base64 and ignore response_format; others hand
  // back a URL. Take whichever arrived.
  if (first?.b64_json) return { base64: first.b64_json, mimeType: payload.output_format === 'jpeg' ? 'image/jpeg' : payload.output_format === 'webp' ? 'image/webp' : 'image/png' };
  if (first?.url) return { url: first.url };
  throw new ProviderError('CometAPI accepted the request but returned no image.', 502, 'comet');
}

/** Runway's `videoUri` data-URI ceiling, in characters, from the official schema. */
export const ALEPH_DATA_URI_MAX = 5_242_880;

/** Encoded length of `data:<mime>;base64,…` for `bytes` of source video. */
export function alephDataUriLength(bytes: number, mime: string): number {
  return `data:${mime};base64,`.length + Math.ceil(Math.max(0, bytes) / 3) * 4;
}

/** https URL up to 2,048 characters, or a video data URI within the schema cap. */
export function isAlephVideoUri(value: string): boolean {
  const https = /^https:\/\/\S+$/.test(value) && value.length <= 2048;
  const data = /^data:video\/[^;]+;base64,/.test(value) && value.length <= ALEPH_DATA_URI_MAX;
  return https || data;
}

function alephVideoUri(value: string | undefined): string {
  if (!value || !isAlephVideoUri(value)) throw new ProviderError('Aleph 2 needs an https video URL, or a data URI up to 5 MB.', 400, 'comet');
  return value;
}

export async function cometCreateVideo(request: VideoRequest): Promise<{ taskId: string }> {
  if (request.model === 'aleph2' && request.inputMode === 'edit') {
    const prompt = request.prompt.trim();
    if (prompt.length > 1000) throw new ProviderError('Aleph 2 prompts are at most 1,000 characters.', 400, 'comet');
    const body: Record<string, string> = { model: 'aleph2', videoUri: alephVideoUri(request.sourceVideo) };
    if (prompt) body.promptText = prompt;
    if (request.aspectRatio) body.targetAspectRatio = request.aspectRatio;
    const response = await fetch(`${COMET_API}/runwayml/v1/video_to_video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as CometVideoEnvelope & { failure?: string };
    if (!response.ok || !payload.id) {
      throw new ProviderError(
        readableProviderError('comet', response.status, errorText(payload, response.status) || payload.failure || ''),
        response.ok ? 502 : response.status,
        'comet'
      );
    }
    return { taskId: payload.id };
  }
  // The video route is multipart even without a file: the vendor's own examples
  // send every field as form data.
  const form = new FormData();
  form.set('model', request.model);
  form.set('prompt', request.prompt);
  if (request.durationSeconds !== undefined) form.set('seconds', String(request.durationSeconds));
  // The vendor documents exact WxH pairs per model; a resolved one wins. Video
  // falls back to landscape, not to the square an image request defaults to.
  form.set(
    'size',
    request.resolution ?? sizeString(COMET_VIDEO_DIMENSIONS, request.aspectRatio, '16:9')
  );

  const reference = request.images?.[0];
  if (reference) {
    form.set('input_reference', dataUrlToBlob(reference), 'reference.png');
  }

  const response = await fetch(`${COMET_API}/v1/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.apiKey}` },
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as CometVideoEnvelope;
  if (!response.ok || !payload.id) {
    throw new ProviderError(
      readableProviderError('comet', response.status, errorText(payload, response.status)),
      response.ok ? 502 : response.status,
      'comet'
    );
  }
  return { taskId: payload.id };
}

/** Runway tasks are a different route and vocabulary from `/v1/videos`. */
export async function cometPollRunway(args: { apiKey: string; taskId: string }): Promise<ProviderTask> {
  const response = await fetch(`${COMET_API}/runwayml/v1/tasks/${encodeURIComponent(args.taskId)}`, {
    headers: { Authorization: `Bearer ${args.apiKey}` },
  });
  const payload = (await response.json().catch(() => ({}))) as CometVideoEnvelope & {
    output?: string[];
    failure?: string;
    failureCode?: string;
  };
  if (!response.ok) {
    throw new ProviderError(
      readableProviderError('comet', response.status, errorText(payload, response.status)),
      response.status,
      'comet'
    );
  }
  if (payload.status === 'SUCCEEDED') {
    return { taskId: args.taskId, state: 'success', progress: 1, urls: Array.isArray(payload.output) ? payload.output.filter((url) => typeof url === 'string') : [] };
  }
  if (payload.status === 'FAILED' || payload.status === 'CANCELLED') {
    return { taskId: args.taskId, state: 'error', urls: [], error: payload.failure || (payload.status === 'CANCELLED' ? 'CometAPI cancelled this edit.' : 'CometAPI could not finish this edit.') };
  }
  return {
    taskId: args.taskId,
    state: payload.status === 'RUNNING' ? 'running' : 'queued',
    progress: typeof payload.progress === 'number' ? Math.min(1, payload.progress) : undefined,
    urls: [],
  };
}

export async function cometPollVideo(args: { apiKey: string; taskId: string }): Promise<ProviderTask> {
  const response = await fetch(`${COMET_API}/v1/videos/${encodeURIComponent(args.taskId)}`, {
    headers: { Authorization: `Bearer ${args.apiKey}` },
  });
  const payload = (await response.json().catch(() => ({}))) as CometVideoEnvelope;
  if (!response.ok) {
    throw new ProviderError(
      readableProviderError('comet', response.status, errorText(payload, response.status)),
      response.status,
      'comet'
    );
  }

  const progress = typeof payload.progress === 'number' ? Math.min(1, payload.progress / 100) : undefined;
  if (payload.status === 'completed') {
    return {
      taskId: args.taskId,
      state: 'success',
      progress: 1,
      urls: payload.video_url ? [payload.video_url] : [],
    };
  }
  // The vendor documents two terminal failures: a rejected task and an internal
  // error. Neither will move again, so both end the poll.
  if (payload.status === 'failed' || payload.status === 'error') {
    return {
      taskId: args.taskId,
      state: 'error',
      urls: [],
      error: errorText(payload, 502),
    };
  }
  return {
    taskId: args.taskId,
    state: payload.status === 'in_progress' ? 'running' : 'queued',
    progress,
    urls: [],
  };
}

/** `data:image/png;base64,…` → Blob, for the multipart reference upload. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'image/png';
  const binary = Uint8Array.from(atob(encoded ?? ''), char => char.charCodeAt(0));
  return new Blob([binary], { type: mime });
}

export const cometAdapter: ProviderAdapter = {
  id: 'comet',
  label: 'CometAPI',
  generateImage: cometGenerateImage,
  createVideo: cometCreateVideo,
  pollVideo: cometPollVideo,
};
