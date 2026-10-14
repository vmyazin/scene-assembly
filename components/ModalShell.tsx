// components/ModalShell.tsx
'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';

/**
 * The frame every modal shares: portal, dimmed backdrop, the panel's enter and
 * exit motion, and the focus trap, Escape, scroll lock and return focus from
 * `useAccessibleDialog`. What goes inside is the caller's.
 *
 * Keep it mounted and drive it with `open`; mounting it only while open skips
 * the exit animation. `onClose` runs for the backdrop and Escape, so a dialog
 * that must not close mid-task passes a guarded handler.
 */
export function ModalShell({
  open,
  onClose,
  role = 'dialog',
  labelledBy,
  describedBy,
  label,
  panelRef,
  raised = false,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  labelledBy?: string;
  describedBy?: string;
  /** For a dialog with no visible title element to point at. */
  label?: string;
  /** Pass one when the caller needs the panel element itself. */
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Above another overlay that is already open. */
  raised?: boolean;
  /** Size and layout of the panel; the surface and phone sheet are built in. */
  className: string;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? ownRef;

  useAccessibleDialog({ open, onClose, dialogRef: ref });

  return (
    <DialogPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 flex items-end justify-center p-0 backdrop-blur-md sm:items-center ${
              raised ? 'z-[70] bg-black/75 sm:p-5' : 'z-[60] bg-black/70 sm:p-4'
            }`}
            onClick={onClose}
          >
            <motion.div
              ref={ref}
              tabIndex={-1}
              role={role}
              aria-modal="true"
              aria-labelledby={labelledBy}
              aria-describedby={describedBy}
              aria-label={label}
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(event) => event.stopPropagation()}
              className={`dialog-panel dialog-mobile-sheet outline-none ${className}`}
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DialogPortal>
  );
}

/** The title row of a full-size sheet: icon, title, one line of context, close. */
export function ModalHeader({
  icon,
  title,
  titleId,
  description,
  descriptionId,
  onClose,
}: {
  icon: ReactNode;
  title: ReactNode;
  titleId: string;
  description: ReactNode;
  descriptionId: string;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-[var(--border)] px-3.5 py-3 sm:px-4">
      {icon}
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-base font-semibold text-[var(--foreground)]">
          {title}
        </h2>
        <p id={descriptionId} className="text-[0.9375rem] text-[var(--foreground-muted)]">
          {description}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
      >
        <X size={18} />
      </button>
    </header>
  );
}

/** The scrolling middle of a full-size sheet. */
export function ModalBody({ children }: { children: ReactNode }) {
  return (
    <div className="dialog-scroll-region min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5 sm:px-4">{children}</div>
  );
}

/** Panel classes for the full-size sheet: header, scrolling body, optional footer. */
export const SHEET_PANEL_CLASS =
  'dialog-touch-targets relative flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden sm:max-h-[90vh]';
