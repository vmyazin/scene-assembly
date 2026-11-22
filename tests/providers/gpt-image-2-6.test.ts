// tests/providers/gpt-image-2-6.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jobModelLabel } from '@/lib/account/job-label';
import { downloadFilenameBase, modelFileCode } from '@/lib/download-name';
import {
  KIE_MODELS,
  buildKieInput,
  currentKieModelId,
  kieModelLabel,
  modelsForKieMode,
  pastKieModel,
  resolveKieVariant,
} from '@/lib/kie/catalog';
import { moderationCapability } from '@/lib/moderation/capabilities';
import { atlasGenerateImage } from '@/lib/providers/atlas';
import { DEFAULT_MODELS, findModel, modelsFor, pastProviderModel, resolveModel } from '@/lib/providers/catalog';
import { cometGenerateImage } from '@/lib/providers/comet';
import { imageDimensions } from '@/lib/providers/output-size';
import { resultModelLabel } from '@/lib/results/reuse-run';
import { resolveCatalogRate } from '@/lib/spend/resolve';

/**
 * OpenAI retires GPT Image 2 on 2027-02-10. It left the Kie and Comet catalogs
 * on 2026-11-21, ahead of that date, so nothing here depends on the clock: the
 * old id is never offered or sent, and only its saved name and filename remain.
 */

afterEach(() => vi.unstubAllGlobals());

const WEIGHTS = ['sunburst', 'flare'] as const;

async function atlasBody(request: Parameters<typeof atlasGenerateImage>[0]) {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'pred-1' } }) });
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'pred-1', status: 'succeeded', outputs: ['https://cdn.atlas/out.png'] }) });
  vi.stubGlobal('fetch', fetchMock);
  await atlasGenerateImage(request, async () => {});
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
}

describe('Kie GPT Image 2.6', () => {
  it('lists Sunburst and Flare with the documented ids, and no GPT Image 2', () => {
    for (const weight of WEIGHTS) {
      const id = `gpt-image-2-6-${weight}`;
      expect(resolveKieVariant(id, 'text')).toMatchObject({ modelId: `gpt-image-2-6/${weight}-text-to-image`, protocol: 'market' });
      expect(resolveKieVariant(id, 'image')).toMatchObject({
        modelId: `gpt-image-2-6/${weight}-image-to-image`,
        imageInputKey: 'input_urls',
        maxInputImages: 16,
      });
    }
    expect(KIE_MODELS.some((model) => model.id === 'gpt-image-2')).toBe(false);
    expect(KIE_MODELS.flatMap((model) => model.variants).some((variant) => ['gpt-image-2-text-to-image', 'gpt-image-2-image-to-image'].includes(variant.modelId))).toBe(false);
    expect(modelsForKieMode('image', 'text').map((model) => model.label)).toEqual(
      expect.arrayContaining(['GPT Image 2.6 Sunburst', 'GPT Image 2.6 Flare'])
    );
  });

  it('sends only fields the closed schema names, with quality explicit', () => {
    const variant = resolveKieVariant('gpt-image-2-6-flare', 'image');
    expect(variant.fields.map((field) => field.key)).toEqual(['aspect_ratio', 'resolution', 'quality']);
    expect(
      buildKieInput(variant, {
        prompt: 'restyle as a cinematic still',
        uploadUrls: ['https://files.example/a.png', 'https://files.example/b.png'],
        values: { aspect_ratio: '16:9', resolution: '1K', quality: 'medium' },
      })
    ).toEqual({
      prompt: 'restyle as a cinematic still',
      input_urls: ['https://files.example/a.png', 'https://files.example/b.png'],
      aspect_ratio: '16:9',
      resolution: '1K',
      quality: 'medium',
      moderation: 'auto',
    });
  });

  it('writes moderation auto on Standard and low only on a relaxed text request', () => {
    const text = resolveKieVariant('gpt-image-2-6-sunburst', 'text');
    const standard = buildKieInput(text, { prompt: 'a paper crane', uploadUrls: [], values: {} });
    expect(standard.moderation).toBe('auto');
    const relaxed = buildKieInput(text, { prompt: 'a paper crane', uploadUrls: [], values: { moderation: 'relaxed' } });
    expect(relaxed.moderation).toBe('low');
    const image = resolveKieVariant('gpt-image-2-6-sunburst', 'image');
    const withRef = buildKieInput(image, { prompt: 'a paper crane', uploadUrls: ['https://files.example/a.png'], values: { moderation: 'relaxed' } });
    expect(withRef.moderation).toBe('auto');
  });

  it('covers both the catalog id and the vendor id in the moderation table', () => {
    for (const modelId of ['gpt-image-2-6-sunburst', 'gpt-image-2-6-flare', 'gpt-image-2-6/flare-text-to-image', 'gpt-image-2-6/sunburst-image-to-image']) {
      expect(moderationCapability({ provider: 'kie', modelId })).toMatchObject({ relaxable: true, key: 'moderation', relaxedValue: 'low', standardValue: 'auto' });
    }
    expect(moderationCapability({ provider: 'kie', modelId: 'gpt-image-2' }).relaxable).toBe(false);
  });

  it('keeps the name and filename of a saved GPT Image 2 job, and moves a stored selection on', () => {
    expect(pastKieModel('gpt-image-2')).toEqual({ label: 'GPT Image 2', fileCode: 'gpt-image-2', replacedBy: 'gpt-image-2-6-sunburst' });
    expect(kieModelLabel('gpt-image-2')).toBe('GPT Image 2');
    expect(jobModelLabel('kie', 'gpt-image-2')).toBe('GPT Image 2');
    expect(resultModelLabel({ provider: 'kie', modelId: 'gpt-image-2', mediaType: 'image' })).toBe('GPT Image 2');
    expect(modelFileCode('kie', 'gpt-image-2')).toBe('gpt-image-2');
    expect(downloadFilenameBase({ prompt: 'p', mediaType: 'image', slug: 'quiet-ocean', provider: 'kie', modelId: 'gpt-image-2' })).toBe('quiet-ocean-gpt-image-2');
    expect(currentKieModelId('gpt-image-2')).toBe('gpt-image-2-6-sunburst');
    expect(KIE_MODELS.some((model) => model.id === currentKieModelId('gpt-image-2'))).toBe(true);
    // A current id is left alone, and an unknown one is not invented.
    expect(currentKieModelId('flux-2-pro')).toBe('flux-2-pro');
    expect(kieModelLabel('never-existed')).toBe('never-existed');
    expect(modelFileCode('kie', 'gpt-image-2-6-flare')).toBe('gpt-image-2_6-flare');
  });
});

