import * as z from 'zod';
import { deleteAsset, getAsset } from '../../assets';
import { listAssets } from '../../job-routes';
import { mediaAccess } from '../../media';
import { readAccountBilling } from '../../provider-billing';
import { listSpend, spendTotals } from '../../spend';
import type { Env } from '../../security';
import { budgetStatus } from '../budget';
import { ToolError } from '../errors';
import { defineTool } from '../tool';

/** Long edge of the inline preview: enough to judge a result, small enough for any client. */
export const PREVIEW_EDGE = 1024;

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** A preview is a convenience: any failure means the agent gets the link instead. */
async function imagePreview(env: Env, objectKey: string): Promise<string | null> {
  if (!env.IMAGES || !env.ASSETS) return null;
  try {
    const object = await env.ASSETS.get(objectKey);
    if (!object) return null;
    const result = await env.IMAGES.input(object.body).transform({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'scale-down' }).output({ format: 'image/webp', quality: 80 });
    return toBase64(new Uint8Array(await result.response().arrayBuffer()));
  } catch {
    return null;
  }
}

export const listAssetsTool = defineTool({
  name: 'list_assets',
  title: 'List library files',
  description: 'The account\'s saved images and videos, newest first, 50 at a time; pass nextCursor back as cursor for the next page. Each asset carries the request that made it (prompt, provider, model) and, when an agent started it, which one.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({ kind: z.enum(['image', 'video']).optional(), temporaryOnly: z.boolean().optional(), cursor: z.string().max(200).optional() }),
  async run(ctx, args) {
    const page = await listAssets(ctx.env, ctx.agent.user_id, { kind: args.kind ?? null, cursor: args.cursor ?? null, temporaryOnly: args.temporaryOnly === true }, ctx.now());
    return { structured: page, text: `${page.assets.length} of ${page.counts.all} files.${page.nextCursor ? ' More with cursor.' : ''}` };
  },
});

export const viewAsset = defineTool({
  name: 'view_asset',
  title: 'View a library file',
  description: `Look at a saved result. An image comes back inline as a WebP no larger than ${PREVIEW_EDGE}px, together with a download link that expires in a few minutes; a video comes back as the link only.`,
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({ assetId: z.string().min(1).max(64) }),
  async run(ctx, { assetId }) {
    const owner = ctx.agent.user_id;
    const asset = await getAsset(ctx.env, assetId, owner);
    if (!asset) throw new ToolError('not_found', 'No file with that id in this library.');
    const access = await mediaAccess(ctx.env, owner, asset.id, 'download');
    const metadata = JSON.parse(asset.metadata_json) as { prompt?: string; provider?: string; modelId?: string };
    const structured = { assetId: asset.id, kind: asset.kind, mimeType: asset.mime_type, bytes: asset.bytes, prompt: metadata.prompt, provider: metadata.provider, modelId: metadata.modelId, downloadUrl: access.url, expiresAt: access.expiresAt };
    const link = { type: 'resource_link' as const, uri: access.url, name: asset.id, mimeType: asset.mime_type };
    const preview = asset.kind === 'image' ? await imagePreview(ctx.env, asset.object_key) : null;
    if (preview) return { structured, text: `Preview of ${asset.id}.`, content: [{ type: 'image' as const, data: preview, mimeType: 'image/webp' }, link] };
    return { structured, text: asset.kind === 'video' ? 'Videos are not shown inline; use the download link.' : 'No preview is available; use the download link.', content: [link] };
  },
});

export const deleteAssetTool = defineTool({
  name: 'delete_asset',
  title: 'Delete a library file',
  description: 'Permanently delete a file from the account\'s library. Offered only when the person allowed this agent to delete files.',
  kind: 'write',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  available: agent => agent.allow_delete === 1,
  input: z.object({ assetId: z.string().min(1).max(64) }),
  async run(ctx, { assetId }) {
    const owner = ctx.agent.user_id;
    if (!await getAsset(ctx.env, assetId, owner)) throw new ToolError('not_found', 'No file with that id in this library.');
    await deleteAsset(ctx.env, assetId, owner);
    return { structured: { ok: true, assetId }, text: `Deleted ${assetId}.` };
  },
});

export const getSpend = defineTool({
  name: 'get_spend',
  title: 'Get spend',
  description: 'What this account has spent on generation (totals from the spend ledger, which includes browser runs), this agent\'s 24-hour limit and what is left of it, optionally the latest ledger entries, and optionally live balances from providers that publish them.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({ entries: z.number().int().min(0).max(50).optional(), balances: z.boolean().optional() }),
  async run(ctx, args) {
    const owner = ctx.agent.user_id;
    const [totals, budget] = await Promise.all([spendTotals(ctx.env, owner), budgetStatus(ctx.env, ctx.agent, ctx.now())]);
    const entries = args.entries ? (await listSpend(ctx.env, owner, null)).entries.slice(0, args.entries) : undefined;
    const balances = args.balances ? await readAccountBilling(ctx.env, owner) : undefined;
    return {
      structured: { totals, budget, ...(entries ? { entries } : {}), ...(balances ? { balances } : {}) },
      text: `This agent has ${budget.remainingUsd.toFixed(2)} USD of its ${budget.limitUsd.toFixed(2)} USD 24-hour limit left.`,
    };
  },
});
