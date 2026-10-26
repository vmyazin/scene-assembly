// lib/providers/reference-clips.ts
/**
 * Reference video and reference audio, as distinct from a source clip being edited
 * and from reference images.
 *
 * Limits are the ones the vendor pages publish, except video bytes: Runware allows
 * 200 MB and this app stops at 100 MB, the same cap as an edit source, because the
 * browser upload is a data URI and account uploads share that 100 MB ceiling.
 * Atlas Seedance 2.0 Fast's own ceiling is 50 MB, which is already under that.
 *
 * Read 2026-10-12:
 * - https://runware.ai/docs/models/bytedance-seedance-2-5.md
 * - https://www.atlascloud.ai/models/bytedance/seedance-2.5/reference-to-video
 * - https://www.atlascloud.ai/models/bytedance/seedance-2.0-fast/reference-to-video/llms.txt
 */
import type { ProviderMode, ProviderModel, ReferenceClipLimit, ReferenceClipsCapability, VideoPromptSyntax } from './types';

export const REFERENCE_AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'] as const;
export const REFERENCE_VIDEO_MIMES = ['video/mp4', 'video/quicktime'] as const;
/** Account and browser ceiling. Runware's page allows 200 MB. */
export const REFERENCE_VIDEO_MAX_BYTES = 100_000_000;
export const REFERENCE_AUDIO_MAX_BYTES = 15_000_000;

const VIDEO_EXTENSIONS: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime' };
const AUDIO_EXTENSIONS: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav' };

export function isReferenceAudioMime(mime: string): boolean {
  return (REFERENCE_AUDIO_MIMES as readonly string[]).includes(mime);
}

export function isReferenceVideoMime(mime: string): boolean {
  return (REFERENCE_VIDEO_MIMES as readonly string[]).includes(mime);
}

/** Browsers often leave `file.type` empty for WAV. The extension is the fallback. */
export function referenceClipMime(file: { type: string; name: string }, kind: 'video' | 'audio'): string {
  const type = file.type.toLowerCase();
  const table = kind === 'video' ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS;
  if (type && (kind === 'video' ? isReferenceVideoMime(type) : isReferenceAudioMime(type))) return type === 'audio/mp3' ? 'audio/mpeg' : type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return table[ext] ?? type;
}

/**
 * The File the upload will declare. An empty type or `audio/mp3` becomes the
 * MIME the Worker accepts; the original is kept when it already matches.
 */
