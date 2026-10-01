// tests/moderation/payloads.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildFalInput, resolveFalVariant } from '@/lib/fal/catalog';
import { buildKieInput, resolveKieVariant } from '@/lib/kie/catalog';
import { atlasCreateImage } from '@/lib/providers/atlas';
import { cometGenerateImage } from '@/lib/providers/comet';
import { stripLockedModerationKeys } from '@/lib/moderation/capabilities';

afterEach(() => vi.unstubAllGlobals());

function fal(modelId: string, media: 'image' | 'video', mode: 'text' | 'image' | 'frames') {
  return resolveFalVariant(modelId, media, mode);
}

describe('provider payloads', () => {
  it('leaves fal Standard identical and adds safety_tolerance 6 only when Relaxed is text-only', () => {
    const nano = fal('nano-banana-2', 'image', 'text');
    const prompt = 'a red kite over a field';
    const standard = buildFalInput(nano, { prompt, uploadUrls: [], values: {} });
    expect(buildFalInput(nano, { prompt, uploadUrls: [], values: { moderation: 'standard' } })).toEqual(standard);
    expect(standard).not.toHaveProperty('safety_tolerance');
    expect(buildFalInput(nano, { prompt, uploadUrls: [], values: { moderation: 'relaxed' } })).toEqual({
      ...standard,
      safety_tolerance: '6',
    });

    const edit = fal('nano-banana-2', 'image', 'image');
    const referenced = buildFalInput(edit, {
      prompt,
      uploadUrls: ['https://files.example/ref.png'],
      values: { moderation: 'relaxed' },
    });
    expect(referenced).not.toHaveProperty('safety_tolerance');
    expect(referenced).toEqual(
      buildFalInput(edit, {
        prompt,
        uploadUrls: ['https://files.example/ref.png'],
        values: {},
      })
    );
  });

  it('sets safety_tolerance 6 on fal Veo 3.1 and Fast, and the Wan checker only on Relaxed', () => {
    for (const id of ['veo-3-1', 'veo-3-1-fast'] as const) {
      const variant = fal(id, 'video', 'text');
      const prompt = 'pan across a harbor';
      const standard = buildFalInput(variant, { prompt, uploadUrls: [], values: {} });
      expect(standard).not.toHaveProperty('safety_tolerance');
      expect(buildFalInput(variant, { prompt, uploadUrls: [], values: { moderation: 'relaxed' } })).toMatchObject({
        safety_tolerance: '6',
      });
    }

    const wan = fal('wan-2-7', 'video', 'text');
    const prompt = 'a paper boat in the rain';
    const standard = buildFalInput(wan, { prompt, uploadUrls: [], values: {} });
    expect(standard).not.toHaveProperty('enable_safety_checker');
    expect(buildFalInput(wan, { prompt, uploadUrls: [], values: { moderation: 'relaxed' } })).toMatchObject({
      enable_safety_checker: false,
    });
    expect(
      buildFalInput(wan, {
        prompt,
        uploadUrls: ['https://files.example/frame.png'],
        values: { moderation: 'relaxed' },
      })
    ).not.toHaveProperty('enable_safety_checker');
  });

  it('adds nothing on a fal route that has no knob', () => {
    const seedance = fal('seedance-2', 'video', 'text');
    const body = buildFalInput(seedance, {
      prompt: 'a rotating cube',
      uploadUrls: [],
      values: { moderation: 'relaxed' },
    });
    expect(body).not.toHaveProperty('safety_tolerance');
    expect(body).not.toHaveProperty('enable_safety_checker');
    expect(body).not.toHaveProperty('moderation');
    expect(body).toEqual(
      buildFalInput(seedance, { prompt: 'a rotating cube', uploadUrls: [], values: {} })
    );
  });

  it('keeps Kie checker true on Standard and turns it off only for FLUX.2 Pro and Z-Image', () => {
    for (const id of ['flux-2-pro', 'z-image'] as const) {
      const variant = resolveKieVariant(id, 'text');
      const standard = buildKieInput(variant, { prompt: 'a red kite', uploadUrls: [], values: {} });
      expect(standard.nsfw_checker).toBe(true);
      expect(
        buildKieInput(variant, { prompt: 'a red kite', uploadUrls: [], values: { moderation: 'standard' } })
      ).toEqual(standard);
      expect(
        buildKieInput(variant, { prompt: 'a red kite', uploadUrls: [], values: { moderation: 'relaxed' } }).nsfw_checker
      ).toBe(false);
    }

    const edit = resolveKieVariant('flux-2-pro', 'image');
    expect(
      buildKieInput(edit, {
        prompt: 'a red kite',
        uploadUrls: ['https://files.example/ref.png'],
        values: { moderation: 'relaxed' },
      }).nsfw_checker
    ).toBe(true);

    const imagen = resolveKieVariant('imagen-4-ultra', 'text');
    expect(buildKieInput(imagen, { prompt: 'a red kite', uploadUrls: [], values: {} }).nsfw_checker).toBe(true);
    expect(
      buildKieInput(imagen, { prompt: 'a red kite', uploadUrls: [], values: { moderation: 'relaxed' } }).nsfw_checker
    ).toBe(true);
  });

  it('never enables Kie Veo fallback, Grok spicy, or a real-person flag', () => {
    const veo = resolveKieVariant('veo-3-1', 'text');
    const input = buildKieInput(veo, {
      prompt: 'sunrise',
      uploadUrls: [],
      values: { enableFallback: true, moderation: 'relaxed' },
    });
    expect(input.enableFallback).toBe(false);
    expect(input).not.toHaveProperty('moderation');

    expect(
      stripLockedModerationKeys({
        prompt: 'x',
        real_person: true,
        enable_fallback: true,
        mode: 'spicy',
        enableFallback: true,
      })
    ).toEqual({ prompt: 'x', enableFallback: false });
  });

  it('sends Comet moderation low only for GPT Image 2 text, and omits it on Standard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ url: 'https://cdn.comet/a.png' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cometGenerateImage({ apiKey: 'cm', model: 'gpt-image-2', prompt: 'a paper crane', aspectRatio: '1:1' });
    const standard = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(standard).toEqual({ model: 'gpt-image-2', prompt: 'a paper crane', n: 1, size: '1024x1024' });
    expect(standard).not.toHaveProperty('moderation');

    await cometGenerateImage({
      apiKey: 'cm',
      model: 'gpt-image-2',
      prompt: 'a paper crane',
      aspectRatio: '1:1',
      moderation: 'relaxed',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).moderation).toBe('low');

    await cometGenerateImage({
      apiKey: 'cm',
      model: 'gpt-image-2',
      prompt: 'a paper crane',
      aspectRatio: '1:1',
      moderation: 'relaxed',
      images: ['data:image/png;base64,QUJD'],
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).not.toHaveProperty('moderation');

    await cometGenerateImage({
      apiKey: 'cm',
      model: 'qwen-image',
      prompt: 'a paper crane',
      moderation: 'relaxed',
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).not.toHaveProperty('moderation');
  });

  it('adds Atlas enable_safety_checker false only on FLUX.1 schnell text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'pred-1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const base = {
      apiKey: 'at',
      model: 'black-forest-labs/flux-schnell',
      prompt: 'a lighthouse',
      aspectRatio: '1:1' as const,
    };

    await atlasCreateImage(base);
    const standard = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(standard).not.toHaveProperty('enable_safety_checker');

    await atlasCreateImage({ ...base, moderation: 'relaxed' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).enable_safety_checker).toBe(false);

    await atlasCreateImage({ ...base, moderation: 'relaxed', images: ['https://files.example/ref.png'] });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).not.toHaveProperty('enable_safety_checker');

    await atlasCreateImage({ ...base, model: 'z-image/turbo', moderation: 'relaxed' });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).not.toHaveProperty('enable_safety_checker');
  });
});
