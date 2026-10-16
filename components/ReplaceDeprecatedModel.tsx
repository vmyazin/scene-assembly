'use client';

import { ArrowRight } from 'lucide-react';

/**
 * The way off a retired model, shown under the model list while one is
 * selected.
 *
 * Nano Banana 2 stays runnable and a person may have picked it on purpose, so
 * the choice is not migrated behind their back. But the studio remembers the
 * last model, and the deprecated one carried over from before 2.1 existed at
 * twice 2.1's price, with only a badge and a line of note text saying so
 * (UX audit M7). One click moves to the successor.
 */
export default function ReplaceDeprecatedModel({
  replacementLabel,
  onSwitch,
}: {
  replacementLabel: string;
  onSwitch: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <p className="text-xs text-[var(--foreground-muted)]">{replacementLabel} replaces this model.</p>
      <button type="button" onClick={onSwitch} className="btn-secondary min-h-9 text-xs">
        Switch to {replacementLabel}
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
