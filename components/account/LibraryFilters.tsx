'use client';

import type { CloudAssetCounts } from '@/lib/account/contracts';
import type { LibraryKind } from '@/lib/account/use-library';

/** `all`/`image`/`video`/`temporary` narrow the asset query in the Worker.
 *  `active` and `attention` describe jobs, so they swap what the canvas shows
 *  rather than filtering assets — a job that failed before saving has no asset
 *  row, and an asset query would report zero exactly when it matters. */
export type LibraryFilterId = LibraryKind | 'active' | 'attention';

export interface LibraryFilter {
  id: LibraryFilterId;
  label: string;
  count: number;
}

/**
 * Pill colour follows the workspace dichotomy the rest of the app already
 * uses (DESIGN.md: "Image uses Marker Yellow, Video uses Motion Violet, and
 * Timeline uses Signal Cyan only while active"), so a media type is the same
 * colour here as it is in the studio.
 *
 * Job states borrow the app's own state palette instead: amber is already
 * "needs a person" in `JOB_STATE_TONES`, and in-flight work takes the sky tone
 * that map gives queued and submitting — violet is spoken for by video, and
 * reusing it would make a running job look like a media filter.
 */
const TONES: Record<LibraryFilterId, { on: string; off: string }> = {
  all: {
    on: 'border-transparent bg-[var(--neon-cyan)] text-[var(--background)]',
    off: 'border-[var(--border-hover)] text-[var(--foreground-muted)] hover:border-[var(--neon-cyan)]/60',
  },
  image: {
    on: 'border-transparent bg-[var(--brand-accent)] text-[var(--background)]',
    off: 'border-[var(--brand-accent)]/35 text-[var(--brand-accent)] hover:border-[var(--brand-accent)]/70',
  },
  video: {
    // White on violet, not the dark ink the other fills use: #bd00ff is too
    // dark a field for dark text to stay legible at 10px.
    on: 'border-transparent bg-[var(--neon-purple)] text-white',
    off: 'border-[var(--neon-purple)]/45 text-violet-300 hover:border-[var(--neon-purple)]/80',
  },
  active: {
    on: 'border-transparent bg-sky-300 text-[var(--background)]',
    off: 'border-sky-300/40 text-sky-300 hover:border-sky-300/70',
  },
  attention: {
    on: 'border-transparent bg-amber-300 text-[var(--background)]',
    off: 'border-amber-300/40 text-amber-200 hover:border-amber-300/70',
  },
  temporary: {
    on: 'border-transparent bg-amber-300 text-[var(--background)]',
    off: 'border-amber-300/40 text-amber-200 hover:border-amber-300/70',
  },
};

/**
 * The library's filter row.
 *
 * Counts come from the Worker rather than from the loaded page, because the
 * assets endpoint is cursor-paged: a client-side count would say "18 images"
 * when it means "18 images so far" and would shrink as someone paged older.
 *
 * "Needs attention" is counted from jobs, not assets — a job that failed to
 * save has no asset row, so an asset-derived count would report zero at exactly
 * the moment the filter matters.
 *
 * That pill names what it counts, which is why it takes two numbers. Behind it
 * sits everything unresolved, decisions and stopped records alike, because it
 * is the only route to either. But a record that already failed needs no
 * decision, and counting the two together is how an account with five real
 * decisions wore a "Needs attention 11" badge — six of those were corpses. So
 * the badge reads the decisions, and once there are none left it renames itself
 * after what actually remains rather than announcing zero or vanishing and
 * taking the rows with it.
 */
export default function LibraryFilters({
  counts,
  attentionCount,
  stoppedCount = 0,
  activeCount,
  active,
  onSelect,
}: {
  counts: CloudAssetCounts | null;
  /** Jobs waiting on a decision. */
  attentionCount: number;
  /** Jobs already stopped or failed: listed behind the same pill, never part of
   *  the alarm. */
  stoppedCount?: number;
  activeCount: number;
  active: LibraryFilterId;
  onSelect: (id: LibraryFilterId) => void;
}) {
  const unresolved = attentionCount + stoppedCount;
  // Three pills reading zero are noise, not navigation: an account with
  // nothing in it has nothing to narrow.
  if (!counts || (counts.all === 0 && unresolved === 0 && activeCount === 0)) return null;
  const filters: LibraryFilter[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'image', label: 'Images', count: counts.image },
    { id: 'video', label: 'Video', count: counts.video },
    ...(activeCount > 0 ? [{ id: 'active' as const, label: 'Generating', count: activeCount }] : []),
    ...(unresolved > 0 ? [attentionCount > 0
      ? { id: 'attention' as const, label: 'Needs attention', count: attentionCount }
      : { id: 'attention' as const, label: 'Stopped', count: stoppedCount }] : []),
    ...(counts.temporary > 0 ? [{ id: 'temporary' as const, label: 'Temporary', count: counts.temporary }] : []),
  ];
  return (
    <div role="group" aria-label="Filter the library" className="mt-4 flex flex-wrap gap-1.5">
      {filters.map(filter => {
        const on = filter.id === active;
        const tone = TONES[filter.id];
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(filter.id)}
            className={`min-h-8 rounded-full border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none ${on ? `font-semibold ${tone.on}` : tone.off}`}
          >
            {filter.label} {filter.count}
          </button>
        );
      })}
    </div>
  );
}
