// tests/providers/kling-4-flash-edit.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/providers/video/route';
import { findModel } from '@/lib/providers/catalog';
import { validateEditSource } from '@/lib/providers/video-edit';

const source = '989ba605-1449-4e1e-b462-cd83ec9c1a67';
const image = 'data:image/png;base64,eA==';
const base = {
  provider: 'runware', apiKey: 'test-key', model: 'klingai:kling-video@4.0-flash', inputMode: 'edit',
  sourceVideo: source, prompt: 'Replace the sky in <<<video_1>>>', sourceDurationSeconds: 6,
};
const send = (body: unknown) => POST(new NextRequest('http://localhost/api/providers/video', { method: 'POST', body: JSON.stringify(body) }));

afterEach(() => vi.unstubAllGlobals());

describe('Kling VIDEO 4.0 Flash on Runware', () => {
  const model = findModel('runware', 'klingai:kling-video@4.0-flash')!;

  it.each([
    [true, true],
    [false, false],
  ])('sends keepOriginalSound=%s as settings.preserveAudio, with no duration or size', async (keepOriginalSound, preserveAudio) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    const response = await send({ ...base, images: [image], keepOriginalSound });
    expect(response.status).toBe(200);
    const [task] = JSON.parse(fetch.mock.calls[0][1].body);
    expect(task).toMatchObject({
      taskType: 'videoInference', model: base.model,
      inputs: { video: source, referenceImages: [image] },
      settings: { preserveAudio },
    });
    for (const absent of ['duration', 'resolution', 'width', 'height', 'providerSettings']) expect(task).not.toHaveProperty(absent);
  });

  it('refuses more reference images than this edit offers before calling Runware', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    expect((await send({ ...base, images: Array(5).fill(image) })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('holds a source to the published 3–20 s and pixel bounds', () => {
    const edit = model.videoEdit!;
    expect(() => validateEditSource({ durationSeconds: 20, width: 3840, height: 2160 }, edit)).not.toThrow();
    expect(() => validateEditSource({ durationSeconds: 2.9, width: 1280, height: 720 }, edit)).toThrow();
    expect(() => validateEditSource({ durationSeconds: 20.1, width: 1280, height: 720 }, edit)).toThrow();
    expect(() => validateEditSource({ durationSeconds: 5, width: 640, height: 360 }, edit)).toThrow();
  });

  it('sends a text run with the vendor dimensions and a whole-second duration', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    const response = await send({
      provider: 'runware', apiKey: 'test-key', model: base.model, inputMode: 'text',
      prompt: 'A lighthouse at dusk', size: '720p · 21:9', durationSeconds: 20,
    });
    expect(response.status).toBe(200);
    const [task] = JSON.parse(fetch.mock.calls[0][1].body);
    expect(task).toMatchObject({ model: base.model, width: 1464, height: 628, duration: 20 });
  });
});
