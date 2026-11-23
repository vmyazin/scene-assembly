// tests/providers/ideogram-4-6.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/generate/route';
import { describeModels } from '@/lib/account/model-schema';
import { providerImageSpecs } from '@/lib/models/listbox-specs';
import {
  DEFAULT_MODELS,
  findModel,
  IDEOGRAM_46_2K_PIXELS,
  IDEOGRAM_46_MODEL,
  IDEOGRAM_46_PRECISE_EDIT_MODEL,
  imageSizesForQuality,
  modelsFor,
  PROVIDER_MODELS,
  resolveImageQuality,
} from '@/lib/providers/catalog';
import { MODEL_PROMOTIONS, modelPromotionAt, withModelSale } from '@/lib/providers/model-promotions';
import { imageDimensions, RUNWARE_IDEOGRAM_46_DIMENSIONS, runwareDimensionTable } from '@/lib/providers/output-size';
import { runwareCreateImage, runwareGenerateImage } from '@/lib/providers/runware';
import type { ImageRequest } from '@/lib/providers/types';
import { captureImageResult } from '@/lib/spend/capture';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { useSpendStore } from '@/store/useSpendStore';

const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const REFS = ['data:image/png;base64,AAA', 'data:image/png;base64,BBB', 'data:image/png;base64,CCC', 'data:image/png;base64,DDD', 'data:image/png;base64,EEE'];

afterEach(() => vi.unstubAllGlobals());

/** The task Runware would receive, without sending anything. */
async function task(request: Omit<ImageRequest, 'apiKey' | 'prompt'> & { prompt?: string }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ data: [{ imageURL: 'https://im.runware.ai/a.jpg', cost: 0.06 }] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  await runwareGenerateImage({ apiKey: 'rw-key', prompt: 'A poster that says OPEN LATE', ...request });
  const [sent] = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Array<Record<string, unknown>>;
  return sent;
}

const generation = findModel('runware', IDEOGRAM_46_MODEL)!;
const precise = findModel('runware', IDEOGRAM_46_PRECISE_EDIT_MODEL)!;

