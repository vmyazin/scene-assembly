// lib/fal/catalog.ts
import { editPromptMode, editReferenceError, editReferenceFields, materializeEditReferences, type EditReferenceInput } from '../providers/edit-references';
import { applyProviderModeration } from '../moderation/capabilities';
import { effectiveModerationLevel } from '../moderation/floors';
import type {
  FalFieldDefinition,
  FalFieldOption,
  FalInputMode,
  FalMediaType,
  FalModelDefinition,
  FalModelVariant,
  FalValue,
} from './types';

const options = (values: Array<string | number>): FalFieldOption[] =>
  values.map((value) => ({
    label: String(value).replaceAll('_', ' '),
    value,
  }));

const selectField = (
  key: string,
  label: string,
  defaultValue: string | number,
  values: Array<string | number>,
  constraints?: Pick<FalFieldDefinition, 'min' | 'max' | 'step'>
): FalFieldDefinition => ({
  key,
  label,
  type: 'select',
  defaultValue,
  options: options(values),
  ...constraints,
});

const numberField = (
  key: string,
  label: string,
  defaultValue: number,
  min: number,
  max: number,
  step = 1
): FalFieldDefinition => ({ key, label, type: 'number', defaultValue, min, max, step });

const booleanField = (key: string, label: string, defaultValue: boolean): FalFieldDefinition => ({
  key,
  label,
  type: 'boolean',
  defaultValue,
});

const textField = (key: string, label: string, description?: string): FalFieldDefinition => ({
  key,
  label,
  type: 'text',
  description,
});

const imageVariant = (
  modelId: string,
  endpointId: string,
  imageInputKey: 'image_url' | 'image_urls' | 'start_image_url',
  fields: FalFieldDefinition[],
  maxInputImages = 1,
  imageInputMultiple = false
): FalModelVariant => ({
  id: `${modelId}:image`,
  endpointId,
  inputMode: 'image',
  imageInputKey,
  imageInputMultiple,
  maxInputImages,
  fields,
});

const textVariant = (
  modelId: string,
  endpointId: string,
  fields: FalFieldDefinition[]
): FalModelVariant => ({
  id: `${modelId}:text`,
  endpointId,
  inputMode: 'text',
  fields,
});

/**
 * A first-and-last-frame run: exactly two ordered stills, the opening and the
 * closing frame, with the model interpolating the motion between them.
 */
const framesVariant = (
  modelId: string,
  endpointId: string,
  frameInputKeys: { first: string; last: string },
  fields: FalFieldDefinition[]
): FalModelVariant => ({
  id: `${modelId}:frames`,
  endpointId,
  inputMode: 'frames',
  frameInputKeys,
  maxInputImages: 2,
  fields,
});

/** A model before its download filename code is attached — see withFileCodes. */
type FalModelBase = Omit<FalModelDefinition, 'fileCode'>;

const videoModel = (
  id: string,
  label: string,
  provider: string,
  description: string,
  textEndpoint: string,
  imageEndpoint: string,
  textFields: FalFieldDefinition[],
  imageFields = textFields,
  imageInputKey: 'image_url' | 'start_image_url' = 'image_url'
): FalModelBase => ({
  id,
  label,
  provider,
  description,
  mediaType: 'video',
  variants: [
    textVariant(id, textEndpoint, textFields),
    imageVariant(id, imageEndpoint, imageInputKey, imageFields),
  ],
});

/**
 * Give a video model a first-and-last-frame variant. Most fal video models take
 * a closing still as an extra `end_image_url` on their existing image-to-video
 * endpoint, so the endpoint, opening-frame key, and controls all default to that
 * variant's; Veo 3.1 is the exception and passes all three explicitly.
 */
const withFrames = (
  model: FalModelBase,
  frames: {
    lastFrameKey: string;
    firstFrameKey?: string;
    endpointId?: string;
    fields?: FalFieldDefinition[];
  }
): FalModelBase => {
  const imageVariantOf = model.variants.find((variant) => variant.inputMode === 'image');
  if (!imageVariantOf?.imageInputKey) {
    throw new Error(`Cannot add frames support to ${model.id} without an image variant.`);
  }

  return {
    ...model,
    variants: [
      ...model.variants,
      framesVariant(
        model.id,
        frames.endpointId ?? imageVariantOf.endpointId,
        {
          first: frames.firstFrameKey ?? imageVariantOf.imageInputKey,
          last: frames.lastFrameKey,
        },
        frames.fields ?? imageVariantOf.fields
      ),
    ],
  };
};

const NANO_ASPECT_RATIOS = [
  'auto',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
  '4:1',
  '1:4',
  '8:1',
  '1:8',
];

const NANO_FIELDS = [
  selectField('aspect_ratio', 'Aspect ratio', 'auto', NANO_ASPECT_RATIOS),
  selectField('resolution', 'Resolution', '1K', ['1K', '2K', '4K']),
  booleanField('enable_web_search', 'Enable web search', false),
];

