// components/FinalizeDraftButton.tsx
'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { SEEDANCE_25_MODEL, SEEDANCE_FINALIZE_PRICE_NOTE, seedanceCatalogFigure } from '@/lib/providers/seedance-draft';

/**
 * Two steps on purpose: the first names the price, the second is the charge.
 * Finalize is a new paid render, so a single click would spend it unseen.
 */
export default function FinalizeDraftButton({
  inputMode,
  durationSeconds,
  busy = false,
  onApprove,
}: {
  inputMode: string;
  durationSeconds: number | undefined;
  busy?: boolean;
  onApprove: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priced = typeof durationSeconds === 'number' && durationSeconds >= 4 && durationSeconds <= 30 ? durationSeconds : undefined;
  const figure = priced
    ? seedanceCatalogFigure({
      modelId: SEEDANCE_25_MODEL,
      inputMode: inputMode as 'text' | 'image' | 'frames' | 'reference' | 'edit',
      values: { finalize: true, draftId: 'priced', durationSeconds: priced },
    })
    : null;
  const price = figure?.costUsd != null ? ` (~$${figure.costUsd.toFixed(2)})` : '';

  async function approve() {
    setError(null);
    try {
      await onApprove();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not finalize this draft.');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="btn-secondary w-full"
      >
        <Sparkles size={16} aria-hidden="true" />
        {`Finalize at 1080p${price}`}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background-elevated)]/70 p-3">
      <p className="text-sm text-[var(--foreground)]">
        {figure?.costUsd != null
          ? `Finalize this 480p draft at 1080p for about $${figure.costUsd.toFixed(2)}.`
          : 'This draft has no saved length between 4 and 30 seconds, so it cannot be priced.'}
      </p>
      <p className="text-xs text-[var(--foreground-muted)]">{SEEDANCE_FINALIZE_PRICE_NOTE}</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || figure?.costUsd == null}
          onClick={() => void approve()}
          className="btn-primary"
        >
          {busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
          Approve and finalize
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