describe('Ideogram 4.6 in the catalog', () => {
  it('lists both vendor ids verbatim, once, among the Runware image models', () => {
    expect(IDEOGRAM_46_MODEL).toBe('ideogram:4.6@0');
    expect(IDEOGRAM_46_PRECISE_EDIT_MODEL).toBe('ideogram:4.6@precise-edit');
    const ids = modelsFor('runware', 'image').map((model) => model.id);
    for (const id of [IDEOGRAM_46_MODEL, IDEOGRAM_46_PRECISE_EDIT_MODEL]) expect(ids.filter((entry) => entry === id)).toHaveLength(1);
    // After the existing image models, so nobody's first-run list is reordered.
    expect(ids).toEqual(['runware:z-image@turbo', 'bfl:flux@3-image-klein', 'runware:400@1', 'runware:108@22', IDEOGRAM_46_MODEL, IDEOGRAM_46_PRECISE_EDIT_MODEL]);
    const codes = PROVIDER_MODELS.runware.map((model) => model.fileCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(generation.fileCode).toBe('ideogram-4_6');
    expect(precise.fileCode).toBe('ideogram-4_6-precise-edit');
  });

  it('describes generation as text plus a reference edit, and Precise Edit as a separate edit-only entry', () => {
    expect(generation).toMatchObject({
      label: 'Ideogram 4.6', kind: 'image', modes: ['text', 'image'],
      imageInput: 'reference', maxInputImages: 5, maxPromptLength: 10_000,
      sizes: [{ label: '2K', preset: '2k' }, { label: '4K', preset: '4k' }],
    });
    expect(generation.aspectRatios).toBeUndefined();
    expect(precise).toMatchObject({
      label: 'Ideogram 4.6 Precise Edit', kind: 'image', modes: ['image'],
      // The source plus up to four reference images.
      imageInput: 'seed', maxInputImages: 5, maxPromptLength: 10_000,
      // No shape and no size: the result keeps the source's dimensions.
      aspectRatios: [],
    });
    expect(precise.sizes).toBeUndefined();
  });

  it('offers the four published qualities with the vendor default selected', () => {
    for (const model of [generation, precise]) {
      expect(model.qualities?.options.map((option) => option.value)).toEqual(['very_low', 'low', 'medium', 'high']);
      expect(model.qualities?.default).toBe('medium');
      expect(resolveImageQuality(model)).toBe('medium');
      expect(resolveImageQuality(model, 'low')).toBe('low');
      expect(resolveImageQuality(model, 'ultra')).toBe('medium');
      expect(resolveImageQuality(model, 4)).toBe('medium');
    }
    expect(resolveImageQuality(findModel('runware', 'runware:z-image@turbo'), 'low')).toBeUndefined();
  });

  it('takes 4K off the size list while very low is selected', () => {
    expect(imageSizesForQuality(generation, 'very_low')?.map((size) => size.label)).toEqual(['2K']);
    for (const quality of ['low', 'medium', 'high', undefined]) {
      expect(imageSizesForQuality(generation, quality)?.map((size) => size.label)).toEqual(['2K', '4K']);
    }
    expect(imageSizesForQuality(precise, 'very_low')).toBeUndefined();
  });

  it('does not become a default, and carries no dated sale', () => {
    expect(DEFAULT_MODELS.runware.image).toBe('runware:z-image@turbo');
    for (const model of [generation, precise]) {
      expect(modelPromotionAt(model.id, Date.parse('2026-11-23T00:00:00Z'))).toBeUndefined();
      expect(withModelSale(model, Date.parse('2026-11-23T00:00:00Z'))).toBe(model);
    }
    expect(MODEL_PROMOTIONS.some((promotion) => promotion.modelIds.some((id) => id.startsWith('ideogram')))).toBe(false);
  });

  it('shows the cheapest figure, the reference cap and the edit mark in the picker', () => {
    const cells = (model: typeof generation) => providerImageSpecs(model).map((cell) => (cell.kind === 'text' ? cell.value : cell.kind === 'mark' ? cell.on : null));
    expect(cells(generation)).toEqual(['$0.008/img', '5', true]);
    expect(cells(precise)).toEqual(['$0.008/img', '5', true]);
  });
});

describe('Ideogram 4.6 dimensions', () => {
  it('keeps every pair on the 32-pixel grid, inside 256–4096 and 1:6 to 6:1', () => {
    for (const table of Object.values(RUNWARE_IDEOGRAM_46_DIMENSIONS)) {
      expect(Object.keys(table)).toEqual(RATIOS);
      for (const [width, height] of Object.values(table)) {
        for (const edge of [width, height]) {
          expect(edge % 32).toBe(0);
          expect(edge).toBeGreaterThanOrEqual(256);
          expect(edge).toBeLessThanOrEqual(4096);
        }
        expect(width / height).toBeLessThanOrEqual(6);
        expect(height / width).toBeLessThanOrEqual(6);
      }
    }
  });

  it('keeps every pair exactly the ratio it is named for', () => {
    for (const table of Object.values(RUNWARE_IDEOGRAM_46_DIMENSIONS)) {
      for (const [ratio, [width, height]] of Object.entries(table)) {
        const [a, b] = ratio.split(':').map(Number);
        expect(width * b).toBe(height * a);
      }
    }
  });

  it('puts every 2K pair at or under 4.19 MP and every 4K pair above it, so the tier shown is the tier billed', () => {
    expect(IDEOGRAM_46_2K_PIXELS).toBe(2048 * 2048);
    for (const [width, height] of Object.values(RUNWARE_IDEOGRAM_46_DIMENSIONS['2k'])) expect(width * height).toBeLessThanOrEqual(IDEOGRAM_46_2K_PIXELS);
    for (const [width, height] of Object.values(RUNWARE_IDEOGRAM_46_DIMENSIONS['4k'])) expect(width * height).toBeGreaterThan(IDEOGRAM_46_2K_PIXELS);
    // The two sizes the vendor's own examples send.
    expect(RUNWARE_IDEOGRAM_46_DIMENSIONS['2k']['1:1']).toEqual([2048, 2048]);
    expect(RUNWARE_IDEOGRAM_46_DIMENSIONS['4k']['16:9']).toEqual([4096, 2304]);
  });

  it('tells the size control the pixels each tier sends, and nothing for Precise Edit', () => {
    expect(imageDimensions('runware', IDEOGRAM_46_MODEL, '16:9', '2K')).toEqual([2560, 1440]);
    expect(imageDimensions('runware', IDEOGRAM_46_MODEL, '16:9', '4K')).toEqual([4096, 2304]);
    expect(imageDimensions('runware', IDEOGRAM_46_MODEL, '9:16')).toEqual([1440, 2560]);
    expect(imageDimensions('runware', IDEOGRAM_46_MODEL, '5:4', '8K')).toEqual([2048, 2048]);
    expect(imageDimensions('runware', IDEOGRAM_46_PRECISE_EDIT_MODEL, '16:9')).toBeNull();
    expect(runwareDimensionTable(IDEOGRAM_46_PRECISE_EDIT_MODEL)).toBeNull();
    // Every other Runware image model keeps the table it had.
    expect(imageDimensions('runware', 'runware:z-image@turbo', '16:9')).toEqual([1344, 768]);
    expect(imageDimensions('runware', undefined, '9:16')).toEqual([768, 1344]);
  });
});

describe('Ideogram 4.6 request', () => {
  it('sends text-to-image with the tier’s pixels and the default quality', async () => {
    const sent = await task({ model: IDEOGRAM_46_MODEL, aspectRatio: '16:9' });
    expect(sent).toMatchObject({
      taskType: 'imageInference', model: 'ideogram:4.6@0', positivePrompt: 'A poster that says OPEN LATE',
      width: 2560, height: 1440, numberResults: 1, includeCost: true, settings: { quality: 'medium' },
    });
    expect(sent.inputs).toBeUndefined();
  });

  it.each([
    ['very_low', '2K', [2048, 2048]],
    ['low', '2K', [2048, 2048]],
    ['medium', '4K', [4096, 4096]],
    ['high', '4K', [4096, 4096]],
    ['high', '4k', [4096, 4096]],
  ] as const)('maps quality %s at %s to settings.quality and the tier', async (quality, resolution, [width, height]) => {
    const sent = await task({ model: IDEOGRAM_46_MODEL, aspectRatio: '1:1', quality, resolution });
    expect(sent.settings).toEqual({ quality });
    expect([sent.width, sent.height]).toEqual([width, height]);
  });

  it('never sends very low above 4.19 MP, whatever size was left selected', async () => {
    for (const aspectRatio of RATIOS) {
      const sent = await task({ model: IDEOGRAM_46_MODEL, aspectRatio, quality: 'very_low', resolution: '4K' });
      expect(sent.settings).toEqual({ quality: 'very_low' });
      expect((sent.width as number) * (sent.height as number)).toBeLessThanOrEqual(IDEOGRAM_46_2K_PIXELS);
    }
  });

  it('falls back to the default quality and tier for values it does not publish', async () => {
    const sent = await task({ model: IDEOGRAM_46_MODEL, aspectRatio: '3:2', quality: 'ultra', resolution: '1K' });
    expect(sent.settings).toEqual({ quality: 'medium' });
    expect([sent.width, sent.height]).toEqual([2496, 1664]);
  });

  it('sends a reference edit as referenceImages, the source first, up to five, with dimensions', async () => {
    const sent = await task({ model: IDEOGRAM_46_MODEL, aspectRatio: '4:3', imageInput: 'reference', images: [...REFS, 'data:image/png;base64,FFF'], quality: 'low' });
    expect(sent.inputs).toEqual({ referenceImages: REFS });
    expect([sent.width, sent.height]).toEqual([2304, 1728]);
    expect(sent.settings).toEqual({ quality: 'low' });
  });

  it('never writes magicPrompt, background or a seed, with or without references', async () => {
    for (const images of [undefined, REFS.slice(0, 2)]) {
      const sent = await task({ model: IDEOGRAM_46_MODEL, imageInput: 'reference', ...(images ? { images } : {}) });
      expect(Object.keys(sent.settings as object)).toEqual(['quality']);
      expect(JSON.stringify(sent)).not.toMatch(/magicPrompt|background|seed"|outputFormat/);
    }
  });

  it('submits the same task for a background job', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await runwareCreateImage({ apiKey: 'rw-key', model: IDEOGRAM_46_MODEL, prompt: 'A sign', aspectRatio: '9:16', resolution: '4K', quality: 'high' });
    const [sent] = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent).toMatchObject({ model: 'ideogram:4.6@0', width: 2304, height: 4096, settings: { quality: 'high' }, deliveryMethod: 'async' });
  });
});