describe('Comet GPT Image 2.6', () => {
  it('lists both weights as metered text models and defaults to Sunburst', () => {
    expect(modelsFor('comet', 'image').map((model) => model.id).slice(0, 2)).toEqual(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']);
    for (const weight of WEIGHTS) {
      expect(findModel('comet', `gpt-image-2.6-${weight}`)).toMatchObject({ kind: 'image', modes: ['text'], price: 'metered' });
      expect(findModel('comet', `gpt-image-2.6-${weight}`)?.rate).toBeUndefined();
    }
    expect(findModel('comet', 'gpt-image-2')).toBeUndefined();
    expect(DEFAULT_MODELS.comet.image).toBe('gpt-image-2.6-sunburst');
    expect(findModel('comet', DEFAULT_MODELS.comet.image)?.kind).toBe('image');
  });

  it('sends a stored GPT Image 2 selection to its successor, never the retired id', () => {
    expect(resolveModel('comet', 'image', 'gpt-image-2')).toBe('gpt-image-2.6-sunburst');
    expect(resolveModel('comet', 'image', 'gpt-image-2.6-flare')).toBe('gpt-image-2.6-flare');
    // The record is Comet's alone: another provider still falls to its default.
    expect(resolveModel('atlas', 'image', 'gpt-image-2')).toBe(DEFAULT_MODELS.atlas.image);
    expect(resolveModel('comet', 'video', 'gpt-image-2')).toBe(DEFAULT_MODELS.comet.video);
  });

  it('keeps the name, filename and unknown-cost row of a saved GPT Image 2 job', () => {
    expect(pastProviderModel('comet', 'gpt-image-2')).toMatchObject({ label: 'GPT Image 2', fileCode: 'gpt-image-2' });
    expect(jobModelLabel('comet', 'gpt-image-2')).toBe('GPT Image 2');
    expect(modelFileCode('comet', 'gpt-image-2')).toBe('gpt-image-2');
    expect(modelFileCode('comet', 'gpt-image-2.6-sunburst')).toBe('gpt-image-2_6-sunburst');
    expect(pastProviderModel('runware', 'gpt-image-2')).toBeUndefined();
    expect(resolveCatalogRate(findModel('comet', 'gpt-image-2'), undefined, 1).costUsd).toBeNull();
  });

  it('posts the new id and relaxes only a text request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'QUJD' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await cometGenerateImage({ apiKey: 'cm', model: 'gpt-image-2.6-flare', prompt: 'a paper crane', aspectRatio: '16:9' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ model: 'gpt-image-2.6-flare', prompt: 'a paper crane', n: 1, size: '1536x864' });
    await cometGenerateImage({ apiKey: 'cm', model: 'gpt-image-2.6-flare', prompt: 'a paper crane', aspectRatio: '1:1', moderation: 'relaxed' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).moderation).toBe('low');
    expect(moderationCapability({ provider: 'comet', modelId: 'gpt-image-2' }).relaxable).toBe(false);
  });
});

