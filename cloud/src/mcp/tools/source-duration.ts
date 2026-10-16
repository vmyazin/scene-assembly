// cloud/src/mcp/tools/source-duration.ts
import type { CloudJobRequest } from '../../../../lib/account/contracts';
import { readContainerDuration } from '../../../../lib/media/container-duration';
import { findModel } from '../../../../lib/providers/catalog';
import { isSeedance25 } from '../../../../lib/providers/seedance-draft';
import { pricesEditFromSourceDuration } from '../../../../lib/providers/video-edit';
import { FAL_VIDEO_MODELS } from '../../../../lib/fal/catalog';
import { getAsset } from '../../assets';
import { objectByteSize, readObjectRange } from '../../object-bytes';
import { validateRequest } from '../../providers';
import type { Env } from '../../security';
import { ToolError } from '../errors';
import type { ToolContext } from '../tool';
import type { ReferenceInput } from './request';

function formatSeconds(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

async function objectSize(env: Env, key: string): Promise<number | null> {
  return objectByteSize(env.ASSETS, key);
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
    read: (offset, length) => readObjectRange(ctx.env.ASSETS, located.key, offset, length),
  });
  if (measured === null) {
    throw new ToolError(
      'invalid_field',
      'The source clip\'s length could not be read, so this draft was not priced or reserved. Use an MP4, MOV, or WebM with a duration in the file.',
      { field: 'sourceVideo' },
    );
  }
  const min = edit.minSeconds ?? 0;
  if (edit.maxSeconds !== undefined && (measured < min || measured > edit.maxSeconds)) {
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

/**
 * Per-second edits (Kling, Aleph) are priced from the file, the same way a
 * Seedance draft is. The agent does not have to send a length. A length it
 * does send is only a check: more than a second off the container is a
 * refusal, and the stored value is the one that was read.
 */
function pricesFromFile(request: CloudJobRequest): boolean {
  if (request.inputMode !== 'edit') return false;
  if (request.provider === 'fal') {
    return FAL_VIDEO_MODELS.find((model) => model.id === request.modelId)?.variants.find((variant) => variant.inputMode === 'edit')?.edit?.rate?.per === 'second';
  }
  if (request.provider === 'runware') {
    return pricesEditFromSourceDuration('runware', findModel('runware', request.modelId)?.videoEdit);
  }
  if (request.provider !== 'atlas' && request.provider !== 'comet' && request.provider !== 'piapi') return false;
  const rate = findModel(request.provider, request.modelId)?.videoEdit?.rate;
  return rate?.per === 'second' && (rate.usd !== undefined || rate.usdByResolution !== undefined);
}

export async function priceEditSource(ctx: ToolContext, request: CloudJobRequest, source?: ReferenceInput): Promise<CloudJobRequest> {
  const drafted = await priceEditDraftSource(ctx, request, source);
  if (drafted !== request) return drafted;
  if (!pricesFromFile(request)) return request;
  if (!source) throw new ToolError('invalid_field', 'This edit needs the source clip so its length can be priced.', { field: 'sourceVideo' });
  const located = await locatedSource(ctx.env, ctx.agent.user_id, source);
  if (!located) throw new ToolError('invalid_field', 'The source clip is not available, so this edit was not priced or reserved.', { field: 'sourceVideo' });
  const measured = await readContainerDuration({
    size: located.bytes,
    read: (offset, length) => readObjectRange(ctx.env.ASSETS, located.key, offset, length),
  });
  if (measured === null) {
    throw new ToolError('invalid_field', 'The source clip\'s length could not be read, so this edit was not priced or reserved. Use an MP4 or MOV with a duration in the file.', { field: 'sourceVideo' });
  }
  const edit = request.provider === 'fal'
    ? FAL_VIDEO_MODELS.find((model) => model.id === request.modelId)?.variants.find((variant) => variant.inputMode === 'edit')?.edit
    : findModel(request.provider as 'atlas' | 'comet' | 'piapi' | 'runware', request.modelId)?.videoEdit;
  const min = edit?.minSeconds ?? 0;
  const max = edit?.maxSeconds;
  if (max !== undefined && (measured < min || measured > max)) {
    throw new ToolError('invalid_field', `The source clip is ${formatSeconds(measured)} seconds. This model edits clips from ${min} to ${max} seconds, so it was not reserved.`, { field: 'sourceVideo' });
  }
  const claimed = request.values.sourceDurationSeconds;
  if (typeof claimed === 'number' && Math.abs(claimed - measured) > 1) {
    throw new ToolError('invalid_field', `The source clip is ${formatSeconds(measured)} seconds, not ${formatSeconds(claimed)}. An edit is priced from the file.`, { field: 'sourceDurationSeconds' });
  }
  const priced: CloudJobRequest = { ...request, values: { ...request.values, sourceDurationSeconds: measured } };
  return validateRequest(ctx.env, priced);
}
