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

export async function cometCreateVideo(request: VideoRequest): Promise<{ taskId: string }> {
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
