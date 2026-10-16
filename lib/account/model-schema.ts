// lib/account/model-schema.ts
/**
 * One description of every model the account Worker can run in the background,
 * in the vocabulary an agent reads: which input modes, how many references, and
 * which `values` keys with which options (docs/claude/specs/2026-09-28-agent-mcp-design.md).
 *
 * Derived from the catalogs the Worker's validators already read, never written
 * by hand, so a model added to a catalog is described without editing this file.
 * The validators stay the authority; this module exists so a refusal can name
 * the field that is wrong. `cloud/tests/model-schema.test.ts` sends every
 * advertised model, mode and option through `validateRequest`.
 */
import type { CloudJobRequest, CloudProvider } from './contracts';
import { SINGLE_IMAGE_MODELS, SINGLE_IMAGE_MODEL_LABELS } from './models';
import { FAL_IMAGE_MODELS, FAL_VIDEO_MODELS } from '../fal/catalog';
import { KIE_MODELS } from '../kie/catalog';
import { findModel, PROVIDER_MODELS, resolveVideoInput } from '../providers/catalog';
import { isSeedanceDraftSize } from '../providers/seedance-draft';
import type { ProviderId, ProviderModel } from '../providers/types';
import { GEMINI_IMAGE_MODELS } from '../engines/gemini-catalog';
import { ENGINES } from '../engines/registry';

export type AgentProvider = Exclude<CloudProvider, 'local-test'>;
export type InputMode = CloudJobRequest['inputMode'];
export type FieldValue = string | number | boolean;

export interface ModelField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'boolean' | 'text';
  description?: string;
  options?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  default?: FieldValue;
  required?: boolean;
}
export interface ModeDescriptor {
  mode: InputMode;
  fields: ModelField[];
  references: { min: number; max: number };
  sourceVideo: boolean;
  /** Reference video and audio. Absent means this mode refuses both. */
  clips?: { video?: { max: number }; audio?: { max: number }; audioRequiresVisual: boolean };
}
export interface ModelDescriptor {
  provider: AgentProvider; modelId: string; label: string; mediaType: 'image' | 'video';
  price?: string; note?: string; deprecated?: boolean; modes: ModeDescriptor[];
}

/** The ratios both background validators accept (aggregators.ts, synchronous.ts). */
export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
/** Background image caps per aggregator, as `validateAggregatorRequest` applies them. */
const AGGREGATOR_IMAGE_CAP: Record<ProviderId, number> = { piapi: 14, atlas: 16, runware: 4, comet: 1 };
const NO_REFERENCES = { min: 0, max: 0 };

export function providerLabel(provider: AgentProvider): string {
  return ENGINES.find(engine => engine.id === provider)?.label ?? provider;
}

function select(key: string, label: string, values: readonly (string | number)[], extra: Partial<ModelField> = {}): ModelField {
  return { key, label, type: 'select', options: values.map(value => ({ value, label: String(value) })), ...extra };
}

/** Optional. No default: a stand-in length would be written into a real request and then fail the measured-length check. */
function sourceDurationField(min: number | undefined, max: number, draft: boolean): ModelField {
  return {
    key: 'sourceDurationSeconds', label: 'Source length (seconds)', type: 'number',
    min: min ?? 1, max,
    description: draft
      ? 'Optional check. The clip length is read from the file before a draft is priced. If you pass this, it must be within a second of that length. It is not sent to Runware.'
      : 'Optional check. The clip length is read from the file before this edit is priced. If you pass this, it must be within a second of that length.',
  };
}

/** fal and Kie already describe their controls; only the spelling of the default differs. */
function fromDefinition(field: {
  key: string; label: string; type: string; description?: string; defaultValue?: FieldValue;
  options?: { label: string; value: string | number }[]; min?: number; max?: number; step?: number; required?: boolean;
}): ModelField {
  return {
    key: field.key, label: field.label, type: field.type as ModelField['type'],
    ...(field.description ? { description: field.description } : {}),
    ...(field.options ? { options: field.options.map(option => ({ value: option.value, label: option.label })) } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.step !== undefined ? { step: field.step } : {}),
    ...(field.defaultValue !== undefined ? { default: field.defaultValue } : {}),
    ...(field.required ? { required: true } : {}),
  };
}

