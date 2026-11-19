// tests/providers/four-models-wire.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeModels } from '@/lib/account/model-schema';
import { atlasCreateVideo, atlasGenerateImage } from '@/lib/providers/atlas';
import { modeDuration, findModel, resolveDuration } from '@/lib/providers/catalog';
import { imageDimensions } from '@/lib/providers/output-size';
import { runwareCreateVideo } from '@/lib/providers/runware';
import type { VideoRequest } from '@/lib/providers/types';

const HEYGEN = 'heygen:video@1.0';
const FLASH = 'bytedance:seedance@2.5-flash';
const SEEDANCE = 'bytedance:seedance@2.5';
const image = 'data:image/png;base64,eA==';

afterEach(() => vi.unstubAllGlobals());

async function runwareTask(request: Omit<VideoRequest, 'apiKey'>) {
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
  vi.stubGlobal('fetch', fetch);
  await runwareCreateVideo({ apiKey: 'rw-key', ...request });
  return JSON.parse(fetch.mock.calls[0][1].body)[0] as Record<string, unknown>;
}

async function atlasVideoBody(request: Omit<VideoRequest, 'apiKey'>) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: 'pred-1' } }) });
  vi.stubGlobal('fetch', fetch);
  await atlasCreateVideo({ apiKey: 'at-key', ...request });
  return JSON.parse(fetch.mock.calls[0][1].body as string) as Record<string, unknown>;
}

async function atlasImageBody(request: Omit<Parameters<typeof atlasGenerateImage>[0], 'apiKey'>) {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'pred-1' } }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'pred-1', status: 'succeeded', outputs: ['https://cdn.atlas/out.png'] }) });
  vi.stubGlobal('fetch', fetch);
  await atlasGenerateImage({ apiKey: 'at-key', ...request }, async () => {});
  return JSON.parse(fetch.mock.calls[0][1].body as string) as Record<string, unknown>;
}

describe('HeyGen Video 1.0 on Runware', () => {
  it('sends a text run as a published pixel pair', async () => {
    const task = await runwareTask({ model: HEYGEN, prompt: 'A presenter', inputMode: 'text', width: 1344, height: 768, durationSeconds: 30 });
    expect(task).toMatchObject({ taskType: 'videoInference', model: HEYGEN, width: 1344, height: 768, duration: 30 });
    for (const absent of ['resolution', 'inputs', 'settings', 'providerSettings']) expect(task).not.toHaveProperty(absent);
  });

  it('sends a first frame with the resolution tier and no width or height', async () => {
    const task = await runwareTask({ model: HEYGEN, prompt: 'Continue', inputMode: 'image', inputField: 'frameImages', images: [image], width: 1632, height: 2856, durationSeconds: 8 });
    expect(task).toMatchObject({ resolution: '2k', inputs: { frameImages: [image] }, duration: 8 });
    expect(task).not.toHaveProperty('width');
    expect(task).not.toHaveProperty('height');
  });

  it('sends references as referenceImages with the tier, as the vendor example does', async () => {
    const task = await runwareTask({ model: HEYGEN, prompt: 'Use the reference', inputMode: 'reference', inputField: 'referenceImages', images: [image, image], width: 768, height: 1024, durationSeconds: 15 });
    expect(task).toMatchObject({ resolution: '768p', inputs: { referenceImages: [image, image] }, duration: 15 });
    expect(task).not.toHaveProperty('width');
  });

  it('caps a reference run at 15 seconds and leaves text at 30', () => {
    expect(resolveDuration('runware', HEYGEN, 30, 'text')).toBe(30);
    expect(resolveDuration('runware', HEYGEN, 30, 'image')).toBe(30);
    expect(resolveDuration('runware', HEYGEN, 30, 'reference')).toBe(15);
    expect(resolveDuration('runware', HEYGEN, 2, 'reference')).toBe(5);
    expect(resolveDuration('runware', HEYGEN, 30)).toBe(30);
    expect(modeDuration(findModel('runware', HEYGEN), 'reference')).toEqual({ type: 'range', min: 5, max: 15, default: 5 });
    // A model with no per-mode ceiling is unchanged.
    expect(resolveDuration('runware', SEEDANCE, 30, 'reference')).toBe(30);
  });

  it('tells agents the same per-mode ceiling', () => {
    const modes = describeModels(['runware']).find((entry) => entry.modelId === HEYGEN)!.modes;
    const max = (mode: string) => modes.find((entry) => entry.mode === mode)?.fields.find((field) => field.key === 'durationSeconds')?.max;
    expect(modes.map((entry) => entry.mode)).toEqual(['text', 'image', 'reference']);
    expect([max('text'), max('image'), max('reference')]).toEqual([30, 30, 15]);
    expect(modes.find((entry) => entry.mode === 'reference')?.references).toEqual({ min: 1, max: 9 });
    expect(modes.every((entry) => entry.clips === undefined)).toBe(true);
  });
});

