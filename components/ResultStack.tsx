'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, Loader2, Maximize2 } from 'lucide-react';

import ImageLightbox from '@/components/ImageLightbox';
import ResultActions from '@/components/ResultActions';
import ResultMeta from '@/components/ResultMeta';

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
  /**
   * What this result is, for the footer under its actions. Every field is
   * optional because the three panels know different amounts — see `ResultMeta`
   * on why a fact is dropped rather than blanked.
   */
  provider?: string;
  modelId?: string;
  cost?: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt?: number;
  /**
   * What produced it, for the download name. Carried on the item because the
   * feed is shared across engines: the prompt on screen may belong to a
   * different run than the card being saved.
   */
  prompt?: string;
  slug?: string;
  /** Set when this result was generated with Relaxed filter. */
  relaxed?: boolean;
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
  /**
   * Open image editing with the chosen result. Passed only by modes without a
   * reference slot, which turns their reference action into "Edit this image".
   */
  onEditImage?: () => void;
  /**
   * `stack` (default): one result per row, actions beside it on a wide panel.
   * `grid`: two equal columns once the panel is wide enough, each labelled
   * Newest or Earlier with its actions underneath — the image workspace's
   * layout, where this run and the last compare side by side (UX audit L1).
   */
  layout?: 'stack' | 'grid';
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
/** The grid's card, frame and pending slot: one result per cell, image on top. */
const GRID_CARD_CLASS =
  'flex flex-col gap-2 rounded-(--radius) border border-[var(--border)] bg-[var(--surface)] p-2.5';
const GRID_FRAME_CLASS =
  'group/img relative flex items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]';
const GRID_PENDING_CLASS = `${FRAME_CLASS} aspect-square`;

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
  onEditImage,
  layout = 'stack',
}: ResultStackProps) {
  const grid = layout === 'grid';
  const [openId, setOpenId] = useState<string | null>(null);
  // Read off the decoded image rather than asked of the caller: it is the one
  // fact none of the three panels record, and the browser knows it for free.
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});

  const visible = items.slice(0, max);
  /** Full width under the image in the stack; one of the row's buttons in the grid. */
  const downloadButton = (item: ResultStackItem, inRow = false) => (
    <button
      type="button"
      onClick={() => void onDownload(item)}
      // The row's label is short for the width; the full one stays the name.
      aria-label={inRow && downloadingId !== item.id ? downloadLabel : undefined}
      className={inRow ? 'btn-secondary flex-1' : 'btn-secondary w-full'}
    >
      {downloadingId === item.id ? (
        <Loader2 className="animate-spin" size={inRow ? 13 : 16} />
      ) : (
        <Download size={inRow ? 13 : 16} />
      )}
      {downloadingId === item.id ? 'Preparing download…' : inRow ? 'Download' : downloadLabel}
    </button>
  );
  const openItem = visible.find((item) => item.id === openId) ?? null;

  // The grid is a child of its container, never the container itself: a
  // container query cannot style the element that defines the container, so
  // `@2xl:grid-cols-2` on the same element would never apply.
  return (
    <div className={grid ? '@container' : '@container flex flex-col gap-3'}>
    <div className={grid ? 'grid grid-cols-1 gap-3.5 @2xl:grid-cols-2' : 'contents'}>
      {isGenerating && (
        <div className={grid ? GRID_PENDING_CLASS : FRAME_CLASS}>
          <div className="flex flex-col items-center gap-4">
            <div className="loading-spinner" />
            <p className="animate-pulse text-[var(--foreground-muted)]">{pendingLabel}</p>
            {pendingDetail}
          </div>
        </div>
      )}

      {!isGenerating && visible.length === 0 && (
        <div className={grid ? `${FRAME_CLASS} col-span-full` : FRAME_CLASS}>{emptyState}</div>
      )}

      <AnimatePresence initial={false}>
        {visible.map((item, index) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={grid ? GRID_CARD_CLASS : 'flex flex-col gap-2 @lg:flex-row @lg:items-start @lg:gap-3'}
          >
            {grid && (
              <span className={`eyebrow ${index === 0 && !isGenerating ? 'text-[var(--neon-cyan)]' : ''}`}>
                {index === 0 && !isGenerating ? 'Newest' : 'Earlier'}
              </span>
            )}
            <div className={grid ? GRID_FRAME_CLASS : IMAGE_FRAME_CLASS}>
              {/* A failed image is left in place rather than dropped: a provider
                  URL can expire while the page is open, and removing a result
                  the user just generated reads as data loss. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- data:, blob: and provider URLs, sized from naturalWidth on load */}
              <img
                src={item.src}
                alt={index === 0 ? 'Generated' : `Generated, ${index + 1} of ${visible.length}`}
                onClick={() => setOpenId(item.id)}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (!naturalWidth || !naturalHeight) return;
                  setSizes((current) =>
                    current[item.id]?.width === naturalWidth &&
                    current[item.id]?.height === naturalHeight
                      ? current
                      : { ...current, [item.id]: { width: naturalWidth, height: naturalHeight } }
                  );
                }}
                className={
                  grid
                    ? 'h-auto max-h-[70vh] w-full cursor-zoom-in object-contain'
                    : 'h-full w-full cursor-zoom-in object-contain @lg:h-auto @lg:max-h-104 @lg:w-auto @lg:max-w-full'
                }
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
            <div className={grid ? 'flex flex-col gap-2' : 'flex flex-col gap-2 @lg:min-w-44 @lg:flex-1 @lg:self-stretch'}>
              {!grid && downloadButton(item)}
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
                onEditImage={onEditImage}
                dense
                stack={!grid}
                leading={grid ? downloadButton(item, true) : undefined}
              />
              {/* Pinned to the foot of the column — `@lg:mt-auto` against the
                  stretched height — so it lines up with the bottom of the
                  picture it describes instead of floating under the buttons.
                  Below the threshold the column is not stretched and it simply
                  follows them. */}
              <ResultMeta
                provider={item.provider}
                modelId={item.modelId}
                cost={item.cost}
                startedAt={item.startedAt}
                finishedAt={item.finishedAt}
                createdAt={item.createdAt}
                relaxed={item.relaxed}
                width={sizes[item.id]?.width}
                height={sizes[item.id]?.height}
                className={grid ? undefined : '@lg:mt-auto'}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {items.length > max && (
        <p className={`text-center text-xs text-[var(--foreground-subtle)]${grid ? ' col-span-full' : ''}`}>
          Showing the last {max}. Everything else is kept in the Library.
        </p>
      )}

    </div>

      <ImageLightbox
        src={openItem?.src}
        open={Boolean(openItem)}
        onClose={() => setOpenId(null)}
        onDownload={openItem ? () => void onDownload(openItem) : undefined}
      />
    </div>
  );
}
