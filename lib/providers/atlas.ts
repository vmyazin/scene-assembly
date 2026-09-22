// lib/providers/atlas.ts
import {
  ProviderError,
  readableProviderError,
  type ImageRequest,
  type ImageResult,
  type ProviderAdapter,
  type ProviderTask,
  type VideoInputField,
  type VideoRequest,
} from './types';
import {
  ATLAS_GPT_IMAGE_DIMENSIONS,
  ATLAS_IMAGE_DIMENSIONS,
  ATLAS_SEEDREAM_DIMENSIONS,
  isGptImage25,
  isNanoBanana2,
  isSeedream,
  ratioDimensions,
} from './output-size';
import { resolveSize } from './catalog';

/**
 * Atlas Cloud — submit returns a prediction id, then you poll one endpoint for
 * every modality. Images and video differ only in which submit route you hit.
 *
 * Contract read from https://atlascloud.ai/docs/models/{image,video} and the
 * per-model machine-readable references at
 * https://www.atlascloud.ai/models/{model}/llms.txt on 2026-08-16.
 */
export const ATLAS_API = 'https://api.atlascloud.ai/api/v1';

/**
 * Atlas is an aggregator, so a request body is the upstream model's, not one of
 * its own: the same idea wears a different field name per model, and a name the
 * model does not know is dropped in silence rather than rejected. Everything
 * from here to the adapter is quoted from a model's own parameter reference.
 *
 * The two size tables live in `output-size.ts`, with the reasons Seedream needs
 * its own, so the size controls can name the pixels a ratio resolves to without
 * a second copy of the numbers. Atlas writes a size with a star, not an x
 * ("1024*1024"), and that formatting is the only part that belongs here.
 */
function imageSize(model: string, aspectRatio: string | undefined): string {
  const table = isSeedream(model) ? ATLAS_SEEDREAM_DIMENSIONS : ATLAS_IMAGE_DIMENSIONS;
  const [width, height] = ratioDimensions(table, aspectRatio);
  return `${width}*${height}`;
}

/** `image` is what the FLUX endpoints take; Seedream's editor takes an array. */
function imageReferenceFields(model: string, images: string[]): Record<string, unknown> {
  if (images.length === 0) return {};
  // Seedream's text-to-image endpoint has no image field at all, so a reference
  // carried over from another model is dropped instead of sent and rejected.
  if (isSeedream(model)) return model.endsWith('/edit') ? { images } : {};
  return { image: images[0] };
}

/**
 * The submit body, in the dialect the chosen model speaks.
 *
 * This dispatch is the whole reason the newer families work. Atlas validates
 * against the upstream model's schema and **drops a field that schema does not
 * name, in silence** — so a Nano Banana request carrying the older `size` does
 * not fail, it succeeds at the default 1:1 1K and ignores every control on
 * screen. Each branch sends only names quoted from that endpoint's own
 * published input schema.
 */
function imageBody(request: ImageRequest): Record<string, unknown> {
  const { model, prompt } = request;
  const images = request.images ?? [];
  const base = { model, prompt };

  if (isNanoBanana2(model)) {
    // No `size` and no `num_images` here: this family takes a shape and a
    // billing tier. The tier is resolved through the catalog so an unknown or
    // absent choice lands on the model's first published size (`1k`) rather
    // than on a tier Lite does not offer.
    const tier = resolveSize('atlas', model, request.resolution)?.preset;
    return {
      ...base,
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      ...(tier ? { resolution: tier } : {}),
      ...(images.length ? { images } : {}),
    };
  }

  if (isGptImage25(model)) {
    // OpenAI's spelling throughout: `size` as `WIDTHxHEIGHT` from a fixed enum
    // (an `x`, where Atlas's other image models take a star), and `n` rather
    // than `num_images`.
    const [width, height] = ratioDimensions(ATLAS_GPT_IMAGE_DIMENSIONS, request.aspectRatio);
    return {
      ...base,
      size: `${width}x${height}`,
      n: 1,
      ...(images.length ? { images } : {}),
    };
  }

  return {
    ...base,
    size: imageSize(model, request.aspectRatio),
    num_images: 1,
    ...imageReferenceFields(model, images),
  };
}

/**
 * Seedance 2.0 renamed the aspect field to `ratio` and 2.5 kept that name;
 * Seedance v1 and everything else here still call it `aspect_ratio`. A name
 * the model does not know is dropped in silence, so a 2.5 request sent with
 * the v1 spelling would come back in the wrong shape rather than fail.
 */
const ratioField = (model: string) =>
  /^bytedance\/seedance-2\./.test(model) || model.startsWith('minimax/h3') ? 'ratio' : 'aspect_ratio';

/**
 * A first frame with an optional closing frame (`image` / `last_image`), or a
 * set of subject references (`reference_images`) — which one is decided by the
 * catalog's declared input field, never by how many images happened to arrive.
 */
