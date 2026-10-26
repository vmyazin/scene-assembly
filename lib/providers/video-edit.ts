// lib/providers/video-edit.ts
import type { ProviderModel } from './types';
/** Application bounds for the first editing release, not vendor storage quotas. */
export const MAX_EDIT_VIDEO_BYTES = 100_000_000;
/**
 * Widest source length a catalog edit page publishes (Aleph and Seedance, 30s).
 * A model whose page states no ceiling still stops here. Otherwise a YouTube
 * import only checks that the section fits the video, and the picker skips
 * auto-trim, so an hour-long clip is re-encoded until the 120s timeout.
 */
export const APP_EDIT_SOURCE_MAX_SECONDS = 30;

/** The vendor ceiling, or the app ceiling when the page publishes none. */
export function editSourceMaxSeconds(capability: Pick<VideoEditCapability, 'maxSeconds'>): number {
  return capability.maxSeconds ?? APP_EDIT_SOURCE_MAX_SECONDS;
}
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
export function editPromptShortcuts(capability?: Pick<VideoEditCapability, 'maxImages' | 'promptSyntax' | 'plainReferences'>): [string, string][] {
  return Object.entries(EDIT_PROMPTS).map(([label, text]) => {
    if (capability?.maxImages === 0) {
      const written = label === 'Replace character'
        ? 'Edit @Video1: replace the main person with a woman in her thirties with short red hair and a yellow raincoat. Keep their movement, timing, camera framing, and background unchanged.'
        : text;
      return [label, written.replace(/^Edit @Video1: (\w)/, (_, first: string) => first.toUpperCase())];
    }
    // plainReferences names the picture in words. @Image is Seedance's token, and
    // these Runware edit pages do not document it.
    if (capability?.promptSyntax === 'image-index' || capability?.plainReferences) return [label, text.replace('@Video1', 'the source video').replace(/@Image(\d+)/g, 'image $1')];
    if (capability?.promptSyntax === 'at-image-underscore-index') return [label, text.replace('@Video1', '@video_1').replace(/@Image(\d+)/g, '@image_$1')];
    if (capability?.promptSyntax === 'triple-angle') return [label, text.replace('@Video1', '<<<video_1>>>').replace(/@Image(\d+)/g, (_, n: string) => `<<<image_${n}>>>`)];
    return [label, text];
  });
}

/** `@Image1` on a model with no image input would run a paid edit against nothing. */
export function editPromptImageTokenError(capability: Pick<VideoEditCapability, 'maxImages'>, prompt: string): string | undefined {
  if (capability.maxImages === 0 && /@Image\d/i.test(prompt)) {
    return 'This model cannot receive images, so @Image references point to nothing. Describe the character in words, or choose an edit model that takes reference images.';
  }
}

/** The sentence after "Choose a readable clip ". Seedance stays "between 4 and 30 seconds long". */
export function editDurationMessage(capability: Pick<VideoEditCapability, 'minSeconds' | 'maxSeconds'>): string {
  const min = capability.minSeconds;
  const max = editSourceMaxSeconds(capability);
  if (min !== undefined) return `between ${min} and ${max} seconds long`;
  return `up to ${max} seconds long`;
}

/** 0.4 → 1:2.5 and 2.5 → 2.5:1, so Seedance's existing sentence stays intact. */
function ratioPhrase(ratio: number): string {
  if (ratio < 1) {
    const inverse = Math.round((1 / ratio) * 10) / 10;
    const text = Number.isInteger(inverse) ? String(inverse) : inverse.toFixed(1);
    return `1:${text}`;
  }
  return `${String(ratio)}:1`;
}

export function editPromptLengthError(capability: Pick<VideoEditCapability, 'minPromptLength' | 'maxPromptLength'>, prompt: string): string | undefined {
  if (capability.minPromptLength !== undefined && prompt.trim().length < capability.minPromptLength) return `This model's prompt is at least ${capability.minPromptLength} characters.`;
  if (capability.maxPromptLength !== undefined && prompt.length > capability.maxPromptLength) return `This model's prompt is at most ${capability.maxPromptLength} characters.`;
}

const FRAME_VALUES = ['first', 'last', '0', '-1'] as const;
export type FramePin = { frame: (typeof FRAME_VALUES)[number] } | { timestamp: number } | null;

function timestampPin(token: string, capability: VideoEditCapability): { timestamp: number } | string {
  const spec = capability.frameAnchors!.timestamp;
  const raw = token.slice(2);
  // Two decimal places is the schema's 0.01 precision. Rounding first would
  // make the step check below unreachable and would move t:1.257 to 1.26.
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return 'A timestamp is a number of seconds with at most two decimal places, like t:1.25.';
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < spec.min || seconds > spec.max) return `A timestamp must be between ${spec.min} and ${spec.max} seconds.`;
  const steps = (seconds - spec.min) / spec.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-3) return `A timestamp moves in steps of ${spec.step} seconds.`;
  return { timestamp: seconds };
}

