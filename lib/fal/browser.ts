// lib/fal/browser.ts
import type { EditReferencePlan } from '@/lib/providers/edit-references';
import type {
  FalInputMode,
  FalMediaType,
  FalTask,
  FalTaskState,
  FalValue,
} from './types';
import { FAL_IMAGE_MODEL } from '@/lib/fal/catalog';
import { RouteError } from '@/lib/providers/route-error';
import { FAL_JOB_TIMEOUT_MS, isFalJobTerminal, nextFalPollDelay } from './queue';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ROUTE_ERROR = 'fal could not complete that request. Please try again.';
const REQUEST_ABORTED_ERROR = 'fal request was aborted.';
const IMAGE_ABORTED_ERROR = 'fal image generation was aborted.';
const IMAGE_TIMEOUT_ERROR = 'fal image generation timed out after 15 minutes.';
const MAX_REFERENCE_IMAGES = 14;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_PUBLIC_ERROR_LENGTH = 512;
const DATA_URL_ERROR =
  'must be a valid PNG, JPEG, WebP, or AVIF data URL.';
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
]);
const TASK_STATES = new Set<FalTaskState>([
  'queued',
  'running',
  'success',
  'fail',
  'timed_out',
  'cancelled',
]);

type FalTaskRequest = {
  apiKey: string;
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  requestId: string;
};

type FalSubmitRequest = {
  apiKey: string;
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  prompt: string;
  uploadUrls: string[];
  values: Record<string, FalValue>;
  editReferencePlan?: EditReferencePlan;
};

type FalImageRunnerArgs = {
  apiKey: string;
  prompt: string;
  dataUrls: string[];
  values: Record<string, FalValue>;
  /** Catalog id. Omitted runs use the default image model. */
  modelId?: string;
  signal?: AbortSignal;
};

type FalImageRunnerDependencies = {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

type FalRequestOptions = {
  signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeFalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    const isFalCdn = url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media');
    return url.protocol === 'https:' && !url.username && !url.password && isFalCdn;
  } catch {
    return false;
  }
}

function safeErrorMessage(data: unknown, apiKey: string): string {
  if (!isRecord(data) || typeof data.error !== 'string' || !data.error.trim()) {
    return ROUTE_ERROR;
  }
  const message = data.error.trim();
  return safePublicMessage(message, apiKey, ROUTE_ERROR);
}

function safePublicMessage(message: string, apiKey: string, fallback: string): string {
  if (!message || message.length > MAX_PUBLIC_ERROR_LENGTH) return fallback;
  let encodedKey = '';
  try {
    encodedKey = encodeURIComponent(apiKey);
  } catch {
    encodedKey = '';
  }
  const jsonKey = JSON.stringify(apiKey);
  const credentialVariants = [apiKey, encodedKey, jsonKey, jsonKey.slice(1, -1)].filter(Boolean);
  const normalizedMessage = message.toLowerCase();
  if (credentialVariants.some((variant) => normalizedMessage.includes(variant.toLowerCase()))) {
    return fallback;
  }
  return message;
}

async function requestFalRoute(
  path: string,
  init: RequestInit,
  apiKey: string,
  malformedSuccessError = ROUTE_ERROR
): Promise<Record<string, unknown>> {
  if (init.signal?.aborted) throw new Error(REQUEST_ABORTED_ERROR);
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    if (init.signal?.aborted) throw new Error(REQUEST_ABORTED_ERROR);
    // Status 0: the request never left the machine, so nothing was accepted.
    throw new RouteError(ROUTE_ERROR, 0);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (init.signal?.aborted) throw new Error(REQUEST_ABORTED_ERROR);
    throw new RouteError(ROUTE_ERROR, response.status);
  }

  if (!response.ok) {
    throw new RouteError(safeErrorMessage(data, apiKey), response.status);
  }
  if (!isRecord(data) || data.success !== true) {
    if (isRecord(data) && typeof data.error === 'string') {
      throw new Error(safeErrorMessage(data, apiKey));
    }
    throw new Error(malformedSuccessError);
  }
  return data;
}

