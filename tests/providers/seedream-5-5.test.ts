// tests/providers/seedream-5-5.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudJobRequest } from '@/lib/account/contracts';
import { describeModels } from '@/lib/account/model-schema';
import { providerImageSpecs } from '@/lib/models/listbox-specs';
import { atlasGenerateImage } from '@/lib/providers/atlas';
import { DEFAULT_MODELS, findModel, modelsFor, PROVIDER_MODELS, resolveSize, SEEDREAM_55_LIST_USD } from '@/lib/providers/catalog';
import { ATLAS_SEEDREAM_55_DIMENSIONS, imageDimensions } from '@/lib/providers/output-size';
import { buildAccountSpendEntry } from '@/lib/spend/account';
import { captureImageResult } from '@/lib/spend/capture';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { useAppStore } from '@/store/useAppStore';
import { useSpendStore } from '@/store/useSpendStore';

const T2I = 'bytedance/seedream-v5.5/text-to-image';
const EDIT = 'bytedance/seedream-v5.5/edit';
const PRO = 'bytedance/seedream-v5.0-pro/text-to-image';
const PRO_EDIT = 'bytedance/seedream-v5.0-pro/edit';

/** The `size` enum of both 5.5 schemas, read 2026-11-12. Every pair sent must be in it. */
const PUBLISHED_SIZES = [
  '2048*2048', '2368*1776', '1776*2368', '2816*1584', '1584*2816', '2496*1664', '1664*2496', '3136*1344',
  '1536*1536', '1792*1344', '1344*1792', '2048*1152', '1152*2048', '1872*1248', '1248*1872', '2352*1008',
  '1024*1024', '1152*864', '864*1152', '1424*800', '800*1424', '1248*832', '832*1248', '1568*672',
];

const noSleep = async () => {};

async function imageBody(request: Parameters<typeof atlasGenerateImage>[0]) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'pred-1' } }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'pred-1', status: 'succeeded', outputs: ['https://cdn.atlas/out.png'] }) });
  vi.stubGlobal('fetch', fetchMock);
  await atlasGenerateImage(request, noSleep);
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
}

const price = (modelId: string, controls: Parameters<typeof resolveCatalogRate>[3]) =>
  resolveCatalogRate(findModel('atlas', modelId), undefined, 1, controls);

afterEach(() => vi.unstubAllGlobals());

