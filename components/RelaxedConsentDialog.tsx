// components/RelaxedConsentDialog.tsx
'use client';

import { useId, useState } from 'react';

import { ModalShell } from '@/components/ModalShell';

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
  const titleId = useId();
  return (
    <ModalShell open={open} onClose={onCancel} labelledBy={titleId} className="dialog-touch-targets w-full max-w-md space-y-4 p-5">
      <ConsentBody titleId={titleId} error={error} onConfirm={onConfirm} onCancel={onCancel} />
    </ModalShell>
  );
}

/** Mounted only while the dialog is open, so the checkbox starts unchecked each time. */
function ConsentBody({ titleId, error, onConfirm, onCancel }: Omit<RelaxedConsentDialogProps, 'open'> & { titleId: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <>
      <h2 id={titleId} className="display text-lg font-semibold">
        Turn on Relaxed filter?
      </h2>
      <p className="text-sm leading-relaxed text-[var(--foreground-muted)]">
        Relaxed filter asks supported providers to use their less-strict settings, so swimwear, horror, action and classical-art prompts are blocked less often. It does <strong>not</strong> allow sexually explicit content. Some things never change: no minors in any suggestive context, no sexualized images of real people, and AI watermarks stay on. Providers still apply their own rules, and repeated violations can get your provider account suspended.
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
    </>
  );
}
