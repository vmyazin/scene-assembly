import { describe, expect, it } from 'vitest';
import {
  KIE_MODELS,
  buildKieInput,
  defaultKieValues,
  modelsForKieMode,
  resolveKieVariant,
  validateKieInput,
} from '../../lib/kie/catalog';

describe('Kie model catalog', () => {
  it('contains the approved eight image and seven video model families', () => {
    expect(KIE_MODELS.filter((model) => model.mediaType === 'image')).toHaveLength(8);
    expect(KIE_MODELS.filter((model) => model.mediaType === 'video')).toHaveLength(7);
  });

  it('filters models by the selected media and input mode', () => {
    expect(modelsForKieMode('video', 'image')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'veo-3-1' }),
        expect.objectContaining({ id: 'wan-2-7' }),
        expect.objectContaining({ id: 'grok-imagine' }),
      ])
    );
  });

  it('selects the documented model variant for image input', () => {
    expect(resolveKieVariant('gpt-image-2', 'image')).toMatchObject({
      modelId: 'gpt-image-2-image-to-image',
      protocol: 'market',
    });
  });

  it('maps dynamic controls and uploaded URLs to the Kie request input', () => {
    const variant = resolveKieVariant('nano-banana-pro', 'image');

    expect(
      buildKieInput(variant, {
        prompt: 'A yellow bicycle in a field of flowers',
        uploadUrls: ['https://files.example/reference.png'],
        values: { aspect_ratio: '16:9', resolution: '2K', output_format: 'jpg' },
      })
    ).toEqual({
      prompt: 'A yellow bicycle in a field of flowers',
      image_input: ['https://files.example/reference.png'],
      aspect_ratio: '16:9',
      resolution: '2K',
      output_format: 'jpg',
    });
  });

  it('builds defaults and model-specific upload shapes for every catalog variant', () => {
    for (const model of KIE_MODELS) {
      for (const variant of model.variants) {
        const defaults = defaultKieValues(variant);
        const input = buildKieInput(variant, {
          prompt: `${model.label} test prompt`,
          uploadUrls: ['https://files.example/reference-one.png', 'https://files.example/reference-two.png'],
          values: defaults,
        });

        expect(input.prompt).toBe(`${model.label} test prompt`);
        for (const field of variant.fields.filter((field) => field.defaultValue !== undefined)) {
          expect(input[field.key]).toBe(field.defaultValue);
        }
        if (variant.inputMode === 'image') {
          expect(input[variant.imageInputKey ?? 'image_url']).toBeDefined();
        }
      }
    }
  });

  it('builds a Wan 2.7 edit with one reference image and an optional prompt', () => {
    const variant = resolveKieVariant('wan-2-7', 'edit');
    expect(variant.modelId).toBe('wan/2-7-videoedit');
    expect(variant.price).toBe('unknown');
    expect(variant.edit?.rate).toBeUndefined();
    const input = buildKieInput(variant, {
      prompt: '',
      uploadUrls: ['https://files.example/hat.png', 'https://files.example/clip.mp4'],
      values: { resolution: '720p', duration: 0, audio_setting: 'origin', prompt_extend: false, aspect_ratio: '' },
    });
    expect(input).toMatchObject({
      video_url: 'https://files.example/clip.mp4',
      reference_image: 'https://files.example/hat.png',
      resolution: '720p',
      duration: 0,
      audio_setting: 'origin',
      prompt_extend: false,
    });
    expect(input.prompt).toBeUndefined();
    expect(input.aspect_ratio).toBeUndefined();
    expect(validateKieInput(variant, { prompt: '', uploadUrls: ['https://files.example/clip.mp4'] })).toBeNull();
  });

  it('validates required reference uploads and model-specific input limits', () => {
    const variant = resolveKieVariant('nano-banana-pro', 'image');
    expect(validateKieInput(variant, { prompt: 'Edit this image', uploadUrls: [] })).toMatch(/at least one/i);
    expect(
      validateKieInput(variant, {
        prompt: 'Edit this image',
        uploadUrls: Array.from({ length: 9 }, (_, index) => `https://files.example/${index}.png`),
      })
    ).toMatch(/up to 8/i);
  });
});
