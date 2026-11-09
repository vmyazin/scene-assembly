import { describe, expect, it } from 'vitest';

import { GEMINI_IMAGE_MODELS, DEFAULT_GEMINI_IMAGE_MODEL } from '@/lib/engines/gemini-catalog';
import { FAL_IMAGE_MODEL, FAL_IMAGE_MODELS } from '@/lib/fal/catalog';
import { hideRetiredModels } from '@/lib/models/retired';
import { DEFAULT_MODELS, PROVIDER_MODELS } from '@/lib/providers/catalog';

const models = [{ id: 'current' }, { id: 'retired', deprecated: true }, { id: 'other' }];

describe('hideRetiredModels', () => {
  it('leaves a retired model out of a new visitor’s list', () => {
    expect(hideRetiredModels(models, 'current').map((model) => model.id)).toEqual(['current', 'other']);
    expect(hideRetiredModels(models, undefined).map((model) => model.id)).toEqual(['current', 'other']);
  });

  it('keeps it while it is the selection, in its catalog position', () => {
    expect(hideRetiredModels(models, 'retired').map((model) => model.id)).toEqual(['current', 'retired', 'other']);
  });

  // The hide is only for new visitors if nobody starts out on a retired model:
  // a default that retires would stay listed for everyone.
  it('has no retired model as any provider’s default', () => {
    const retired = (list: { id: string; deprecated?: boolean }[]) => new Set(list.filter((model) => model.deprecated).map((model) => model.id));

    expect(retired(GEMINI_IMAGE_MODELS).has(DEFAULT_GEMINI_IMAGE_MODEL)).toBe(false);
    expect(retired(FAL_IMAGE_MODELS).has(FAL_IMAGE_MODEL.id)).toBe(false);
    for (const [provider, defaults] of Object.entries(DEFAULT_MODELS)) {
      const catalog = retired(PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS]);
      expect(catalog.has(defaults.image), `${provider} image`).toBe(false);
      expect(catalog.has(defaults.video), `${provider} video`).toBe(false);
    }
  });
});