/**
 * `auto,first,t:1.25` — one token per reference image. An empty value means
 * every image is left for the vendor to place. A string return is the refusal.
 */
export function framePinsFor(encoded: string | undefined, count: number, capability: VideoEditCapability): FramePin[] | string {
  if (!capability.frameAnchors) return encoded ? 'This model does not pin reference images.' : [];
  if (encoded === undefined || encoded.trim() === '') return Array.from({ length: count }, () => null);
  const tokens = encoded.split(',').map((token) => token.trim());
  if (tokens.length !== count) return 'Each reference image needs its own anchor, or leave every anchor automatic.';
  const pins: FramePin[] = [];
  for (const token of tokens) {
    if (token === '' || token === 'auto') { pins.push(null); continue; }
    if ((FRAME_VALUES as readonly string[]).includes(token) && capability.frameAnchors.frames.includes(token as (typeof FRAME_VALUES)[number])) {
      pins.push({ frame: token as (typeof FRAME_VALUES)[number] });
      continue;
    }
    if (token.startsWith('t:')) {
      const pin = timestampPin(token, capability);
      if (typeof pin === 'string') return pin;
      pins.push(pin);
      continue;
    }
    return 'An anchor is automatic, first, last, 0, -1, or a timestamp like t:1.25.';
  }
  return pins;
}

function frameAnchorTokenError(capability: VideoEditCapability, encoded: string): string | undefined {
  if (encoded.trim() === '') return;
  const pins = framePinsFor(encoded, encoded.split(',').length, capability);
  return typeof pins === 'string' ? pins : undefined;
}

/** A timestamp cannot point past the clip the file actually contains. */
export function frameAnchorTimingError(pins: FramePin[], durationSeconds: number | undefined): string | undefined {
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds)) return;
  for (const pin of pins) {
    if (pin && 'timestamp' in pin && pin.timestamp > durationSeconds + 1e-6) {
      return `A timestamp must fall inside the ${durationSeconds.toFixed(2)} s source.`;
    }
  }
}

/** Whether this edit lists a shared control, including one the tray draws. */
export function editHasControl(capability: Pick<VideoEditCapability, 'controls'> | undefined, key: string): boolean {
  return Boolean(capability?.controls?.some((control) => control.key === key));
}

/**
 * Per-second edits priced from the container. Runware reports a cost after the
 * run, so it stays off this path unless the catalog marks `measureForPrice`.
 * That flag is how Aleph 2.0 and Kling Omni 4K get a budget without pulling
 * P-Video-Edit or Seedance onto the same path.
 */
export function pricesEditFromSourceDuration(provider: string, capability?: VideoEditCapability): boolean {
  if (!capability?.rate || capability.rate.per !== 'second' || capability.rate.usd === undefined) return false;
  if (capability.measureForPrice) return true;
  return provider !== 'runware';
}

/** The source-card sentence. A missing vendor ceiling uses the app maximum, so the card never says "undefined". */
export function editSourceSummary(capability: VideoEditCapability): string {
  const mimes = editVideoMimes(capability).map((mime) => mime === 'video/mp4' ? 'MP4' : mime === 'video/quicktime' ? 'MOV' : mime === 'video/webm' ? 'WebM' : mime).join(', ');
  const max = editSourceMaxSeconds(capability);
  const seconds = capability.minSeconds !== undefined ? `${capability.minSeconds}–${max} seconds` : `Up to ${max} seconds`;
  const bounds = capability.sourceBounds;
  const pixels = bounds?.minEdge !== undefined && bounds.maxEdge !== undefined
    ? ` · ${bounds.minEdge}–${bounds.maxEdge}px`
    : bounds?.maxEdge !== undefined ? ` · up to ${bounds.maxEdge}px`
      : bounds?.minEdge !== undefined ? ` · at least ${bounds.minEdge}px` : '';
  const tail = capability.promptSyntax === 'triple-angle'
    ? 'Reference this clip as <<<video_1>>>.'
    : capability.promptSyntax === 'at-image-underscore-index' ? 'Reference this clip as @video_1.'
    : capability.namesSource ? 'Reference this clip as @Video1.' : 'Describe how to change the source video.';
  return `${mimes} · ${seconds} · up to ${Math.round(editVideoMaxBytes(capability) / 1_000_000)} MB${pixels}. ${tail}`;
}