/**
 * Nano Banana 2.1 on fal, read 2026-10-15 from
 * https://fal.ai/models/google/nano-banana-2.1/llms.txt and the edit sibling.
 * Same aspect and resolution enums as Nano Banana 2, plus thinking_level.
 * Text is `google/nano-banana-2.1`; references are `google/nano-banana-2.1/edit`
 * (up to 14 `image_urls`).
 */
const NANO_21_FIELDS = [
  ...NANO_FIELDS,
  selectField('thinking_level', 'Thinking', 'medium', ['minimal', 'medium', 'high']),
];

const nanoBananaImageModel = (
  id: string,
  label: string,
  fileCode: string,
  description: string,
  textEndpoint: string,
  editEndpoint: string,
  fields: FalFieldDefinition[],
  /** Set on a retired model: its successor's id, which also marks it deprecated. */
  replacedBy?: string
): FalModelDefinition => ({
  id,
  label,
  fileCode,
  provider: 'Google',
  description,
  mediaType: 'image',
  ...(replacedBy ? { deprecated: true, replacedBy } : {}),
  variants: [
    textVariant(id, textEndpoint, fields),
    imageVariant(id, editEndpoint, 'image_urls', fields, 14, true),
  ],
});

export const FAL_IMAGE_MODELS: FalModelDefinition[] = [
  nanoBananaImageModel(
    'nano-banana-2.1',
    'Nano Banana 2.1',
    'nano-banana-2_1',
    'Nano Banana 2.1. Text and multi-image editing at 1K, 2K or 4K, with optional web search and thinking.',
    'google/nano-banana-2.1',
    'google/nano-banana-2.1/edit',
    NANO_21_FIELDS
  ),
  nanoBananaImageModel(
    'nano-banana-2',
    'Nano Banana 2',
    'nano-banana-2',
    'Deprecated. Nano Banana 2.1 replaces it. Still available: reasoning-guided image generation and multi-image editing with optional web grounding.',
    'fal-ai/nano-banana-2',
    'fal-ai/nano-banana-2/edit',
    NANO_FIELDS,
    'nano-banana-2.1'
  ),
];

/** The image model a fal run uses when nobody has chosen. */
export const FAL_IMAGE_MODEL: FalModelDefinition = FAL_IMAGE_MODELS[0];

const VEO_BASE_FIELDS = [
  selectField('duration', 'Duration', '8s', ['4s', '6s', '8s']),
  selectField('resolution', 'Resolution', '720p', ['720p', '1080p', '4k']),
  booleanField('generate_audio', 'Generate audio', true),
];

const VEO_TEXT_FIELDS = [
  ...VEO_BASE_FIELDS,
  selectField('aspect_ratio', 'Aspect ratio', '16:9', ['16:9', '9:16']),
];

const VEO_IMAGE_FIELDS = [
  ...VEO_BASE_FIELDS,
  selectField('aspect_ratio', 'Aspect ratio', 'auto', ['auto', '16:9', '9:16']),
];

/**
 * Veo 3.1 Lite, read 2026-10-01 from
 * https://fal.ai/models/fal-ai/veo3.1/lite/llms.txt and the image-to-video and
 * first-last-frame siblings. Same duration and aspect enums as Veo 3.1, but
 * resolution stops at 1080p — there is no 4k option on these endpoints.
 */
const VEO_LITE_BASE_FIELDS = [
  selectField('duration', 'Duration', '8s', ['4s', '6s', '8s']),
  selectField('resolution', 'Resolution', '720p', ['720p', '1080p']),
  booleanField('generate_audio', 'Generate audio', true),
];

const VEO_LITE_TEXT_FIELDS = [
  ...VEO_LITE_BASE_FIELDS,
  selectField('aspect_ratio', 'Aspect ratio', '16:9', ['16:9', '9:16']),
];

const VEO_LITE_IMAGE_FIELDS = [
  ...VEO_LITE_BASE_FIELDS,
  selectField('aspect_ratio', 'Aspect ratio', 'auto', ['auto', '16:9', '9:16']),
];

const seedanceFields = (resolutions: string[]): FalFieldDefinition[] => [
  selectField(
    'duration',
    'Duration',
    'auto',
    ['auto', ...Array.from({ length: 12 }, (_, index) => String(index + 4))]
  ),
  selectField('resolution', 'Resolution', '720p', resolutions),
  booleanField('generate_audio', 'Generate audio', true),
  selectField('aspect_ratio', 'Aspect ratio', 'auto', [
    'auto',
    '21:9',
    '16:9',
    '4:3',
    '1:1',
    '3:4',
    '9:16',
  ]),
  selectField('bitrate_mode', 'Bitrate', 'standard', ['standard', 'high']),
];

const klingFields = (includeAspectRatio: boolean): FalFieldDefinition[] => [
  selectField(
    'duration',
    'Duration',
    '5',
    Array.from({ length: 13 }, (_, index) => String(index + 3))
  ),
  booleanField('generate_audio', 'Generate audio', true),
  ...(includeAspectRatio
    ? [selectField('aspect_ratio', 'Aspect ratio', '16:9', ['16:9', '9:16', '1:1'])]
    : []),
  textField('negative_prompt', 'Negative prompt', 'Describe visual elements to avoid.'),
];

