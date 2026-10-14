'use client';

import { useState } from 'react';
import { Library as LibraryIcon, Repeat2 } from 'lucide-react';

import LibraryOverlay from '@/components/LibraryOverlay';
import { useDraftStore } from '@/store/useDraftStore';

interface StoredImagePickerProps {
  referenceLimit: number;
  /**
   * Swap the reference in this slot instead of adding one. The slot is the only
   * thing that knows which image the user meant, so it is recorded on the draft
   * before the overlay opens and cleared however the overlay closes — a
   * cancelled pick must not leave the next ordinary add replacing something.
   */
  replaceIndex?: number;
}

/**
 * A shared entry point for adding a stored gallery image to the active draft.
 * The overlay and its local open state live here so generation workspaces only
 * need to provide the reference limit enforced by their selected model.
 *
 * It also stands in for itself once the slots are full. Adding used to be the
 * only thing it did, so it was rendered only while there was room — which meant
 * that attaching a reference made the one visible route to the library vanish,
 * leaving a hover-only, unlabelled bin icon as the sole way to change your mind.
 */
export default function StoredImagePicker({ referenceLimit, replaceIndex }: StoredImagePickerProps) {
  const [open, setOpen] = useState(false);
  const replacing = replaceIndex !== undefined;

  const change = (next: boolean) => {
    useDraftStore.getState().setReplaceTarget(next && replacing ? replaceIndex : null);
    setOpen(next);
  };

  if (replacing) {
    return (
      <>
        <button
          type="button"
          onClick={() => change(true)}
          className="btn-secondary flex-1"
        >
          <Repeat2 size={13} aria-hidden="true" /> Replace
        </button>

        <LibraryOverlay
          open={open}
          onOpenChange={change}
          purpose="pick-image"
          referenceLimit={referenceLimit}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="From library"
        onClick={() => change(true)}
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 py-3.5 text-[var(--foreground-muted)] transition-colors hover:border-[var(--neon-cyan)]/60 hover:bg-[var(--neon-cyan)]/10 hover:text-[var(--neon-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] sm:w-36 sm:shrink-0"
      >
        <LibraryIcon aria-hidden="true" size={24} />
        <span className="text-sm font-medium">From library</span>
        <span className="text-[0.65rem] text-[var(--foreground-subtle)]">Stored images</span>
      </button>

      <LibraryOverlay
        open={open}
        onOpenChange={change}
        purpose="pick-image"
        referenceLimit={referenceLimit}
      />
    </>
  );
}
