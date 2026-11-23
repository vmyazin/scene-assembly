// lib/kie/catalog.ts
import { editPromptMode, editReferenceError, editReferenceFields, materializeEditReferences, type EditReferenceInput } from '../providers/edit-references';
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

// https://docs.kie.ai/market/wan/2-7-image-to-video
// Keep saved duration strings and the shared prompt toggle usable across models.
const wanVideoFields: KieFieldDefinition[] = [
  {
    ...duration,
    options: Array.from({ length: 14 }, (_, i) => {
      const seconds = i + 2;
      return { label: `${seconds} seconds`, value: String(seconds), wireValue: seconds };
    }),
  },
  selectField('resolution', 'Resolution', '720p', ['720p', '1080p']),
  { ...boolField('enable_prompt_expansion', 'Expand prompt', true), wireKey: 'prompt_extend' },
  seed,
];

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

/**
 * GPT Image 2.6 on Kie, read 2026-11-21 from
 * `https://docs.kie.ai/market/gpt/gpt-image-2-6-{sunburst,flare}-{text-to-image,image-to-image}.md`.
 * It replaces GPT Image 2, which OpenAI retires on 2027-02-10.
 *
 * The request schema is closed (`additionalProperties: false`), so only fields
 * it names are listed: GPT Image 2's `seed` is not one of them. `quality` is
 * sent explicitly because Kie bills this family by token
 * (https://kie.ai/gpt-image-2-6: image output $27.00 per million, the same for
 * both weights) and quality is what moves the token count. `auto` is left out:
 * it lets the vendor pick the tier the user pays for.
 *
 * Kie's own `moderation` default is `low`, so the Standard `auto` is written by
 * `lib/moderation/capabilities.ts`, not left to the vendor.
 *
 * Kie also sells a flat-price 1K "Economy" endpoint with a different schema.
 * It is not listed here.
 */
function gptImage26(variant: 'sunburst' | 'flare'): KieModelDefinition {
  const name = variant === 'sunburst' ? 'Sunburst' : 'Flare';
  return {
    id: `gpt-image-2-6-${variant}`,
    label: `GPT Image 2.6 ${name}`,
    fileCode: `gpt-image-2_6-${variant}`,
    provider: 'OpenAI',
    description:
      variant === 'sunburst'
        ? 'Text to image, or editing from up to 16 reference images. Detailed compositions and precise edits.'
        : 'Text to image, or editing from up to 16 reference images. The faster of the two.',
    mediaType: 'image',
    variants: paired(
      `gpt-image-2-6/${variant}-text-to-image`,
      `gpt-image-2-6/${variant}-image-to-image`,
      'input_urls',
      [aspectRatios, imageResolution, selectField('quality', 'Quality', 'medium', ['low', 'medium', 'high', 'xhigh', 'max'])],
      16
    ),
  };
}

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
  ...(['sunburst', 'flare'] as const).map(gptImage26),
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
    variants: [
      {
        modelId: 'wan/2-7-text-to-video',
        protocol: 'market',
        inputMode: 'text',
        fields: [
          { ...selectField('aspect_ratio', 'Aspect ratio', '16:9', ['16:9', '9:16', '1:1', '4:3', '3:4']), wireKey: 'ratio' },
          ...wanVideoFields,
        ],
      },
      {
        modelId: 'wan/2-7-image-to-video',
        protocol: 'market',
        inputMode: 'image',
        imageInputKey: 'first_frame_url',
        imageInputMultiple: false,
        maxInputImages: 1,
        fields: wanVideoFields,
      },
      // https://docs.kie.ai/market/wan/2-7-videoedit (read 2026-10-16).
      // video_url required. reference_image is one optional URL.
      // Source 2–10s, 240–4096px, aspect 1:8–8:1, ≤100MB, mp4/mov.
      // Duration 0 or 2–10 (1 is not valid). No dollar price is published.
      {
        modelId: 'wan/2-7-videoedit',
        protocol: 'market',
        inputMode: 'edit',
        imageInputKey: 'reference_image',
        imageInputMultiple: false,
        maxInputImages: 1,
        price: 'unknown',
        edit: {
          sizes: [],
          maxImages: 1,
          minSeconds: 2,
          maxSeconds: 10,
          maxBytes: 100_000_000,
          mimes: ['video/mp4', 'video/quicktime'],
          requireMeasurement: true,
          sourceBounds: { minEdge: 240, maxEdge: 4096, minRatio: 1 / 8, maxRatio: 8 },
          references: { prompt: 'optional', images: { max: 1, wire: 'reference_image' } },
          note: 'Kie has not published a dollar price for this edit. One optional reference image. Output duration 0 keeps the source length.',
        },
        fields: [
          {
            key: 'resolution',
            label: 'Resolution',
            type: 'select',
            defaultValue: '1080p',
            description: '1080p costs more than 720p. Kie does not publish the dollar amounts.',
            options: ['720p', '1080p'].map((value) => ({ label: value, value })),
          },
          {
            key: 'aspect_ratio',
            label: 'Aspect ratio',
            type: 'select',
            description: 'Match source keeps a frame close to the input. Omit the field to keep it.',
            options: [
              { label: 'Match source', value: '' },
              ...['16:9', '9:16', '1:1', '4:3', '3:4'].map((value) => ({ label: value, value })),
            ],
          },
          {
            key: 'duration',
            label: 'Output duration',
            type: 'select',
            defaultValue: 0,
            description: 'Match source keeps the input length. Any other value clips from the start. 1 second is not a valid length.',
            options: [
              { label: 'Match source', value: 0 },
              ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ label: `${value} seconds`, value })),
            ],
          },
          {
            key: 'audio_setting',
            label: 'Audio',
            type: 'select',
            defaultValue: 'auto',
            options: [
              { label: 'Auto', value: 'auto' },
              { label: 'Keep original', value: 'origin' },
            ],
          },
          boolField('prompt_extend', 'Expand prompt', true),
          {
            key: 'negative_prompt',
            label: 'Negative prompt',
            type: 'text',
            maxLength: 500,
            description: 'Up to 500 characters. Leave blank to omit it.',
          },
        ],
      },
    ],
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

