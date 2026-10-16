// cloud/src/edit-source-limits.ts
/**
 * Per-model edit-source limits, before a job reserves storage.
 *
 * The source picker already checks bytes, duration and frame size. An agent
 * can stage under the global upload cap and still miss a model's own ceiling —
 * Kling O1 is 3–10s and 720–2160px, Aleph 2 is 30s. Bytes come from the upload
 * row. Duration and frame size come from `readContainerVideo`. A model that
 * sets `requireMeasurement` is refused when the file cannot be read, so the
 * reservation never starts. Seedance leaves that flag off: its draft pricer
 * is the path that already refuses an unreadable clip, and a 3-byte fixture
 * still exercises the rest of the edit pipeline.
 */
import type { CloudJobRequest } from '../../lib/account/contracts';
import { readContainerVideo } from '../../lib/media/container-duration';
import { FAL_VIDEO_MODELS } from '../../lib/fal/catalog';
import { KIE_MODELS } from '../../lib/kie/catalog';
import { findModel } from '../../lib/providers/catalog';
import type { ProviderId } from '../../lib/providers/types';
import { editVideoMaxBytes, validateEditSource, type VideoEditCapability } from '../../lib/providers/video-edit';
import { AccountError } from './jobs';
import { objectByteSize, readObjectRange } from './object-bytes';
import type { Env } from './security';

function limitsFor(request: CloudJobRequest): VideoEditCapability | undefined {
  if (request.provider === 'fal') {
    return FAL_VIDEO_MODELS.find((model) => model.id === request.modelId)?.variants.find((variant) => variant.inputMode === 'edit')?.edit;
  }
  if (request.provider === 'kie') {
    return KIE_MODELS.find((model) => model.id === request.modelId)?.variants.find((variant) => variant.inputMode === 'edit')?.edit;
  }
  const catalogProvider = (['runware', 'atlas', 'comet', 'piapi'] as const satisfies readonly ProviderId[]).find((id) => id === request.provider);
  return catalogProvider ? findModel(catalogProvider, request.modelId)?.videoEdit : undefined;
}

function formatSeconds(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** Per-second edits, including a resolution table. Runware reports its own cost. A missing rate stays unknown. */
function pricesFromMeasuredLength(request: CloudJobRequest, limits: VideoEditCapability): boolean {
  const rate = limits.rate;
  if (!rate || request.provider === 'runware' || rate.per !== 'second') return false;
  return rate.usd !== undefined || rate.usdByResolution !== undefined;
}

export async function assertEditSourceLimits(env: Env, owner: string, request: CloudJobRequest): Promise<number | undefined> {
  if (request.inputMode !== 'edit' || !request.sourceVideoId) return;
  const limits = limitsFor(request);
  if (!limits) return;
  const row = await env.DB.prepare(
    'SELECT mime_type, expected_bytes, object_key, state FROM account_uploads WHERE user_id = ? AND id = ?',
  ).bind(owner, request.sourceVideoId).first<{ mime_type: string; expected_bytes: number; object_key: string; state: string }>();
  if (!row || row.state === 'deleted') return;
  const maxBytes = editVideoMaxBytes(limits);
  if (row.expected_bytes > maxBytes) {
    throw new AccountError(`This model's source video must be ${Math.round(maxBytes / 1_000_000)} MB or smaller.`, 400, 'invalid_references');
  }
  if (limits.mimes && !limits.mimes.includes(row.mime_type)) {
    throw new AccountError('This model does not accept that source video format.', 400, 'invalid_references');
  }
  if (limits.maxPromptLength && request.prompt.length > limits.maxPromptLength) {
    throw new AccountError(`This model's prompt is at most ${limits.maxPromptLength} characters.`, 400, 'invalid_settings');
  }
  if (row.state !== 'ready') return;
  const size = await objectByteSize(env.ASSETS, row.object_key);
  const measured = size === null
    ? null
    : await readContainerVideo({
      size,
      read: (offset, length) => readObjectRange(env.ASSETS, row.object_key, offset, length),
    });
  const duration = measured?.durationSeconds ?? null;
  const width = measured?.width ?? null;
  const height = measured?.height ?? null;
  const needsFrame = Boolean(limits.sourceBounds);
  if (limits.requireMeasurement && (duration === null || (needsFrame && (width === null || height === null)))) {
    throw new AccountError('The source clip\'s length and frame size could not be read, so this edit was not reserved. Use an MP4 or MOV with a duration and a video track in the file.', 400, 'invalid_references');
  }
  const min = limits.minSeconds ?? 0;
  if (duration !== null && (duration <= 0 || duration < min || duration > limits.maxSeconds)) {
    throw new AccountError(`Choose a readable clip ${limits.minSeconds ? `between ${limits.minSeconds} and ${limits.maxSeconds}` : `up to ${limits.maxSeconds}`} seconds long.`, 400, 'invalid_references');
  }
  const pricedFromFile = pricesFromMeasuredLength(request, limits);
  const claimed = request.values.sourceDurationSeconds;
  if (pricedFromFile && typeof claimed === 'number' && duration !== null && Math.abs(claimed - duration) > 1) {
    throw new AccountError(`The source clip is ${formatSeconds(duration)} seconds, not ${formatSeconds(claimed)}. An edit is priced from the file.`, 400, 'invalid_settings');
  }
  if (width === null || height === null) return pricedFromFile ? duration ?? undefined : undefined;
  try {
    // Duration was checked on its own. A stand-in keeps the frame check from
    // reporting a length when the container had a picture and no duration.
    validateEditSource({ durationSeconds: duration ?? Math.min(limits.maxSeconds, Math.max(min, 1)), width, height }, limits);
  } catch (error) {
    throw new AccountError(error instanceof Error ? error.message : 'This source video is outside the model\'s limits.', 400, 'invalid_references');
  }
  return pricedFromFile ? duration ?? undefined : undefined;
}