export function fileWithReferenceClipType(file: File, kind: 'video' | 'audio'): File {
  const type = referenceClipMime(file, kind);
  if (!type || type === file.type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

const SEEDANCE_25_VIDEO: ReferenceClipLimit = {
  max: 10, minSeconds: 2, maxSeconds: 30, maxTotalSeconds: 30, maxBytes: REFERENCE_VIDEO_MAX_BYTES,
  accept: REFERENCE_VIDEO_MIMES, formatsLabel: 'MP4 or MOV', token: 'Video',
  minEdge: 300, maxEdge: 6000, minRatio: 0.4, maxRatio: 2.5,
};

const SEEDANCE_25_AUDIO: ReferenceClipLimit = {
  max: 10, minSeconds: 2, maxSeconds: 30, maxTotalSeconds: 30, maxBytes: REFERENCE_AUDIO_MAX_BYTES,
  accept: REFERENCE_AUDIO_MIMES, formatsLabel: 'MP3 or WAV', token: 'Audio',
};

/** Runware Seedance 2.5. Audio may be the only reference. Text and reference modes; frames and edit stay off. */
export const SEEDANCE_25_REFERENCE_CLIPS: ReferenceClipsCapability = {
  modes: ['text', 'reference'],
  audioRequiresVisual: false,
  video: SEEDANCE_25_VIDEO,
  audio: SEEDANCE_25_AUDIO,
};

/**
 * Atlas Seedance 2.5 reference-to-video. Same counts as Runware, plus the pixel
 * and frame-rate bounds that page publishes and Runware's parameter table does not.
 * The endpoint is reference-only, so text-to-video on Atlas is a different model id.
 */
export const ATLAS_SEEDANCE_25_REFERENCE_CLIPS: ReferenceClipsCapability = {
  modes: ['reference'],
  audioRequiresVisual: false,
  video: { ...SEEDANCE_25_VIDEO, minPixels: 409_600, maxPixels: 8_295_044, minFps: 24, maxFps: 60 },
  audio: SEEDANCE_25_AUDIO,
};

/** Atlas Seedance 2.0 reference-to-video. Audio is refused unless an image or video is attached. */
export const SEEDANCE_20_REFERENCE_CLIPS: ReferenceClipsCapability = {
  modes: ['reference'],
  audioRequiresVisual: true,
  video: {
    max: 3, minSeconds: 2, maxSeconds: 15, maxTotalSeconds: 15, maxBytes: 50_000_000,
    accept: REFERENCE_VIDEO_MIMES, formatsLabel: 'MP4 or MOV', token: 'Video',
    minEdge: 300, maxEdge: 6000, minRatio: 0.4, maxRatio: 2.5,
    minPixels: 409_600, maxPixels: 2_086_876, minFps: 24, maxFps: 60,
  },
  audio: {
    max: 3, minSeconds: 2, maxSeconds: 15, maxTotalSeconds: 15, maxBytes: REFERENCE_AUDIO_MAX_BYTES,
    accept: REFERENCE_AUDIO_MIMES, formatsLabel: 'MP3 or WAV', token: 'Audio',
  },
};

export function referenceClipsFor(model: ProviderModel | undefined, mode: ProviderMode): ReferenceClipsCapability | undefined {
  const clips = model?.referenceClips;
  if (!clips?.modes.includes(mode)) return undefined;
  return clips;
}

export function clipToken(syntax: VideoPromptSyntax | undefined, token: 'Video' | 'Audio' | 'Image', index: number): string {
  const n = index + 1;
  if (syntax === 'at-image-underscore-index') return `@${token.toLowerCase()}_${n}`;
  if (syntax === 'at-image-index') return `@${token}${n}`;
  if (syntax === 'triple-angle') return `<<<${token.toLowerCase()}_${n}>>>`;
  return `${token} ${n}`;
}

export interface ProbedClip {
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
}

function bytesLabel(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Type and size, before the file is opened. */
export function referenceClipFileError(spec: ReferenceClipLimit, file: { type: string; size: number; name: string }): string | null {
  const mime = referenceClipMime(file, spec.token === 'Video' ? 'video' : 'audio');
  const accepted = spec.accept.map((item) => (item === 'audio/mp3' ? 'audio/mpeg' : item));
  if (!accepted.includes(mime) || file.size <= 0 || file.size > spec.maxBytes) {
    return spec.token === 'Video'
      ? `Choose an ${spec.formatsLabel} video up to ${bytesLabel(spec.maxBytes)}.`
      : `Choose an ${spec.formatsLabel} file up to ${bytesLabel(spec.maxBytes)}.`;
  }
  return null;
}

/** Duration, dimensions and frame rate once the file has been read. */
export function referenceClipProbeError(spec: ReferenceClipLimit, probed: ProbedClip, existingSeconds = 0): string | null {
  const seconds = probed.durationSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return `Could not read that ${spec.token === 'Video' ? 'video' : 'audio'}'s length.`;
  if (seconds < spec.minSeconds - 0.05 || seconds > spec.maxSeconds + 0.05) {
    return `Each reference ${spec.token === 'Video' ? 'video' : 'audio clip'} must be ${spec.minSeconds}–${spec.maxSeconds} seconds. This one is ${seconds.toFixed(1)}s.`;
  }
  if (existingSeconds + seconds > spec.maxTotalSeconds + 0.05) {
    return `Reference ${spec.token === 'Video' ? 'videos' : 'audio'} together must be ${spec.maxTotalSeconds} seconds or shorter.`;
  }
  if (spec.token === 'Video' && spec.minEdge !== undefined && spec.maxEdge !== undefined) {
    const { width = 0, height = 0 } = probed;
    if (!width || !height) return 'Could not read that video\'s dimensions.';
    if (width < spec.minEdge || height < spec.minEdge || width > spec.maxEdge || height > spec.maxEdge) {
      return `Reference video width and height must be between ${spec.minEdge} and ${spec.maxEdge} pixels.`;
    }
    if (spec.minRatio !== undefined && spec.maxRatio !== undefined && (width / height < spec.minRatio || width / height > spec.maxRatio)) {
      return 'Choose a reference video between 1:2.5 and 2.5:1.';
    }
    const pixels = width * height;
    if (spec.minPixels !== undefined && pixels < spec.minPixels) return `This model needs at least ${spec.minPixels.toLocaleString('en-US')} reference-video pixels.`;
    if (spec.maxPixels !== undefined && pixels > spec.maxPixels) return `This model accepts at most ${spec.maxPixels.toLocaleString('en-US')} reference-video pixels.`;
    if (probed.fps !== undefined && spec.minFps !== undefined && spec.maxFps !== undefined && (probed.fps < spec.minFps || probed.fps > spec.maxFps)) {
      return `This clip is ${probed.fps} fps. Reference videos for this model need ${spec.minFps}–${spec.maxFps} fps.`;
    }
  }
  return null;
}

export function referenceClipCountError(spec: ReferenceClipLimit, count: number): string | null {
  if (count > spec.max) {
    return `Add up to ${spec.max} reference ${spec.token === 'Video' ? `video${spec.max === 1 ? '' : 's'}` : `audio clip${spec.max === 1 ? '' : 's'}`}.`;
  }
  return null;
}

/** Whole-set rule that a single file cannot see: 2.0 audio needs a picture or a video. */
export function referenceClipSetError(
  capability: ReferenceClipsCapability,
  counts: { images: number; videos: number; audios: number },
): string | null {
  if (counts.audios > 0 && capability.audioRequiresVisual && counts.images === 0 && counts.videos === 0) {
    return 'Add a reference image or reference video. This model cannot use audio on its own.';
  }
  return null;
}