function falModels(): ModelDescriptor[] {
  return [...FAL_IMAGE_MODELS, ...FAL_VIDEO_MODELS].map(model => ({
    provider: 'fal', modelId: model.id, label: model.label, mediaType: model.mediaType, note: model.description,
    ...(model.deprecated ? { deprecated: true } : {}),
    modes: model.variants.map(variant => {
      const edit = variant.inputMode === 'edit' ? variant.edit : undefined;
      return {
        mode: variant.inputMode,
        fields: [
          ...variant.fields.map(fromDefinition),
          ...(edit?.rate.per === 'second' ? [sourceDurationField(edit.minSeconds, edit.maxSeconds, false)] : []),
        ],
        references: variant.inputMode === 'text' ? NO_REFERENCES
          : variant.inputMode === 'frames' ? { min: 2, max: 2 }
            : variant.inputMode === 'edit' ? { min: 0, max: variant.maxInputImages ?? 0 }
              : { min: 1, max: variant.maxInputImages ?? 1 },
        sourceVideo: variant.inputMode === 'edit',
      };
    }),
  }));
}

function kieModels(): ModelDescriptor[] {
  return KIE_MODELS.map(model => ({
    provider: 'kie', modelId: model.id, label: model.label, mediaType: model.mediaType, note: model.description,
    modes: model.variants.map(variant => ({
      mode: variant.inputMode,
      // A `file` field is filled from references, never from `values`.
      fields: variant.fields.filter(field => field.type !== 'file').map(fromDefinition),
      references: variant.inputMode === 'text' ? NO_REFERENCES : { min: 1, max: variant.maxInputImages ?? 1 },
      sourceVideo: false,
    })),
  }));
}

function aspectRatioField(_provider: ProviderId, model: ProviderModel): ModelField {
  const allowed = model.aspectRatios?.length ? ASPECT_RATIOS.filter(ratio => model.aspectRatios!.includes(ratio)) : ASPECT_RATIOS;
  return select('aspectRatio', 'Aspect ratio', allowed);
}

/** `720p · 16:9` already names the ratio. A second control can disagree with it. */
function sizeNamesAspect(model: ProviderModel): boolean {
  return Boolean(model.sizes?.some(size => size.label.includes('·')));
}

function aggregatorImageFields(provider: ProviderId, model: ProviderModel): ModelField[] {
  const fields = [aspectRatioField(provider, model)];
  if (provider === 'piapi') fields.push(select('resolution', 'Resolution', ['1K', '2K', '4K'], { default: '1K' }));
  else if (provider === 'atlas' && model.sizes?.length) fields.push(select('resolution', 'Resolution', model.sizes.map(size => size.label), { default: model.sizes[0].label }));
  return fields;
}

function aggregatorVideoFields(provider: ProviderId, model: ProviderModel): ModelField[] {
  const fields: ModelField[] = [];
  if (!(model.aspectRatios?.length && sizeNamesAspect(model))) fields.push(aspectRatioField(provider, model));
  if (model.sizes?.length) fields.push(select('size', 'Output size', model.sizes.map(size => size.label), { default: model.sizes[0].label }));
  const duration = model.duration;
  if (duration?.type === 'options' && duration.values.length) fields.push(select('durationSeconds', 'Duration (seconds)', duration.values, { default: duration.values[0] }));
  else if (duration?.type === 'range') fields.push({ key: 'durationSeconds', label: 'Duration (seconds)', type: 'number', min: duration.min, max: duration.max, step: 1, default: duration.default });
  else if (model.durations?.length) fields.push(select('durationSeconds', 'Duration (seconds)', model.durations, { default: model.durations[0] }));
  if (model.supportsAudio) fields.push({ key: 'audio', label: 'Audio', type: 'boolean' });
  // Off by default so a normal request is not a 480p preview. checkValues
  // forces a 480p size when an agent turns it on, which is what lets the
  // one-option schema test pass against a 720p or 1080p catalog default.
  if (model.draftPreview) fields.push({
    key: 'draft', label: 'Draft', type: 'boolean', default: false,
    description: '480p preview only. Off by default. Turn it on, then call finalize_draft to render that preview at 1080p. That is a separate charge.',
  });
  return fields;
}

