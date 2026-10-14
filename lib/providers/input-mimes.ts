// lib/providers/input-mimes.ts
/**
 * One list of MIME types an input upload may declare.
 *
 * Staging (`add_reference`), `isSupportedInputMime`, and the byte cap used to
 * each write the list out. They had already drifted: the storage check let
 * WebM through because it reused the output allowlist. WebM stays stageable
 * because an edit source may be WebM. A reference video still refuses it by role.
 */
import { REFERENCE_AUDIO_MIMES } from './reference-clips';
import { EDIT_VIDEO_MIMES } from './video-edit';

export const IMAGE_INPUT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const;

export const STAGEABLE_INPUT_MIMES = [
  ...IMAGE_INPUT_MIMES,
  ...EDIT_VIDEO_MIMES,
  ...REFERENCE_AUDIO_MIMES,
] as const;

export function isStageableInputMime(mime: string): boolean {
  return (STAGEABLE_INPUT_MIMES as readonly string[]).includes(mime);
}

export function isImageInputMime(mime: string): boolean {
  return (IMAGE_INPUT_MIMES as readonly string[]).includes(mime);
}
