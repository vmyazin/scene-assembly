'use client';

import { BookMarked } from 'lucide-react';

import { useLibraryDialog } from '@/store/useLibraryDialog';

/**
 * Opens the library on saved prompts, from the prompt panel's header.
 *
 * The prompts were reachable only through the header's Library button and then
 * a tab switch, or ⌘K — three steps away from the box they fill. Picking one
 * writes the draft store, which every workspace's prompt reads, so it lands in
 * whichever panel this sits in.
 *
 * Neutral rather than accent: it sits beside Gen Example, which is the panel's
 * one invitation, and two lit buttons in one header compete.
 */
export default function SavedPromptsButton({ className = 'px-2.5 py-1.5' }: { className?: string }) {
  const openLibrary = useLibraryDialog((state) => state.openLibrary);
  return (
    <button
      type="button"
      onClick={() => openLibrary('prompts')}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--foreground)] ${className}`}
      title="Open your saved and recent prompts"
    >
      <BookMarked size={14} aria-hidden="true" />
      {/* Icon-only on a phone: beside "Prompt" and Gen Example the label
          wrapped both buttons onto two lines at 375px. */}
      <span className="sr-only sm:not-sr-only">Saved prompts</span>
    </button>
  );
}