const HAILUO_STANDARD_FIELDS = [
  selectField('duration', 'Duration', '6', ['6', '10']),
  booleanField('prompt_optimizer', 'Optimize prompt', true),
];

const HAILUO_PRO_FIELDS = [booleanField('prompt_optimizer', 'Optimize prompt', true)];

/**
 * MiniMax H3 Max Turbo, read 2026-10-15 from the fal OpenAPI schema.
 * Duration is a number from 0.92 to 15 (default 5), not a fixed enum, so there
 * is no step: 5 and 0.92 are both legal, and a step of 1 off 0.92 would reject
 * every whole second. Resolution values stay uppercase because that is the enum.
 */
const H3_MAX_TURBO_FIELDS: FalFieldDefinition[] = [
  {
    key: 'duration',
    label: 'Duration',
    type: 'number',
    defaultValue: 5,
    min: 0.92,
    max: 15,
    description: 'Seconds, from 0.92 to 15. The clip can run about 0.7 s longer than requested.',
  },
  {
    key: 'resolution',
    label: 'Resolution',
    type: 'select',
    defaultValue: '768P',
    options: [
      { label: '480p', value: '480P' },
      { label: '768p', value: '768P' },
      { label: '1080p', value: '1080P' },
    ],
  },
  {
    key: 'prompt_expansion_mode',
    label: 'Prompt expansion',
    type: 'select',
    defaultValue: 'balanced',
    options: [
      { label: 'Disabled', value: 'disabled' },
      { label: 'Balanced', value: 'balanced' },
      { label: 'Quality', value: 'quality' },
    ],
    description: 'Disabled skips rewriting. Balanced takes about a second. Quality can take about 30 seconds.',
  },
];

const wanFields = (includeAspectRatio: boolean): FalFieldDefinition[] => [
  numberField('duration', 'Duration', 5, 2, 15),
  selectField('resolution', 'Resolution', '720p', ['720p', '1080p']),
  ...(includeAspectRatio
    ? [selectField('aspect_ratio', 'Aspect ratio', '16:9', ['16:9', '9:16', '1:1'])]
    : []),
  textField('negative_prompt', 'Negative prompt', 'Describe visual elements to avoid.'),
  booleanField('enable_prompt_expansion', 'Enable prompt expansion', true),
];

/**
 * Short code each model tags its downloads with, so a saved file says which
 * model made it: `neon-tiger-in-the-rain-wan-2_7.mp4`. Lowercase and
 * hyphen-separated, with a version's decimal point written as `_` (`2.7` →
 * `2_7`) so it reads apart from the word separators. Kept as a map because the
 * definitions below are assembled by helpers rather than written out as object
 * literals; `withFileCodes` fails loudly if a model is missing one.
 */
const FAL_FILE_CODES: Record<string, string> = {
  'veo-3-1': 'veo-3_1',
  'veo-3-1-fast': 'veo-3_1-fast',
  'veo-3-1-lite': 'veo-3_1-lite',
  'seedance-2': 'seedance-2_0',
  'seedance-2-fast': 'seedance-2_0-fast',
  'kling-3-standard': 'kling-3-standard',
  'kling-3-pro': 'kling-3-pro',
  'hailuo-2-3-standard': 'hailuo-2_3-standard',
  'hailuo-2-3-pro': 'hailuo-2_3-pro',
  'wan-2-7': 'wan-2_7',
  'h3-max-turbo': 'h3-max-turbo',
  'kling-o1-edit': 'kling-o1-edit',
  'kling-o3-standard-edit': 'kling-o3-standard-edit',
  'kling-o3-pro-edit': 'kling-o3-pro-edit',
  'kling-o3-4k-edit': 'kling-o3-4k-edit',
  'wan-2-7-edit': 'wan-2_7-edit',
  'luma-ray-3-2-edit': 'luma-ray-3_2-edit',
  'h3-max-recast': 'h3-max-recast',
  'h3-max-relight': 'h3-max-relight',
};

const KLING_EDIT_MIMES = ['video/mp4', 'video/quicktime'] as const;

/** Shared Kling video-to-video limits. Prices are the pages' per-second rates. */
const klingEditLimits = ({
  maxSeconds,
  maxEdge,
  usd,
  namesSource = false,
}: {
  maxSeconds: number;
  maxEdge: number;
  usd: number;
  /** O3's page tells the prompt to name the source `@Video1`. O1 does not. */
  namesSource?: boolean;
}) => ({
  sizes: [],
  rate: { per: 'second' as const, usd },
  maxImages: 4,
  minSeconds: 3,
  maxSeconds,
  maxBytes: 200_000_000,
  mimes: KLING_EDIT_MIMES,
  requireMeasurement: true,
  sourceBounds: { minEdge: 720, maxEdge },
  promptSyntax: 'at-image-index' as const,
  ...(namesSource ? { namesSource: true as const } : {}),
});

