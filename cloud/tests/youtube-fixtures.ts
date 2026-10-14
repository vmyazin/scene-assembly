import { toResponse, type ClipRequest, type ClipResult } from '../src/youtube/importer-core';

export const CLIP_BYTES = new Uint8Array(2048).fill(7);
export const clipOk = (patch: Partial<Extract<ClipResult, { ok: true }>> = {}): ClipResult =>
  ({ ok: true, body: new Blob([CLIP_BYTES]).stream(), bytes: CLIP_BYTES.length, width: 1280, height: 720, durationSeconds: 12.4, title: 'Big Buck Bunny 60fps 4K', ...patch });

/** Stands in for the YOUTUBE_IMPORTER namespace; records which owner each call addressed. */
export function fakeImporter(respond: (request: ClipRequest) => ClipResult | Promise<ClipResult>) {
  const calls: { owner: string; request: ClipRequest; signal?: AbortSignal | null }[] = [];
  const namespace = {
    getByName: (owner: string) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as ClipRequest;
        calls.push({ owner, request, signal: init.signal });
        return toResponse(await respond(request));
      },
    }),
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, calls };
}