describe('Atlas GPT Image 2.6', () => {
  it('lists both weights ahead of 2.5 Developer, which stays', () => {
    const ids = modelsFor('atlas', 'image').map((model) => model.id);
    for (const weight of WEIGHTS) {
      expect(ids).toContain(`openai/gpt-image-2.6-${weight}/text-to-image`);
      expect(ids).toContain(`openai/gpt-image-2.6-${weight}/edit`);
      expect(findModel('atlas', `openai/gpt-image-2.6-${weight}/edit`)).toMatchObject({ modes: ['image'], maxInputImages: 16 });
      expect(findModel('atlas', `openai/gpt-image-2.5-${weight}-developer/text-to-image`)?.deprecated).toBeUndefined();
    }
    expect(ids.indexOf('openai/gpt-image-2.6-sunburst/text-to-image')).toBeLessThan(ids.indexOf('openai/gpt-image-2.5-sunburst-developer/text-to-image'));
  });

  it('pins quality to medium, the tier the rate is quoted at', async () => {
    expect(await atlasBody({ apiKey: 'at', model: 'openai/gpt-image-2.6-sunburst/text-to-image', prompt: 'a ramen stall', aspectRatio: '1:1' })).toEqual({
      model: 'openai/gpt-image-2.6-sunburst/text-to-image',
      prompt: 'a ramen stall',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    });
    const edit = await atlasBody({
      apiKey: 'at',
      model: 'openai/gpt-image-2.6-flare/edit',
      prompt: 'a ramen stall',
      aspectRatio: '16:9',
      background: 'transparent',
      images: ['https://cdn.atlas/ref.png'],
    });
    expect(edit).toMatchObject({ size: '2048x1152', quality: 'medium', n: 1, background: 'transparent', output_format: 'png', images: ['https://cdn.atlas/ref.png'] });
  });

  it('sends the exact wide and tall sizes 2.5 has to snap', () => {
    const model = 'openai/gpt-image-2.6-sunburst/text-to-image';
    expect(imageDimensions('atlas', model, '16:9')).toEqual([2048, 1152]);
    expect(imageDimensions('atlas', model, '9:16')).toEqual([1152, 2048]);
    expect(imageDimensions('atlas', model, '21:9')).toEqual([2560, 1088]);
    expect(imageDimensions('atlas', model, '3:2')).toEqual([1536, 1024]);
    // 2.5 keeps its own table.
    expect(imageDimensions('atlas', 'openai/gpt-image-2.5-sunburst-developer/text-to-image', '16:9')).toEqual([1536, 1024]);
  });

  it('prices at the calculator quote, with every edit input billed', () => {
    const text = findModel('atlas', 'openai/gpt-image-2.6-sunburst/text-to-image');
    const edit = findModel('atlas', 'openai/gpt-image-2.6-flare/edit');
    expect(resolveCatalogRate(text, undefined, 1).costUsd).toBeCloseTo(0.0146, 8);
    // Calculator, 2026-11-21: 1 input $0.040136, 2 inputs $0.065736, 4 inputs $0.116936.
    const one = resolveCatalogRate(edit, undefined, 1, { inputMode: 'image', inputImages: 1 }).costUsd!;
    const two = resolveCatalogRate(edit, undefined, 1, { inputMode: 'image', inputImages: 2 }).costUsd!;
    const four = resolveCatalogRate(edit, undefined, 1, { inputMode: 'image', inputImages: 4 }).costUsd!;
    expect(one).toBeCloseTo(0.0402, 8);
    expect(two).toBeCloseTo(0.0658, 8);
    expect(four).toBeCloseTo(0.117, 8);
    // Never under the quote.
    expect(one).toBeGreaterThanOrEqual(0.040136);
    expect(two).toBeGreaterThanOrEqual(0.065736);
    expect(four).toBeGreaterThanOrEqual(0.116936);
  });
});