const durationChoices = (values: number[], matchSource = false): FalFieldDefinition => ({
  key: 'duration',
  label: 'Output duration',
  type: 'select',
  defaultValue: matchSource ? 0 : values[0],
  description: matchSource ? 'Match source keeps the input length. Any other value clips from the start.' : undefined,
  options: [
    ...(matchSource ? [{ label: 'Match source', value: 0 }] : []),
    ...values.filter((value) => value !== 0).map((value) => ({ label: `${value} seconds`, value })),
  ],
});

const editOnlyModel = (
  id: string,
  label: string,
  provider: string,
  description: string,
  endpointId: string,
  edit: NonNullable<FalModelBase['variants'][number]['edit']>,
  fields: FalFieldDefinition[]
): FalModelBase => ({
  id,
  label,
  provider,
  description,
  mediaType: 'video',
  variants: [{
    id: `${id}:edit`,
    endpointId,
    inputMode: 'edit',
    maxInputImages: edit.maxImages,
    edit,
    fields,
  }],
});

const editVideoModel = (
  id: string,
  label: string,
  description: string,
  endpointId: string,
  edit: ReturnType<typeof klingEditLimits>,
  keepAudio: boolean
): FalModelBase => ({
  id,
  label,
  provider: 'Kuaishou',
  description,
  mediaType: 'video',
  variants: [{
    id: `${id}:edit`,
    endpointId,
    inputMode: 'edit',
    imageInputKey: 'image_urls',
    imageInputMultiple: true,
    maxInputImages: edit.maxImages,
    edit,
    fields: [booleanField('keep_audio', 'Keep source audio', keepAudio)],
  }],
});

/** The same prompt ceiling on every variant, including one withFrames adds. */
const withPromptLimit = (model: FalModelBase, maxPromptLength: number): FalModelBase => ({
  ...model,
  variants: model.variants.map((variant) => ({ ...variant, maxPromptLength })),
});

const withFileCodes = (models: FalModelBase[]): FalModelDefinition[] =>
  models.map((model) => {
    const fileCode = FAL_FILE_CODES[model.id];
    if (!fileCode) throw new Error(`No download filename code defined for fal model ${model.id}.`);
    return { ...model, fileCode };
  });

