// lib/kie/catalog.ts
import { applyProviderModeration, lockKieVeoFallback } from '../moderation/capabilities';
import { effectiveModerationLevel } from '../moderation/floors';
import type {
  KieFieldDefinition,
  KieInputMode,
  KieModelDefinition,
  KieModelVariant,
  MediaType,
} from './types';

const aspectRatios: KieFieldDefinition = {
  key: 'aspect_ratio',
  label: 'Aspect ratio',
  type: 'select',
  defaultValue: '16:9',
  options: ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'].map((value) => ({
    label: value,
    value,
  })),
};

const imageResolution: KieFieldDefinition = {
  key: 'resolution',
  label: 'Resolution',
  type: 'select',
  defaultValue: '1K',
  options: ['1K', '2K', '4K'].map((value) => ({ label: value, value })),
};

const outputFormat: KieFieldDefinition = {
  key: 'output_format',
  label: 'Output format',
  type: 'select',
  defaultValue: 'png',
  options: ['png', 'jpg', 'jpeg'].map((value) => ({ label: value.toUpperCase(), value })),
};

const seed: KieFieldDefinition = {
  key: 'seed',
  label: 'Seed',
  type: 'number',
  description: 'Leave at 0 for a random result when the provider supports it.',
  defaultValue: 0,
  min: 0,
  max: 2_147_483_647,
  step: 1,
};

const duration: KieFieldDefinition = {
  key: 'duration',
  label: 'Duration',
  type: 'select',
  defaultValue: '5',
  options: ['5', '8', '10'].map((value) => ({ label: `${value} seconds`, value })),
};

const videoResolution: KieFieldDefinition = {
  key: 'resolution',
  label: 'Resolution',
  type: 'select',
  defaultValue: '720p',
  options: ['480p', '720p', '1080p'].map((value) => ({ label: value, value })),
};

const boolField = (key: string, label: string, defaultValue = false): KieFieldDefinition => ({
  key,
  label,
  type: 'boolean',
  defaultValue,
});

const textField = (key: string, label: string, description?: string): KieFieldDefinition => ({
  key,
  label,
  type: 'text',
  description,
});

const selectField = (
  key: string,
  label: string,
  defaultValue: string,
  options: string[]
): KieFieldDefinition => ({
  key,
  label,
  type: 'select',
  defaultValue,
  options: options.map((value) => ({ label: value.replaceAll('_', ' '), value })),
});

const paired = (
  textModelId: string,
  imageModelId: string,
  imageInputKey: string,
  fields: KieFieldDefinition[],
  maxInputImages = 1,
  imageInputMultiple = true
): KieModelVariant[] => [
  { modelId: textModelId, protocol: 'market', inputMode: 'text', fields },
  {
    modelId: imageModelId,
    protocol: 'market',
    inputMode: 'image',
    imageInputKey,
    imageInputMultiple,
    maxInputImages,
    fields,
  },
];

