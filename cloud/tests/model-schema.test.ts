import { describe, expect, it } from 'vitest';
import { checkReferences, checkValues, describeModels, findModelDescriptor, sampleRequest, type FieldValue } from '../../lib/account/model-schema';
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

  it('holds numbers to their bounds and step', () => {
    const range = models.flatMap(model => model.modes).flatMap(mode => mode.fields.map(field => ({ mode, field })))
      .find(({ field }) => field.type === 'number' && field.min !== undefined && field.max !== undefined)!;
    expect(checkValues(range.mode, { [range.field.key]: range.field.max! + 1 })).toMatchObject({ ok: false, field: range.field.key });
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
