// cloud/src/mcp/tools/source-duration.ts
import type { CloudJobRequest } from '../../../../lib/account/contracts';
import { readContainerDuration } from '../../../../lib/media/container-duration';
import { findModel } from '../../../../lib/providers/catalog';
import { isSeedance25 } from '../../../../lib/providers/seedance-draft';
import { getAsset } from '../../assets';
import { validateRequest } from '../../providers';
import type { Env } from '../../security';
import { ToolError } from '../errors';
import type { ToolContext } from '../tool';
import type { ReferenceInput } from './request';

function formatSeconds(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
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

async function objectSize(env: Env, key: string): Promise<number | null> {
  const head = await env.ASSETS?.head(key);
  if (!head) return null;
  const body = (head as { body?: ReadableStream<Uint8Array> }).body;
  await body?.cancel?.().catch(() => {});
  return head.size;
}

async function locatedSource(env: Env, owner: string, source: ReferenceInput): Promise<{ key: string; bytes: number } | null> {
  if ('uploadId' in source) {
    const row = await env.DB.prepare(
      "SELECT object_key, mime_type, state FROM account_uploads WHERE id = ? AND user_id = ? AND state != 'deleted'",
    ).bind(source.uploadId, owner).first<{ object_key: string; mime_type: string; state: string }>();
    if (!row || row.state !== 'ready' || !row.mime_type.startsWith('video/')) return null;
    const bytes = await objectSize(env, row.object_key);
    return bytes ? { key: row.object_key, bytes } : null;
  }
  const asset = await getAsset(env, source.assetId, owner);
  if (!asset || !asset.mime_type.startsWith('video/')) return null;
  const bytes = await objectSize(env, asset.object_key);
  return bytes ? { key: asset.object_key, bytes } : null;
}

/**
 * A Seedance edit draft is priced from the clip, not from the number the agent
 * sent. The read happens before any reservation. A missing or unreadable
 * duration is a refusal: an unknown estimate would let `allowUnknownCost`
 * start the job with nothing held against the limit.
 */
export async function priceEditDraftSource(ctx: ToolContext, request: CloudJobRequest, source?: ReferenceInput): Promise<CloudJobRequest> {
  if (request.inputMode !== 'edit' || request.values.draft !== true || !isSeedance25(request.modelId)) return request;
  const edit = findModel('runware', request.modelId)?.videoEdit;
  if (!edit?.draftPreview) return request;
  if (!source) throw new ToolError('invalid_field', 'A Seedance edit draft needs the source clip so its length can be priced.', { field: 'sourceVideo' });
  const located = await locatedSource(ctx.env, ctx.agent.user_id, source);
  if (!located) {
    throw new ToolError('invalid_field', 'The source clip is not available, so this draft was not priced or reserved.', { field: 'sourceVideo' });
  }
  const measured = await readContainerDuration({
    size: located.bytes,
    read: async (offset, length) => {
      const object = await ctx.env.ASSETS?.get(located.key, { range: { offset, length } });
      return readBody(object?.body);
    },
  });
  if (measured === null) {
    throw new ToolError(
      'invalid_field',
      'The source clip\'s length could not be read, so this draft was not priced or reserved. Use an MP4, MOV, or WebM with a duration in the file.',
      { field: 'sourceVideo' },
    );
  }
  const min = edit.minSeconds ?? 0;
  if (measured < min || measured > edit.maxSeconds) {
    throw new ToolError(
      'invalid_field',
      `The source clip is ${formatSeconds(measured)} seconds. This model edits clips from ${min} to ${edit.maxSeconds} seconds, so the draft was not reserved.`,
      { field: 'sourceVideo' },
    );
  }
  const claimed = request.values.sourceDurationSeconds;
  if (typeof claimed === 'number' && Math.abs(claimed - measured) > 1) {
    throw new ToolError(
      'invalid_field',
      `The source clip is ${formatSeconds(measured)} seconds, not ${formatSeconds(claimed)}. A draft is priced from the file.`,
      { field: 'sourceDurationSeconds' },
    );
  }
  const priced: CloudJobRequest = { ...request, values: { ...request.values, sourceDurationSeconds: measured } };
  return validateRequest(ctx.env, priced);
}
