import * as z from 'zod';
import { copyAssetToUpload, INPUT_TTL, reserveUpload, storeUpload } from '../../uploads';
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
      const stored = await storeUpload(ctx.env, owner, fetched.bytes, fetched.bytes.byteLength, fetched.mimeType);
      return {
        structured: { uploadId: stored.id, mimeType: fetched.mimeType, bytes: fetched.bytes.byteLength, expiresAt: stored.expiresAt },
        text: `Staged ${fetched.mimeType}, ${fetched.bytes.byteLength} bytes, as ${stored.id}.`,
      };
    }
    const { mimeType, bytes } = args.upload!;
    const reserved = await reserveUpload(ctx.env, owner, bytes, mimeType, 'agent-upload');
    return {
      structured: { uploadId: reserved.id, putUrl: reserved.url, putExpiresAt: reserved.urlExpiresAt, expiresAt: ctx.now() + INPUT_TTL },
      text: `PUT the file to putUrl with Content-Type ${mimeType} within 15 minutes, then pass { "uploadId": "${reserved.id}" } to generate.`,
    };
  },
});

/** Real upload ids for generate: staged uploads pass through (acceptJob checks
 *  ownership, readiness and roles), library files are copied. */
export async function resolveReferences(ctx: ToolContext, references: ReferenceInput[] = [], sourceVideo?: ReferenceInput): Promise<{ referenceIds: string[]; sourceVideoId?: string }> {
  const resolve = (reference: ReferenceInput) => 'uploadId' in reference ? Promise.resolve(reference.uploadId) : copyAssetToUpload(ctx.env, ctx.agent.user_id, reference.assetId);
  const referenceIds: string[] = [];
  for (const reference of references) referenceIds.push(await resolve(reference));
  return { referenceIds, ...(sourceVideo ? { sourceVideoId: await resolve(sourceVideo) } : {}) };
}