function aggregatorReferences(provider: ProviderId, model: ProviderModel, mode: InputMode): { min: number; max: number } | null {
  if (mode === 'text') return NO_REFERENCES;
  if (model.kind === 'image') return { min: 1, max: Math.min(model.maxInputImages ?? 1, AGGREGATOR_IMAGE_CAP[provider]) };
  const capability = resolveVideoInput(provider, model.id, mode);
  if (!capability) return null;
  // Comet's video route takes a single input_reference.
  const max = provider === 'comet' ? Math.min(capability.maxImages, 1) : capability.maxImages;
  if (mode === 'frames') return max >= 2 ? { min: 2, max: 2 } : null;
  return max >= 1 ? { min: 1, max } : null;
}

function clipDescriptor(model: ProviderModel, mode: InputMode): ModeDescriptor['clips'] {
  const clips = model.referenceClips;
  if (!clips?.modes.includes(mode)) return undefined;
  return {
    ...(clips.video ? { video: { max: clips.video.max } } : {}),
    ...(clips.audio ? { audio: { max: clips.audio.max } } : {}),
    audioRequiresVisual: clips.audioRequiresVisual,
  };
}

function aggregatorModes(provider: ProviderId, model: ProviderModel): ModeDescriptor[] {
  const modes: ModeDescriptor[] = [];
  for (const mode of model.modes) {
    if (mode === 'edit') {
      const edit = model.videoEdit;
      if (!edit) continue;
      modes.push({
        mode, sourceVideo: true, references: { min: 0, max: edit.maxImages },
        // editSettingsError accepts these keys; duration and ratio follow the source.
        fields: [
          ...(edit.aspectRatios?.length ? [select('aspectRatio', 'Target aspect ratio', edit.aspectRatios, {
            description: 'Letterboxes the source to this shape. Omit it to keep the source frame.',
          })] : []),
          ...(edit.sizes.length ? [select('size', 'Resolution', edit.sizes.map(size => size.label), {
            // The catalog's first size (720p for Seedance). checkValues moves
            // it to 480p when draft is on, so the schema test can turn that
            // one field on without the default size failing validation.
            default: edit.sizes[0].label, required: true,
          })] : []),
          ...(edit.draftRate || edit.draftPreview ? [{
            key: 'draft', label: 'Draft', type: 'boolean' as const, default: false,
            ...(edit.draftPreview ? { description: '480p preview only. Off by default. Turn it on, then call finalize_draft to render that preview at 1080p. That is a separate charge.' } : {}),
          }] : []),
          ...(edit.draftPreview || edit.rate.per === 'second' ? [sourceDurationField(edit.minSeconds, edit.maxSeconds, Boolean(edit.draftPreview))] : []),
        ],
      });
      continue;
    }
    const references = aggregatorReferences(provider, model, mode);
    if (!references) continue;
    const clips = clipDescriptor(model, mode);
    modes.push({
      mode, sourceVideo: false, references,
      fields: model.kind === 'image' ? aggregatorImageFields(provider, model) : aggregatorVideoFields(provider, model),
      ...(clips ? { clips } : {}),
    });
  }
  return modes;
}

function aggregatorModels(provider: ProviderId): ModelDescriptor[] {
  return PROVIDER_MODELS[provider].map(model => ({
    provider, modelId: model.id, label: model.label, mediaType: model.kind,
    ...(model.price ? { price: model.price } : {}), ...(model.note ? { note: model.note } : {}),
    ...(model.deprecated ? { deprecated: true } : {}),
    modes: aggregatorModes(provider, model),
  }));
}

function geminiModels(): ModelDescriptor[] {
  return GEMINI_IMAGE_MODELS.map(model => {
    const fields: ModelField[] = [
      select('aspectRatio', 'Aspect ratio', ASPECT_RATIOS),
      select('imageSize', 'Image size', model.sizes, { default: model.sizes[0] }),
      // Lite refuses the grounding tool, so it is not offered at all rather than offered as false.
      ...(model.supportsGoogleSearch ? [{ key: 'useGoogleSearch', label: 'Ground with Google Search', type: 'boolean' as const, default: false }] : []),
    ];
    return {
      provider: 'gemini', modelId: model.id, label: model.label, mediaType: 'image', note: model.note,
      ...(model.deprecated ? { deprecated: true } : {}),
      modes: [
        { mode: 'text', fields, references: NO_REFERENCES, sourceVideo: false },
        { mode: 'image', fields, references: { min: 1, max: model.maxInputImages }, sourceVideo: false },
      ],
    };
  });
}

