import * as z from 'zod';
import { copyAssetToUpload, discardUploads, reserveUpload, storeStreamedUpload } from '../../uploads';
import { ToolError } from '../errors';
import { fetchReference } from '../fetch-reference';
import { defineTool, type ToolContext } from '../tool';
import type { ReferenceInput } from './request';

const STAGEABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'] as const;

export const addReference = defineTool({
  name: 'add_reference',
  title: 'Add a reference',
  description: 'Stage a reference image, or a source video for edit mode, for generate. Either pass url (an https link Scene Assembly downloads now), or pass upload with the file\'s mimeType and exact byte size to get a putUrl, then PUT the file there with that Content-Type within 15 minutes, for example: curl -T cat.png -H "Content-Type: image/png" "<putUrl>". Both return an uploadId for references or sourceVideo that lasts 24 hours. A file already in the library does not need this: pass { assetId } to generate.',
  kind: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  input: z.object({
    url: z.string().max(2048).optional(),
    upload: z.object({ mimeType: z.enum(STAGEABLE), bytes: z.number().int().positive() }).optional(),
  }),
  async run(ctx, args) {
    if (Boolean(args.url) === Boolean(args.upload)) throw new ToolError('invalid_field', 'Pass either url or upload.', { field: 'url' });
    const owner = ctx.agent.user_id;
    if (args.url) {
      const fetched = await fetchReference(ctx.env, args.url);
      const stored = await storeStreamedUpload(ctx.env, owner, fetched.body, fetched.mimeType, fetched.maxBytes);
      return {
        structured: { uploadId: stored.id, mimeType: fetched.mimeType, bytes: stored.bytes, expiresAt: stored.expiresAt },
        text: `Staged ${fetched.mimeType}, ${stored.bytes} bytes, as ${stored.id}.`,
      };
    }
    const { mimeType, bytes } = args.upload!;
    const reserved = await reserveUpload(ctx.env, owner, bytes, mimeType, 'agent-upload');
    return {
      structured: { uploadId: reserved.id, putUrl: reserved.url, putExpiresAt: reserved.urlExpiresAt, expiresAt: reserved.expiresAt },
      text: `PUT the file to putUrl with Content-Type ${mimeType} within 15 minutes, then pass { "uploadId": "${reserved.id}" } to generate.`,
    };
  },
});

/** Real upload ids for generate: staged uploads pass through (acceptJob checks
 *  ownership, readiness and roles), library files are copied. copiedIds lists only
 *  the ones this call itself copied, so generate can discard them if the job it
 *  was building never got submitted (a staged { uploadId } is never in this list —
 *  the agent made that one itself and keeps owning its lifecycle).
 *  If a later reference in the same call fails, every earlier copy is discarded
 *  here before the error reaches the caller, so a failed generate never leaves
 *  copies occupying input slots for their full 24 hours. */
export async function resolveReferences(ctx: ToolContext, references: ReferenceInput[] = [], sourceVideo?: ReferenceInput): Promise<{ referenceIds: string[]; sourceVideoId?: string; copiedIds: string[] }> {
  const copiedIds: string[] = [];
  const resolve = async (reference: ReferenceInput) => {
    if ('uploadId' in reference) return reference.uploadId;
    const id = await copyAssetToUpload(ctx.env, ctx.agent.user_id, reference.assetId);
    copiedIds.push(id);
    return id;
  };
  try {
    const referenceIds: string[] = [];
    for (const reference of references) referenceIds.push(await resolve(reference));
    const sourceVideoId = sourceVideo ? await resolve(sourceVideo) : undefined;
    return { referenceIds, ...(sourceVideoId ? { sourceVideoId } : {}), copiedIds };
  } catch (error) {
    if (copiedIds.length) await discardUploads(ctx.env, ctx.agent.user_id, copiedIds);
    throw error;
  }
}
