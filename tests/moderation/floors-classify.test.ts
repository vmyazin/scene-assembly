// tests/moderation/floors-classify.test.ts
import { describe, expect, it } from 'vitest';

import { refusalPresentation } from '@/lib/moderation/classify';
import { FLOOR_BLOCK_MESSAGE, FLOOR_STANDARD_NOTE, effectiveModerationLevel, inspectPrompt } from '@/lib/moderation/floors';

describe('prompt floors', () => {
  it('blocks a minor term together with a nudity, sexual, or swimwear term', () => {
    for (const prompt of [
      'a nude child on a beach',
      'teen in lingerie',
      'schoolgirl in a bikini',
      'underage and explicit',
      'a 12 year old in swimwear',
      '7yo naked',
    ]) {
      expect(inspectPrompt(prompt, 'relaxed')).toMatchObject({
        blocked: true,
        forceStandard: true,
        message: FLOOR_BLOCK_MESSAGE,
      });
    }
  });

  it('does not block a minor mention on its own, and forces Standard only when Relaxed was asked', () => {
    expect(inspectPrompt('a child playing in a park', 'standard')).toEqual({
      blocked: false,
      forceStandard: false,
    });
    expect(inspectPrompt('a child playing in a park', 'relaxed')).toMatchObject({
      blocked: false,
      forceStandard: true,
      note: FLOOR_STANDARD_NOTE,
    });
    expect(inspectPrompt('kids racing bicycles', 'relaxed').blocked).toBe(false);
  });

  it('does not treat an adult age or an ordinary scene as a floor', () => {
    expect(inspectPrompt('a 21 year old in swimwear', 'relaxed')).toEqual({
      blocked: false,
      forceStandard: false,
    });
    expect(inspectPrompt('a lighthouse at dusk', 'relaxed').blocked).toBe(false);
    expect(inspectPrompt('a classical statue in a museum', 'relaxed').blocked).toBe(false);
  });

  it('forces Standard when a reference is attached', () => {
    expect(
      effectiveModerationLevel({ level: 'relaxed', prompt: 'a red kite', hasReferences: true })
    ).toBe('standard');
    expect(
      effectiveModerationLevel({ level: 'relaxed', prompt: 'a child in a garden', hasReferences: false })
    ).toBe('standard');
    expect(
      effectiveModerationLevel({ level: 'relaxed', prompt: 'a red kite', hasReferences: false })
    ).toBe('relaxed');
  });
});

describe('refusal copy', () => {
  const route = { provider: 'fal', modelId: 'nano-banana-2', endpointId: 'fal-ai/nano-banana-2' };

  it('offers Try with Relaxed only when the route can change and the request was Standard', () => {
    expect(
      refusalPresentation('IMAGE_SAFETY', {
        providerLabel: 'fal',
        modelLabel: 'Nano Banana 2',
        level: 'standard',
        route,
      })
    ).toEqual({
      kind: 'policy',
      message:
        'fal blocked this under its content filter. Relaxed filter may let legitimate creative work through.',
      offerTryRelaxed: true,
    });
  });

  it('says the model policy still applies when Relaxed was already on', () => {
    expect(
      refusalPresentation('PROHIBITED_CONTENT', {
        providerLabel: 'fal',
        modelLabel: 'Nano Banana 2',
        level: 'relaxed',
        route,
      })?.offerTryRelaxed
    ).toBe(false);
    expect(
      refusalPresentation('raiMediaFiltered', {
        providerLabel: 'fal',
        modelLabel: 'Nano Banana 2',
        level: 'relaxed',
        route,
      })?.message
    ).toMatch(/still blocked this with Relaxed filter on/);
  });

  it('names engines that can change when this one cannot', () => {
    const presented = refusalPresentation('moderation_blocked', {
      providerLabel: 'Gemini',
      modelLabel: 'Gemini image',
      level: 'standard',
      route: { provider: 'gemini', modelId: 'gemini-3-pro-image-preview' },
    });
    expect(presented?.offerTryRelaxed).toBe(false);
    expect(presented?.message).toMatch(/can't adjust it for this engine/);
    expect(presented?.message).toMatch(/fal Nano Banana 2/);
  });

  it('uses the floor sentence and does not offer a switch', () => {
    expect(
      refusalPresentation(FLOOR_BLOCK_MESSAGE, {
        providerLabel: 'fal',
        modelLabel: 'Nano Banana 2',
        level: 'relaxed',
        route,
      })
    ).toEqual({ kind: 'floor', message: FLOOR_BLOCK_MESSAGE, offerTryRelaxed: false });
  });

  it('leaves a transport error alone', () => {
    expect(
      refusalPresentation('fal returned 503', {
        providerLabel: 'fal',
        modelLabel: 'Nano Banana 2',
        level: 'standard',
        route,
      })
    ).toBeNull();
  });

  it('classifies the documented provider phrases as policy', () => {
    for (const sample of [
      'IMAGE_SAFETY',
      'PROHIBITED_CONTENT',
      'raiMediaFilteredReasons',
      'moderation_blocked',
      'prompt violates content policy',
      'blocked by the safety checker',
      'nsfw',
    ]) {
      expect(
        refusalPresentation(sample, {
          providerLabel: 'Kie',
          modelLabel: 'FLUX.2 Pro',
          level: 'standard',
          route: { provider: 'kie', modelId: 'flux-2-pro' },
        })?.kind
      ).toBe('policy');
    }
  });

  it('does not offer a switch when a reference already forced Standard', () => {
    expect(
      refusalPresentation('content filter', {
        providerLabel: 'fal',
        modelLabel: 'Nano Banana 2',
        level: 'standard',
        route,
        hasReferences: true,
      })?.offerTryRelaxed
    ).toBe(false);
  });
});
