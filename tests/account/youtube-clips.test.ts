import { afterEach, describe, expect, it, vi } from 'vitest';
import { importYouTubeClip } from '@/lib/account/youtube-clips';
import { stagedSourceId } from '@/lib/account/staged-sources';

const input = { url: 'https://youtu.be/aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4, provider: 'runware', modelId: 'bytedance:seedance@2.5' };
const imported = { uploadId: 'u1', bytes: 3, expiresAt: Date.now() + 86_400_000, previewUrl: 'https://accounts.test/media/preview/t', source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } };
afterEach(() => vi.unstubAllGlobals());

describe('importYouTubeClip (browser)', () => {
  it('stages the fetched clip for its owner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(imported, { status: 201 })).mockResolvedValueOnce(new Response('mp4')));
    const { file } = await importYouTubeClip(input, new AbortController().signal, 'owner');
    expect(stagedSourceId(file, 'owner')).toBe('u1');
  });
  it('releases the Worker upload when the clip cannot be fetched', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(imported, { status: 201 })).mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    await expect(importYouTubeClip(input, new AbortController().signal, 'owner')).rejects.toThrow('The clip was imported but could not be loaded. Try again.');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const [url, init] = fetcher.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/account/uploads/u1');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('X-Account-Id')).toBe('owner');
  });
});