export const KIE_MODELS: KieModelDefinition[] = [
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    fileCode: 'nano-banana-pro',
    provider: 'Google',
    description: 'Text to image, or editing from up to 8 reference images.',
    mediaType: 'image',
    variants: paired(
      'nano-banana-pro',
      'nano-banana-pro',
      'image_input',
      [aspectRatios, imageResolution, outputFormat],
      8
    ),
  },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    fileCode: 'nano-banana-2',
    provider: 'Google',
    description: 'Text to image, or editing from up to 8 reference images. Two output resolutions.',
    mediaType: 'image',
    variants: paired(
      'nano-banana-2',
      'nano-banana-2',
      'image_input',
      [aspectRatios, { ...imageResolution, options: imageResolution.options?.slice(0, 2) }, outputFormat],
      8
    ),
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    fileCode: 'gpt-image-2',
    provider: 'OpenAI',
    description: 'Text to image, or editing from up to 16 reference images.',
    mediaType: 'image',
    variants: paired(
      'gpt-image-2-text-to-image',
      'gpt-image-2-image-to-image',
      'input_urls',
      [aspectRatios, imageResolution, seed],
      16
    ),
  },
  {
    id: 'flux-2-pro',
    label: 'FLUX.2 Pro',
    fileCode: 'flux-2-pro',
    provider: 'Black Forest Labs',
    description: 'Text to image, or editing from up to 4 reference images.',
    mediaType: 'image',
    variants: paired(
      'flux-2/pro-text-to-image',
      'flux-2/pro-image-to-image',
      'image_urls',
      [aspectRatios, { ...imageResolution, options: imageResolution.options?.slice(0, 2) }, seed],
      4
    ),
  },
  {
    id: 'seedream-5-pro',
    label: 'Seedream 5 Pro',
    fileCode: 'seedream-5-pro',
    provider: 'ByteDance',
    description: 'Text to image, or editing from up to 6 reference images. Takes a negative prompt.',
    mediaType: 'image',
    variants: paired(
      'seedream/5-pro-text-to-image',
      'seedream/5-pro-image-to-image',
      'image_urls',
      [aspectRatios, outputFormat, seed, textField('negative_prompt', 'Negative prompt')],
      6
    ),
  },
  {
    id: 'imagen-4-ultra',
    label: 'Imagen 4 Ultra',
    fileCode: 'imagen-4-ultra',
    provider: 'Google',
    description: 'Text to image only. Takes a negative prompt.',
    mediaType: 'image',
    variants: [
      {
        modelId: 'google/imagen4-ultra',
        protocol: 'market',
        inputMode: 'text',
        fields: [aspectRatios, textField('negative_prompt', 'Negative prompt'), seed],
      },
    ],
  },
  {
    id: 'ideogram-v3',
    label: 'Ideogram V3',
    fileCode: 'ideogram-v3',
    provider: 'Ideogram',
    description: 'Text to image only. Rendering speed and prompt enhancement are adjustable.',
    mediaType: 'image',
    variants: [
      {
        modelId: 'ideogram/v3-text-to-image',
        protocol: 'market',
        inputMode: 'text',
        fields: [
          aspectRatios,
          seed,
          {
            key: 'rendering_speed',
            label: 'Rendering speed',
            type: 'select',
            defaultValue: 'DEFAULT',
            options: ['DEFAULT', 'TURBO', 'QUALITY'].map((value) => ({ label: value, value })),
          },
          boolField('magic_prompt_option', 'Prompt enhancement', true),
        ],
      },
    ],
  },
  {
    id: 'z-image',
    label: 'Z-Image',
    fileCode: 'z-image',
    provider: 'Z.ai',
    description: 'Text to image only. Aspect ratio is the only control.',
    mediaType: 'image',
    variants: [
      {
        modelId: 'z-image',
        protocol: 'market',
        inputMode: 'text',
        fields: [aspectRatios],
      },
    ],
  },
  {
    id: 'veo-3-1',
    label: 'Veo 3.1',
    fileCode: 'veo-3_1',
    provider: 'Google',
    description: 'Text to video, or from up to 2 images, including first and last frame. Comes with audio.',
    mediaType: 'video',
    variants: [
      {
        modelId: 'veo3_fast',
        protocol: 'veo',
        inputMode: 'text',
        fields: [
          { ...aspectRatios, options: aspectRatios.options?.filter((option) => ['auto', '16:9', '9:16'].includes(String(option.value))) },
          textField('watermark', 'Watermark'),
          boolField('enableTranslation', 'Translate prompt', true),
          selectField('generationType', 'Generation mode', 'TEXT_2_VIDEO', ['TEXT_2_VIDEO']),
        ],
      },
      {
        modelId: 'veo3_fast',
        protocol: 'veo',
        inputMode: 'image',
        imageInputKey: 'imageUrls',
        imageInputMultiple: true,
        maxInputImages: 2,
        fields: [
          { ...aspectRatios, options: aspectRatios.options?.filter((option) => ['auto', '16:9', '9:16'].includes(String(option.value))) },
          textField('watermark', 'Watermark'),
          boolField('enableTranslation', 'Translate prompt', true),
          selectField('generationType', 'Generation mode', 'REFERENCE_2_VIDEO', [
            'FIRST_AND_LAST_FRAMES_2_VIDEO',
            'REFERENCE_2_VIDEO',
          ]),
        ],
      },
    ],
  },
  {
    id: 'kling-3-0',
    label: 'Kling 3.0',
    fileCode: 'kling-3_0',
    provider: 'Kling',
    description: 'Text to video, or animates one image. Duration and resolution are adjustable.',
    mediaType: 'video',
    variants: paired(
      'kling-3.0/video',
      'kling/v3-turbo-image-to-video',
      'image_urls',
      [aspectRatios, duration, videoResolution, textField('negative_prompt', 'Negative prompt'), seed],
      1
    ),
  },
  {
    id: 'seedance-2',
    label: 'Seedance 2',
    fileCode: 'seedance-2',
    provider: 'ByteDance',
    description: 'Text to video only. Audio optional.',
    mediaType: 'video',
    variants: [
      {
        modelId: 'bytedance/seedance-2',
        protocol: 'market',
        inputMode: 'text',
        fields: [aspectRatios, duration, videoResolution, boolField('generate_audio', 'Generate audio', true), seed],
      },
    ],
  },
  {
    id: 'wan-2-7',
    label: 'Wan 2.7',
    fileCode: 'wan-2_7',
    provider: 'Wan',
    description: 'Text to video, or animates one image. Expands short prompts.',
    mediaType: 'video',
    variants: paired(
      'wan/2-7-text-to-video',
      'wan/2-7-image-to-video',
      'image_url',
      [aspectRatios, duration, videoResolution, boolField('enable_prompt_expansion', 'Expand prompt', true), seed],
      1,
      false
    ),
  },
  {
    id: 'hailuo-2-3-pro',
    label: 'Hailuo 2.3 Pro',
    fileCode: 'hailuo-2_3-pro',
    provider: 'MiniMax',
    description: 'Animates one image. No text-only mode.',
    mediaType: 'video',
    variants: [
      {
        modelId: 'hailuo/2-3-image-to-video-pro',
        protocol: 'market',
        inputMode: 'image',
        imageInputKey: 'image_url',
        maxInputImages: 1,
        fields: [duration, videoResolution, boolField('prompt_optimizer', 'Optimize prompt', true), seed],
      },
    ],
  },
  {
    id: 'grok-imagine',
    label: 'Grok Imagine',
    fileCode: 'grok-imagine',
    provider: 'xAI',
    description: 'Text to video, or animates one image.',
    mediaType: 'video',
    variants: paired(
      'grok-imagine/text-to-video',
      'grok-imagine/image-to-video',
      'image_urls',
      [aspectRatios, duration, videoResolution, seed],
      1
    ),
  },
  {
    id: 'pixverse-v6',
    label: 'PixVerse V6',
    fileCode: 'pixverse-v6',
    provider: 'PixVerse',
    description: 'Text to video, or animates one image. Audio and multi-clip optional.',
    mediaType: 'video',
    variants: paired(
      'pixverse-v6/text-to-video',
      'pixverse-v6/image-to-video',
      'image_url',
      [
        aspectRatios,
        duration,
        {
          key: 'quality',
          label: 'Quality',
          type: 'select',
          defaultValue: '540p',
          options: ['360p', '540p', '720p', '1080p'].map((value) => ({ label: value, value })),
        },
        boolField('generate_audio_switch', 'Generate audio', true),
        boolField('generate_multi_clip_switch', 'Generate multiple clips'),
        seed,
      ],
      1,
      false
    ),
  },
];