describe('Ideogram 4.6 Precise Edit request', () => {
  it('sends the source as seedImage and no width or height', async () => {
    const sent = await task({ model: IDEOGRAM_46_PRECISE_EDIT_MODEL, imageInput: 'seed', images: REFS.slice(0, 1), aspectRatio: '16:9', resolution: '4K' });
    expect(sent).toMatchObject({ taskType: 'imageInference', model: 'ideogram:4.6@precise-edit', settings: { quality: 'medium' } });
    expect(sent.inputs).toEqual({ seedImage: REFS[0] });
    expect(sent).not.toHaveProperty('width');
    expect(sent).not.toHaveProperty('height');
    expect(sent).not.toHaveProperty('resolution');
  });

  it('sends the rest as referenceImages, four at most', async () => {
    const sent = await task({ model: IDEOGRAM_46_PRECISE_EDIT_MODEL, imageInput: 'seed', images: [...REFS, 'data:image/png;base64,FFF'], quality: 'high' });
    expect(sent.inputs).toEqual({ seedImage: REFS[0], referenceImages: REFS.slice(1) });
    expect((sent.inputs as { referenceImages: string[] }).referenceImages).toHaveLength(4);
    expect(sent.settings).toEqual({ quality: 'high' });
  });

  it.each(['very_low', 'low', 'medium', 'high'])('maps quality %s and writes no mask, edit region or magicPrompt', async (quality) => {
    const sent = await task({ model: IDEOGRAM_46_PRECISE_EDIT_MODEL, imageInput: 'seed', images: REFS.slice(0, 2), quality });
    expect(sent.settings).toEqual({ quality });
    expect(JSON.stringify(sent)).not.toMatch(/maskImage|editRegion|magicPrompt/);
  });
});

