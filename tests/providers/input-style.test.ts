import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/generate/route';
import { modelsFor } from '@/lib/providers/catalog';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never
  );
}

/** Provider call, then the download of the finished image. */
function mockGenerateThenDownload() {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ imageURL: 'https://im.runware.ai/a.jpg' }] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => new Uint8Array(200).fill(3).buffer,
    });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Runware splits input images two ways: the older checkpoints start from
 * inputs.seedImage, the editing models require inputs.referenceImages and have
 * no seedImage at all. The catalog records which, per model.
 */
describe('per-model image input shape', () => {
  it('sends seedImage for a checkpoint that starts from one', async () => {
    const fetchMock = mockGenerateThenDownload();

    await post({
      engine: 'runware',
      apiKey: 'rw',
      prompt: 'restyle',
      model: 'runware:z-image@turbo',
      images: ['QUJD'],
    });

    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(task.inputs.seedImage).toBe('data:image/png;base64,QUJD');
    expect(task.inputs).not.toHaveProperty('referenceImages');
  });

  it('sends referenceImages for an editing model that has no seedImage', async () => {
    const fetchMock = mockGenerateThenDownload();

    await post({
      engine: 'runware',
      apiKey: 'rw',
      prompt: 'swap the jacket',
      model: 'runware:108@22',
      images: ['QUJD', 'REVG'],
    });

    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(task.inputs.referenceImages).toHaveLength(2);
    expect(task.inputs).not.toHaveProperty('seedImage');
  });

  it('sends FLUX 3 Image Klein references without a seed image', async () => {
    const fetchMock = mockGenerateThenDownload();

    await post({
      engine: 'runware',
      apiKey: 'rw',
      prompt: 'a cheap draft of the jacket',
      model: 'bfl:flux@3-image-klein',
      aspectRatio: '1:1',
      images: ['QUJD'],
    });

    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(task.model).toBe('bfl:flux@3-image-klein');
    expect(task.width).toBe(1024);
    expect(task.height).toBe(1024);
    expect(task.inputs.referenceImages).toEqual(['data:image/png;base64,QUJD']);
    expect(task.inputs).not.toHaveProperty('seedImage');
    expect(task).not.toHaveProperty('settings');
  });

  it('trims references to the count the model documents', async () => {
    const fetchMock = mockGenerateThenDownload();

    // Qwen-Image-Edit-Plus takes at most three.
    await post({
      engine: 'runware',
      apiKey: 'rw',
      prompt: 'combine',
      model: 'runware:108@22',
      images: ['a', 'b', 'c', 'd', 'e'],
    });

    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(task.inputs.referenceImages).toHaveLength(3);
  });

  it('offers vertical video sizes on the models that publish them', () => {
    const video = modelsFor('runware', 'video');
    const portrait = (id: string) =>
      video.find((model) => model.id === id)?.sizes?.some((size) => (size.height ?? 0) > (size.width ?? 0));

    expect(portrait('bytedance:seedance@2.0-mini')).toBe(true);
    expect(portrait('pixverse:1@5-fast')).toBe(true);
    // LTX-2.5 Fast publishes 9:16 at every tier, unlike the model it replaced.
    expect(portrait('lightricks:ltx@2.5-fast')).toBe(true);
  });
});
