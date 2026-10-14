// components/MediaCard.tsx
'use client';

import Image, { type StaticImageData } from 'next/image';
import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The picker card shared by the feature grid on the landing page and the input
 * mode grid in the video workspace: an optional badge row, a 16:9 thumbnail, a
 * title and description, optional meta pills, and a check badge when selected.
 *
 * The accent follows the surface the card sits on — cyan on the landing page,
 * purple in the video workspace, where the nav and provider cards are purple.
 */
const ACCENTS = {
  cyan: {
    selectedCard: '[--media-card-accent:var(--neon-cyan)]',
    check: 'bg-[var(--neon-cyan)]',
  },
  purple: {
    selectedCard: '[--media-card-accent:var(--neon-purple)]',
    check: 'bg-[var(--neon-purple)]',
  },
} as const;

export type MediaCardAccent = keyof typeof ACCENTS;

interface MediaCardProps {
  title: string;
  description?: string;
  /**
   * A static import goes through next/image. A plain string is a URL served
   * as-is through a bare img — the feature art lives under /public/thumbnails
   * and has no static import to hang next/image optimization on.
   */
  thumbnail?: StaticImageData | string;
  thumbnailAlt?: string;
  /** Pills above the thumbnail. */
  badges?: ReactNode;
  /** Pills below the description. */
  meta?: ReactNode;
  selected?: boolean;
  accent?: MediaCardAccent;
  onClick: () => void;
  /** Set when the surrounding grid staggers its children in. */
  variants?: Variants;
  /** Width hint for next/image; unused by remote thumbnails. */
  sizes?: string;
}

export default function MediaCard({
  title,
  description,
  thumbnail,
  thumbnailAlt = '',
  badges,
  meta,
  selected = false,
  accent = 'cyan',
  onClick,
  variants,
  // Matches the grid below: 3 across from the tablet breakpoint up, 2 at sm.
  sizes = '(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw',
}: MediaCardProps) {
  const tone = ACCENTS[accent];

  return (
    <motion.button
      type="button"
      variants={variants}
      onClick={onClick}
      aria-pressed={selected}
      // flex-col opts out of the native button centering: grid rows stretch
      // every card to the tallest one, and a plain button vertically centers
      // its content in the extra space, knocking cards out of alignment.
      className={`glass-card media-card group relative flex cursor-pointer flex-col overflow-hidden p-3 text-left sm:p-3.5 ${selected ? tone.selectedCard : ''}`}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
    >
      {badges && <div className="flex items-center justify-between gap-1.5">{badges}</div>}

      <div
        className={`relative mb-2.5 aspect-video overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background-elevated)] ${badges ? 'mt-2.5' : ''}`}
      >
        {typeof thumbnail === 'string' ? (
          // eslint-disable-next-line @next/next/no-img-element -- string URLs stay bare imgs, see thumbnail prop
          <img
            src={thumbnail}
            alt={thumbnailAlt}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : thumbnail ? (
          <Image
            src={thumbnail}
            alt={thumbnailAlt}
            fill
            sizes={sizes}
            placeholder="blur"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <h3 className="display text-[0.9375rem] font-semibold text-[var(--foreground)]">{title}</h3>

        {/* Two lines, not three: at three cards per row the third line was the
            single largest contributor to card height on a tablet. */}
        {description && (
          <p className="line-clamp-2 text-[0.8125rem] leading-snug text-[var(--foreground-muted)]">
            {description}
          </p>
        )}

        {/* mt-auto pins the pills to the card's bottom edge so they line up
            across a row even when a sibling's description runs a line short. */}
        {meta && <div className="mt-auto flex flex-wrap gap-1.5 pt-1">{meta}</div>}
      </div>

      {selected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute bottom-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full ${tone.check}`}
        >
          <svg className="h-3 w-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </motion.div>
      )}
    </motion.button>
  );
}
