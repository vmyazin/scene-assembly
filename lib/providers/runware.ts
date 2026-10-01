// lib/providers/runware.ts
import {
  ProviderError,
  readableProviderError,
  type ImageRequest,
  type ImageResult,
  type ProviderAdapter,
  type ProviderTask,
  type VideoRequest,
} from './types';
import { RUNWARE_IMAGE_DIMENSIONS, ratioDimensions, type Dimensions } from './output-size';

/**
 * Runware — one endpoint, one shape: every request is an array of task objects
 * carrying a `taskType` and a `taskUUID` you generate, and every response echoes
 * that UUID back. Images run synchronously; video is submitted with
 * `deliveryMethod: "async"` and collected with a `getResponse` task.
 *
 * Contract read from https://runware.ai/docs (llms.txt + model pages) on
 * 2026-08-16; see the spec for the quoted request/response bodies.
 */
export const RUNWARE_API = 'https://api.runware.ai/v1';

interface RunwareEnvelope {
  data?: Array<Record<string, unknown>>;
  errors?: Array<{ code?: string; message?: string; parameter?: string; additionalDetails?: {responseContent?: string} }>;
}

/**
 * Dimensions must be multiples of 64 and paired. The table lives in
 * `output-size.ts` so the size controls can name the pixels a ratio resolves
 * to; a second copy would drift from what is sent here.
 */
function dimensionsFor(aspectRatio?: string): Dimensions {
  return ratioDimensions(RUNWARE_IMAGE_DIMENSIONS, aspectRatio);
}

/** https://runware.ai/docs/models/google-veo-3-1-lite — the AIR the API takes. */
export const RUNWARE_VEO_LITE_MODEL = 'google:veo@3.1-lite';

/**
 * Shown instead of a generic outage. Runware documents limited provider-side
 * capacity for this model, and a 503 would otherwise read as "temporarily
 * unavailable" and be sent again on its own.
 */
export const RUNWARE_VEO_LITE_CAPACITY_MESSAGE =
  'Veo 3.1 Lite has no free capacity on Runware right now. Availability for this model is limited, so the request was not started. Try again later, or pick another video model.';

const VEO_LITE_DURATIONS = new Set([4, 6, 8]);
const VEO_LITE_ASPECTS = new Set(['16:9', '9:16']);
/** Width×height pairs from the model page, and the resolution tier they belong to. */
const VEO_LITE_DIMENSIONS: Record<string, '720p' | '1080p'> = {
  '1280x720': '720p',
  '720x1280': '720p',
  '1920x1080': '1080p',
  '1080x1920': '1080p',
};

const CAPACITY_CODES = new Set(['noAvailableServer', 'modelUnavailable', 'modelNotReady', 'modelDisabled']);

