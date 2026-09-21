// components/ImageLightbox.tsx
'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { useRef } from 'react';

import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';

/**
 * Full-screen view of a single result.
 *
 * Portaled to <body> so it escapes the z-10 stacking context of <main> and
 * the sticky Generate column, covering the header and footer. Shared by every
 * workspace that shows an image: a result is worth looking at closely wherever
 * it was generated.
 */
export default function ImageLightbox({
  src,
  open,
  onClose,
  onDownload,
  alt = 'Generated image, full size',
}: {
  src: string | null | undefined;
  open: boolean;
  onClose: () => void;
  /** Offers a download from inside the overlay when the caller has one. */
  onDownload?: () => void;
  alt?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useAccessibleDialog({ open: open && Boolean(src), onClose, dialogRef });

  return (
    <DialogPortal>
    <AnimatePresence>
      {open && src && (
        <motion.div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="dialog-touch-targets image-lightbox-dialog fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4 outline-none backdrop-blur-md sm:p-5"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="image-lightbox-close absolute right-4 top-4 rounded-lg border border-[var(--border)] p-2 text-[var(--foreground-muted)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--foreground)]"
          >
            <X size={22} />
          </button>
          <motion.img
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2 }}
            src={src}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100dvh-9rem)] max-w-full rounded-xl object-contain shadow-2xl sm:max-h-full"
          />
          {onDownload && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDownload();
              }}
              className="btn-secondary image-lightbox-download absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2"
            >
              <Download size={18} />
              Download
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
    </DialogPortal>
  );
}
