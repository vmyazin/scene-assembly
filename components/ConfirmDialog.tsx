// components/ConfirmDialog.tsx
'use client';

import { useId, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';

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
 * A small modal that asks before an action the user might regret. Shares the
 * focus trap, Escape handling, scroll lock and return-focus behaviour of the
 * library overlay through `useAccessibleDialog`, so it behaves like every
 * other dialog here rather than like `window.confirm`.
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
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useAccessibleDialog({ open, onClose: onCancel, dialogRef: panelRef });

  return (
    <DialogPortal>
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
          onClick={onCancel}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(event) => event.stopPropagation()}
            className="dialog-panel dialog-mobile-sheet dialog-touch-targets w-full max-w-md p-4 outline-none sm:p-5"
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
              <button type="button" onClick={onCancel} className="btn-secondary px-3 py-2 text-sm">
                {cancelLabel}
              </button>
              <button type="button" onClick={onConfirm} className="btn-primary px-3 py-2 text-sm">
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </DialogPortal>
  );
}
