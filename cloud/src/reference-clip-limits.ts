// cloud/src/reference-clip-limits.ts
/**
 * Per-model reference clip limits, before a job reserves storage.
 *
 * The browser tray already checks bytes, duration, dimensions and frame rate.
 * An agent can stage under the global caps (100 MB video, 15 MB audio) and
 * still miss a model's own ceiling — Atlas Seedance 2.0 is 50 MB and 2–15 s.
 * Bytes come from the upload row. Duration comes from `readContainerDuration`
 * (MP4/MOV `mvhd`, WebM, WAV). That reader does not yield width, height or
 * frame rate, so those stay on the tray. MP3 has no duration in the reader;
 * its bytes are still checked, and a missing MP3 length is not treated as a
 * failure.
 */
import type { CloudJobRequest } from '../../lib/account/contracts';
import { readContainerDuration } from '../../lib/media/container-duration';
import { findModel } from '../../lib/providers/catalog';
import { referenceClipsFor } from '../../lib/providers/reference-clips';
import type { ProviderId, ReferenceClipLimit } from '../../lib/providers/types';
import { AccountError } from './jobs';
import type { Env } from './security';

interface UploadRow { id: string; mime_type: string; expected_bytes: number; object_key: string; state: string }

function formatSeconds(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
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

async function durationOf(env: Env, key: string): Promise<number | null> {
  const head = await env.ASSETS?.head(key);
  if (!head) return null;
  await (head as { body?: ReadableStream<Uint8Array> }).body?.cancel?.().catch(() => {});
  return readContainerDuration({
    size: head.size,
    read: async (offset, length) => {
      const object = await env.ASSETS?.get(key, { range: { offset, length } });
      return readBody(object?.body);
    },
  });
}

function overBytes(kind: 'video' | 'audio', limit: ReferenceClipLimit, bytes: number): AccountError | null {
  if (bytes <= limit.maxBytes) return null;
  const cap = megabytes(limit.maxBytes);
  const message = kind === 'video'
    ? `Each reference video must be ${cap} MB or smaller. This one is ${megabytes(bytes)} MB.`
    : `Each reference audio clip must be ${cap} MB or smaller. This one is ${megabytes(bytes)} MB.`;
  return new AccountError(message, 400, 'invalid_references');
}

export async function assertReferenceClipLimits(env: Env, owner: string, request: CloudJobRequest): Promise<void> {
  const videoIds = request.referenceVideoIds ?? [];
  const audioIds = request.referenceAudioIds ?? [];
  if (videoIds.length === 0 && audioIds.length === 0) return;
  const catalogProvider = (['runware', 'atlas', 'comet', 'piapi'] as const satisfies readonly ProviderId[]).find((id) => id === request.provider);
  const model = catalogProvider ? findModel(catalogProvider, request.modelId) : undefined;
  const spec = referenceClipsFor(model, request.inputMode);
  if (!spec) return;
  const ids = [...videoIds, ...audioIds];
  const rows = await env.DB.prepare(
    'SELECT id, mime_type, expected_bytes, object_key, state FROM account_uploads WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))',
  ).bind(owner, JSON.stringify(ids)).all<UploadRow>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));

  const checkList = async (idList: string[], kind: 'video' | 'audio', limit: ReferenceClipLimit) => {
    let total = 0;
    const noun = kind === 'video' ? 'video' : 'audio clip';
    const together = kind === 'video' ? 'videos' : 'audio';
    for (const id of idList) {
      const row = byId.get(id);
      if (!row) continue;
      const tooBig = overBytes(kind, limit, row.expected_bytes);
      if (tooBig) throw tooBig;
      if (row.state !== 'ready') continue;
      const measured = await durationOf(env, row.object_key);
      const wav = kind === 'audio' && (row.mime_type === 'audio/wav' || row.mime_type === 'audio/wave' || row.mime_type === 'audio/x-wav');
      if (measured === null) {
        if (kind === 'video' || wav) {
          const message = kind === 'video'
            ? 'The reference video\'s length could not be read, so this job was not reserved. Use an MP4 or MOV with a duration in the file.'
            : 'The reference audio\'s length could not be read, so this job was not reserved. Use a WAV with a duration in the file, or an MP3.';
          throw new AccountError(message, 400, 'invalid_references');
        }
        continue;
      }
      if (measured < limit.minSeconds - 0.05 || measured > limit.maxSeconds + 0.05) {
        throw new AccountError(`Each reference ${noun} must be ${limit.minSeconds}–${limit.maxSeconds} seconds. This one is ${formatSeconds(measured)}s.`, 400, 'invalid_references');
      }
      total += measured;
      if (total > limit.maxTotalSeconds + 0.05) {
        throw new AccountError(`Reference ${together} together must be ${limit.maxTotalSeconds} seconds or shorter.`, 400, 'invalid_references');
      }
    }
  };

  if (spec.video) await checkList(videoIds, 'video', spec.video);
  if (spec.audio) await checkList(audioIds, 'audio', spec.audio);
}
