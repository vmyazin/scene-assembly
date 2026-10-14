// components/ConfirmDialog.tsx
'use client';

import { useId, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { ModalShell } from '@/components/ModalShell';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small modal that asks before an action the user might regret. Its focus
 * trap, Escape handling, scroll lock and return focus come from `ModalShell`,
 * like every other dialog here, rather than from `window.confirm`.
 *
 * Cancel is the first focusable control so a stray Enter keeps things as
 * they are; confirming takes a deliberate move.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      role="alertdialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="dialog-touch-targets w-full max-w-md p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-[var(--neon-pink)]" size={18} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold text-[var(--foreground)]">
            {title}
          </h2>
          <div id={descriptionId} className="mt-1 text-[0.9375rem] text-[var(--foreground-muted)]">
            {description}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="btn-secondary">
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} className="btn-primary">
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
