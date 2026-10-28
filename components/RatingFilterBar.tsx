'use client';

import { useId } from 'react';
import { Layers } from 'lucide-react';

import { RATING_FILTERS, ratingFilterCount, type RatingCounts, type RatingFilter } from '@/lib/results/rating';
import { resultModelLabel } from '@/lib/results/reuse-run';

const FILTER_LABELS: Record<RatingFilter, string> = {
  all: 'All',
  unrated: 'Unrated',
  down: 'Misses',
  'good-up': 'Good & up',
  great: 'Great',
};

export interface ModelOption {
  provider: string;
  modelId: string;
  mediaType?: 'image' | 'video';
  count: number;
}

export interface ModelChoice {
  provider: string;
  modelId: string;
}

/** One `<option>` value for a provider and model together. */
function optionValue(model: ModelChoice) {
  return JSON.stringify([model.provider, model.modelId]);
}

/**
 * The rating, model and grouping controls, shared by the browser library and
 * both views of the cloud library so a filter means the same thing in each.
 *
 * The three answer one question together: "for this prompt, which model got it
 * right?" Rating narrows to the runs worth repeating, model to one engine's
 * track record, and grouping lines up the runs of one prompt side by side.
 */
export default function RatingFilterBar({
  counts,
  rating,
  onRating,
  models,
  model,
  onModel,
  grouped,
  onGrouped,
  groupNote,
}: {
  counts: RatingCounts | null;
  rating: RatingFilter;
  onRating: (rating: RatingFilter) => void;
  models: ModelOption[];
  model: ModelChoice | null;
  onModel: (model: ModelChoice | null) => void;
  grouped: boolean;
  onGrouped: (grouped: boolean) => void;
  /** Said under the grouping toggle while it is on, e.g. that only one page is grouped. */
  groupNote?: string;
}) {
  const modelId = useId();
  const total = counts ? ratingFilterCount(counts, 'all') : 0;
  // Nothing to narrow in an empty library, and a row of zeros is noise.
  if (total === 0 && models.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by rating">
        {RATING_FILTERS.map((filter) => {
          const on = filter === rating;
          const count = counts ? ratingFilterCount(counts, filter) : null;
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={on}
              onClick={() => onRating(filter)}
              className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-[0.6875rem] font-semibold transition-colors motion-reduce:transition-none ${
                on
                  ? 'border-transparent bg-[var(--foreground)] text-[var(--background)]'
                  : 'border-[var(--border-hover)] text-[var(--foreground-muted)] hover:border-[var(--foreground-muted)]'
              }`}
            >
              {FILTER_LABELS[filter]}
              {count !== null && <span className="tabular-nums opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {models.length > 0 && (
          <>
            <label htmlFor={modelId} className="sr-only">
              Filter by model
            </label>
            <select
              id={modelId}
              value={model ? optionValue(model) : ''}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return onModel(null);
                const [provider, id] = JSON.parse(value) as [string, string];
                onModel({ provider, modelId: id });
              }}
              className="min-h-8 min-w-0 max-w-full flex-1 rounded-lg border border-[var(--border)] bg-[var(--background-elevated)] px-2 text-xs text-[var(--foreground)] sm:flex-none"
            >
              <option value="">All models</option>
              {models.map((option) => (
                <option key={optionValue(option)} value={optionValue(option)}>
                  {resultModelLabel({ provider: option.provider, modelId: option.modelId, mediaType: option.mediaType ?? 'image' })} · {option.provider} ({option.count})
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          aria-pressed={grouped}
          onClick={() => onGrouped(!grouped)}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors motion-reduce:transition-none ${
            grouped
              ? 'border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]'
              : 'border-[var(--border)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
          }`}
        >
          <Layers size={13} aria-hidden="true" /> Group by prompt
        </button>
      </div>
      {grouped && groupNote && <p className="text-[0.6875rem] text-[var(--foreground-subtle)]">{groupNote}</p>}
    </div>
  );
}
