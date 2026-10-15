// lib/providers/video-edit.ts
import type { ProviderModel } from './types';
/** Application bounds for the first editing release, not vendor storage quotas. */
export const MAX_EDIT_VIDEO_BYTES = 100_000_000;
/** Largest source a catalog model currently publishes (Kling O1/O3 on fal). */
export const MAX_EDIT_VIDEO_UPLOAD_BYTES = 200_000_000;
export const EDIT_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export type VideoEditCapability = NonNullable<ProviderModel['videoEdit']>;

export function editVideoMimes(capability?: Pick<VideoEditCapability, 'mimes'>): readonly string[] {
  return capability?.mimes ?? EDIT_VIDEO_MIMES;
}
export function editVideoMaxBytes(capability?: Pick<VideoEditCapability, 'maxBytes'>): number {
  return capability?.maxBytes ?? MAX_EDIT_VIDEO_BYTES;
}
export function isEditVideoMime(mime: string, capability?: Pick<VideoEditCapability, 'mimes'>): boolean {
  return editVideoMimes(capability).includes(mime);
}
function formatList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}
function mimeLabel(mime: string): string {
  if (mime === 'video/mp4') return 'MP4';
  if (mime === 'video/quicktime') return 'MOV';
  if (mime === 'video/webm') return 'WebM';
  return mime;
}
export function validateEditVideo(file: Pick<File, 'size' | 'type'>, capability?: Pick<VideoEditCapability, 'mimes' | 'maxBytes'>): void {
  const maxBytes = editVideoMaxBytes(capability);
  const megabytes = Math.round(maxBytes / 1_000_000);
  const formats = formatList(editVideoMimes(capability).map(mimeLabel));
  if (!isEditVideoMime(file.type, capability) || file.size <= 0 || file.size > maxBytes) {
    throw new Error(`Choose ${formats.startsWith('MP4') ? `an ${formats}` : `a ${formats}`} video up to ${megabytes} MB.`);
  }
}
export const EDIT_PROMPTS = {
  'Replace character': 'Edit @Video1: replace the main person with the character in @Image1. Keep their movement, timing, camera framing, and background unchanged.',
  'Change scene': 'Edit @Video1: replace the background with a snowy forest. Keep the person, clothing, movement, timing, and camera framing unchanged.',
  Restyle: 'Edit @Video1: restyle the clip as a clay animation. Preserve the subjects, composition, movement, camera, and timing.',
};

/**
 * Shortcuts in the vocabulary the model reads. A model that takes no images
 * (Aleph 2) gets a written character and no tokens, because `@Image1` would
 * name a file it never receives and `@Video1` is not in its vocabulary.
 */
export function editPromptShortcuts(capability?: Pick<VideoEditCapability, 'maxImages' | 'promptSyntax'>): [string, string][] {
  return Object.entries(EDIT_PROMPTS).map(([label, text]) => {
    if (capability?.maxImages === 0) {
      const written = label === 'Replace character'
        ? 'Edit @Video1: replace the main person with a woman in her thirties with short red hair and a yellow raincoat. Keep their movement, timing, camera framing, and background unchanged.'
        : text;
      return [label, written.replace(/^Edit @Video1: (\w)/, (_, first: string) => first.toUpperCase())];
    }
    if (capability?.promptSyntax === 'image-index') return [label, text.replace('@Video1', 'the source video').replace(/@Image(\d+)/g, 'image $1')];
    return [label, text];
  });
}

/** `@Image1` on a model with no image input would run a paid edit against nothing. */
export function editPromptImageTokenError(capability: Pick<VideoEditCapability, 'maxImages'>, prompt: string): string | undefined {
  if (capability.maxImages === 0 && /@Image\d/i.test(prompt)) {
    return 'This model cannot receive images, so @Image references point to nothing. Describe the character in words, or choose an edit model that takes reference images.';
  }
}

/** Validate only model-owned settings; fixed-output models must not receive stale resolution. */
export function editSettingsError(capability: VideoEditCapability, values: Record<string, unknown>): string | undefined {
  const allowed = [
    ...(capability.sizes.length ? ['size'] : []),
    ...(capability.aspectRatios?.length ? ['aspectRatio'] : []),
    ...(capability.draftRate || capability.draftPreview ? ['draft'] : []),
    // The Worker overwrites this with the container length before reserve.
    // A caller-supplied number is only a check, within a second of the file.
    ...(capability.draftPreview || capability.rate.per === 'second' ? ['sourceDurationSeconds'] : []),
  ];
  if (Object.keys(values).some(key => values[key] !== undefined && !allowed.includes(key))) return 'Unsupported edit setting. Duration and aspect ratio follow the source.';
  if (values.draft !== undefined && typeof values.draft !== 'boolean') return 'Draft must be on or off.';
  if (capability.draftPreview && values.draft === true && values.size !== '480p') return 'A Seedance draft edit is 480p only.';
  if (capability.sizes.length && !capability.sizes.some(size => size.label === values.size)) return 'Choose a supported edit resolution.';
  if (values.aspectRatio !== undefined && !capability.aspectRatios?.includes(String(values.aspectRatio))) return 'Choose a supported aspect ratio.';
  if (values.sourceDurationSeconds !== undefined && (typeof values.sourceDurationSeconds !== 'number' || !Number.isFinite(values.sourceDurationSeconds) || values.sourceDurationSeconds <= 0 || values.sourceDurationSeconds > capability.maxSeconds)) return 'Source duration must be a positive number of seconds within this model\'s limit.';
}

export function validateEditSource(source: {durationSeconds: number; width: number; height: number}, capability: VideoEditCapability): void {
  const {durationSeconds: duration, width, height} = source;
  if (!Number.isFinite(duration) || duration <= 0 || duration < (capability.minSeconds ?? 0) || duration > capability.maxSeconds || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(`Choose a readable clip ${capability.minSeconds ? `between ${capability.minSeconds} and ${capability.maxSeconds}` : `up to ${capability.maxSeconds}`} seconds long.`);
  const bounds = capability.sourceBounds;
  if (!bounds) return;
  if (width < bounds.minEdge || height < bounds.minEdge || width > bounds.maxEdge || height > bounds.maxEdge) throw new Error(`Source width and height must be between ${bounds.minEdge} and ${bounds.maxEdge} pixels.`);
  if (bounds.minPixels !== undefined && width * height < bounds.minPixels) throw new Error(`This model requires at least ${bounds.minPixels.toLocaleString('en-US')} source pixels. Resize the clip before uploading.`);
  if (bounds.minRatio !== undefined && bounds.maxRatio !== undefined && (width / height < bounds.minRatio || width / height > bounds.maxRatio)) throw new Error('Choose a source aspect ratio between 1:2.5 and 2.5:1.');
}

/** Comet's Runway task route, not `/v1/videos`. Keyed off the catalog so a second model does not need another string compare. */
export function isRunwayEditProtocol(capability?: { protocol?: string }): boolean {
  return capability?.protocol === 'runway';
}
