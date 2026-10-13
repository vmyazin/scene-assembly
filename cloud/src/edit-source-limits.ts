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
import { findModel } from '../../lib/providers/catalog';
import type { ProviderId } from '../../lib/providers/types';
import { editVideoMaxBytes, validateEditSource, type VideoEditCapability } from '../../lib/providers/video-edit';
import { AccountError } from './jobs';
import type { Env } from './security';

function limitsFor(request: CloudJobRequest): VideoEditCapability | undefined {
  if (request.provider === 'fal') {
    return FAL_VIDEO_MODELS.find((model) => model.id === request.modelId)?.variants.find((variant) => variant.inputMode === 'edit')?.edit;
  }
  const catalogProvider = (['runware', 'atlas', 'comet', 'piapi'] as const satisfies readonly ProviderId[]).find((id) => id === request.provider);
  return catalogProvider ? findModel(catalogProvider, request.modelId)?.videoEdit : undefined;
}

async function readBody(body: ReadableStream<Uint8Array> | null | undefined): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) {
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function assertEditSourceLimits(env: Env, owner: string, request: CloudJobRequest): Promise<void> {
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
  const head = await env.ASSETS?.head(row.object_key);
  await (head as { body?: ReadableStream<Uint8Array> } | null)?.body?.cancel?.().catch(() => {});
  const measured = head
    ? await readContainerVideo({
      size: head.size,
      read: async (offset, length) => {
        const object = await env.ASSETS?.get(row.object_key, { range: { offset, length } });
        return readBody(object?.body);
      },
    })
    : null;
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
  if (width === null || height === null) return;
  try {
    // Duration was checked on its own. A stand-in keeps the frame check from
    // reporting a length when the container had a picture and no duration.
    validateEditSource({ durationSeconds: duration ?? Math.min(limits.maxSeconds, Math.max(min, 1)), width, height }, limits);
  } catch (error) {
    throw new AccountError(error instanceof Error ? error.message : 'This source video is outside the model\'s limits.', 400, 'invalid_references');
  }
}