describe('the image models that were already on Runware', () => {
  it('still send their pixels, four references at most, and no settings', async () => {
    const sent = await task({ model: 'bfl:flux@3-image-klein', aspectRatio: '16:9', imageInput: 'reference', images: REFS, quality: 'high', resolution: '4K' });
    expect([sent.width, sent.height]).toEqual([1344, 768]);
    expect(sent.inputs).toEqual({ referenceImages: REFS.slice(0, 4) });
    expect(sent).not.toHaveProperty('settings');
    const seeded = await task({ model: 'runware:z-image@turbo', imageInput: 'seed', images: REFS.slice(0, 1) });
    expect(seeded.inputs).toEqual({ seedImage: REFS[0] });
    expect([seeded.width, seeded.height]).toEqual([1024, 1024]);
  });
});

describe('POST /api/generate with Ideogram 4.6', () => {
  async function post(body: Record<string, unknown>) {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ imageURL: 'https://im.runware.ai/a.jpg', cost: 0.03 }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array(200).fill(7).buffer });
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new Request('http://localhost/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'runware', apiKey: 'rw-key', prompt: 'A neon sign', ...body }),
    }) as never);
    const [sent] = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Array<Record<string, unknown>>;
    return { sent, json: await response.json() };
  }

  it('passes the chosen quality and size through, and returns the reported cost', async () => {
    const { sent, json } = await post({ model: IDEOGRAM_46_MODEL, config: { aspectRatio: '16:9', imageSize: '4K', quality: 'low' } });
    expect(sent).toMatchObject({ model: 'ideogram:4.6@0', width: 4096, height: 2304, settings: { quality: 'low' } });
    expect(json).toMatchObject({ success: true, cost: 0.03 });
  });

  it('ignores a quality the model does not publish', async () => {
    const { sent } = await post({ model: IDEOGRAM_46_MODEL, config: { aspectRatio: '1:1', quality: 'max' } });
    expect(sent.settings).toEqual({ quality: 'medium' });
    expect([sent.width, sent.height]).toEqual([2048, 2048]);
  });

  it('routes Precise Edit references to seedImage, trimmed to five', async () => {
    const { sent } = await post({ model: IDEOGRAM_46_PRECISE_EDIT_MODEL, images: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'], config: { aspectRatio: '16:9', imageSize: '4K', quality: 'very_low' } });
    const inputs = sent.inputs as { seedImage: string; referenceImages: string[] };
    expect(inputs.seedImage).toBe('data:image/png;base64,AAA');
    expect(inputs.referenceImages).toHaveLength(4);
    expect(sent).not.toHaveProperty('width');
    expect(sent.settings).toEqual({ quality: 'very_low' });
  });

  it('leaves a model without qualities or sizes exactly as it was', async () => {
    const { sent } = await post({ model: 'runware:z-image@turbo', config: { aspectRatio: '1:1', imageSize: '4K', quality: 'high' } });
    expect(sent).not.toHaveProperty('settings');
    expect([sent.width, sent.height]).toEqual([1024, 1024]);
  });
});

