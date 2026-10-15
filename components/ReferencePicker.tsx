// components/ReferencePicker.tsx
'use client';

import { useRef } from 'react';
import { ArrowUpDown, ImagePlus, Loader2 } from 'lucide-react';

import StoredImagePicker from '@/components/StoredImagePicker';
import type { FileDropProps } from '@/lib/drop/use-file-drop';
import { useDraftStore } from '@/store/useDraftStore';

const ACCENT = {
  cyan: {
    dragging: 'border-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]',
    idle: 'border-[var(--neon-cyan)]/30 text-[var(--foreground-muted)] hover:border-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/5 hover:text-[var(--neon-cyan)]',
  },
  purple: {
    dragging: 'border-[var(--neon-purple)] bg-[var(--neon-purple)]/10 text-[var(--neon-purple)]',
    idle: 'border-[var(--neon-purple)]/30 text-[var(--foreground-muted)] hover:border-[var(--neon-purple)] hover:bg-[var(--neon-purple)]/5 hover:text-[var(--neon-purple)]',
  },
} as const;

/**
 * The way references get in: a drop target that is also a file picker, beside
 * the picker for images already stored. Pair it with useReferenceIntake, whose
 * state it shows.
 */
export function ReferencePicker({
  accept,
  multiple,
  inputLabel,
  accent,
  idleLabel,
  draggingLabel = 'Drop to use as a source',
  referenceCount,
  referenceLimit,
  intake,
}: {
  accept: string;
  multiple: boolean;
  inputLabel?: string;
  accent: keyof typeof ACCENT;
  idleLabel: string;
  draggingLabel?: string;
  referenceCount: number;
  referenceLimit: number;
  intake: {
    addFiles: (files: File[]) => Promise<void>;
    isReadingFrame: boolean;
    isFetching: boolean;
    isDragging: boolean;
    dropProps: FileDropProps;
  };
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFiles, isReadingFrame, isFetching, isDragging, dropProps } = intake;
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={inputLabel}
        className="hidden"
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          {...dropProps}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-3.5 text-sm transition-colors sm:flex-1 ${
            isDragging ? ACCENT[accent].dragging : ACCENT[accent].idle
          }`}
        >
          {isReadingFrame || isFetching ? <Loader2 className="animate-spin" size={28} /> : <ImagePlus size={28} />}
          {isReadingFrame
            ? 'Reading last frame…'
            : isFetching
              ? 'Fetching dropped image…'
              : isDragging
                ? draggingLabel
                : idleLabel}
        </button>
        {referenceCount < referenceLimit && <StoredImagePicker referenceLimit={referenceLimit} />}
      </div>
    </>
  );
}

/**
 * Which image opens the clip and which closes it is the whole of a frames
 * mode, and picking them in the wrong order is a two-file re-upload without
 * this.
 */
export function SwapFramesButton() {
  return (
    <button type="button" onClick={() => useDraftStore.getState().reorderReference(0, 1)} className="btn-secondary w-full">
      <ArrowUpDown size={15} /> Swap first and last
    </button>
  );
}