/**
 * Models that have left this catalog. Saved jobs, library cards and stored
 * settings still name them, so the label and filename code are kept; none is
 * selectable, and a stored selection moves to `replacedBy`.
 *
 * GPT Image 2 (`gpt-image-2-text-to-image` / `gpt-image-2-image-to-image`) is
 * retired by OpenAI on 2027-02-10 and was replaced here on 2026-11-21.
 */
const PAST_KIE_MODELS: Record<string, Pick<KieModelDefinition, 'label' | 'fileCode'> & { replacedBy: string }> = {
  'gpt-image-2': { label: 'GPT Image 2', fileCode: 'gpt-image-2', replacedBy: 'gpt-image-2-6-sunburst' },
};

export function pastKieModel(modelId: string | undefined) {
  return modelId ? PAST_KIE_MODELS[modelId] : undefined;
}

/** The name a job was run under, whether or not the model is still offered. */
export function kieModelLabel(modelId: string): string {
  return KIE_MODELS.find((model) => model.id === modelId)?.label ?? pastKieModel(modelId)?.label ?? modelId;
}

/** A stored selection, moved to its successor when the model has left the catalog. */
export function currentKieModelId(modelId: string): string {
  return pastKieModel(modelId)?.replacedBy ?? modelId;
}

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
  args: { prompt: string; uploadUrls: string[]; references?: EditReferenceInput }
): string | null {
  const promptMode = variant.inputMode === 'edit' ? editPromptMode(variant.edit?.references) : 'required';
  if (promptMode === 'required' && !args.prompt.trim()) return 'Enter a prompt for the selected Kie model.';
  if (variant.inputMode === 'edit' && args.prompt.trim().length > 5000) return 'This model\'s prompt is at most 5000 characters.';
  if (variant.inputMode === 'edit') {
    if (args.uploadUrls.length < 1 && !args.references?.video) return 'Choose a source video to edit.';
    const spec = variant.edit?.references;
    if (!spec) return null;
    const images = args.uploadUrls.slice(0, Math.max(0, args.uploadUrls.length - 1));
    return editReferenceError(spec, args.references ?? materializeEditReferences(spec, images));
  }
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
    references?: EditReferenceInput;
  }
): Record<string, string | number | boolean | string[]> {
  const promptMode = variant.inputMode === 'edit' ? editPromptMode(variant.edit?.references) : 'required';
  const input: Record<string, string | number | boolean | string[]> = {};
  if (promptMode !== 'absent' && args.prompt.trim()) input.prompt = args.prompt.trim();

  if (variant.inputMode === 'edit' && variant.edit?.references) {
    const spec = variant.edit.references;
    const video = args.references?.video ?? args.uploadUrls[args.uploadUrls.length - 1];
    const images = args.uploadUrls.slice(0, Math.max(0, args.uploadUrls.length - 1));
    const references = args.references ?? materializeEditReferences(spec, images);
    const fields = editReferenceFields(spec, { ...references, video });
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
        input[key] = value as string | number | boolean | string[];
      }
    }
  } else if (variant.imageInputKey && args.uploadUrls.length > 0) {
    input[variant.imageInputKey] = variant.imageInputMultiple
      ? args.uploadUrls
      : args.uploadUrls[0];
  }

  for (const field of variant.fields) {
    const value = args.values[field.key];
    if (value !== undefined && value !== '') {
      const option = field.options?.find(option => option.value === value);
      input[field.wireKey ?? field.key] = option?.wireValue ?? value;
    }
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