export const FAL_VIDEO_MODELS: FalModelDefinition[] = withFileCodes([
  withFrames(
    videoModel(
      'veo-3-1',
      'Veo 3.1 Standard',
      'Google',
      'High-quality video generation with native audio.',
      'fal-ai/veo3.1',
      'fal-ai/veo3.1/image-to-video',
      VEO_TEXT_FIELDS,
      VEO_IMAGE_FIELDS
    ),
    {
      endpointId: 'fal-ai/veo3.1/first-last-frame-to-video',
      firstFrameKey: 'first_frame_url',
      lastFrameKey: 'last_frame_url',
    }
  ),
  withFrames(
    videoModel(
      'veo-3-1-fast',
      'Veo 3.1 Fast',
      'Google',
      'Faster Veo 3.1 video generation with native audio.',
      'fal-ai/veo3.1/fast',
      'fal-ai/veo3.1/fast/image-to-video',
      VEO_TEXT_FIELDS,
      VEO_IMAGE_FIELDS
    ),
    {
      endpointId: 'fal-ai/veo3.1/fast/first-last-frame-to-video',
      firstFrameKey: 'first_frame_url',
      lastFrameKey: 'last_frame_url',
    }
  ),
  withFrames(
    videoModel(
      'veo-3-1-lite',
      'Veo 3.1 Lite',
      'Google',
      'Lower-cost Veo 3.1 at 720p or 1080p, with optional audio. No 4K.',
      'fal-ai/veo3.1/lite',
      'fal-ai/veo3.1/lite/image-to-video',
      VEO_LITE_TEXT_FIELDS,
      VEO_LITE_IMAGE_FIELDS
    ),
    {
      endpointId: 'fal-ai/veo3.1/lite/first-last-frame-to-video',
      firstFrameKey: 'first_frame_url',
      lastFrameKey: 'last_frame_url',
    }
  ),
  withFrames(
    videoModel(
      'seedance-2',
      'Seedance 2.0 Standard',
      'ByteDance',
      'Cinematic video generation with synchronized audio.',
      'bytedance/seedance-2.0/text-to-video',
      'bytedance/seedance-2.0/image-to-video',
      seedanceFields(['480p', '720p', '1080p', '4k'])
    ),
    { lastFrameKey: 'end_image_url' }
  ),
  withFrames(
    videoModel(
      'seedance-2-fast',
      'Seedance 2.0 Fast',
      'ByteDance',
      'Fast cinematic video generation with synchronized audio.',
      'bytedance/seedance-2.0/fast/text-to-video',
      'bytedance/seedance-2.0/fast/image-to-video',
      seedanceFields(['480p', '720p'])
    ),
    { lastFrameKey: 'end_image_url' }
  ),
  withFrames(
    videoModel(
      'kling-3-standard',
      'Kling 3 Standard',
      'Kuaishou',
      'Kling 3 video generation with native audio.',
      'fal-ai/kling-video/v3/standard/text-to-video',
      'fal-ai/kling-video/v3/standard/image-to-video',
      klingFields(true),
      klingFields(false),
      'start_image_url'
    ),
    { lastFrameKey: 'end_image_url' }
  ),
  withFrames(
    videoModel(
      'kling-3-pro',
      'Kling 3 Pro',
      'Kuaishou',
      'Higher-tier Kling 3 video generation with native audio.',
      'fal-ai/kling-video/v3/pro/text-to-video',
      'fal-ai/kling-video/v3/pro/image-to-video',
      klingFields(true),
      klingFields(false),
      'start_image_url'
    ),
    { lastFrameKey: 'end_image_url' }
  ),
  videoModel(
    'hailuo-2-3-standard',
    'MiniMax Hailuo 2.3 Standard',
    'MiniMax',
    'Cost-efficient Hailuo 2.3 video generation at 768p.',
    'fal-ai/minimax/hailuo-2.3/standard/text-to-video',
    'fal-ai/minimax/hailuo-2.3/standard/image-to-video',
    HAILUO_STANDARD_FIELDS
  ),
  videoModel(
    'hailuo-2-3-pro',
    'MiniMax Hailuo 2.3 Pro',
    'MiniMax',
    'Higher-resolution Hailuo 2.3 video generation at 1080p.',
    'fal-ai/minimax/hailuo-2.3/pro/text-to-video',
    'fal-ai/minimax/hailuo-2.3/pro/image-to-video',
    HAILUO_PRO_FIELDS
  ),
  withFrames(
    videoModel(
      'wan-2-7',
      'Wan 2.7',
      'Alibaba',
      'Wan video generation with optional prompt expansion.',
      'fal-ai/wan/v2.7/text-to-video',
      'fal-ai/wan/v2.7/image-to-video',
      wanFields(true),
      wanFields(false)
    ),
    { lastFrameKey: 'end_image_url' }
  ),
  // Read 2026-10-15 from
  // https://fal.ai/models/minimax/h3-max-turbo/image-to-video/llms.txt
  // and the OpenAPI schema. One endpoint: omit both images for text-to-video,
  // `image_url` for the first frame, `end_image_url` for the last. Duration is
  // 0.92–15 seconds (default 5). Resolution is 480P, 768P (default) or 1080P.
  // Prompt is required, at most 50,000 characters. prompt_expansion_mode is
  // required: disabled, balanced (default) or quality. Regular prices, the
  // promo having ended 2026-10-15: $0.025 / $0.04 / $0.08 per second.
  withPromptLimit(
    withFrames(
      videoModel(
        'h3-max-turbo',
        'MiniMax H3 Max Turbo',
        'MiniMax',
        'Image to video on fal. Optional closing frame. $0.025/s at 480p, $0.04/s at 768p, $0.08/s at 1080p.',
        'minimax/h3-max-turbo/image-to-video',
        'minimax/h3-max-turbo/image-to-video',
        H3_MAX_TURBO_FIELDS
      ),
      { lastFrameKey: 'end_image_url' }
    ),
    50_000
  ),
  // Read 2026-10-13 from
  // https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit/llms.txt
  // mp4/mov, 3–10s (hard max 10.05), 720–2160px, 200MB, ≤4 images, $0.168/s.
  // keep_audio defaults to false. Element bundles are a separate object and
  // are not a control here; reference images are @Image1, @Image2.
  editVideoModel(
    'kling-o1-edit',
    'Kling O1 Edit',
    'Edit a clip with Kling O1. Address reference images as @Image1, @Image2.',
    'fal-ai/kling-video/o1/video-to-video/edit',
    klingEditLimits({ maxSeconds: 10.05, maxEdge: 2160, usd: 0.168 }),
    false
  ),
  // Read 2026-10-13 from
  // https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/edit/llms.txt
  // The page says 3–15s and 720–3840px, not the narrower 3–10s / 2160px figure.
  // $0.126/s. keep_audio defaults to true. Reference the source as @Video1.
  editVideoModel(
    'kling-o3-standard-edit',
    'Kling O3 Standard Edit',
    'Edit a clip with Kling O3 Standard. Reference the source as @Video1 and images as @Image1.',
    'fal-ai/kling-video/o3/standard/video-to-video/edit',
    klingEditLimits({ maxSeconds: 15, maxEdge: 3840, usd: 0.126, namesSource: true }),
    true
  ),
  // Read 2026-10-16 from
  // https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/llms.txt
  // and the queue OpenAPI. $0.168/s. mp4/mov, 3–15.05s, 720–3840px, 200MB,
  // 24–60 fps (fps is not measured here). Prompt max 2,500. image_urls and
  // elements share a cap of 4. Each element is a frontal image plus 1–3
  // angles. shot_type is the constant "customize".
  editOnlyModel(
    'kling-o3-pro-edit',
    'Kling O3 Pro Edit',
    'Kuaishou',
    'Edit a clip with Kling O3 Pro. Reference the source as @Video1, images as @Image1, and elements as @Element1. $0.168 per second.',
    'fal-ai/kling-video/o3/pro/video-to-video/edit',
    {
      ...klingEditLimits({ maxSeconds: 15.05, maxEdge: 3840, usd: 0.168, namesSource: true }),
      // File count, not the combined cap of 4. One element is a frontal image
      // plus up to 3 angles, and four of those is 16 files.
      maxImages: 16,
      maxPromptLength: 2500,
      references: {
        images: { max: 4, wire: 'image_urls' },
        elements: { minAngles: 1, maxAngles: 3, combinedMax: 4 },
        shotTypeCustomize: true,
      },
    },
    [booleanField('keep_audio', 'Keep source audio', true)]
  ),
  // https://fal.ai/models/fal-ai/kling-video/o3/4k/video-to-video/edit/llms.txt
  // Same reference model as Pro. $0.42/s with or without audio.
  editOnlyModel(
    'kling-o3-4k-edit',
    'Kling O3 4K Edit',
    'Kuaishou',
    'Edit a clip with Kling O3 at 4K. Same references as Pro: @Video1, @Image1, and @Element1. $0.42 per second.',
    'fal-ai/kling-video/o3/4k/video-to-video/edit',
    {
      ...klingEditLimits({ maxSeconds: 15.05, maxEdge: 3840, usd: 0.42, namesSource: true }),
      maxImages: 16,
      maxPromptLength: 2500,
      references: {
        images: { max: 4, wire: 'image_urls' },
        elements: { minAngles: 1, maxAngles: 3, combinedMax: 4 },
        shotTypeCustomize: true,
      },
    },
    [booleanField('keep_audio', 'Keep source audio', true)]
  ),
  // https://fal.ai/models/fal-ai/wan/v2.7/edit-video/llms.txt
  // One reference_image_url. Source 2–10s, MP4/MOV, 100MB. No pixel cap on
  // that page. $0.10/s at 720p, $0.15/s at 1080p. Duration 0 matches the source.
  editOnlyModel(
    'wan-2-7-edit',
    'Wan 2.7 Edit',
    'Alibaba',
    'Edit a clip with Wan 2.7 and one optional reference image. $0.10 per second at 720p, $0.15 at 1080p.',
    'fal-ai/wan/v2.7/edit-video',
    {
      sizes: [],
      rate: { per: 'second', usdByResolution: { '720p': 0.1, '1080p': 0.15 } },
      maxImages: 1,
      minSeconds: 2,
      maxSeconds: 10,
      maxBytes: 100_000_000,
      mimes: KLING_EDIT_MIMES,
      requireMeasurement: true,
      references: { images: { max: 1, wire: 'reference_image_url' } },
    },
    [
      selectField('resolution', 'Resolution', '1080p', ['720p', '1080p']),
      {
        key: 'aspect_ratio',
        label: 'Aspect ratio',
        type: 'select',
        defaultValue: '',
        description: 'Match source keeps the input frame.',
        options: [{ label: 'Match source', value: '' }, ...options(['16:9', '9:16', '1:1', '4:3', '3:4'])],
      },
      durationChoices([2, 3, 4, 5, 6, 7, 8, 9, 10], true),
      selectField('audio_setting', 'Audio', 'auto', ['auto', 'origin']),
    ]
  ),
  // https://fal.ai/models/luma/agent/ray/v3.2/video-to-video/llms.txt
  // Output duration is 5s or 10s. Prices are per 5 seconds: $0.72 / $1.08 / $2.16.
  // Keyframes (up to 64) and start_image_url are mutually exclusive.
  // Source cap of 18s and 200MB is the Luma agents guide
  // https://docs.agents.lumalabs.ai/guides/videos/editing/ — fal's schema omits it.
  // HDR and EXR are account-gated and not offered.
  editOnlyModel(
    'luma-ray-3-2-edit',
    'Luma Ray 3.2',
    'Luma',
    'Re-render a clip with Ray 3.2. Guide it with a start frame or with up to 64 keyframes, not both. $0.72 / $1.08 / $2.16 per 5 seconds at 540p / 720p / 1080p.',
    'luma/agent/ray/v3.2/video-to-video',
    {
      sizes: [],
      rate: { per: 'second', usdByResolution: { '540p': 0.144, '720p': 0.216, '1080p': 0.432 } },
      maxImages: 64,
      maxSeconds: 18,
      maxBytes: 200_000_000,
      mimes: KLING_EDIT_MIMES,
      requireMeasurement: true,
      references: { keyframes: { max: 64, startImage: true } },
      note: 'The source clip must be 18 seconds or shorter. Output length is 5 or 10 seconds, which is what the price uses.',
    },
    [
      selectField('resolution', 'Resolution', '540p', ['540p', '720p', '1080p']),
      selectField('duration', 'Duration', '5s', ['5s', '10s']),
    ]
  ),
  // https://fal.ai/models/minimax/h3-max/recast/llms.txt
  // One photo per person, up to 4, required. Prompt optional. Source 5–30s.
  // Individual shots must be 15s or less; that cut is not readable from the file.
  // $0.30/s at 768P, $0.45/s at 1080P. The page publishes no file-size cap.
  editOnlyModel(
    'h3-max-recast',
    'MiniMax H3 Max Recast',
    'MiniMax',
    'Replace the people in a clip. One photo per person, up to 4. No shot in the source may be longer than 15 seconds. $0.30 per second at 768P, $0.45 at 1080P.',
    'minimax/h3-max/recast',
    {
      sizes: [],
      rate: { per: 'second', usdByResolution: { '768P': 0.3, '1080P': 0.45 } },
      maxImages: 4,
      minSeconds: 5,
      maxSeconds: 30,
      requireMeasurement: true,
      references: { prompt: 'optional', persons: { min: 1, max: 4 } },
      note: 'A shot longer than 15 seconds is refused by the model. The file length is what can be checked here.',
    },
    [
      selectField('resolution', 'Resolution', '1080P', ['768P', '1080P']),
      booleanField('enhance_realism', 'Enhance realism', false),
    ]
  ),
  // https://fal.ai/models/minimax/h3-max/relight/llms.txt
  // Exactly one lighting-sphere image. No prompt field. Source up to 15s,
  // and the prepared clip keeps at least about 2.33s. $0.05 / $0.08 / $0.16 / $0.32
  // per second at 480P / 768P / 1080P / 2K. No published file-size cap.
  editOnlyModel(
    'h3-max-relight',
    'MiniMax H3 Max Relight',
    'MiniMax',
    'Relight a clip from one sphere image. The model does not take a prompt. $0.05 / $0.08 / $0.16 / $0.32 per second at 480P / 768P / 1080P / 2K.',
    'minimax/h3-max/relight',
    {
      sizes: [],
      rate: { per: 'second', usdByResolution: { '480P': 0.05, '768P': 0.08, '1080P': 0.16, '2K': 0.32 } },
      maxImages: 1,
      minSeconds: 2.33,
      maxSeconds: 15,
      requireMeasurement: true,
      references: { prompt: 'absent', litSphere: true },
    },
    [
      selectField('resolution', 'Resolution', '768P', ['480P', '768P', '1080P', '2K']),
      selectField('aspect_ratio', 'Aspect ratio', '16:9', ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
    ]
  ),
]);

/**
 * Display name for a model, by id. Jobs outlive the picker — the list keeps
 * showing a run while the user moves on to another model — so a card names its
 * own model rather than the selected one. A retired id falls back to itself.
 */
export function falModelLabel(modelId: string): string {
  return (
    [...FAL_IMAGE_MODELS, ...FAL_VIDEO_MODELS].find((model) => model.id === modelId)?.label ?? modelId
  );
}

function assertFalMediaType(mediaType: unknown): asserts mediaType is FalMediaType {
  if (mediaType !== 'image' && mediaType !== 'video') {
    throw new Error('Invalid fal media type.');
  }
}

function compatibleFalModels(
  mediaType: FalMediaType,
  inputMode: FalInputMode
): FalModelDefinition[] {
  const models = mediaType === 'image' ? FAL_IMAGE_MODELS : FAL_VIDEO_MODELS;
  return models.filter((model) => model.variants.some((variant) => variant.inputMode === inputMode));
}

export function modelsForFalMode(
  mediaType: FalMediaType,
  inputMode: FalInputMode
): FalModelDefinition[] {
  assertFalMediaType(mediaType);
  return compatibleFalModels(mediaType, inputMode);
}

export function resolveFalVariant(
  modelId: string,
  mediaType: FalMediaType,
  inputMode: FalInputMode
): FalModelVariant {
  assertFalMediaType(mediaType);
  const model = compatibleFalModels(mediaType, inputMode).find(
    (candidate) => candidate.id === modelId
  );
  const variant = model?.variants.find((candidate) => candidate.inputMode === inputMode);

  if (!variant) {
    throw new Error(`The selected fal model does not support ${inputMode}-to-${mediaType}.`);
  }

  return variant;
}

export function defaultFalValues(variant: FalModelVariant): Record<string, FalValue> {
  return Object.fromEntries(
    variant.fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as FalValue])
  );
}

