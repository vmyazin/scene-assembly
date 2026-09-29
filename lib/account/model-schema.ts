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
import { FAL_IMAGE_MODEL, FAL_VIDEO_MODELS } from '../fal/catalog';
import { KIE_MODELS } from '../kie/catalog';
import { PROVIDER_MODELS, resolveVideoInput } from '../providers/catalog';
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
export interface ModeDescriptor { mode: InputMode; fields: ModelField[]; references: { min: number; max: number }; sourceVideo: boolean }
export interface ModelDescriptor {
  provider: AgentProvider; modelId: string; label: string; mediaType: 'image' | 'video';
  price?: string; note?: string; modes: ModeDescriptor[];
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
  return [FAL_IMAGE_MODEL, ...FAL_VIDEO_MODELS].map(model => ({
    provider: 'fal', modelId: model.id, label: model.label, mediaType: model.mediaType, note: model.description,
    modes: model.variants.map(variant => ({
      mode: variant.inputMode,
      fields: variant.fields.map(fromDefinition),
      references: variant.inputMode === 'text' ? NO_REFERENCES
        : variant.inputMode === 'frames' ? { min: 2, max: 2 }
          : { min: 1, max: variant.maxInputImages ?? 1 },
      sourceVideo: false,
    })),
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

function aspectRatioField(provider: ProviderId, model: ProviderModel): ModelField {
  const allowed = provider === 'piapi' && model.aspectRatios ? ASPECT_RATIOS.filter(ratio => model.aspectRatios!.includes(ratio)) : ASPECT_RATIOS;
  return select('aspectRatio', 'Aspect ratio', allowed);
}

function aggregatorImageFields(provider: ProviderId, model: ProviderModel): ModelField[] {
  const fields = [aspectRatioField(provider, model)];
  if (provider === 'piapi') fields.push(select('resolution', 'Resolution', ['1K', '2K', '4K'], { default: '1K' }));
  else if (provider === 'atlas' && model.sizes?.length) fields.push(select('resolution', 'Resolution', model.sizes.map(size => size.label), { default: model.sizes[0].label }));
  return fields;
}

function aggregatorVideoFields(provider: ProviderId, model: ProviderModel): ModelField[] {
  const fields = [aspectRatioField(provider, model)];
  if (model.sizes?.length) fields.push(select('size', 'Output size', model.sizes.map(size => size.label), { default: model.sizes[0].label }));
  const duration = model.duration;
  if (duration?.type === 'options' && duration.values.length) fields.push(select('durationSeconds', 'Duration (seconds)', duration.values, { default: duration.values[0] }));
  else if (duration?.type === 'range') fields.push({ key: 'durationSeconds', label: 'Duration (seconds)', type: 'number', min: duration.min, max: duration.max, step: 1, default: duration.default });
  else if (model.durations?.length) fields.push(select('durationSeconds', 'Duration (seconds)', model.durations, { default: model.durations[0] }));
  if (provider === 'piapi' && model.supportsAudio) fields.push({ key: 'audio', label: 'Audio', type: 'boolean' });
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

function aggregatorModes(provider: ProviderId, model: ProviderModel): ModeDescriptor[] {
  const modes: ModeDescriptor[] = [];
  for (const mode of model.modes) {
    if (mode === 'edit') {
      const edit = model.videoEdit;
      if (!edit) continue;
      modes.push({
        mode, sourceVideo: true, references: { min: 0, max: edit.maxImages },
        // editSettingsError accepts exactly these two keys; duration and ratio follow the source.
        fields: [
          ...(edit.sizes.length ? [select('size', 'Resolution', edit.sizes.map(size => size.label), { default: edit.sizes[0].label, required: true })] : []),
          ...(edit.draftRate ? [{ key: 'draft', label: 'Draft', type: 'boolean' as const, default: false }] : []),
        ],
      });
      continue;
    }
    const references = aggregatorReferences(provider, model, mode);
    if (!references) continue;
    modes.push({ mode, sourceVideo: false, references, fields: model.kind === 'image' ? aggregatorImageFields(provider, model) : aggregatorVideoFields(provider, model) });
  }
  return modes;
}

function aggregatorModels(provider: ProviderId): ModelDescriptor[] {
  return PROVIDER_MODELS[provider].map(model => ({
    provider, modelId: model.id, label: model.label, mediaType: model.kind,
    ...(model.price ? { price: model.price } : {}), ...(model.note ? { note: model.note } : {}),
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
  return { ok: true, values: out };
}

export function checkReferences(mode: ModeDescriptor, count: number, hasSourceVideo: boolean): string | null {
  if (mode.sourceVideo && !hasSourceVideo) return 'This mode edits a video: pass sourceVideo.';
  if (!mode.sourceVideo && hasSourceVideo) return 'sourceVideo is only accepted in edit mode.';
  const { min, max } = mode.references;
  if (count >= min && count <= max) return null;
  if (min === max) return min === 0 ? 'This mode takes no reference images.' : `This mode takes exactly ${min} reference image${min === 1 ? '' : 's'}.`;
  return `This mode takes ${min} to ${max} reference images.`;
}

/** A request this mode accepts, with placeholder reference ids: used to price
 *  and to test descriptors, never submitted. */
export function sampleRequest(model: ModelDescriptor, mode: ModeDescriptor, values: Record<string, FieldValue> = {}): CloudJobRequest {
  const check = checkValues(mode, values);
  if (!check.ok) throw new Error(check.message);
  return {
    provider: model.provider, modelId: model.modelId, mediaType: model.mediaType, inputMode: mode.mode,
    prompt: 'A lighthouse on a cliff at dusk', values: check.values,
    referenceIds: Array.from({ length: mode.references.min }, (_, index) => `sample-reference-${index}`),
    ...(mode.sourceVideo ? { sourceVideoId: 'sample-source-video' } : {}),
  };
}
