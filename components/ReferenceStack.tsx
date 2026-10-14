'use client';

import { Maximize2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import ImageLightbox from '@/components/ImageLightbox';
import StoredImagePicker from '@/components/StoredImagePicker';

export interface ReferenceStackItem {
  /** Stable across re-renders, so React keys and the open lightbox survive one. */
  id: string;
  src: string;
  /** Accessible name for the thumbnail; the lightbox appends ", full size". */
  alt: string;
  /** Slot or token label above the frame, e.g. "First frame", "@Image1". */
  caption?: string;
  /** Provenance note under the frame, e.g. the clip a still came from. */
  sourceLabel?: string;
  /** aria-label for this item's remove button; workspaces word it differently. */
  removeLabel: string;
}

/**
 * The source images a generation runs on, with the same full-screen view its
 * results get.
 *
 * Shared rather than laid out inline because four workspaces rendered the same
 * frame, remove button, and caption with small drifts, and a panel that keeps
 * its own `open` boolean cannot say *which* of several references is open —
 * the same reason `ResultStack` owns the result lightbox.
 */
export default function ReferenceStack({
  items,
  onRemove,
  replaceLimit,
  layout = 'grid',
  captionClassName = 'text-xs font-medium text-[var(--foreground)]',
}: {
  items: ReferenceStackItem[];
  /** Called with the item's index, matching each workspace's existing remover. */
  onRemove: (index: number) => void;
  /**
   * Offer each slot its own Replace, limited to this many references.
   *
   * Per slot rather than one control for the set: with two frames on screen,
   * "replace" has to say *which*, and only the slot knows. Omitted where the
   * workspace has no library to pick from.
   */
  replaceLimit?: number;
  /** `grid` is the two-up square gallery; `stack` is one full-width column. */
  layout?: 'grid' | 'stack';
  /** Caption tone belongs to the workspace's accent; the frame belongs here. */
  captionClassName?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = items.find((item) => item.id === openId) ?? null;

  if (items.length === 0) return null;

  return (
    <>
      <div className={layout === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
        {items.map((item, index) => (
          <div key={item.id} className="space-y-1">
            {item.caption && <p className={captionClassName}>{item.caption}</p>}
            <div className="group/ref relative overflow-hidden rounded-lg border border-[var(--border)]">
              {/* Local blob and data URLs cannot be optimized by next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt={item.alt}
                onClick={() => setOpenId(item.id)}
                className={`w-full cursor-zoom-in ${layout === 'grid' ? 'aspect-square object-cover' : 'aspect-video object-contain'}`}
              />
              {/* Top-left, because remove has held the top-right corner in every
                  workspace; the button exists so the zoom is keyboard-reachable,
                  which the click handler on the image alone is not. */}
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                aria-label={`View ${item.alt} full screen`}
                className="absolute left-2 top-2 rounded-md border border-white/10 bg-black/70 p-1.5 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/ref:opacity-100"
              >
                <Maximize2 size={14} />
              </button>
            </div>
            {/* Always on screen, and named. These used to be one unlabelled bin
                icon that appeared on hover in the thumbnail's corner, so
                swapping a frame meant discovering it first — and the route back
                to the library disappeared the moment a slot was filled. */}
            <div className="flex gap-1.5">
              {replaceLimit !== undefined && (
                <StoredImagePicker referenceLimit={replaceLimit} replaceIndex={index} />
              )}
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={item.removeLabel}
                className="btn-secondary flex-1"
              >
                <Trash2 size={13} aria-hidden="true" /> Remove
              </button>
            </div>
            {item.sourceLabel && (
              <p title={item.sourceLabel} className="truncate text-[0.65rem] text-[var(--foreground-subtle)]">
                {item.sourceLabel}
              </p>
            )}
          </div>
        ))}
      </div>
      <ImageLightbox
        src={openItem?.src}
        open={Boolean(openItem)}
        onClose={() => setOpenId(null)}
        alt={openItem ? `${openItem.alt}, full size` : undefined}
      />
    </>
  );
}