function jsonPost(body: Record<string, unknown>, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  };
}

function isFalTask(
  value: unknown,
  expectedRequestId: string,
  expectedMediaType: FalMediaType
): value is FalTask {
  if (!isRecord(value)) return false;
  if (
    value.requestId !== expectedRequestId ||
    !REQUEST_ID_PATTERN.test(expectedRequestId) ||
    typeof value.state !== 'string' ||
    !TASK_STATES.has(value.state as FalTaskState) ||
    !Array.isArray(value.logs) ||
    !value.logs.every((log) => typeof log === 'string')
  ) {
    return false;
  }

  if (value.resultUrl !== undefined && !isSafeFalUrl(value.resultUrl)) return false;
  if (value.state === 'success' && !isSafeFalUrl(value.resultUrl)) return false;
  if (
    value.mimeType !== undefined
    && (
      typeof value.mimeType !== 'string'
      || !new RegExp(`^${expectedMediaType}/[a-z0-9][a-z0-9!#$&^_.+-]*$`, 'i').test(value.mimeType)
    )
  ) {
    return false;
  }
  return (
    value.error === undefined || typeof value.error === 'string'
  );
}

export async function uploadFalFiles(
  apiKey: string,
  files: File[],
  options: FalRequestOptions = {}
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    const form = new FormData();
    form.set('apiKey', apiKey);
    form.set('file', file);
    const data = await requestFalRoute(
      '/api/fal/upload',
      { method: 'POST', body: form, ...(options.signal ? { signal: options.signal } : {}) },
      apiKey
    );
    if (!isSafeFalUrl(data.url)) {
      throw new Error('fal did not return a temporary file URL.');
    }
    urls.push(data.url);
  }
  return urls;
}

export async function submitFalJob(
  args: FalSubmitRequest,
  options: FalRequestOptions = {}
): Promise<{ requestId: string }> {
  const data = await requestFalRoute(
    '/api/fal/queue',
    jsonPost({
      operation: 'submit',
      apiKey: args.apiKey,
      modelId: args.modelId,
      mediaType: args.mediaType,
      inputMode: args.inputMode,
      prompt: args.prompt,
      uploadUrls: args.uploadUrls,
      values: args.values,
      ...(args.editReferencePlan ? { editReferencePlan: args.editReferencePlan } : {}),
    }, options.signal),
    args.apiKey
  );
  if (typeof data.requestId !== 'string' || !REQUEST_ID_PATTERN.test(data.requestId)) {
    throw new Error('fal did not return a valid request ID.');
  }
  return { requestId: data.requestId };
}

export async function getFalJobStatus(
  args: FalTaskRequest,
  options: FalRequestOptions = {}
): Promise<FalTask> {
  if (typeof args.requestId !== 'string' || !REQUEST_ID_PATTERN.test(args.requestId)) {
    throw new Error('fal request ID is invalid.');
  }
  const data = await requestFalRoute(
    '/api/fal/queue',
    jsonPost({
      operation: 'status',
      apiKey: args.apiKey,
      modelId: args.modelId,
      mediaType: args.mediaType,
      inputMode: args.inputMode,
      requestId: args.requestId,
    }, options.signal),
    args.apiKey
  );
  if (!isFalTask(data.task, args.requestId, args.mediaType)) {
    throw new Error('fal did not return a valid task status.');
  }
  return data.task;
}

export async function cancelFalJob(
  args: FalTaskRequest,
  options: FalRequestOptions = {}
): Promise<void> {
  if (typeof args.requestId !== 'string' || !REQUEST_ID_PATTERN.test(args.requestId)) {
    throw new Error('fal request ID is invalid.');
  }
  await requestFalRoute(
    '/api/fal/queue',
    jsonPost({
      operation: 'cancel',
      apiKey: args.apiKey,
      modelId: args.modelId,
      mediaType: args.mediaType,
      inputMode: args.inputMode,
      requestId: args.requestId,
    }, options.signal),
    args.apiKey,
    'fal did not confirm the cancellation.'
  );
}

