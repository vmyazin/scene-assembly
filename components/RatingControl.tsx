'use client';

import { Star, ThumbsDown, ThumbsUp, type LucideIcon } from 'lucide-react';

import { RATING_LABELS, RATINGS, type Rating } from '@/lib/results/rating';

const ICONS: Record<Rating, LucideIcon> = { down: ThumbsDown, good: ThumbsUp, great: Star };

/**
 * Selected tone per mark. Great borrows Marker Yellow's "rare editorial
 * emphasis" (DESIGN.md), Good the app's own cyan, and a miss stays a muted red
 * so a grid full of judgements reads by its best results, not its failures.
 */
const SELECTED: Record<Rating, string> = {
  down: 'border-red-300/50 bg-red-400/10 text-red-200',
  good: 'border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]',
  great: 'border-[var(--brand-accent)]/60 bg-[var(--brand-accent)]/10 text-[var(--brand-accent)]',
};

/**
 * Three toggles rather than a radio group: pressing the current mark again
 * clears it, which a radio cannot express, and "unrated" is a real state the
 * library filters on.
 */
export default function RatingControl({
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  value: Rating | null | undefined;
  onChange: (rating: Rating | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Rate this result"
      className={`inline-flex items-center gap-0.5 rounded-[9px] border border-[var(--border)] bg-black/20 p-[3px] ${className}`}
    >
      {RATINGS.map((rating) => {
        const Icon = ICONS[rating];
        const on = value === rating;
        return (
          <button
            key={rating}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            // The miss shows only its icon; its name still reaches assistive tech.
            aria-label={rating === 'down' ? RATING_LABELS.down : undefined}
            title={on ? `${RATING_LABELS[rating]} (press again to clear)` : RATING_LABELS[rating]}
            onClick={() => onChange(on ? null : rating)}
            className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[0.71875rem] font-medium transition-colors motion-reduce:transition-none disabled:opacity-60 ${
              on
                ? SELECTED[rating]
                : 'border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
            }`}
          >
            <Icon size={12} aria-hidden="true" fill={on && rating === 'great' ? 'currentColor' : 'none'} />
            {rating === 'down' ? null : RATING_LABELS[rating]}
          </button>
        );
      })}
    </div>
  );
}