function isRunwareCapacityFailure(status: number, error?: { code?: string; message?: string }): boolean {
  if (status === 503) return true;
  const code = error?.code ?? '';
  if (CAPACITY_CODES.has(code)) return true;
  const text = `${code} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('capacity') || text.includes('no available server') || text.includes('model unavailable');
}

/**
 * Lite's compatibility rules are not the generic video task. Text and a single
 * frame image go out as a published width/height. Two frames cannot be sent
 * with width/height — the page says that combination is rejected — so those
 * runs use the resolution tier instead. Audio is `providerSettings.google`.
 */
function applyVeoLiteTask(
  task: Record<string, unknown>,
  request: VideoRequest,
  width: number,
  height: number
): void {
  if (request.durationSeconds !== undefined && !VEO_LITE_DURATIONS.has(request.durationSeconds)) {
    throw new ProviderError('Veo 3.1 Lite accepts only 4, 6, or 8 seconds.', 400, 'runware');
  }
  if (request.aspectRatio !== undefined && !VEO_LITE_ASPECTS.has(request.aspectRatio)) {
    throw new ProviderError('Veo 3.1 Lite accepts only 16:9 or 9:16.', 400, 'runware');
  }
  const fromPixels = VEO_LITE_DIMENSIONS[`${width}x${height}`];
  const fromPreset = request.resolution === '720p' || request.resolution === '1080p' ? request.resolution : undefined;
  const tier = fromPixels ?? fromPreset;
  if (!tier) {
    throw new ProviderError('Veo 3.1 Lite accepts only 720p or 1080p at 16:9 or 9:16.', 400, 'runware');
  }
  const frames = request.images?.length ?? 0;
  if (frames >= 2) {
    delete task.width;
    delete task.height;
    task.resolution = tier;
  } else if (!fromPixels) {
    throw new ProviderError('Veo 3.1 Lite accepts only 720p or 1080p at 16:9 or 9:16.', 400, 'runware');
  } else {
    delete task.resolution;
    task.width = width;
    task.height = height;
  }
  if (typeof request.audio === 'boolean') {
    task.providerSettings = { google: { generateAudio: request.audio } };
  }
}

async function runwareFetch(apiKey: string, tasks: Array<Record<string, unknown>>): Promise<RunwareEnvelope> {
  const response = await fetch(RUNWARE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tasks),
  });

  const payload = (await response.json().catch(() => ({}))) as RunwareEnvelope;
  // Runware reports task-level failures in `errors` with a 200, so the status
  // alone never tells you whether the work happened.
  const firstError = payload.errors?.[0];
  if (!response.ok || firstError) {
    const detail = firstError?.additionalDetails?.responseContent;
    const raw = [firstError?.message, typeof detail === 'string' ? detail : undefined].filter(Boolean).join(' ') || `Runware returned ${response.status}.`;
    const model = tasks.find((task) => typeof task.model === 'string')?.model;
    // 422 is not a retryable status. A 503 here would be sent again on its own
    // and the countdown would hide the sentence that says why it stopped.
    if (model === RUNWARE_VEO_LITE_MODEL && isRunwareCapacityFailure(response.ok ? 0 : response.status, firstError)) {
      throw new ProviderError(RUNWARE_VEO_LITE_CAPACITY_MESSAGE, 422, 'runware');
    }
    throw new ProviderError(
      readableProviderError('runware', response.status, raw),
      response.ok ? 400 : response.status,
      'runware'
    );
  }
  return payload;
}

function taskUUID(): string {
  return crypto.randomUUID();
}

function imageTask(request: ImageRequest, uuid: string): Record<string, unknown> {
  const [width, height] = dimensionsFor(request.aspectRatio);
  const references = (request.images ?? []).slice(0, 4);
  const task: Record<string, unknown> = {
    taskType: 'imageInference',
    taskUUID: uuid,
    model: request.model,
    positivePrompt: request.prompt,
    width,
    height,
    numberResults: 1,
    includeCost: true,
  };

  if (references.length > 0) {
    // Two different input shapes, per model: the editing models (FLUX.2,
    // Qwen-Image-Edit-Plus) require referenceImages and have no seedImage,
    // while the older checkpoints start from seedImage and treat the rest as
    // reference. Sending the wrong field is rejected outright.
    task.inputs =
      request.imageInput === 'reference'
        ? { referenceImages: references }
        : {
            seedImage: references[0],
            ...(references.length > 1 ? { referenceImages: references.slice(1) } : {}),
          };
  }

  return task;
}

export async function runwareCreateImage(request: ImageRequest): Promise<{taskId: string}> {
  const uuid = taskUUID();
  await runwareFetch(request.apiKey, [{...imageTask(request, uuid), deliveryMethod: 'async'}]);
  return {taskId: uuid};
}

export async function runwareGenerateImage(request: ImageRequest): Promise<ImageResult> {
  const payload = await runwareFetch(request.apiKey, [imageTask(request, taskUUID())]);
  const first = payload.data?.[0] ?? {};
  const url = typeof first.imageURL === 'string' ? first.imageURL : undefined;
  if (!url) {
    throw new ProviderError('Runware accepted the task but returned no image.', 502, 'runware');
  }
  return { url, cost: typeof first.cost === 'number' ? first.cost : undefined };
}

export async function runwareCreateVideo(request: VideoRequest, uuid = taskUUID()): Promise<{ taskId: string }> {
  if (request.inputMode === 'edit' && request.model === 'prunaai:p-video@edit') {
    if (!request.sourceVideo || request.resolution !== undefined || request.durationSeconds !== undefined || request.width !== undefined || request.height !== undefined || request.aspectRatio !== undefined || request.audio !== undefined || (request.draft !== undefined && typeof request.draft !== 'boolean') || (request.images?.length ?? 0) > 4) throw new ProviderError('Invalid P-Video-Edit settings.', 400, 'runware');
    await runwareFetch(request.apiKey, [{
      taskType: 'videoInference', taskUUID: uuid, model: request.model,
      positivePrompt: request.prompt,
      inputs: {video: request.sourceVideo, ...(request.images?.length ? {referenceImages: request.images} : {})},
      settings: {draft: request.draft === true},
      deliveryMethod: 'async', includeCost: true, outputFormat: 'MP4',
    }]);
    return {taskId: uuid};
  }
  if (request.inputMode === 'edit') {
    if (request.draft !== undefined || request.model !== 'bytedance:seedance@2.5' || !request.sourceVideo || !['480p', '720p'].includes(request.resolution ?? '')) throw new ProviderError('Invalid video edit settings.', 400, 'runware');
    await runwareFetch(request.apiKey, [{
      taskType: 'videoInference', taskUUID: uuid, model: request.model,
      positivePrompt: request.prompt, inputs: {video: request.sourceVideo, ...(request.images?.length ? {referenceImages: request.images} : {})},
      settings: {operation: 'edit'}, duration: 'auto', resolution: request.resolution,
      deliveryMethod: 'async', includeCost: true, outputFormat: 'MP4',
    }]);
    return {taskId: uuid};
  }
  // Video models publish a table of exact sizes and reject anything outside it,
  // so the caller's resolved pair wins over any ratio-derived guess.
  const [width, height] =
    request.width && request.height
      ? [request.width, request.height]
      : dimensionsFor(request.aspectRatio ?? '16:9');
  const frames = request.images ?? [];
  const task: Record<string, unknown> = {
    taskType: 'videoInference',
    taskUUID: uuid,
    model: request.model,
    positivePrompt: request.prompt,
    deliveryMethod: 'async',
    includeCost: true,
  };
  // Models with attached reference media can expose a resolution tier instead
  // of a fixed pixel pair. Runware rejects sending both forms together.
  if (request.resolution) task.resolution = request.resolution;
  else {
    task.width = width;
    task.height = height;
  }
  // Only when the caller resolved one: models list the lengths they accept, and
  // a model that counts frames instead has no duration parameter to reject.
  if (request.durationSeconds !== undefined) task.duration = request.durationSeconds;
  if (frames.length > 0) {
    // The route resolves this field from the catalog. Legacy callers omit it
    // and retain the historical frameImages behavior.
    task.inputs = { [request.inputField ?? 'frameImages']: frames };
  }
  if (request.model === RUNWARE_VEO_LITE_MODEL) applyVeoLiteTask(task, request, width, height);

  await runwareFetch(request.apiKey, [task]);
  // The submit acknowledgment carries no separate job id: the taskUUID we
  // generated *is* the handle, and getResponse polls on it.
  return { taskId: uuid };
}

async function runwarePoll(args: { apiKey: string; taskId: string }, output: 'imageURL' | 'videoURL'): Promise<ProviderTask> {
  const payload = await runwareFetch(args.apiKey, [
    { taskType: 'getResponse', taskUUID: args.taskId },
  ]);
  const first = payload.data?.[0] ?? {};
  const status = typeof first.status === 'string' ? first.status : undefined;
  const url = typeof first[output] === 'string' ? first[output] as string : undefined;

  // A finished task drops `status` and just carries the media, so a URL is the
  // real terminal signal.
  if (url) {
    return {
      taskId: args.taskId,
      state: 'success',
      progress: 1,
      urls: [url],
      cost: typeof first.cost === 'number' ? first.cost : undefined,
    };
  }
  if (status === 'error') {
    return {
      taskId: args.taskId,
      state: 'error',
      urls: [],
      error: typeof first.message === 'string' ? first.message : 'Runware could not finish this video.',
    };
  }

  const progress = typeof first.progress === 'number' ? first.progress : undefined;
  return {
    taskId: args.taskId,
    state: status === 'processing' ? 'running' : 'queued',
    // The vendor reports progress as a percentage; the app's job UI wants 0–1.
    progress: progress !== undefined ? Math.min(1, progress / 100) : undefined,
    urls: [],
  };
}

export function runwarePollImage(args: {apiKey: string; taskId: string}): Promise<ProviderTask> {
  return runwarePoll(args, 'imageURL');
}

export function runwarePollVideo(args: {apiKey: string; taskId: string}): Promise<ProviderTask> {
  return runwarePoll(args, 'videoURL');
}

export const runwareAdapter: ProviderAdapter = {
  id: 'runware',
  label: 'Runware',
  generateImage: runwareGenerateImage,
  createVideo: runwareCreateVideo,
  pollVideo: runwarePollVideo,
};

/** Best-effort cleanup after a terminal edit; never delete while a job is pending. */
export async function runwareDeleteMedia(apiKey: string, media: string): Promise<void> {
  await runwareFetch(apiKey, [{taskType: 'mediaStorage', taskUUID: taskUUID(), operation: 'delete', media}]);
}

export async function runwareStoreMedia(apiKey: string, media: string): Promise<string> {
  const payload = await runwareFetch(apiKey, [{taskType: 'mediaStorage', taskUUID: taskUUID(), operation: 'upload', media}]);
  const id = payload.data?.[0]?.mediaUUID;
  if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) throw new ProviderError('Runware did not return a source video ID.', 502, 'runware');
  return id;
}