async function dataUrlToFile(
  dataUrl: string,
  index: number,
  signal?: AbortSignal
): Promise<File> {
  const message = `Reference image ${index + 1} ${DATA_URL_ERROR}`;
  const sizeMessage = `Reference image ${index + 1} is larger than 20 MiB.`;
  const mismatchMessage = `Reference image ${index + 1} does not match its declared image type.`;
  const match = /^data:(image\/(?:png|jpeg|webp|avif))(?:;[^,]*)?,/i.exec(dataUrl);
  if (!match) throw new Error(message);
  const encodedLength = dataUrl.length - match[0].length;
  const isBase64 = /;base64(?:;|,)/i.test(match[0]);
  const maxEncodedLength = isBase64
    ? Math.ceil(MAX_REFERENCE_BYTES / 3) * 4
    : MAX_REFERENCE_BYTES * 3;
  if (encodedLength > maxEncodedLength) throw new Error(sizeMessage);

  let blob: Blob;
  try {
    blob = await (await fetch(dataUrl, signal ? { signal } : undefined)).blob();
  } catch {
    throw new Error(message);
  }
  if (blob.size > MAX_REFERENCE_BYTES) throw new Error(sizeMessage);

  const mimeType = blob.type.toLowerCase().split(';', 1)[0].trim();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType) || mimeType !== match[1].toLowerCase()) {
    throw new Error(mismatchMessage);
  }
  const signature = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!matchesImageSignature(mimeType, signature)) throw new Error(mismatchMessage);
  const extension =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/jpeg'
        ? 'jpg'
        : mimeType === 'image/webp'
          ? 'webp'
          : 'avif';
  return new File([blob], `reference-${index + 1}.${extension}`, { type: mimeType });
}