export function validateFalInput(
  variant: FalModelVariant,
  args: { prompt: string; uploadUrls: string[]; references?: EditReferenceInput }
): string | null {
  const prompt = args.prompt.trim();
  const promptMode = variant.inputMode === 'edit' ? editPromptMode(variant.edit?.references) : 'required';
  if (promptMode === 'required' && !prompt) return 'Enter a prompt for the selected fal model.';
  if (variant.maxPromptLength !== undefined && prompt.length > variant.maxPromptLength) {
    return `This fal model accepts a prompt of at most ${variant.maxPromptLength} characters.`;
  }
  if (variant.edit?.maxPromptLength && prompt.length > variant.edit.maxPromptLength) {
    return `This model's prompt is at most ${variant.edit.maxPromptLength} characters.`;
  }
  if (variant.inputMode === 'text') return null;
  if (variant.inputMode === 'edit') {
    if (args.uploadUrls.length < 1 && !args.references?.video) return 'Choose a source video to edit.';
    const spec = variant.edit?.references;
    if (spec) {
      const images = args.uploadUrls.slice(0, Math.max(0, args.uploadUrls.length - 1));
      const references = args.references ?? materializeEditReferences(spec, images);
      return editReferenceError(spec, references);
    }
    const images = args.uploadUrls.length - 1;
    const maxImages = variant.maxInputImages ?? 0;
    if (images > maxImages) return maxImages === 0
      ? 'This model does not take reference images.'
      : `This fal model accepts up to ${maxImages} reference image${maxImages === 1 ? '' : 's'}.`;
    return null;
  }
  if (variant.inputMode === 'frames') {
    return args.uploadUrls.length === 2
      ? null
      : 'Add both a first frame and a last frame for the selected fal model.';
  }
  if (args.uploadUrls.length === 0) {
    return 'Add at least one reference image for the selected fal model.';
  }

  const maxInputImages = variant.maxInputImages ?? 1;
  if (args.uploadUrls.length > maxInputImages) {
    return `This fal model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`;
  }

  return null;
}