export function modelsForKieMode(mediaType: MediaType, inputMode: KieInputMode): KieModelDefinition[] {
  return KIE_MODELS.filter(
    (model) => model.mediaType === mediaType && model.variants.some((variant) => variant.inputMode === inputMode)
  );
}

export function resolveKieVariant(modelId: string, inputMode: KieInputMode): KieModelVariant {
  const model = KIE_MODELS.find((candidate) => candidate.id === modelId);
  const variant = model?.variants.find((candidate) => candidate.inputMode === inputMode);

  if (!variant) {
    throw new Error(`The selected Kie model does not support ${inputMode}-to-${model?.mediaType ?? 'media'}.`);
  }

  return variant;
}

export function defaultKieValues(variant: KieModelVariant): Record<string, string | number | boolean> {
  return Object.fromEntries(
    variant.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as string | number | boolean])
  );
}

export function validateKieInput(
  variant: KieModelVariant,
  args: { prompt: string; uploadUrls: string[] }
): string | null {
  if (!args.prompt.trim()) return 'Enter a prompt for the selected Kie model.';
  if (variant.inputMode !== 'image') return null;
  if (args.uploadUrls.length === 0) return 'Add at least one reference image for the selected Kie model.';
  const maxInputImages = variant.maxInputImages ?? 1;
  if (args.uploadUrls.length > maxInputImages) {
    return `This Kie model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`;
  }
  return null;
}

export function buildKieInput(
  variant: KieModelVariant,
  args: {
    prompt: string;
    uploadUrls: string[];
    values: Record<string, string | number | boolean | undefined>;
  }
): Record<string, string | number | boolean | string[]> {
  const input: Record<string, string | number | boolean | string[]> = { prompt: args.prompt };

  if (variant.imageInputKey && args.uploadUrls.length > 0) {
    input[variant.imageInputKey] = variant.imageInputMultiple
      ? args.uploadUrls
      : args.uploadUrls[0];
  }

  for (const field of variant.fields) {
    const value = args.values[field.key];
    if (value !== undefined && value !== '') input[field.key] = value;
  }

  const hasReferences = args.uploadUrls.length > 0;
  const applied = applyProviderModeration(input, {
    provider: 'kie',
    modelId: variant.modelId,
    level: effectiveModerationLevel({ level: args.values.moderation, prompt: args.prompt, hasReferences }),
    hasReferences,
  });
  // The per-model Safety check and Enable fallback controls are gone. The
  // checker is the Relaxed filter; Standard still sends `true`, which is what
  // the catalog default sent. Fallback stays hard-off: Kie used it to switch
  // models on errors that include the minor and prominent-person floors.
  return lockKieVeoFallback(applied, variant.protocol);
}