function singleImageModel(provider: 'cloudflare' | 'pollinations'): ModelDescriptor[] {
  return [{
    provider, modelId: SINGLE_IMAGE_MODELS[provider], label: SINGLE_IMAGE_MODEL_LABELS[provider], mediaType: 'image',
    modes: [{ mode: 'text', fields: provider === 'pollinations' ? [select('aspectRatio', 'Aspect ratio', ASPECT_RATIOS)] : [], references: NO_REFERENCES, sourceVideo: false }],
  }];
}

const BUILDERS: Record<AgentProvider, () => ModelDescriptor[]> = {
  fal: falModels, kie: kieModels, gemini: geminiModels,
  runware: () => aggregatorModels('runware'), atlas: () => aggregatorModels('atlas'),
  comet: () => aggregatorModels('comet'), piapi: () => aggregatorModels('piapi'),
  cloudflare: () => singleImageModel('cloudflare'), pollinations: () => singleImageModel('pollinations'),
};

export function describeModels(providers: readonly AgentProvider[]): ModelDescriptor[] {
  return providers.flatMap(provider => BUILDERS[provider]()).filter(model => model.modes.length > 0);
}

export function findModelDescriptor(provider: AgentProvider, modelId: string, mediaType: 'image' | 'video'): ModelDescriptor | undefined {
  return describeModels([provider]).find(model => model.modelId === modelId && model.mediaType === mediaType);
}

export type ValuesCheck =
  | { ok: true; values: Record<string, FieldValue> }
  | { ok: false; field: string; message: string; allowed?: FieldValue[] | string[] | { min?: number; max?: number } };

function fieldProblem(field: ModelField, value: FieldValue): Omit<Extract<ValuesCheck, { ok: false }>, 'ok' | 'field'> | null {
  if (field.type === 'select') {
    const allowed = field.options?.map(option => option.value) ?? [];
    return allowed.some(option => option === value) ? null : { message: `"${field.key}" must be one of ${allowed.map(option => JSON.stringify(option)).join(', ')}.`, allowed };
  }
  if (field.type === 'boolean') return typeof value === 'boolean' ? null : { message: `"${field.key}" must be true or false.` };
  if (field.type === 'text') return typeof value === 'string' && value.length <= 2048 ? null : { message: `"${field.key}" must be text of at most 2048 characters.` };
  const bounds = { ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}) };
  if (typeof value !== 'number' || !Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
    return { message: `"${field.key}" must be a number${field.min !== undefined ? ` from ${field.min}` : ''}${field.max !== undefined ? ` to ${field.max}` : ''}.`, allowed: bounds };
  }
  if (field.step !== undefined && field.step > 0) {
    const steps = (value - (field.min ?? 0)) / field.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return { message: `"${field.key}" moves in steps of ${field.step}.`, allowed: bounds };
  }
  return null;
}

/** Checks values against a mode and returns them with every default written in. */
export function checkValues(mode: ModeDescriptor, values: Record<string, FieldValue> = {}): ValuesCheck {
  const keys = mode.fields.map(field => field.key);
  const stray = Object.keys(values).find(key => !keys.includes(key));
  if (stray) return { ok: false, field: stray, message: `"${stray}" is not a setting of this model in ${mode.mode} mode.`, allowed: keys };
  const out: Record<string, FieldValue> = {};
  for (const field of mode.fields) {
    const value = values[field.key] ?? field.default;
    if (value === undefined) {
      if (field.required) return { ok: false, field: field.key, message: `"${field.key}" is required.`, ...(field.options ? { allowed: field.options.map(option => option.value) } : {}) };
      continue;
    }
    const problem = fieldProblem(field, value);
    if (problem) return { ok: false, field: field.key, ...problem };
    out[field.key] = value;
  }
  const draftSize = constrainDraftSize(mode, values, out);
  if (draftSize) return draftSize;
  return { ok: true, values: out };
}

/**
 * A Seedance draft is 480p only. When the caller turned draft on and left
 * size at the catalog default, rewrite that default. An explicit other size
 * is a refusal, so a 720p default can stay in the descriptor.
 */
