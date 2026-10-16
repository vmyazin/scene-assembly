import { prepareReferences } from '@/lib/draft/ingest';
import { extensionForMedia } from '@/lib/media-download';
import { extractLastFrame, FRAME_EXTRACTION_ERROR, lastFrameFilename } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';

/**
 * Sending a finished result somewhere without a round trip through the Library.
 *
 * Nothing here is a new capability: `LastFrameActions` has always turned a clip
 * into the seed for the next one, and the Library has always been able to hand a
 * stored image to the draft. What was missing is that the result panel itself
 * offered neither, so a four-keyframe job paid twelve modal round trips to do
 * what the app could already do.
 *
 * Both destinations go through the existing chokepoints — `prepareReferences`
 * for anything entering the draft, `useSeedFrameStore` for the workspace
 * handoff — rather than adding a fifth place image bytes can enter the app.
 */

export type ResultKind = 'image' | 'video';

/**
 * The bytes behind a result, as an image.
 *
 * A result is addressed by URL rather than held as a Blob, so every action
 * starts here. A clip resolves to its *closing* frame, which is what
 * `LastFrameActions` and the gallery poster already mean by "the frame of this
 * clip" — a follow-on shot continues from where the last one ended, never from
 * where it began.
 */
export async function resolveResultImage(src: string, kind: ResultKind): Promise<Blob> {
  if (kind === 'video') return extractLastFrame(src);

  const response = await fetch(src);
  if (!response.ok) throw new Error('This result is no longer available.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('This result is not an image.');
  return blob;
}

/** `rooftop-at-dusk` + an image Blob → `rooftop-at-dusk.webp`, so the chip reads like a file. */
function namedFile(blob: Blob, filenameBase: string, kind: ResultKind): File {
  const name =
    kind === 'video'
      ? lastFrameFilename(filenameBase)
      : `${filenameBase}.${extensionForMedia('image', blob.type)}`;
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/**
 * Add a finished result to the current draft's references.
 *
 * The conversion is what decides the payload, so this runs `prepareReferences`
 * on the way in exactly as the pickers do — never a size gate on the source
 * bytes, which would reject full-resolution results the pipeline handles fine.
 */
export async function sendResultToReferences(
  blob: Blob,
  { filenameBase, kind, sourceLabel, limit, replace = false }: {
    filenameBase: string;
    kind: ResultKind;
    sourceLabel: string;
    limit: number;
    /**
     * Make this result the source rather than one more reference: older
     * references give way instead of refusing. For a handoff into a mode the
     * user has not opened yet, whose slots they cannot see to clear.
     */
    replace?: boolean;
  }
) {
  if (!replace && useDraftStore.getState().references.length >= limit) {
    throw new Error('Remove a reference before adding another.');
  }
  const prepared = await prepareReferences(
    [{ file: namedFile(blob, filenameBase, kind), sourceLabel }],
    useAppStore.getState().imageFormat
  );
  // Re-checked after the await: conversion is asynchronous and the user can
  // fill the stack while it runs.
  if (!replace && useDraftStore.getState().references.length >= limit) {
    throw new Error('Remove a reference before adding another.');
  }
  useDraftStore.getState().addReferences(prepared, limit);
}

/**
 * Hand a finished result to the next clip as its opening frame.
 *
 * A store rather than a prop for the reason the tray exists at all: the caller
 * immediately switches the workspace into image-to-video, which remounts it, and
 * a frame passed as a prop would be dropped mid-flight.
 */
export function sendResultToFirstFrame(
  blob: Blob,
  { filenameBase, kind, sourceLabel }: { filenameBase: string; kind: ResultKind; sourceLabel: string }
) {
  useSeedFrameStore.getState().setSeedFrame({
    file: namedFile(blob, filenameBase, kind),
    sourceLabel,
  });
}

/** What to show when an action fails without a message worth repeating. */
export const HANDOFF_ERROR = FRAME_EXTRACTION_ERROR;
