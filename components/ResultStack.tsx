'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Loader2, Maximize2 } from 'lucide-react';

import ImageLightbox from '@/components/ImageLightbox';
import ResultActions from '@/components/ResultActions';

/**
 * Generated images, newest on top, instead of one that each job overwrites.
 *
 * Generating is iterative — the same prompt run three or four times and
 * compared — so destroying the previous result on every run threw away exactly
 * what the user was about to look at. The bytes were never lost (the library
 * captures every result), but comparing meant opening an overlay, which is the
 * wrong weight for "was the last one better?".
 *
 * Shared by both image panels rather than written twice, for the reason
 * `GenerationWorkspaceLayout` and `AutoExpandingPrompt` exist: provider-owned
 * copies of shared UI drift apart.
 */

export interface ResultStackItem {
  /** Stable across re-renders, so React keys and the open lightbox survive one. */
  id: string;
  src: string;
  mimeType?: string;
  /** Model name, shown per card where the panel tracks one. */
  label?: string;
}

interface ResultStackProps {
  /** Newest first. Capped here rather than by callers, so panels cannot disagree. */
  items: ResultStackItem[];
  max?: number;
  isGenerating?: boolean;
  pendingLabel?: string;
  /** Extra line under the pending label, e.g. a queue percentage. */
  pendingDetail?: ReactNode;
  /** Shown when there is nothing yet and nothing running. */
  emptyState: ReactNode;
  onDownload: (item: ResultStackItem) => void | Promise<void>;
  /** Id of the item whose download is in flight, for its button's spinner. */
  downloadingId?: string | null;
  downloadLabel?: string;
  /**
   * Names each result for the file that reaches the draft. Falls back to the
   * item id, which is stable but says nothing — panels that know the prompt
   * slug should pass it.
   */
  filenameBase?: (item: ResultStackItem) => string;
  /** How many references the selected model accepts. */
  referenceLimit?: number;
  /**
   * Switch the app into image-to-video, seeded with the chosen result. Omitted
   * where that destination is unreachable, which withdraws the action rather
   * than offering a button that goes nowhere.
   */
  onUseAsFirstFrame?: () => void;
}

/** How many results are kept on screen; the rest stay in the library. */
export const DEFAULT_MAX_RESULTS = 4;

const FRAME_CLASS =
  'relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]';

/**
 * A loaded result stops pretending to be 16:9 once there is room beside it.
 *
 * The pending and empty frames keep `aspect-video`, because a fixed box is what
 * stops the panel jumping while a job runs. A finished image has no such
 * excuse: a portrait result letterboxed into 16:9 spent most of the card on
 * empty bars, so here the frame shrinks to the picture and the actions take the
 * width that was being wasted.
 *
 * Keyed off the panel's own width via `@container`, not the viewport: this card
 * lives in a workspace column that is narrow on a wide screen, and a `md:`
 * breakpoint would have split the card while the column was still too tight.
 */
const IMAGE_FRAME_CLASS = `${FRAME_CLASS} group/img @lg:aspect-auto @lg:h-auto @lg:w-fit @lg:max-w-full @lg:min-h-48 @lg:min-w-48`;

export default function ResultStack({
  items,
  max = DEFAULT_MAX_RESULTS,
  isGenerating = false,
  pendingLabel = 'Creating your masterpiece...',
  pendingDetail,
  emptyState,
  onDownload,
  downloadingId,
  downloadLabel = 'Download image',
  filenameBase,
  referenceLimit,
  onUseAsFirstFrame,
}: ResultStackProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = items.slice(0, max);
  const openItem = visible.find((item) => item.id === openId) ?? null;

  return (
    <div className="@container flex flex-col gap-3">
      {isGenerating && (
        <div className={FRAME_CLASS}>
          <div className="flex flex-col items-center gap-4">
            <div className="loading-spinner" />
            <p className="animate-pulse text-[var(--foreground-muted)]">{pendingLabel}</p>
            {pendingDetail}
          </div>
        </div>
      )}

      {!isGenerating && visible.length === 0 && <div className={FRAME_CLASS}>{emptyState}</div>}

      <AnimatePresence initial={false}>
        {visible.map((item, index) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-2 @lg:flex-row @lg:items-start @lg:gap-3"
          >
            <div className={IMAGE_FRAME_CLASS}>
              {/* A failed image is left in place rather than dropped: a provider
                  URL can expire while the page is open, and removing a result
                  the user just generated reads as data loss. */}
              <img
                src={item.src}
                alt={index === 0 ? 'Generated' : `Generated, ${index + 1} of ${visible.length}`}
                onClick={() => setOpenId(item.id)}
                className="h-full w-full cursor-zoom-in object-contain @lg:h-auto @lg:max-h-104 @lg:w-auto @lg:max-w-full"
              />
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                aria-label="View full screen"
                className="absolute right-3 top-3 rounded-lg border border-white/10 bg-black/55 p-2 text-white/80 opacity-0 backdrop-blur transition-opacity hover:text-white focus-visible:opacity-100 group-hover/img:opacity-100"
              >
                <Maximize2 size={16} />
              </button>
              {item.label && (
                <span className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-xs text-white/80 backdrop-blur">
                  {item.label}
                </span>
              )}
            </div>
            {/* Beneath the image on a narrow panel, beside it on a wide one —
                one column either way, so the buttons keep their order and the
                markup stays a single source. */}
            <div className="flex flex-col gap-2 @lg:min-w-44 @lg:flex-1">
              <button
                type="button"
                onClick={() => void onDownload(item)}
                className="btn-secondary flex w-full items-center justify-center gap-2 py-2 text-sm"
              >
                {downloadingId === item.id ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Download size={16} />
                )}
                {downloadingId === item.id ? 'Preparing download…' : downloadLabel}
              </button>
              {/* The row that makes a result something other than a dead end.
                  Every image panel composes this component, so putting it here
                  rather than in each caller is what gives all three the same
                  handoffs at once. */}
              <ResultActions
                kind="image"
                src={item.src}
                filenameBase={filenameBase?.(item) ?? item.id}
                referenceLimit={referenceLimit}
                onUseAsFirstFrame={onUseAsFirstFrame}
                dense
                stack
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {items.length > max && (
        <p className="text-center text-xs text-[var(--foreground-subtle)]">
          Showing the last {max}. Everything else is kept in the Library.
        </p>
      )}

      <ImageLightbox
        src={openItem?.src}
        open={Boolean(openItem)}
        onClose={() => setOpenId(null)}
        onDownload={openItem ? () => void onDownload(openItem) : undefined}
      />
    </div>
  );
}
