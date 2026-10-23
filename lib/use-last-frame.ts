'use client';

import { useRef, useState } from 'react';

import { extractLastFrame, lastFrameFilename } from '@/lib/video-frame';
import { saveBlobAs } from '@/lib/save-file';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';

export const COPY_UNSUPPORTED = 'This browser cannot copy images to the clipboard.';

/** Image clipboard writes need a secure context, and PNG is the only safe type. */
export function canCopyImages() {
  return typeof ClipboardItem !== 'undefined' && typeof navigator?.clipboard?.write === 'function';
}

/**
 * Save, copy, or continue from the closing frame of a finished clip.
 *
 * Shared by the result panel's button row (`LastFrameActions`) and the library
 * card's action menu, so both decode the same way and name the file the same
 * way. Extraction is cached per URL, so using two actions, or retrying,
 * refetches nothing. Each action rejects on failure; the host decides whether
 * that is an inline line or a toast.
 */
export function useLastFrame(videoUrl: string, filenameBase: string) {
  const setSeedFrame = useSeedFrameStore((state) => state.setSeedFrame);
  // Safe to detect during render: hosts mount only once a result exists in the
  // browser, so this is never part of the server-rendered HTML.
  const [copySupported] = useState(canCopyImages);
  const frameRef = useRef<{ url: string; blob: Blob } | null>(null);

  const ensureFrame = async () => {
    if (frameRef.current?.url === videoUrl) return frameRef.current.blob;
    const blob = await extractLastFrame(videoUrl);
    frameRef.current = { url: videoUrl, blob };
    return blob;
  };

  const save = async () => {
    saveBlobAs(await ensureFrame(), lastFrameFilename(filenameBase));
  };

  // Not async: Safari only honours a write started in the gesture's task, so the
  // clipboard gets the pending extraction rather than an awaited blob.
  const copy = () => {
    if (!canCopyImages()) return Promise.reject(new Error(COPY_UNSUPPORTED));
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': ensureFrame() })]);
  };

  /** Hands the frame to the next image-to-video draft via the seed store. */
  const seed = async () => {
    const blob = await ensureFrame();
    const name = lastFrameFilename(filenameBase);
    setSeedFrame({
      file: new File([blob], name, { type: 'image/png' }),
      sourceLabel: filenameBase,
    });
  };

  return { copySupported, save, copy, seed };
}