describe('Ideogram 4.6 price estimate', () => {
  const price = (model: typeof generation, controls: Parameters<typeof resolveCatalogRate>[3]) => resolveCatalogRate(model, undefined, 1, controls);

  // https://runware.ai/docs/models/ideogram-4-6 — "Text to image", read 2026-11-23.
  it.each([
    ['very_low', '2K', 0.008], ['low', '2K', 0.03], ['low', '4K', 0.06],
    ['medium', '2K', 0.06], ['medium', '4K', 0.12], ['high', '2K', 0.10], ['high', '4K', 0.20],
  ])('prices text-to-image at %s, %s as $%s', (quality, size, usd) => {
    expect(price(generation, { inputMode: 'text', quality, size, inputImages: 0 })).toMatchObject({ costUsd: usd, confidence: 'estimated', quantity: { unit: 'image', value: 1 } });
  });

  // Same page, "Image to image".
  it.each([
    ['very_low', '2K', 0.008], ['low', '2K', 0.03], ['low', '4K', 0.06],
    ['medium', '2K', 0.06], ['medium', '4K', 0.20], ['high', '2K', 0.22], ['high', '4K', 0.60],
  ])('prices a reference edit at %s, %s as $%s', (quality, size, usd) => {
    expect(price(generation, { inputMode: 'image', quality, size, inputImages: 2 }).costUsd).toBe(usd);
    // The table is per run: more references do not add to it.
    expect(price(generation, { inputMode: 'image', quality, size, inputImages: 5 }).costUsd).toBe(usd);
  });

  it('never prices very low at 4K, an unlisted quality, or a run with no size', () => {
    for (const inputMode of ['text', 'image']) {
      expect(price(generation, { inputMode, quality: 'very_low', size: '4K' })).toMatchObject({ costUsd: null, confidence: 'unknown' });
      expect(price(generation, { inputMode, quality: 'ultra', size: '2K' })).toMatchObject({ costUsd: null, confidence: 'unknown' });
      expect(price(generation, { inputMode, quality: 'high' })).toMatchObject({ costUsd: null, confidence: 'unknown' });
      expect(price(generation, { inputMode, quality: 'high', size: '8K' })).toMatchObject({ costUsd: null, confidence: 'unknown' });
    }
  });

  it('prices a request that names no quality at the vendor default, medium', () => {
    expect(price(generation, { inputMode: 'text', size: '2K' }).costUsd).toBe(0.06);
    expect(price(generation, { inputMode: 'text', size: '4K' }).costUsd).toBe(0.12);
    expect(price(generation, { inputMode: 'image', size: '4K' }).costUsd).toBe(0.20);
  });

  // https://runware.ai/docs/models/ideogram-4-6-precise-edit, read 2026-11-23.
  it.each([
    ['very_low', 0.008, 0.008], ['low', 0.03, 0.06], ['medium', 0.06, 0.20], ['high', 0.22, 0.60],
  ])('prices Precise Edit at %s by the source’s pixel count', (quality, upTo2k, above) => {
    const at = (outputPixels?: number) => price(precise, { inputMode: 'image', quality, inputImages: 1, ...(outputPixels ? { outputPixels } : {}) }).costUsd;
    expect(at(1024 * 1024)).toBe(upTo2k);
    expect(at(IDEOGRAM_46_2K_PIXELS)).toBe(upTo2k);
    expect(at(IDEOGRAM_46_2K_PIXELS + 1)).toBe(above);
    expect(at(8192 * 8192)).toBe(above);
    // An unmeasured source is the dearest tier, so the figure is never under the charge.
    expect(at()).toBe(above);
  });

  it('matches the examples Runware prices on its own pages', () => {
    // transparent-background 2048×2048 $0.06; text-to-image 4096×2304 $0.12; reference-to-image 3072×2048 $0.20.
    expect(price(generation, { inputMode: 'text', quality: 'medium', size: '2K' }).costUsd).toBe(0.06);
    expect(price(generation, { inputMode: 'text', quality: 'medium', size: '4K' }).costUsd).toBe(0.12);
    expect(3072 * 2048).toBeGreaterThan(IDEOGRAM_46_2K_PIXELS);
    expect(price(generation, { inputMode: 'image', quality: 'medium', size: '4K', inputImages: 2 }).costUsd).toBe(0.20);
  });

  it('files the browser ledger from the cost Runware reports, not from the table', () => {
    useSpendStore.setState({ entries: [] });
    captureImageResult({ engine: 'runware', modelId: IDEOGRAM_46_MODEL, prompt: 'A sign', inputImages: 0, resolution: '4K', cost: 0.12 });
    captureImageResult({ engine: 'runware', modelId: IDEOGRAM_46_PRECISE_EDIT_MODEL, prompt: 'Fix the label', inputImages: 1 });
    const [first, second] = useSpendStore.getState().entries.slice().sort((a, b) => (a.modelId < b.modelId ? -1 : 1));
    expect(first).toMatchObject({ modelId: IDEOGRAM_46_MODEL, costUsd: 0.12, confidence: 'exact', source: 'response' });
    expect(second).toMatchObject({ modelId: IDEOGRAM_46_PRECISE_EDIT_MODEL, costUsd: null, confidence: 'unknown' });
  });
});