describe('Seedance 2.5 Flash on Runware', () => {
  it('sends frames with the tier, because width/height are refused with frame images', async () => {
    const task = await runwareTask({ model: FLASH, prompt: 'Go', inputMode: 'frames', inputField: 'frameImages', images: [image, image], width: 720, height: 1280, durationSeconds: 6 });
    expect(task).toMatchObject({ resolution: '720p', inputs: { frameImages: [image, image] }, duration: 6 });
    expect(task).not.toHaveProperty('width');
  });

  it('keeps the pixel pair for text and for reference runs', async () => {
    const text = await runwareTask({ model: FLASH, prompt: 'Go', inputMode: 'text', width: 854, height: 480, durationSeconds: 30 });
    expect(text).toMatchObject({ width: 854, height: 480, duration: 30 });
    expect(text).not.toHaveProperty('resolution');
    const reference = await runwareTask({ model: FLASH, prompt: '@Image1', inputMode: 'reference', inputField: 'referenceImages', images: [image], referenceVideos: ['v-uuid'], referenceAudios: ['a-uuid'], width: 1280, height: 720 });
    expect(reference).toMatchObject({ width: 1280, height: 720, inputs: { referenceImages: [image], referenceVideos: ['v-uuid'], referenceAudios: ['a-uuid'] } });
  });

  it('edits with operation edit at 480p or 720p, and has no 1080p or draft', async () => {
    const task = await runwareTask({ model: FLASH, prompt: 'Relight @Video1', inputMode: 'edit', sourceVideo: 'src-uuid', resolution: '720p' });
    expect(task).toMatchObject({ model: FLASH, inputs: { video: 'src-uuid' }, settings: { operation: 'edit' }, duration: 'auto', resolution: '720p' });
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
    vi.stubGlobal('fetch', fetch);
    await expect(runwareCreateVideo({ apiKey: 'k', model: FLASH, prompt: 'p', inputMode: 'edit', sourceVideo: 's', resolution: '1080p' })).rejects.toThrow('Invalid video edit settings.');
    await expect(runwareCreateVideo({ apiKey: 'k', model: FLASH, prompt: 'p', inputMode: 'edit', sourceVideo: 's', resolution: '480p', draft: true })).rejects.toThrow(/only available for Seedance 2\.5/);
    await expect(runwareCreateVideo({ apiKey: 'k', model: FLASH, prompt: 'p', inputMode: 'text', width: 854, height: 480, draft: true })).rejects.toThrow(/only available for Seedance 2\.5/);
    await expect(runwareCreateVideo({ apiKey: 'k', model: FLASH, prompt: '', inputMode: 'text', draftId: 'draft-1' })).rejects.toThrow('Only Seedance 2.5 can finalize a draft.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not change Seedance 2.5: frames keep pixels, draft and 1080p edits still run', async () => {
    const frames = await runwareTask({ model: SEEDANCE, prompt: 'Go', inputMode: 'frames', inputField: 'frameImages', images: [image, image], width: 854, height: 480, durationSeconds: 5, draft: true });
    expect(frames).toMatchObject({ width: 854, height: 480, settings: { draft: true } });
    expect(frames).not.toHaveProperty('resolution');
    const edit = await runwareTask({ model: SEEDANCE, prompt: 'Relight', inputMode: 'edit', sourceVideo: 's', resolution: '1080p' });
    expect(edit).toMatchObject({ resolution: '1080p', settings: { operation: 'edit' } });
    const draftEdit = await runwareTask({ model: SEEDANCE, prompt: 'Relight', inputMode: 'edit', sourceVideo: 's', resolution: '480p', draft: true });
    expect(draftEdit).toMatchObject({ settings: { operation: 'edit', draft: true } });
    const finalize = await runwareTask({ model: SEEDANCE, prompt: '', inputMode: 'text', draftId: 'draft-1' });
    expect(finalize).toMatchObject({ resolution: '1080p', inputs: { draftId: 'draft-1' } });
  });
});

describe('Atlas request bodies', () => {
  it('sends Seedance 2.5 Flash with `ratio`, the preset and reference media', async () => {
    const text = await atlasVideoBody({ model: 'bytedance/seedance-2.5-flash/text-to-video', prompt: 'p', inputMode: 'text', durationSeconds: 12, resolution: '480p', aspectRatio: '21:9' });
    expect(text).toEqual({ model: 'bytedance/seedance-2.5-flash/text-to-video', prompt: 'p', duration: 12, resolution: '480p', ratio: '21:9' });
    const frames = await atlasVideoBody({ model: 'bytedance/seedance-2.5-flash/image-to-video', prompt: 'p', inputMode: 'frames', inputField: 'frameImages', images: ['a', 'b'], durationSeconds: 5, resolution: '720p' });
    expect(frames).toEqual({ model: 'bytedance/seedance-2.5-flash/image-to-video', prompt: 'p', image: 'a', last_image: 'b', duration: 5, resolution: '720p' });
    const reference = await atlasVideoBody({ model: 'bytedance/seedance-2.5-flash/reference-to-video', prompt: '@Image1', inputMode: 'reference', inputField: 'referenceImages', images: ['a'], referenceVideos: ['v'], referenceAudios: ['s'], durationSeconds: 5, resolution: '720p', aspectRatio: '16:9' });
    expect(reference).toMatchObject({ reference_images: ['a'], reference_videos: ['v'], reference_audios: ['s'], ratio: '16:9' });
  });

  it('sends Kling 4.0 Flash text with aspect_ratio and image without one', async () => {
    const text = await atlasVideoBody({ model: 'kwaivgi/kling-v4.0-flash/text-to-video', prompt: 'p', inputMode: 'text', durationSeconds: 10, resolution: '720p', aspectRatio: '9:16' });
    expect(text).toEqual({ model: 'kwaivgi/kling-v4.0-flash/text-to-video', prompt: 'p', duration: 10, resolution: '720p', aspect_ratio: '9:16' });
    const frame = await atlasVideoBody({ model: 'kwaivgi/kling-v4.0-flash/image-to-video', prompt: 'p', inputMode: 'image', inputField: 'frameImages', images: ['a'], durationSeconds: 3, resolution: '720p', aspectRatio: '16:9' });
    expect(frame).toEqual({ model: 'kwaivgi/kling-v4.0-flash/image-to-video', prompt: 'p', image: 'a', duration: 3, resolution: '720p' });
    const reference = await atlasVideoBody({ model: 'kwaivgi/kling-v4.0-flash/reference-to-video', prompt: '@image_1', inputMode: 'reference', inputField: 'referenceImages', images: ['a', 'b'], durationSeconds: 20, resolution: '720p', aspectRatio: '1:1' });
    expect(reference).toEqual({ model: 'kwaivgi/kling-v4.0-flash/reference-to-video', prompt: '@image_1', reference_images: ['a', 'b'], duration: 20, resolution: '720p', aspect_ratio: '1:1' });
    expect(resolveDuration('atlas', 'kwaivgi/kling-v4.0-flash/text-to-video', 30)).toBe(20);
  });

  it('sends Kling Image 4.0 as a tier, a ratio and exactly one image', async () => {
    const model = 'kwaivgi/kling-image-v4.0/text-to-image';
    expect(await atlasImageBody({ model, prompt: 'a poster' })).toEqual({ model, prompt: 'a poster', aspect_ratio: '1:1', resolution: '2k', num_images: 1 });
    expect(await atlasImageBody({ model, prompt: 'a poster', aspectRatio: '21:9', resolution: '4K' })).toEqual({ model, prompt: 'a poster', aspect_ratio: '21:9', resolution: '4k', num_images: 1 });
    // A size no entry publishes falls back to the first one, 2K, which is what the ledger prices.
    expect((await atlasImageBody({ model, prompt: 'p', resolution: '8K' })).resolution).toBe('2k');
    const refs = ['https://cdn.atlas/a.png', 'https://cdn.atlas/b.png'];
    expect(await atlasImageBody({ model, prompt: '@image_1', aspectRatio: '3:2', resolution: '2K', images: refs })).toEqual({ model, prompt: '@image_1', aspect_ratio: '3:2', resolution: '2k', num_images: 1, reference_images: refs });
    // No pixel pair is published, so the shape control shows none.
    expect(imageDimensions('atlas', model, '16:9', '2K')).toBeNull();
  });
});
