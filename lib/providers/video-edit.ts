// lib/providers/video-edit.ts
import type { ProviderModel } from './types';
/** Application bounds for the first editing release, not vendor storage quotas. */
export const MAX_EDIT_VIDEO_BYTES = 100_000_000;
export const EDIT_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export function isEditVideoMime(mime: string): boolean {
  return (EDIT_VIDEO_MIMES as readonly string[]).includes(mime);
}
export function validateEditVideo(file: Pick<File, 'size' | 'type'>): void {
  if (!isEditVideoMime(file.type) || file.size <= 0 || file.size > MAX_EDIT_VIDEO_BYTES) {
    throw new Error('Choose an MP4, MOV or WebM video up to 100 MB.');
  }
}
export const EDIT_PROMPTS = {
  'Replace character': 'Edit @Video1: replace the main person with the character in @Image1. Keep their movement, timing, camera framing, and background unchanged.',
  'Change scene': 'Edit @Video1: replace the background with a snowy forest. Keep the person, clothing, movement, timing, and camera framing unchanged.',
  Restyle: 'Edit @Video1: restyle the clip as a clay animation. Preserve the subjects, composition, movement, camera, and timing.',
};

/** Validate only model-owned settings; fixed-output models must not receive stale resolution. */
export function editSettingsError(capability: NonNullable<ProviderModel['videoEdit']>, values: Record<string, unknown>): string | undefined {
  const allowed = [
    ...(capability.sizes.length ? ['size'] : []),
    ...(capability.draftRate || capability.draftPreview ? ['draft'] : []),
    // Stored for the price of a later finalize. The adapter still sends duration auto.
    ...(capability.draftPreview ? ['sourceDurationSeconds'] : []),
  ];
  if (Object.keys(values).some(key => values[key] !== undefined && !allowed.includes(key))) return 'Unsupported edit setting. Duration and aspect ratio follow the source.';
  if (capability.sizes.length && !capability.sizes.some(size => size.label === values.size)) return 'Choose a supported edit resolution.';
  if (values.draft !== undefined && typeof values.draft !== 'boolean') return 'Draft must be on or off.';
  if (capability.draftPreview && values.draft === true && typeof values.size === 'string' && values.size !== '480p') return 'A Seedance draft edit is 480p only.';
  if (values.sourceDurationSeconds !== undefined && (typeof values.sourceDurationSeconds !== 'number' || !Number.isFinite(values.sourceDurationSeconds) || values.sourceDurationSeconds <= 0 || values.sourceDurationSeconds > capability.maxSeconds)) return 'Source duration must be a positive number of seconds within this model\'s limit.';
}

export function validateEditSource(source: {durationSeconds: number; width: number; height: number}, capability: NonNullable<ProviderModel['videoEdit']>): void {
  const {durationSeconds: duration, width, height} = source;
  if (!Number.isFinite(duration) || duration <= 0 || duration < (capability.minSeconds ?? 0) || duration > capability.maxSeconds || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(`Choose a readable clip ${capability.minSeconds ? `between ${capability.minSeconds} and ${capability.maxSeconds}` : `up to ${capability.maxSeconds}`} seconds long.`);
  const bounds = capability.sourceBounds;
  if (!bounds) return;
  if (width < bounds.minEdge || height < bounds.minEdge || width > bounds.maxEdge || height > bounds.maxEdge) throw new Error(`Source width and height must be between ${bounds.minEdge} and ${bounds.maxEdge} pixels.`);
  if (width * height < bounds.minPixels) throw new Error(`This model requires at least ${bounds.minPixels.toLocaleString('en-US')} source pixels. Resize the clip before uploading.`);
  if (width / height < bounds.minRatio || width / height > bounds.maxRatio) throw new Error('Choose a source aspect ratio between 1:2.5 and 2.5:1.');
}