function matchesImageSignature(mimeType: string, bytes: Uint8Array): boolean {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (mimeType === 'image/png') {
    return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === 'image/jpeg') return startsWith([0xff, 0xd8, 0xff]);
  if (mimeType === 'image/webp') {
    return (
      startsWith([0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x61 &&
    bytes[9] === 0x76 &&
    bytes[10] === 0x69 &&
    (bytes[11] === 0x66 || bytes[11] === 0x73)
  );
}

function readTime(now: () => number, fallback: number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function terminalTaskError(task: FalTask, apiKey: string): Error {
  if (task.state === 'cancelled') return new Error('fal image generation was cancelled.');
  if (task.state === 'timed_out') return new Error('fal image generation timed out.');

  const providerMessage = task.error?.trim();
  if (providerMessage) {
    return new Error(safePublicMessage(providerMessage, apiKey, 'fal image generation failed.'));
  }
  return new Error('fal image generation failed.');
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(REQUEST_ABORTED_ERROR));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error(REQUEST_ABORTED_ERROR));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(REQUEST_ABORTED_ERROR));
      return;
    }
    const onAbort = () => reject(new Error(REQUEST_ABORTED_ERROR));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export async function runFalImage(
  args: FalImageRunnerArgs,
  dependencies: FalImageRunnerDependencies = {}
): Promise<{ url: string; mimeType?: string }> {
  const controller = new AbortController();
  let callerAborted = args.signal?.aborted ?? false;
  let deadlineExpired = false;
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  args.signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (callerAborted) controller.abort();
  const deadlineTimer = setTimeout(() => {
    deadlineExpired = true;
    controller.abort();
  }, FAL_JOB_TIMEOUT_MS);

  try {
    if (callerAborted) throw new Error(IMAGE_ABORTED_ERROR);
    const dataUrls = [...args.dataUrls];
    const values = { ...args.values };
    if (dataUrls.length > MAX_REFERENCE_IMAGES) {
      throw new Error('fal accepts at most 14 reference images.');
    }
    const files: File[] = [];
    for (const [index, dataUrl] of dataUrls.entries()) {
      files.push(await dataUrlToFile(dataUrl, index, controller.signal));
    }
    const uploadUrls =
      files.length > 0
        ? await uploadFalFiles(args.apiKey, files, { signal: controller.signal })
        : [];
    const inputMode: FalInputMode = uploadUrls.length > 0 ? 'image' : 'text';
    const selection = {
      apiKey: args.apiKey,
      modelId: args.modelId ?? FAL_IMAGE_MODEL.id,
      mediaType: 'image' as const,
      inputMode,
    };
    const { requestId } = await submitFalJob(
      {
        ...selection,
        prompt: args.prompt,
        uploadUrls,
        values,
      },
      { signal: controller.signal }
    );

    const now = dependencies.now ?? Date.now;
    const startedAt = readTime(now, 0);
    let latestObserved = startedAt;
    let scheduledElapsed = 0;
    let attempt = 0;

    const elapsedTime = () => {
      latestObserved = Math.max(latestObserved, readTime(now, latestObserved));
      const observedElapsed = latestObserved - startedAt;
      const safeObservedElapsed = Number.isFinite(observedElapsed)
        ? Math.max(0, observedElapsed)
        : FAL_JOB_TIMEOUT_MS;
      return Math.max(scheduledElapsed, safeObservedElapsed);
    };

    while (true) {
      let elapsed = elapsedTime();
      if (elapsed >= FAL_JOB_TIMEOUT_MS) throw new Error(IMAGE_TIMEOUT_ERROR);

      const task = await getFalJobStatus(
        { ...selection, requestId },
        { signal: controller.signal }
      );
      elapsed = elapsedTime();
      if (elapsed >= FAL_JOB_TIMEOUT_MS) throw new Error(IMAGE_TIMEOUT_ERROR);

      if (task.state === 'success') {
        if (!isSafeFalUrl(task.resultUrl)) {
          throw new Error('fal completed without a usable image URL.');
        }
        return { url: task.resultUrl, mimeType: task.mimeType };
      }
      if (isFalJobTerminal(task.state)) {
        throw terminalTaskError(task, args.apiKey);
      }

      const remaining = FAL_JOB_TIMEOUT_MS - elapsed;
      const delay = Math.min(nextFalPollDelay(attempt), remaining);
      if (dependencies.sleep) {
        await withAbort(dependencies.sleep(delay), controller.signal);
      } else {
        await defaultSleep(delay, controller.signal);
      }
      scheduledElapsed += delay;
      attempt += 1;
    }
  } catch (error: unknown) {
    if (deadlineExpired) throw new Error(IMAGE_TIMEOUT_ERROR);
    if (callerAborted) throw new Error(IMAGE_ABORTED_ERROR);
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    args.signal?.removeEventListener('abort', onCallerAbort);
    controller.abort();
  }
}

export interface FalJobCostEstimate {
  costUsd: number | null;
  unit?: string;
  quantity?: number;
}

/** Spend readout for a finished job. Resolves to an unknown figure rather than rejecting. */
export async function estimateFalJobCost(args: {
  apiKey: string;
  endpointId: string;
  durationSeconds?: number;
}): Promise<FalJobCostEstimate> {
  try {
    const response = await fetch('/api/fal/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = (await response.json().catch(() => ({}))) as Partial<FalJobCostEstimate> & { success?: boolean };
    if (!response.ok || !data.success) return { costUsd: null };
    return {
      costUsd: typeof data.costUsd === 'number' ? data.costUsd : null,
      ...(typeof data.unit === 'string' ? { unit: data.unit } : {}),
      ...(typeof data.quantity === 'number' ? { quantity: data.quantity } : {}),
    };
  } catch {
    return { costUsd: null };
  }
}
