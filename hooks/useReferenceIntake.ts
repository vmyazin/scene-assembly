// hooks/useReferenceIntake.ts
'use client';

import { useEffect, useRef, useState } from 'react';

import { prepareReferences } from '@/lib/draft/ingest';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import { keepUploadedImages } from '@/lib/gallery/keep-upload';
import { FRAME_EXTRACTION_ERROR, isVideoFile, lastFrameAsImageFile } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';

/**
 * Reference images for a workspace, from every way one arrives: the file
 * picker, a drop, or a paste. A video stands in for its last frame, so a clip
 * saved earlier can seed the next one without a round trip through a provider.
 *
 * What a workspace accepts and how it words a refusal stay with the caller;
 * the reading, re-encoding and storing are the same everywhere.
 */
export function useReferenceIntake({
  referenceCount,
  maxImages,
  accept,
  rejectAnyUnusable = false,
  unusableMessage,
  tooManyMessage,
  pasteEnabled,
  dropDisabled = false,
  onError,
}: {
  /** References already in the draft. */
  referenceCount: number;
  maxImages: number;
  /** Whether a file can become a reference here. */
  accept: (file: File) => boolean;
  /** Refuse the whole batch when any file is unusable, not only when none is. */
  rejectAnyUnusable?: boolean;
  unusableMessage: string;
  tooManyMessage: string;
  /** Listen for pasted images while the reference card is on screen. */
  pasteEnabled: boolean;
  /** Stop taking drops, e.g. once a fixed number of slots is full. */
  dropDisabled?: boolean;
  onError: (message: string | null) => void;
}) {
  const imageFormat = useAppStore((state) => state.imageFormat);
  const [isReadingFrame, setIsReadingFrame] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A stricter model must not keep more references than it accepts.
  useEffect(() => {
    useDraftStore.getState().limitReferences(maxImages);
  }, [maxImages]);

  const addFiles = async (files: File[]) => {
    const usable = files.filter(accept);
    if (usable.length === 0 || (rejectAnyUnusable && usable.length !== files.length)) {
      onError(unusableMessage);
      return;
    }
    if (referenceCount + usable.length > maxImages) {
      onError(tooManyMessage);
      return;
    }

    onError(null);
    const hasVideo = usable.some(isVideoFile);
    if (hasVideo) setIsReadingFrame(true);
    try {
      const prepared = await Promise.all(
        usable.map(async (file) =>
          isVideoFile(file)
            ? { file: await lastFrameAsImageFile(file), sourceLabel: `Last frame of ${file.name}` }
            : { file, sourceLabel: undefined }
        )
      );
      // Re-encoded before any provider sees it: nano banana returns PNG, which
      // is both the largest upload and the format providers handle worst.
      const converted = await prepareReferences(prepared, imageFormat);
      if (!mountedRef.current) return;
      useDraftStore.getState().addReferences(converted, maxImages);
      // Kept for next time, in this browser and in the cloud library when
      // there is an account to hold it. Deliberately not awaited: the
      // reference is already in the draft, and storing it must not delay the
      // press that follows.
      void keepUploadedImages(converted);
    } catch {
      if (mountedRef.current) onError(FRAME_EXTRACTION_ERROR);
    } finally {
      if (mountedRef.current && hasVideo) setIsReadingFrame(false);
    }
  };

  // Latest addFiles, so the paste listener attaches once instead of per render.
  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });

  useEffect(() => {
    if (!pasteEnabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith('image/') || isVideoFile(file)
      );
      if (pasted.length === 0) return;
      event.preventDefault();
      void addFilesRef.current(pasted);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasteEnabled]);

  const { isDragging, isFetching, dropProps } = useFileDrop({
    onFiles: (files) => addFilesRef.current(files),
    onError,
    disabled: dropDisabled,
  });

  return { addFiles: (files: File[]) => addFilesRef.current(files), isReadingFrame, isDragging, isFetching, dropProps };
}

/**
 * Claims a frame handed over by "Continue from last frame": it replaces the
 * references and, when nothing is typed yet, starts the prompt. The seed lives
 * in a store because switching to an image mode remounts the workspace.
 */
export function useClaimSeedFrame(enabled: boolean, maxImages: number, mode: string) {
  useEffect(() => {
    if (!enabled) return;
    const seed = useSeedFrameStore.getState().takeSeedFrame();
    if (!seed) return;
    const name = seed.sourceLabel.replace(/-/g, ' ');
    const draft = useDraftStore.getState();
    draft.clearReferences();
    draft.addReferences([{ file: seed.file, sourceLabel: `Last frame of ${name}` }], maxImages);
    if (!draft.prompt) draft.setPrompt(`Continue the scene from ${name}.`);
  }, [enabled, maxImages, mode]);
}
