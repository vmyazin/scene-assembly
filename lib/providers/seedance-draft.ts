// lib/providers/seedance-draft.ts
/**
 * Seedance 2.5 draft, then finalize.
 *
 * Read 2026-10-12 from https://runware.ai/docs/models/bytedance-seedance-2-5
 * `settings.draft: true` is a 480p preview and returns `outputs.draftId`.
 * Finalize sends `inputs.draftId` and `resolution: "1080p"` only. Prompt,
 * duration, audio, operation, and media cannot be sent again. Draft is allowed
 * with edit: nothing on the page forbids `settings.draft` together with
 * `settings.operation: "edit"`, and finalize does not resend the operation.
 *
 * Runware publishes per-second rates by resolution and does not publish a
 * separate finalize price. Estimates use the documented 1080p rate for the
 * same kind of run and are labeled estimated. A cost on the task still wins.
 */
import type { CloudJobRequest } from '../account/contracts';
import { findModel } from './catalog';
import type { ProviderModel } from './types';
import { resolveCatalogRate, type SpendFigure } from '../spend/resolve';

export const SEEDANCE_25_MODEL = 'bytedance:seedance@2.5';
export const SEEDANCE_DRAFT_RESOLUTION = '480p';
export const SEEDANCE_FINALIZE_RESOLUTION = '1080p';

/** Width×height pairs allowed when `settings.draft` is true. */
export const SEEDANCE_DRAFT_DIMENSIONS = new Set([
  '854x480', '752x560', '640x640', '560x752', '480x854', '992x432',
]);

export const SEEDANCE_FINALIZE_PRICE_NOTE =
  'Runware does not publish a separate finalize price. This estimate uses the documented 1080p rate for the same kind of run.';

export const SEEDANCE_DRAFT_EXPIRED =
  'This Seedance draft can no longer be finalized. The draft ID is invalid or has expired. Generate a new 480p draft and finalize that one.';

export function isSeedance25(modelId: string | undefined): boolean {
  return modelId === SEEDANCE_25_MODEL;
}

/** `480p` and `480p · 16:9` are the draft tier. `480px` is not. */
export function isSeedanceDraftSize(label: string | undefined): boolean {
  return label === '480p' || (typeof label === 'string' && label.startsWith('480p '));
}

export function seedanceDraftSizeLabel(sizes: Array<{ label: string }> | undefined, current?: string): string | undefined {
  if (current && isSeedanceDraftSize(current)) return current;
  return sizes?.find((size) => isSeedanceDraftSize(size.label))?.label;
}

/** The size label whose tier prices a finalize. Aspect does not change the per-second rate. */
export function seedanceFinalizeSizeLabel(inputMode: string): string {
  return inputMode === 'edit' ? '1080p' : '1080p · 16:9';
}

export function seedanceDraftDimensionError(width?: number, height?: number, resolution?: string): string | undefined {
  if (resolution !== undefined && resolution !== SEEDANCE_DRAFT_RESOLUTION) {
    return 'A Seedance draft is 480p only. Pick a 480p size, or turn Draft off.';
  }
  if (width !== undefined || height !== undefined) {
    if (!width || !height || !SEEDANCE_DRAFT_DIMENSIONS.has(`${width}x${height}`)) {
      return 'A Seedance draft is 480p only. Pick a 480p size, or turn Draft off.';
    }
  }
  if (resolution === undefined && (width === undefined || height === undefined)) {
    return 'A Seedance draft is 480p only. Pick a 480p size, or turn Draft off.';
  }
  return undefined;
}

export function isSeedanceFinalizeValues(values: Record<string, unknown> | undefined): boolean {
  return values?.finalize === true;
}

/** Cloud and browser jobs that finalize. Prompt may be stored for the library and must not be sent. */
export function seedanceFinalizeValuesError(values: Record<string, unknown>): string | undefined {
  if (values.finalize !== true) return 'Finalize must be requested explicitly.';
  if (typeof values.draftId !== 'string' || !values.draftId.trim() || values.draftId.length > 256) return 'A draft ID is required to finalize.';
  const duration = values.durationSeconds;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 4 || duration > 30) {
    return 'Finalize needs the draft length, from 4 to 30 seconds, so the price can be checked before it runs.';
  }
  const stray = Object.keys(values).find((key) => key !== 'finalize' && key !== 'draftId' && key !== 'durationSeconds');
  if (stray) return `Finalizing a draft cannot include "${stray}". Prompt and media stay on the draft.`;
  return undefined;
}

export function seedanceDraftSeconds(values: Record<string, string | number | boolean> | undefined): number | undefined {
  if (!values) return undefined;
  const raw = values.durationSeconds ?? values.sourceDurationSeconds ?? values.duration;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * A vendor error about the draft id, or undefined when the message is about
 * something else. The page does not publish the error code, so this matches
 * the parameter and the words vendors use for a dead id.
 */
export function seedanceDraftFailure(error?: { message?: string; parameter?: string; code?: string }): string | undefined {
  const parameter = error?.parameter ?? '';
  const message = `${error?.code ?? ''} ${error?.message ?? ''}`;
  const aboutDraft = /draftId/i.test(parameter) || /draft/i.test(message);
  const rejected = /invalid|expire|not found|unknown|does not exist|unrecognized|missing/i.test(message) || /draftId/i.test(parameter);
  if (aboutDraft && rejected) return SEEDANCE_DRAFT_EXPIRED;
  return undefined;
}

/** Documented 480p (draft) or 1080p (finalize) rate. Null when this request is neither. */
export function seedanceCatalogFigure(request: Pick<CloudJobRequest, 'modelId' | 'inputMode' | 'values'>, model?: ProviderModel): SpendFigure | null {
  if (!isSeedance25(request.modelId)) return null;
  const finalize = isSeedanceFinalizeValues(request.values);
  const draft = request.values.draft === true;
  if (!finalize && !draft) return null;
  const duration = seedanceDraftSeconds(request.values);
  const size = finalize
    ? seedanceFinalizeSizeLabel(request.inputMode)
    : request.inputMode === 'edit'
      ? '480p'
      : seedanceDraftSizeLabel(model?.sizes, typeof request.values.size === 'string' ? request.values.size : undefined) ?? '480p · 16:9';
  const figure = resolveCatalogRate(model ?? findModel('runware', request.modelId), duration, 1, { inputMode: request.inputMode, size });
  if (!finalize) return figure.costUsd === null ? figure : { ...figure, note: 'Seedance draft uses the documented 480p rate.' };
  if (figure.costUsd === null) return { ...figure, note: SEEDANCE_FINALIZE_PRICE_NOTE };
  return { ...figure, confidence: 'estimated', note: SEEDANCE_FINALIZE_PRICE_NOTE };
}