function constrainDraftSize(mode: ModeDescriptor, input: Record<string, FieldValue>, out: Record<string, FieldValue>): ValuesCheck | null {
  if (out.draft !== true) return null;
  const sizeField = mode.fields.find(field => field.key === 'size' && field.type === 'select');
  const draftOptions = sizeField?.options?.filter(option => typeof option.value === 'string' && isSeedanceDraftSize(option.value)) ?? [];
  if (!draftOptions.length) return null;
  const explicit = input.size;
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || !isSeedanceDraftSize(explicit)) {
      return {
        ok: false, field: 'size',
        message: 'A Seedance draft is 480p only. Pick a 480p size, or turn Draft off.',
        allowed: draftOptions.map(option => option.value),
      };
    }
    return null;
  }
  if (typeof out.size === 'string' && isSeedanceDraftSize(out.size)) return null;
  out.size = draftOptions[0].value;
  return null;
}

export function checkReferences(mode: ModeDescriptor, count: number, hasSourceVideo: boolean, clips: { videos?: number; audios?: number } = {}): string | null {
  if (mode.sourceVideo && !hasSourceVideo) return 'This mode edits a video: pass sourceVideo.';
  if (!mode.sourceVideo && hasSourceVideo) return 'sourceVideo is only accepted in edit mode.';
  const videos = clips.videos ?? 0;
  const audios = clips.audios ?? 0;
  if ((videos > 0 || audios > 0) && !mode.clips) return 'This mode does not take reference video or audio.';
  if (videos > 0 && !mode.clips?.video) return 'This mode does not take reference video.';
  if (audios > 0 && !mode.clips?.audio) return 'This mode does not take reference audio.';
  if (mode.clips?.video && videos > mode.clips.video.max) return `Add up to ${mode.clips.video.max} reference videos.`;
  if (mode.clips?.audio && audios > mode.clips.audio.max) return `Add up to ${mode.clips.audio.max} reference audio clips.`;
  if (audios > 0 && mode.clips?.audioRequiresVisual && count === 0 && videos === 0) return 'Add a reference image or reference video. This model cannot use audio on its own.';
  const { min, max } = mode.references;
  const clipsStandIn = videos > 0 || (audios > 0 && Boolean(mode.clips && !mode.clips.audioRequiresVisual));
  if (count >= min && count <= max) return null;
  if (clipsStandIn && count >= 0 && count <= max) return null;
  if (min === max) return min === 0 ? 'This mode takes no reference images.' : `This mode takes exactly ${min} reference image${min === 1 ? '' : 's'}.`;
  return `This mode takes ${min} to ${max} reference images.`;
}

/** A request this mode accepts, with placeholder reference ids: used to price
 *  and to test descriptors, never submitted. */
function standInEditSeconds(model: ModelDescriptor, mode: ModeDescriptor): number | undefined {
  if (mode.mode !== 'edit' || model.provider === 'runware') return undefined;
  if (model.provider === 'fal') {
    const edit = FAL_VIDEO_MODELS.find(entry => entry.id === model.modelId)?.variants.find(variant => variant.inputMode === 'edit')?.edit;
    if (edit?.rate.per !== 'second') return undefined;
    return edit.minSeconds ?? 1;
  }
  if (model.provider !== 'atlas' && model.provider !== 'comet' && model.provider !== 'piapi') return undefined;
  const edit = findModel(model.provider, model.modelId)?.videoEdit;
  if (!edit || edit.rate.per !== 'second' || edit.rate.usd === undefined) return undefined;
  return edit.minSeconds ?? 1;
}

export function sampleRequest(model: ModelDescriptor, mode: ModeDescriptor, values: Record<string, FieldValue> = {}): CloudJobRequest {
  const check = checkValues(mode, values);
  if (!check.ok) throw new Error(check.message);
  // After checkValues, and only on this sample. A default on the field would
  // be copied into a real agent request and then fail the measured-length check.
  const seconds = standInEditSeconds(model, mode);
  const priced = seconds !== undefined && check.values.sourceDurationSeconds === undefined
    ? { ...check.values, sourceDurationSeconds: seconds }
    : check.values;
  return {
    provider: model.provider, modelId: model.modelId, mediaType: model.mediaType, inputMode: mode.mode,
    prompt: 'A lighthouse on a cliff at dusk', values: priced,
    referenceIds: Array.from({ length: mode.references.min }, (_, index) => `sample-reference-${index}`),
    ...(mode.sourceVideo ? { sourceVideoId: 'sample-source-video' } : {}),
  };
}
