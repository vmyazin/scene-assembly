import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/providers/video/route';

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/providers/video', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never);
}

afterEach(() => vi.unstubAllGlobals());

describe('Atlas Kling 4.0 browser route', () => {
  const base = { provider: 'atlas', apiKey: 'test-only', prompt: 'A paper lantern drifting over a lake', size: '720p', durationSeconds: 5 };
  const frameImages = Array.from({ length: 10 }, (_, index) => `data:image/png;base64,${index}`);

  it('keeps the first, eight middle, and last keyframes in the documented fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { id: 'kling-four' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await post({ ...base, model: 'kwaivgi/kling-v4.0/image-to-video', inputMode: 'image', images: frameImages });
    expect(response.status).toBe(200);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ image: frameImages[0], middle_images: frameImages.slice(1, -1), last_image: frameImages[9] });
    expect(body.reference_images).toBeUndefined();
  });

  it('keeps the reference endpoint separate from ordered keyframes and enforces its image cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { id: 'kling-four' } }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { ...base, model: 'kwaivgi/kling-v4.0/reference-to-video', inputMode: 'reference', images: frameImages };
    expect((await post(request)).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ reference_images: frameImages });
    expect((await post({ ...request, images: [...frameImages, frameImages[0]] })).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an overlong prompt and source edit without hosted account media before submission', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await post({ ...base, model: 'kwaivgi/kling-v4.0/text-to-video', inputMode: 'text', prompt: 'a'.repeat(11_001) })).status).toBe(400);
    expect((await post({ ...base, model: 'kwaivgi/kling-v4.0/video-edit', inputMode: 'edit', sourceVideo: 'https://unowned.example/clip.mp4' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['image', 'frames'])('refuses an explicit output shape when %s frames define it', async (inputMode) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await post({
      ...base, model: 'kwaivgi/kling-v4.0/image-to-video', inputMode,
      images: frameImages.slice(0, 2), aspectRatio: '16:9',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('input image') });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
