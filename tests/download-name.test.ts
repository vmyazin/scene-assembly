// tests/download-name.test.ts
import { describe, expect, it } from 'vitest';

import { downloadFilenameBase, modelFileCode } from '../lib/download-name';
import { ENGINES } from '../lib/engines/registry';
import { FAL_IMAGE_MODEL, FAL_VIDEO_MODELS } from '../lib/fal/catalog';
import { KIE_MODELS } from '../lib/kie/catalog';
import { PROVIDER_MODELS } from '../lib/providers/catalog';

/** Lowercase words joined by hyphens, with a version's decimal written as `_`. */
const CODE_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

describe('model filename codes', () => {
  const catalogued = [
    ...[FAL_IMAGE_MODEL, ...FAL_VIDEO_MODELS].map((model) => ['fal', model.id, model.fileCode]),
    ...KIE_MODELS.map((model) => ['kie', model.id, model.fileCode]),
    ...Object.entries(PROVIDER_MODELS).flatMap(([provider, models]) =>
      models.map((model) => [provider, model.id, model.fileCode])
    ),
  ] as Array<[string, string, string]>;

  it.each(catalogued)('%s/%s carries a filename-safe code', (_provider, _id, fileCode) => {
    expect(fileCode).toMatch(CODE_PATTERN);
  });

  it('is unique within each provider', () => {
    const byProvider = new Map<string, string[]>();
    for (const [provider, , fileCode] of catalogued) {
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), fileCode]);
    }
    for (const [provider, codes] of byProvider) {
      expect([provider, codes.length]).toEqual([provider, new Set(codes).size]);
    }
  });

  it('resolves a catalogued model to its own code', () => {
    expect(modelFileCode('fal', 'wan-2-7')).toBe('wan-2_7');
    expect(modelFileCode('fal', 'kling-3-pro')).toBe('kling-3-pro');
    expect(modelFileCode('kie', 'hailuo-2-3-pro')).toBe('hailuo-2_3-pro');
    expect(modelFileCode('comet', 'wan2.7')).toBe('wan-2_7');
  });

  it('names each Gemini model, not the engine, when the run says which one', () => {
    expect(modelFileCode('gemini', 'gemini-3.1-flash-image')).toBe('gemini-3_1-flash-image');
    expect(modelFileCode('gemini', 'gemini-3.1-flash-lite-image')).toBe('gemini-3_1-flash-lite-image');
    expect(modelFileCode('gemini', 'gemini-3-pro-image-preview')).toBe('gemini-3-pro-image');
    expect(modelFileCode('gemini', 'veo-3.1-lite-generate-preview')).toBe('veo-3_1-lite');
    // A run recorded before the picker existed carries no model id.
    expect(modelFileCode('gemini')).toBe('gemini-3-pro-image');
  });

  it('names the single-model engines from the engine registry', () => {
    expect(modelFileCode('gemini')).toBe('gemini-3-pro-image');
    expect(modelFileCode('cloudflare')).toBe('flux-1-schnell');
    // Aggregators have no engine-level code: the model answers for them.
    expect(ENGINES.find((engine) => engine.id === 'fal')?.fileCode).toBeUndefined();
    expect(modelFileCode('fal')).toBeUndefined();
  });

  it('falls back to a sanitized id for a model that has left its catalog', () => {
    expect(modelFileCode('comet', 'retired-model@2.1')).toBe('retired-model-2_1');
  });

  it('leaves the name alone when nothing identifies the model', () => {
    expect(modelFileCode(undefined, undefined)).toBeUndefined();
  });
});

describe('downloadFilenameBase', () => {
  it('appends the model code to the prompt slug', () => {
    expect(
      downloadFilenameBase({
        prompt: 'A neon tiger in the rain',
        mediaType: 'video',
        slug: 'neon-tiger-in-the-rain',
        provider: 'fal',
        modelId: 'wan-2-7',
      })
    ).toBe('neon-tiger-in-the-rain-wan-2_7');
  });

  it('falls back to the prompt when no slug has landed yet', () => {
    expect(
      downloadFilenameBase({
        prompt: 'Quiet ocean at dusk',
        mediaType: 'image',
        provider: 'kie',
        modelId: 'nano-banana-pro',
      })
    ).toBe('quiet-ocean-at-dusk-nano-banana-pro');
  });

  it('keeps the plain name when the model is unknown', () => {
    expect(
      downloadFilenameBase({ prompt: 'Quiet ocean at dusk', mediaType: 'image' })
    ).toBe('quiet-ocean-at-dusk');
  });
});
