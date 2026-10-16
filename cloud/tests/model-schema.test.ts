import { describe, expect, it } from 'vitest';
import { checkReferences, checkValues, describeModels, findModelDescriptor, sampleRequest, type FieldValue } from '../../lib/account/model-schema';
import type { CloudJobRequest } from '../../lib/account/contracts';
import { CLOUD_PROVIDERS, validateRequest } from '../src/providers';
import type { Env } from '../src/security';

// A production origin keeps isLocal false, so validateRequest takes the deployed
// branch; every provider is enabled so each adapter's own validator runs.
const env = { APP_ORIGIN: 'https://sceneassembly.example', CLOUD_GENERATION_PROVIDERS: CLOUD_PROVIDERS.join(',') } as Env;
const models = describeModels(CLOUD_PROVIDERS);

describe('agent model schema against the Worker validators', () => {
  it('describes every background provider', () => {
    expect(new Set(models.map(model => model.provider))).toEqual(new Set(CLOUD_PROVIDERS));
    expect(models.every(model => model.modes.length > 0)).toBe(true);
    const deprecated = models.filter(model => model.deprecated).map(model => model.modelId).sort();
    expect(deprecated).toEqual([
      'gemini-3.1-flash-image',
      'google/nano-banana-2/edit-developer',
      'google/nano-banana-2/text-to-image-developer',
      'nano-banana-2',
    ]);
    expect(models.find(model => model.modelId === 'nano-banana-2')?.label).toBe('Nano Banana 2');
  });

  // The drift guard: anything list_models offers must be something the Worker
  // accepts. When a case fails, change the descriptor — never loosen a validator.
  it('advertises only requests the Worker accepts, with every default filled in', () => {
    for (const model of models) for (const mode of model.modes) {
      expect(() => validateRequest(env, sampleRequest(model, mode)), `${model.provider} ${model.modelId} ${mode.mode}`).not.toThrow();
    }
  });

  it('advertises only options and bounds the Worker accepts', () => {
    for (const model of models) for (const mode of model.modes) for (const field of mode.fields) {
      const candidates: FieldValue[] = field.type === 'select' ? field.options!.map(option => option.value)
        : field.type === 'boolean' ? [true, false]
          : field.type === 'number' ? [field.min, field.max].filter((value): value is number => value !== undefined) : [];
      for (const value of candidates) {
        const label = `${model.provider} ${model.modelId} ${mode.mode} ${field.key}=${String(value)}`;
        expect(() => validateRequest(env, sampleRequest(model, mode, { [field.key]: value })), label).not.toThrow();
      }
    }
  });
});

describe('checkValues', () => {
  const veo = findModelDescriptor('fal', 'veo-3-1', 'video')!;
  const text = veo.modes.find(mode => mode.mode === 'text')!;

  it('fills every default so the run, the estimate and the ledger read the same values', () => {
    const result = checkValues(text, {});
    expect(result.ok).toBe(true);
    if (result.ok) for (const field of text.fields) if (field.default !== undefined) expect(result.values[field.key]).toBe(field.default);
  });

  it('names a key the model does not have', () => {
    expect(checkValues(text, { seed: 4 })).toMatchObject({ ok: false, field: 'seed' });
  });

  it('matches select options strictly, as the fal and Kie builders do', () => {
    const duration = text.fields.find(field => field.key === 'duration')!;
    const allowed = duration.options!.map(option => option.value);
    const wrongType = typeof allowed[0] === 'string' ? Number.parseInt(String(allowed[0]), 10) : String(allowed[0]);
    expect(checkValues(text, { duration: wrongType })).toMatchObject({ ok: false, field: 'duration', allowed });
  });

  it('keeps the Seedance edit default at 720p and forces 480p only when draft is on', () => {
    const seedance = findModelDescriptor('runware', 'bytedance:seedance@2.5', 'video')!;
    const edit = seedance.modes.find(mode => mode.mode === 'edit')!;
    expect(edit.fields.find(field => field.key === 'size')?.default).toBe('720p');
    const drafted = checkValues(edit, { draft: true });
    expect(drafted.ok).toBe(true);
    if (drafted.ok) expect(drafted.values.size).toBe('480p');
    expect(checkValues(edit, { draft: true, size: '720p' })).toMatchObject({ ok: false, field: 'size' });
    expect(() => validateRequest(env, sampleRequest(seedance, edit, { draft: true }))).not.toThrow();
  });

  it('holds numbers to their bounds and step', () => {
    const range = models.flatMap(model => model.modes).flatMap(mode => mode.fields.map(field => ({ mode, field })))
      .find(({ field }) => field.type === 'number' && field.min !== undefined && field.max !== undefined)!;
    expect(checkValues(range.mode, { [range.field.key]: range.field.max! + 1 })).toMatchObject({ ok: false, field: range.field.key });
  });
});

describe('edit reference descriptors', () => {
  it('advertises only the references an agent can send without a plan', () => {
    const editOf = (modelId: string) => findModelDescriptor('fal', modelId, 'video')!.modes.find(mode => mode.mode === 'edit')!;
    expect(editOf('luma-ray-3-2-edit').references).toEqual({ min: 0, max: 1 });
    expect(editOf('kling-o3-pro-edit').references).toEqual({ min: 0, max: 4 });
    expect(editOf('kling-o3-4k-edit').references).toEqual({ min: 0, max: 4 });
    expect(editOf('h3-max-relight').references).toEqual({ min: 1, max: 1 });
  });

  it('accepts a Luma keyframe plan in the studio and refuses extra images without one', () => {
    const luma = (count: number, plan?: CloudJobRequest['editReferencePlan']): CloudJobRequest => ({
      provider: 'fal', modelId: 'luma-ray-3-2-edit', mediaType: 'video', inputMode: 'edit',
      prompt: 'Relight the street', referenceIds: Array.from({ length: count }, (_, index) => `frame-${index}`),
      sourceVideoId: 'source', values: { resolution: '540p', duration: '5s' },
      ...(plan ? { editReferencePlan: plan } : {}),
    });
    expect(() => validateRequest(env, luma(1))).not.toThrow();
    expect(() => validateRequest(env, luma(2))).toThrow(/Review the selected model/);
    const frames = 17;
    expect(() => validateRequest(env, luma(frames, {
      keyframes: Array.from({ length: frames }, (_, index) => ({ image: index, index })),
    }))).not.toThrow();
    expect(() => validateRequest(env, luma(65, {
      keyframes: Array.from({ length: 65 }, (_, index) => ({ image: index, index })),
    }))).toThrow(/Invalid generation settings/);
    expect(() => validateRequest(env, {
      provider: 'fal', modelId: 'h3-max-relight', mediaType: 'video', inputMode: 'edit',
      prompt: '', referenceIds: ['sphere'], sourceVideoId: 'source', values: { resolution: '1080P' },
    })).not.toThrow();
  });
});

describe('checkReferences', () => {
  it('states the exact count a first-and-last-frame mode needs', () => {
    const frames = models.flatMap(model => model.modes).find(mode => mode.mode === 'frames')!;
    expect(checkReferences(frames, 1, false)).toBe('This mode takes exactly 2 reference images.');
    expect(checkReferences(frames, 2, false)).toBeNull();
  });

  it('requires a source video in edit mode and refuses one elsewhere', () => {
    const edit = models.flatMap(model => model.modes).find(mode => mode.mode === 'edit')!;
    expect(checkReferences(edit, 0, false)).toMatch(/sourceVideo/);
    const text = models[0].modes.find(mode => mode.mode === 'text')!;
    expect(checkReferences(text, 0, true)).toMatch(/only accepted in edit mode/);
  });
});
