import { afterEach, describe, expect, it, vi } from 'vitest';
import { discardStagedSource, forgetStagedSource, stageSource, stagedSourceId } from '@/lib/account/staged-sources';

afterEach(() => vi.unstubAllGlobals());

describe('staged sources', () => {
  const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  it('belongs to its owner, and lapses five minutes before expiry', () => {
    stageSource(file, { uploadId: 'u1', owner: 'owner', expiresAt: 1_000_000 });
    expect(stagedSourceId(file, 'owner', 1_000_000 - 300_001)).toBe('u1');
    expect(stagedSourceId(file, 'owner', 1_000_000 - 299_999)).toBeUndefined();
    expect(stagedSourceId(file, 'other', 0)).toBeUndefined();
    expect(stagedSourceId(new File(['x'], 'clip.mp4'), 'owner', 0)).toBeUndefined();
    forgetStagedSource(file);
    expect(stagedSourceId(file, 'owner', 0)).toBeUndefined();
  });
  it('discards a staged clip on the Worker once, as its owner, and forgets it', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const clip = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    stageSource(clip, { uploadId: 'u2', owner: 'owner', expiresAt: Date.now() + 86_400_000 });
    discardStagedSource(clip);
    expect(stagedSourceId(clip, 'owner')).toBeUndefined();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/account/uploads/u2');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('X-Account-Id')).toBe('owner');
    // Already forgotten, never staged, or already submitted (forgotten at submission): nothing to send.
    discardStagedSource(clip);
    discardStagedSource(new File(['x'], 'device.mp4', { type: 'video/mp4' }));
    const submitted = new File(['x'], 'submitted.mp4', { type: 'video/mp4' });
    stageSource(submitted, { uploadId: 'u3', owner: 'owner', expiresAt: Date.now() + 86_400_000 });
    forgetStagedSource(submitted);
    discardStagedSource(submitted);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('ignores a refused or failed discard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: 'An active job still needs this reference.' }, { status: 409 })).mockRejectedValueOnce(new TypeError('offline')));
    for (const id of ['held', 'offline']) {
      const clip = new File(['x'], `${id}.mp4`, { type: 'video/mp4' });
      stageSource(clip, { uploadId: id, owner: 'owner', expiresAt: Date.now() + 86_400_000 });
      expect(() => discardStagedSource(clip)).not.toThrow();
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