describe('Ideogram 4.6 for agents', () => {
  const describe46 = (modelId: string) => describeModels(['runware']).find((model) => model.modelId === modelId)!;

  it('advertises ratio, tier and quality for generation, in both modes', () => {
    const model = describe46(IDEOGRAM_46_MODEL);
    expect(model).toMatchObject({ label: 'Ideogram 4.6', mediaType: 'image' });
    expect(model.price).toMatch(/^\$0\.06 \/ image @ medium/);
    expect(model.modes.map((mode) => mode.mode)).toEqual(['text', 'image']);
    for (const mode of model.modes) {
      expect(mode.fields.map((field) => field.key)).toEqual(['aspectRatio', 'resolution', 'quality']);
      expect(mode.fields.find((field) => field.key === 'resolution')).toMatchObject({ default: '2K', options: [{ value: '2K' }, { value: '4K' }] });
      expect(mode.fields.find((field) => field.key === 'quality')).toMatchObject({ default: 'medium' });
      expect(mode.fields.find((field) => field.key === 'quality')?.options?.map((option) => option.value)).toEqual(['very_low', 'low', 'medium', 'high']);
    }
    expect(model.modes[0].references).toEqual({ min: 0, max: 0 });
    expect(model.modes[1].references).toEqual({ min: 1, max: 5 });
  });

  it('advertises only quality for Precise Edit, with one to five images', () => {
    const model = describe46(IDEOGRAM_46_PRECISE_EDIT_MODEL);
    expect(model.modes).toHaveLength(1);
    expect(model.modes[0].mode).toBe('image');
    expect(model.modes[0].fields.map((field) => field.key)).toEqual(['quality']);
    expect(model.modes[0].references).toEqual({ min: 1, max: 5 });
  });

  it('leaves the older Runware image models with a ratio and nothing else', () => {
    for (const id of ['runware:z-image@turbo', 'bfl:flux@3-image-klein', 'runware:400@1', 'runware:108@22']) {
      for (const mode of describe46(id).modes) expect(mode.fields.map((field) => field.key)).toEqual(['aspectRatio']);
    }
    expect(describe46('runware:400@1').modes.find((mode) => mode.mode === 'image')?.references).toEqual({ min: 1, max: 4 });
  });
});