/** Validate only model-owned settings; fixed-output models must not receive stale resolution. */
export function editSettingsError(capability: VideoEditCapability, values: Record<string, unknown>): string | undefined {
  const allowsDuration = Boolean(capability.draftPreview || capability.rate?.per === 'second' || capability.measureForPrice);
  const allowed = [
    ...(capability.sizes.length ? ['size'] : []),
    ...(capability.aspectRatios?.length ? ['aspectRatio'] : []),
    ...(capability.draftRate || capability.draftPreview ? ['draft'] : []),
    // The Worker overwrites this with the container length before reserve.
    // A caller-supplied number is only a check, within a second of the file.
    ...(allowsDuration ? ['sourceDurationSeconds'] : []),
    ...(capability.controls ?? []).map(control => control.key),
  ];
  if (values.frameAnchors !== undefined && typeof values.frameAnchors !== 'string') return 'Frame anchors must be a comma-separated list.';
  if (typeof values.frameAnchors === 'string') {
    const tokenError = frameAnchorTokenError(capability, values.frameAnchors);
    if (tokenError) return tokenError;
  }
  if (Object.keys(values).some(key => values[key] !== undefined && !allowed.includes(key))) return 'Unsupported edit setting. Duration and aspect ratio follow the source.';
  for (const control of capability.controls ?? []) {
    const value = values[control.key];
    if (value === undefined) continue;
    if (control.kind === 'boolean' && typeof value !== 'boolean') return `${control.label} must be on or off.`;
    if (control.kind === 'text' && (typeof value !== 'string' || (control.maxLength !== undefined && value.length > control.maxLength))) return `${control.label} is too long.`;
    if (control.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (control.min !== undefined && value < control.min) || (control.max !== undefined && value > control.max))) return `${control.label} is outside this model's range.`;
    if (control.kind === 'select' && !control.options?.some(option => option.value === value)) return `Choose a supported ${control.label.toLowerCase()}.`;
  }
  if (values.draft !== undefined && typeof values.draft !== 'boolean') return 'Draft must be on or off.';
  if (capability.draftPreview && values.draft === true && values.size !== '480p') return 'A Seedance draft edit is 480p only.';
  if (capability.sizes.length && !capability.sizes.some(size => size.label === values.size)) return 'Choose a supported edit resolution.';
  if (values.aspectRatio !== undefined && !capability.aspectRatios?.includes(String(values.aspectRatio))) return 'Choose a supported aspect ratio.';
  if (values.sourceDurationSeconds !== undefined && (typeof values.sourceDurationSeconds !== 'number' || !Number.isFinite(values.sourceDurationSeconds) || values.sourceDurationSeconds <= 0 || (capability.maxSeconds !== undefined && values.sourceDurationSeconds > capability.maxSeconds))) return 'Source duration must be a positive number of seconds within this model\'s limit.';
}

export function validateEditSource(source: {durationSeconds: number; width: number; height: number}, capability: VideoEditCapability): void {
  const {durationSeconds: duration, width, height} = source;
  const min = capability.minSeconds ?? 0;
  const overMax = duration > editSourceMaxSeconds(capability);
  if (!Number.isFinite(duration) || duration <= 0 || duration < min || overMax || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(`Choose a readable clip ${editDurationMessage(capability)}.`);
  const bounds = capability.sourceBounds;
  if (!bounds) return;
  const { minEdge, maxEdge } = bounds;
  if (minEdge !== undefined && maxEdge !== undefined && (width < minEdge || height < minEdge || width > maxEdge || height > maxEdge)) throw new Error(`Source width and height must be between ${minEdge} and ${maxEdge} pixels.`);
  else if (maxEdge !== undefined && minEdge === undefined && (width > maxEdge || height > maxEdge)) throw new Error(`Source width and height must be at most ${maxEdge} pixels.`);
  else if (minEdge !== undefined && maxEdge === undefined && (width < minEdge || height < minEdge)) throw new Error(`Source width and height must be at least ${minEdge} pixels.`);
  if (bounds.minPixels !== undefined && width * height < bounds.minPixels) throw new Error(`This model requires at least ${bounds.minPixels.toLocaleString('en-US')} source pixels. Resize the clip before uploading.`);
  if (bounds.maxPixels !== undefined && width * height > bounds.maxPixels) throw new Error(`This model accepts at most ${bounds.maxPixels.toLocaleString('en-US')} source pixels.`);
  if (bounds.minRatio !== undefined && bounds.maxRatio !== undefined && (width / height < bounds.minRatio || width / height > bounds.maxRatio)) throw new Error(`Choose a source aspect ratio between ${ratioPhrase(bounds.minRatio)} and ${ratioPhrase(bounds.maxRatio)}.`);
}

/** Comet's Runway task route, not `/v1/videos`. Keyed off the catalog so a second model does not need another string compare. */
export function isRunwayEditProtocol(capability?: { protocol?: string }): boolean {
  return capability?.protocol === 'runway';
}