function videoImageFields(
  model: string,
  field: VideoInputField | undefined,
  images: string[]
): Record<string, unknown> {
  if (images.length === 0) return {};
  // MiniMax H3 renames both of these. Its references are objects rather than
  // bare URLs, and `type` is sent explicitly even though the schema calls it
  // optional: it is inferred from the URL extension, and these arrive as data
  // URLs, which have none.
  if (model.startsWith('minimax/h3')) {
    if (field === 'referenceImages') {
      return { refers: images.map((url) => ({ url, type: 'image' })) };
    }
    const [opening, closing] = images;
    return { image: opening, ...(closing ? { end_image: closing } : {}) };
  }
  if (field === 'referenceImages') return { reference_images: images };
  const [first, last] = images;
  return { image: first, ...(last ? { last_image: last } : {}) };
}

interface AtlasSubmitEnvelope {
  code?: string | number;
  msg?: string;
  message?: string;
  data?: { id?: string } | null;
}

interface AtlasPrediction {
  id?: string;
  status?: 'queued' | 'processing' | 'succeeded' | 'failed' | string;
  output?: string[] | null;
  outputs?: string[] | null;
  error?: string | null;
  logs?: string;
}

async function atlasFetch<T>(url: string, apiKey: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    msg?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    const raw = payload.msg || payload.message || payload.error || `Atlas Cloud returned ${response.status}.`;
    throw new ProviderError(readableProviderError('atlas', response.status, raw), response.status, 'atlas');
  }
  return payload;
}

async function submit(
  apiKey: string,
  path: 'generateImage' | 'generateVideo',
  body: Record<string, unknown>
): Promise<string> {
  const payload = await atlasFetch<AtlasSubmitEnvelope>(`${ATLAS_API}/model/${path}`, apiKey, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const id = payload.data?.id;
  if (!id) {
    throw new ProviderError('Atlas Cloud accepted the request but returned no prediction ID.', 502, 'atlas');
  }
  return id;
}

async function readPrediction(apiKey: string, id: string): Promise<ProviderTask> {
  const payload = await atlasFetch<AtlasPrediction & {data?: AtlasPrediction}>(`${ATLAS_API}/model/prediction/${encodeURIComponent(id)}`, apiKey);
  // Current API wraps predictions in data; retain the original flat response
  // for older model endpoints. Both guest and durable jobs use this parser.
  const prediction = payload.data ?? payload;
  const urls = (prediction.outputs ?? prediction.output ?? []).filter((url): url is string => typeof url === 'string' && url.length > 0);

  if (prediction.status === 'succeeded' || prediction.status === 'completed') {
    return { taskId: id, state: 'success', progress: 1, urls };
  }
  if (prediction.status === 'failed') {
    return {
      taskId: id,
      state: 'error',
      urls: [],
      // `logs` is where Atlas puts the reason; it is often the only detail.
      error: prediction.error?.trim() || prediction.logs?.trim() || 'Atlas Cloud could not finish this generation.',
    };
  }
  return { taskId: id, state: prediction.status === 'processing' ? 'running' : 'queued', urls };
}

/**
 * Images are async here too, but they finish in seconds — so the image path
 * polls inside the request rather than making the browser own a job. The cap
 * keeps a stuck prediction from holding the route open indefinitely.
 */
const IMAGE_POLL_ATTEMPTS = 40;
const IMAGE_POLL_INTERVAL_MS = 1500;

export async function atlasCreateImage(request: ImageRequest): Promise<{ taskId: string }> {
  const id = await submit(request.apiKey, 'generateImage', imageBody(request));
  return { taskId: id };
}

export async function atlasGenerateImage(
  request: ImageRequest,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<ImageResult> {
  const { taskId: id } = await atlasCreateImage(request);

  for (let attempt = 0; attempt < IMAGE_POLL_ATTEMPTS; attempt += 1) {
    const task = await readPrediction(request.apiKey, id);
    if (task.state === 'success' && task.urls[0]) return { url: task.urls[0] };
    if (task.state === 'error') throw new ProviderError(task.error ?? 'Atlas Cloud failed.', 502, 'atlas');
    await sleep(IMAGE_POLL_INTERVAL_MS);
  }
  throw new ProviderError('Atlas Cloud is still working on this image. Try again in a moment.', 504, 'atlas');
}

export async function atlasCreateVideo(request: VideoRequest): Promise<{ taskId: string }> {
  const taskId = await submit(request.apiKey, 'generateVideo', {
    model: request.model,
    prompt: request.prompt,
    ...videoImageFields(request.model, request.inputField, request.images ?? []),
    ...(request.durationSeconds ? { duration: request.durationSeconds } : {}),
    ...(request.resolution ? { resolution: request.resolution } : {}),
    ...(request.aspectRatio ? { [ratioField(request.model)]: request.aspectRatio } : {}),
  });
  return { taskId };
}

export function atlasPollVideo(args: { apiKey: string; taskId: string }): Promise<ProviderTask> {
  return readPrediction(args.apiKey, args.taskId);
}

export const atlasAdapter: ProviderAdapter = {
  id: 'atlas',
  label: 'Atlas Cloud',
  generateImage: (request) => atlasGenerateImage(request),
  createVideo: atlasCreateVideo,
  pollVideo: atlasPollVideo,
};