describe('Seedream 5.5 in the catalog', () => {
  it('is the first Seedream in the Atlas image list, with 5.0 Pro and Flash still selectable', () => {
    const seedreams = modelsFor('atlas', 'image').filter((model) => model.id.startsWith('bytedance/seedream-')).map((model) => model.id);
    expect(seedreams.slice(0, 4)).toEqual([T2I, EDIT, PRO, PRO_EDIT]);
    expect(seedreams).toContain('bytedance/seedream-v5.0-flash/text-to-image');
    expect(seedreams).toContain('bytedance/seedream-v5.0-flash/edit');
    expect(findModel('atlas', PRO)?.deprecated).toBeUndefined();
    expect(findModel('atlas', PRO)?.note).toMatch(/fallback/);
    expect(findModel('atlas', T2I)?.note).toMatch(/current Seedream/);
  });

  it('does not change a provider default and is not duplicated on Runware', () => {
    expect(DEFAULT_MODELS.atlas.image).toBe('black-forest-labs/flux-schnell');
    expect(DEFAULT_MODELS.runware.image).toBe('runware:z-image@turbo');
    expect(PROVIDER_MODELS.runware.some((model) => /seedream/i.test(model.id))).toBe(false);
  });

  it('keeps file codes unique so a download says which Seedream made it', () => {
    const codes = PROVIDER_MODELS.atlas.map((model) => model.fileCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(findModel('atlas', T2I)?.fileCode).toBe('seedream-v5_5');
    expect(findModel('atlas', EDIT)?.fileCode).toBe('seedream-v5_5-edit');
  });

  it('offers 2K first, the vendor default, then 1.5K and 1K', () => {
    expect(findModel('atlas', T2I)?.sizes?.map((size) => size.label)).toEqual(['2K', '1.5K', '1K']);
    expect(resolveSize('atlas', T2I)?.preset).toBe('2k');
    expect(resolveSize('atlas', EDIT, '4K')?.preset).toBe('2k');
    expect(resolveSize('atlas', EDIT, '1.5K')?.preset).toBe('1.5k');
  });

  it('tells an agent the sizes, backgrounds and reference limit', () => {
    const models = describeModels(['atlas']).filter((model) => model.modelId === T2I || model.modelId === EDIT);
    expect(models).toHaveLength(2);
    const edit = models.find((model) => model.modelId === EDIT)!;
    const mode = edit.modes[0];
    expect(mode.references).toEqual({ min: 1, max: 10 });
    expect(mode.fields.find((field) => field.key === 'resolution')).toMatchObject({ options: ['2K', '1.5K', '1K'].map((value) => ({ label: value, value })), default: '2K' });
    expect(mode.fields.find((field) => field.key === 'background')).toMatchObject({ options: ['auto', 'opaque', 'transparent'].map((value) => ({ label: value, value })), default: 'auto' });
  });
});

describe('Seedream 5.5 sizes', () => {
  it('only names pixel pairs the schema publishes', () => {
    const pairs = Object.values(ATLAS_SEEDREAM_55_DIMENSIONS).flatMap((table) => Object.values(table).map(([w, h]) => `${w}*${h}`));
    expect(pairs).toHaveLength(24);
    expect([...pairs].sort()).toEqual([...PUBLISHED_SIZES].sort());
  });

  it('keeps each tier on its side of the 2.61 MP billing line', () => {
    const megapixels = (tier: string) => Object.values(ATLAS_SEEDREAM_55_DIMENSIONS[tier]).map(([w, h]) => (w * h) / 1e6);
    expect(Math.min(...megapixels('2k'))).toBeGreaterThan(2.61);
    expect(Math.max(...megapixels('1.5k'))).toBeLessThanOrEqual(2.61);
    expect(Math.max(...megapixels('1k'))).toBeLessThanOrEqual(2.61);
  });

  it('labels the pixels of the selected tier, and 2K when none is chosen', () => {
    expect(imageDimensions('atlas', T2I, '16:9', '1K')).toEqual([1424, 800]);
    expect(imageDimensions('atlas', T2I, '16:9', '1.5K')).toEqual([2048, 1152]);
    expect(imageDimensions('atlas', EDIT, '16:9', '2K')).toEqual([2816, 1584]);
    expect(imageDimensions('atlas', T2I, '21:9')).toEqual([3136, 1344]);
    expect(imageDimensions('atlas', T2I, undefined, '4K')).toEqual([2048, 2048]);
    // 5.0 Pro keeps its own single 1.5K table whatever the shared size says.
    expect(imageDimensions('atlas', PRO, '4:3', '2K')).toEqual([1776, 1328]);
  });
});

describe('Seedream 5.5 request body', () => {
  it('sends the vendor default 2K size when no size is chosen, with no fields the schema does not name', async () => {
    const body = await imageBody({ apiKey: 'at-key', model: T2I, prompt: 'a lighthouse' });
    expect(body).toEqual({ model: T2I, prompt: 'a lighthouse', size: '2048*2048' });
  });

  it('sends the chosen tier and shape', async () => {
    expect((await imageBody({ apiKey: 'k', model: T2I, prompt: 'p', aspectRatio: '9:16', resolution: '1K' })).size).toBe('800*1424');
    expect((await imageBody({ apiKey: 'k', model: T2I, prompt: 'p', aspectRatio: '3:2', resolution: '1.5K' })).size).toBe('1872*1248');
    expect((await imageBody({ apiKey: 'k', model: T2I, prompt: 'p', aspectRatio: '21:9', resolution: '2K' })).size).toBe('3136*1344');
  });

  it('sends a transparent background as PNG on text-to-image too', async () => {
    const body = await imageBody({ apiKey: 'k', model: T2I, prompt: 'a sticker', resolution: '1K', background: 'transparent' });
    expect(body).toMatchObject({ size: '1024*1024', background: 'transparent', output_format: 'png' });
  });

  it('drops a carried-over reference on text-to-image', async () => {
    const body = await imageBody({ apiKey: 'k', model: T2I, prompt: 'p', images: ['https://cdn.atlas/a.png'] });
    expect(body.reference_images).toBeUndefined();
    expect(body.images).toBeUndefined();
  });

  it('sends edits as reference_images, not the images field 5.0 Pro uses', async () => {
    const refs = ['https://cdn.atlas/a.png', 'https://cdn.atlas/b.png'];
    const body = await imageBody({ apiKey: 'k', model: EDIT, prompt: 'swap the coat', aspectRatio: '4:3', resolution: '1.5K', images: refs });
    expect(body).toEqual({ model: EDIT, prompt: 'swap the coat', size: '1792*1344', reference_images: refs });

    const pro = await imageBody({ apiKey: 'k', model: PRO_EDIT, prompt: 'swap the coat', aspectRatio: '4:3', images: refs });
    expect(pro.images).toEqual(refs);
    expect(pro.reference_images).toBeUndefined();
    expect(pro.size).toBe('1776*1328');
  });
});

describe('Seedream 5.5 rates', () => {
  it('prices the output from the tier that is sent', () => {
    expect(price(T2I, { size: '1K' }).costUsd).toBeCloseTo(0.016, 8);
    expect(price(T2I, { size: '1.5K' }).costUsd).toBeCloseTo(0.016, 8);
    expect(price(T2I, { size: '2K' }).costUsd).toBeCloseTo(0.028, 8);
    expect(price(T2I, { size: '2K' })).toMatchObject({ confidence: 'estimated', source: 'catalog-rate', quantity: { unit: 'image', value: 1 } });
  });

  it('is the calculator quote: 80% of the SKU table Atlas publishes', () => {
    const t2i = findModel('atlas', T2I)!.rate!;
    const edit = findModel('atlas', EDIT)!.rate!;
    for (const tier of ['2k', '1.5k', '1k'] as const) {
      expect(t2i.usdByResolution![tier]).toBeCloseTo(SEEDREAM_55_LIST_USD[tier] * 0.8, 8);
      expect(edit.usdByResolution![tier]).toBeCloseTo(SEEDREAM_55_LIST_USD[tier] * 0.8, 8);
    }
    expect(edit.inputImageUsd).toBeCloseTo(SEEDREAM_55_LIST_USD.inputImage * 0.8, 8);
    expect(t2i.inputImageUsd).toBeUndefined();
  });

  // Atlas calculator, 2026-11-12: 1024² + 1 input 0.0224, 1536² + 3 inputs
  // 0.0352, 2048² + 1 input 0.0344, 2816×1584 + 10 inputs 0.092.
  it.each([
    ['1K', 1, 0.0224],
    ['1.5K', 3, 0.0352],
    ['2K', 1, 0.0344],
    ['2K', 10, 0.092],
  ])('charges every input image on an edit: %s with %s', (size, inputImages, expected) => {
    expect(price(EDIT, { size, inputImages, inputMode: 'image' }).costUsd).toBeCloseTo(expected, 8);
  });

  it('charges the first input, where 5.0 Pro includes it', () => {
    const oneInput55 = price(EDIT, { size: '1.5K', inputImages: 1 }).costUsd!;
    const noInput55 = price(EDIT, { size: '1.5K', inputImages: 0 }).costUsd!;
    expect(oneInput55 - noInput55).toBeCloseTo(0.0064, 8);

    const oneInputPro = price(PRO_EDIT, { inputImages: 1 }).costUsd!;
    const twoInputsPro = price(PRO_EDIT, { inputImages: 2 }).costUsd!;
    expect(oneInputPro).toBeCloseTo(0.036, 8);
    expect(twoInputsPro - oneInputPro).toBeCloseTo(0.003, 8);
    expect(findModel('atlas', PRO_EDIT)?.rate).toEqual({ usd: 0.036, per: 'image', extraInputImageUsd: 0.003 });
    expect(findModel('atlas', EDIT)?.rate?.extraInputImageUsd).toBeUndefined();
  });

  it('stays unknown without a size or a reference count, never the cheapest tier', () => {
    expect(price(T2I, {})).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(price(T2I, { size: '4K' })).toMatchObject({ costUsd: null, confidence: 'unknown' });
    expect(price(EDIT, { size: '2K' })).toMatchObject({ costUsd: null, confidence: 'unknown', note: expect.stringContaining('reference count') });
  });

  it('starts the picker row at the cheapest run that can exist', () => {
    const textOf = (cell: ReturnType<typeof providerImageSpecs>[number]) => (cell.kind === 'text' ? cell.value : cell.kind === 'mark' ? cell.on : null);
    expect(providerImageSpecs(findModel('atlas', T2I)!).map(textOf)).toEqual(['$0.016/img', '—', false]);
    // An edit cannot run without one billed input: 0.016 + 0.0064.
    expect(providerImageSpecs(findModel('atlas', EDIT)!).map(textOf)).toEqual(['$0.0224/img', '10', true]);
    expect(providerImageSpecs(findModel('atlas', PRO_EDIT)!).map(textOf)).toEqual(['$0.036/img', '10', true]);
  });
});

describe('Seedream 5.5 in the ledgers', () => {
  const request = (patch: Partial<CloudJobRequest>): CloudJobRequest => ({
    provider: 'atlas', modelId: T2I, mediaType: 'image', inputMode: 'text', prompt: 'p', values: {}, referenceIds: [], ...patch,
  });
  const account = (patch: Partial<CloudJobRequest>) =>
    buildAccountSpendEntry({ jobId: 'job', at: 1, result: { sources: [{}] }, request: request(patch) });

  beforeEach(() => useSpendStore.setState({ entries: [] }));

  it('prices a background job with no size at the 2K the adapter sends', () => {
    expect(account({})?.costUsd).toBeCloseTo(0.028, 8);
    expect(account({ values: { resolution: '1K' } })?.costUsd).toBeCloseTo(0.016, 8);
  });

  it('prices a background edit from its size and every reference', () => {
    const entry = account({ modelId: EDIT, inputMode: 'image', referenceIds: ['a', 'b', 'c'], values: { resolution: '1.5K' } });
    expect(entry?.costUsd).toBeCloseTo(0.0352, 8);
    expect(entry?.confidence).toBe('estimated');
    expect(account({ modelId: EDIT, inputMode: 'image', referenceIds: ['a'] })?.costUsd).toBeCloseTo(0.0344, 8);
  });

  it('files a browser edit from the size on screen and every reference', () => {
    captureImageResult({ engine: 'atlas', modelId: EDIT, prompt: 'p', inputImages: 2, resolution: '2K' });
    captureImageResult({ engine: 'atlas', modelId: T2I, prompt: 'p', inputImages: 0, resolution: '1.5K' });
    const [first, second] = [...useSpendStore.getState().entries].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
    expect(first.costUsd).toBeCloseTo(0.028 + 2 * 0.0064, 8);
    expect(second.costUsd).toBeCloseTo(0.016, 8);
  });
});

/**
 * No saved selection is moved to 5.5. Atlas's default image model has always
 * been FLUX schnell, so a stored 5.0 Pro id can only be a choice somebody made,
 * and it has to keep working as the fallback.
 */
describe('a saved Seedream 5.0 Pro selection', () => {
  const STORAGE_KEY = 'scene-assembly-store';

  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it.each([PRO, PRO_EDIT, 'bytedance/seedream-v5.0-flash/text-to-image'])('survives rehydration: %s', async (modelId) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { atlasImageModel: modelId, engine: 'atlas' }, version: 4 }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().atlasImageModel).toBe(modelId);
  });

  it('survives rehydration from an older blob that still runs migrate', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { atlasImageModel: PRO, engine: 'atlas' }, version: 1 }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().atlasImageModel).toBe(PRO);
  });

  it('leaves the store version alone, because nothing is migrated', () => {
    expect(useAppStore.persist.getOptions().version).toBe(4);
  });

  it('does not make 5.5 anyone’s model without a choice', () => {
    expect(useAppStore.getInitialState().atlasImageModel).toBe('black-forest-labs/flux-schnell');
  });
});