function normalizeFalFieldValue(
  field: FalFieldDefinition,
  value: FalValue
): FalValue | undefined {
  let normalized: FalValue = value;

  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Invalid fal setting "${field.key}".`);
  } else if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid fal setting "${field.key}".`);
    }
    if (field.min !== undefined && value < field.min) {
      throw new Error(`Invalid fal setting "${field.key}".`);
    }
    if (field.max !== undefined && value > field.max) {
      throw new Error(`Invalid fal setting "${field.key}".`);
    }
    if (field.step !== undefined) {
      const offset = value - (field.min ?? 0);
      const steps = offset / field.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        throw new Error(`Invalid fal setting "${field.key}".`);
      }
    }
  } else if (field.type === 'select') {
    if (!field.options?.some((option) => option.value === value)) {
      throw new Error(`Invalid fal setting "${field.key}".`);
    }
  } else {
    if (typeof value !== 'string') throw new Error(`Invalid fal setting "${field.key}".`);
    normalized = value.trim();
    if (!normalized) return undefined;
  }

  if (normalized === '') return undefined;

  return normalized;
}

export function buildFalInput(
  variant: FalModelVariant,
  args: { prompt: string; uploadUrls: string[]; values: Record<string, FalValue>; references?: EditReferenceInput }
): Record<string, unknown> {
  const prompt = args.prompt.trim();
  const promptMode = variant.inputMode === 'edit' ? editPromptMode(variant.edit?.references) : 'required';
  const input: Record<string, unknown> = {};
  if (promptMode !== 'absent' && prompt) input.prompt = prompt;
  if (variant.inputMode === 'edit') {
    const spec = variant.edit?.references;
    const video = args.references?.video ?? args.uploadUrls[args.uploadUrls.length - 1];
    if (spec) {
      const images = args.uploadUrls.slice(0, Math.max(0, args.uploadUrls.length - 1));
      const references = args.references ?? materializeEditReferences(spec, images);
      Object.assign(input, editReferenceFields(spec, { ...references, video }));
    } else {
      input.video_url = video;
      const images = args.uploadUrls.slice(0, -1);
      if (images.length > 0 && variant.imageInputKey) input[variant.imageInputKey] = images;
    }
  } else if (variant.inputMode === 'frames' && variant.frameInputKeys) {
    input[variant.frameInputKeys.first] = args.uploadUrls[0];
    input[variant.frameInputKeys.last] = args.uploadUrls[1];
  } else if (variant.inputMode === 'image' && variant.imageInputKey) {
    input[variant.imageInputKey] = variant.imageInputMultiple ? args.uploadUrls : args.uploadUrls[0];
  }
  for (const field of variant.fields) {
    const suppliedValue = args.values[field.key];
    const value = suppliedValue === undefined ? field.defaultValue : suppliedValue;
    if (value === undefined) continue;
    const normalized = normalizeFalFieldValue(field, value);
    if (normalized !== undefined) input[field.key] = normalized;
  }
  const hasReferences = args.uploadUrls.length > 0;
  return applyProviderModeration(input, {
    provider: 'fal',
    modelId: variant.id,
    endpointId: variant.endpointId,
    level: effectiveModerationLevel({ level: args.values.moderation, prompt: args.prompt, hasReferences }),
    hasReferences,
  });
}

export function extractFalResult(mediaType: FalMediaType, payload: unknown) {
  const record =
    payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const media =
    mediaType === 'image'
      ? Array.isArray(record.images)
        ? record.images[0]
        : undefined
      : record.video;
  const file = media !== null && typeof media === 'object' ? (media as Record<string, unknown>) : {};
  const url = typeof file.url === 'string' ? file.url.trim() : '';
  if (!url) {
    throw new Error('fal completed without a usable media URL.');
  }
  return {
    url,
    mimeType: typeof file.content_type === 'string' ? file.content_type : undefined,
  };
}
