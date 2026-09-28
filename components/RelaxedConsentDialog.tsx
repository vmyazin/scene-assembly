// components/RelaxedConsentDialog.tsx
'use client';

import { useId, useRef, useState } from 'react';

import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';

interface RelaxedConsentDialogProps {
  open: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * First time Relaxed is turned on. The checkbox is the age confirmation the
 * spec stores; Turn on stays disabled until it is checked.
 */
export default function RelaxedConsentDialog({ open, error, onConfirm, onCancel }: RelaxedConsentDialogProps) {
  return (
    <DialogPortal>
      {open && <ConsentPanel error={error} onConfirm={onConfirm} onCancel={onCancel} />}
    </DialogPortal>
  );
}

/** Mounted only while the dialog is open, so the checkbox starts unchecked each time. */
function ConsentPanel({ error, onConfirm, onCancel }: Omit<RelaxedConsentDialogProps, 'open'>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [checked, setChecked] = useState(false);
  useAccessibleDialog({ open: true, onClose: onCancel, dialogRef: panelRef });

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-card w-full max-w-md space-y-4 p-5"
      >
        <h2 id={titleId} className="display text-lg font-semibold">
          Turn on Relaxed filter?
        </h2>
        <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
          Relaxed filter asks supported engines to use their less-strict settings, so swimwear, horror, action and classical-art prompts are blocked less often. It does <strong>not</strong> allow sexually explicit content. Some things never change: no minors in any suggestive context, no sexualized images of real people, and AI watermarks stay on. Providers still apply their own rules, and repeated violations can get your provider account suspended.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>I&apos;m 18 or older and I&apos;ll follow these rules and my providers&apos; terms.</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!checked} onClick={onConfirm}>
            Turn on
          </button>
        </div>
      </div>
    </div>
  );
}
