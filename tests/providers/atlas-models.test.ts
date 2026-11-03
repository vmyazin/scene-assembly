// tests/providers/atlas-models.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAccountSpendEntry } from '@/lib/spend/account';
import { atlasEditBody, atlasGenerateImage } from '@/lib/providers/atlas';
import type { CloudJobRequest } from '@/lib/account/contracts';

const noSleep = async () => {};

function mockFetchSequence(payloads: unknown[]) {
  const fetchMock = vi.fn();
  for (const payload of payloads) {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function imageBody(request: Parameters<typeof atlasGenerateImage>[0]) {
  const fetchMock = mockFetchSequence([
    { data: { id: 'pred-1' } },
    { id: 'pred-1', status: 'succeeded', outputs: ['https://cdn.atlas/out.png'] },
  ]);
  await atlasGenerateImage(request, noSleep);
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
}

function spend(request: CloudJobRequest) {
  return buildAccountSpendEntry({
    jobId: 'job',
    request,
    result: { sources: [{ url: 'https://cdn.atlas/out.png' }] },
    at: 1,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Atlas image request shaping', () => {
  it('leaves GPT Image unchanged until a background is chosen, then forces PNG for transparent', async () => {
    const plain = await imageBody({
      apiKey: 'at-key',
      model: 'openai/gpt-image-2.5-sunburst-developer/text-to-image',
      prompt: 'a ramen stall',
      aspectRatio: '1:1',
    });
    expect(plain).toEqual({
      model: 'openai/gpt-image-2.5-sunburst-developer/text-to-image',
      prompt: 'a ramen stall',
      size: '1024x1024',
      n: 1,
    });

    const transparent = await imageBody({
      apiKey: 'at-key',
      model: 'openai/gpt-image-2.5-flare-developer/edit',
      prompt: 'a ramen stall',
      aspectRatio: '1:1',
      background: 'transparent',
      images: ['https://cdn.atlas/ref.png'],
    });
    expect(transparent).toMatchObject({
      background: 'transparent',
      output_format: 'png',
      images: ['https://cdn.atlas/ref.png'],
      size: '1024x1024',
    });
  });

  it('uses Seedream Flash sizes and sends transparent edits as PNG', async () => {
    const text = await imageBody({
      apiKey: 'at-key',
      model: 'bytedance/seedream-v5.0-flash/text-to-image',
      prompt: 'a lighthouse',
      aspectRatio: '16:9',
    });
    expect(text.size).toBe('2816*1584');
    expect(text.background).toBeUndefined();

    const edit = await imageBody({
      apiKey: 'at-key',
      model: 'bytedance/seedream-v5.0-flash/edit',
      prompt: 'a lighthouse',
      aspectRatio: '4:3',
      background: 'transparent',
      images: ['https://cdn.atlas/a.png'],
    });
    expect(edit).toMatchObject({
      size: '2368*1776',
      background: 'transparent',
      output_format: 'png',
      images: ['https://cdn.atlas/a.png'],
    });
  });

  it('sends MAI-Image-2.6 a pixel size, and its edit the default size plus reference images', async () => {
    const text = await imageBody({
      apiKey: 'at-key',
      model: 'microsoft/mai-image-2.6/text-to-image',
      prompt: 'a lighthouse',
      aspectRatio: '21:9',
    });
    expect(text).toMatchObject({ size: '2016*864', num_images: 1 });
    expect(text.reference_images).toBeUndefined();

    const edit = await imageBody({
      apiKey: 'at-key',
      model: 'microsoft/mai-image-2.6/edit',
      prompt: 'a lighthouse',
      images: ['https://cdn.atlas/a.png', 'https://cdn.atlas/b.png'],
    });
    expect(edit).toMatchObject({
      size: 'default',
      reference_images: ['https://cdn.atlas/a.png', 'https://cdn.atlas/b.png'],
    });
    expect(edit.images).toBeUndefined();
  });
});

describe('Atlas video edit request shaping', () => {
  it('sends FLUX 3 only the source URL and the prompt', () => {
    expect(atlasEditBody({
      apiKey: 'at-key',
      model: 'black-forest-labs/flux-3/edit-video',
      prompt: 'keep the motion, make it clay',
      sourceVideo: 'https://cdn.atlas/clip.mp4',
      inputMode: 'edit',
      resolution: '1080p',
      outputDuration: 10,
    })).toEqual({
      model: 'black-forest-labs/flux-3/edit-video',
      prompt: 'keep the motion, make it clay',
      video_url: 'https://cdn.atlas/clip.mp4',
    });
  });

  it('sends Luma restyle the generated length and strength, and reframe a required ratio', () => {
    expect(atlasEditBody({
      apiKey: 'at-key',
      model: 'luma/ray-3.2/video-to-video',
      prompt: 'clay animation',
      sourceVideo: 'https://cdn.atlas/clip.mp4',
      inputMode: 'edit',
      resolution: '720p',
      outputDuration: 10,
      strength: 'reimagine_2',
      sourceDurationSeconds: 4,
    })).toEqual({
      model: 'luma/ray-3.2/video-to-video',
      prompt: 'clay animation',
      video: 'https://cdn.atlas/clip.mp4',
      duration: 10,
      resolution: '720p',
      strength: 'reimagine_2',
    });

    expect(atlasEditBody({
      apiKey: 'at-key',
      model: 'luma/ray-3.2/reframe',
      prompt: 'portrait',
      sourceVideo: 'https://cdn.atlas/clip.mp4',
      inputMode: 'edit',
      resolution: '1080p',
      aspectRatio: '9:16',
    })).toEqual({
      model: 'luma/ray-3.2/reframe',
      prompt: 'portrait',
      video: 'https://cdn.atlas/clip.mp4',
      aspect_ratio: '9:16',
      resolution: '1080p',
    });
  });
});

describe('Atlas ledger for the new rates', () => {
  it('bills a Nano Banana 2.1 image from the saved resolution', () => {
    expect(spend({
      provider: 'atlas',
      modelId: 'google/nano-banana-2.1-developer/text-to-image',
      mediaType: 'image',
      inputMode: 'text',
      prompt: 'a lighthouse',
      referenceIds: [],
      values: { resolution: '4K', aspectRatio: '1:1' },
    }).costUsd).toBeCloseTo(0.049, 8);
  });

  it('bills Luma restyle for the generated length when the source is shorter', () => {
    expect(spend({
      provider: 'atlas',
      modelId: 'luma/ray-3.2/video-to-video',
      mediaType: 'video',
      inputMode: 'edit',
      prompt: 'clay',
      referenceIds: [],
      sourceVideoId: 'source',
      values: { size: '540p', outputDuration: 10, sourceDurationSeconds: 4, strength: 'flex_2' },
    }).costUsd).toBeCloseTo(1.584, 6);
  });

  it('bills reframe and FLUX from the measured source', () => {
    expect(spend({
      provider: 'atlas',
      modelId: 'luma/ray-3.2/reframe',
      mediaType: 'video',
      inputMode: 'edit',
      prompt: 'portrait',
      referenceIds: [],
      sourceVideoId: 'source',
      values: { size: '720p', aspectRatio: '9:16', sourceDurationSeconds: 5 },
    }).costUsd).toBeCloseTo(0.66, 6);
    expect(spend({
      provider: 'atlas',
      modelId: 'black-forest-labs/flux-3/edit-video',
      mediaType: 'video',
      inputMode: 'edit',
      prompt: 'clay',
      referenceIds: [],
      sourceVideoId: 'source',
      values: { sourceDurationSeconds: 5.366667 },
    }).costUsd).toBeCloseTo(0.1771, 4);
  });
});
