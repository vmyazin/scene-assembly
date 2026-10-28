/**
 * How a person judged a result, so they can find the model that worked again.
 *
 * Three marks rather than a five-star scale: comparing video models is about
 * "would I use this model for this again", and finer grades turned out to be
 * noise in the conversation that designed this. A thumbs-down is a mark in its
 * own right, not the absence of one — "this model failed at this prompt" is
 * the other half of the same memory.
 *
 * Shared by the browser library (`GalleryRecord.rating`) and the cloud library
 * (`account_assets.rating`), so both grids read and filter the same vocabulary.
 */
export const RATINGS = ['down', 'good', 'great'] as const;
export type Rating = (typeof RATINGS)[number];

export function isRating(value: unknown): value is Rating {
  return typeof value === 'string' && (RATINGS as readonly string[]).includes(value);
}

export const RATING_LABELS: Record<Rating, string> = {
  down: 'Miss',
  good: 'Good',
  great: 'Great',
};

/** What the library can narrow to. `good-up` is Good and Great together. */
export const RATING_FILTERS = ['all', 'unrated', 'down', 'good-up', 'great'] as const;
export type RatingFilter = (typeof RATING_FILTERS)[number];

export function isRatingFilter(value: unknown): value is RatingFilter {
  return typeof value === 'string' && (RATING_FILTERS as readonly string[]).includes(value);
}

export function matchesRating(rating: Rating | null | undefined, filter: RatingFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unrated':
      return !rating;
    case 'good-up':
      return rating === 'good' || rating === 'great';
    default:
      return rating === filter;
  }
}

/** Counts behind each rating pill. */
export interface RatingCounts {
  unrated: number;
  down: number;
  good: number;
  great: number;
}

export function countRatings(ratings: Iterable<Rating | null | undefined>): RatingCounts {
  const counts: RatingCounts = { unrated: 0, down: 0, good: 0, great: 0 };
  for (const rating of ratings) counts[rating ?? 'unrated'] += 1;
  return counts;
}

export function ratingFilterCount(counts: RatingCounts, filter: RatingFilter): number {
  switch (filter) {
    case 'all':
      return counts.unrated + counts.down + counts.good + counts.great;
    case 'good-up':
      return counts.good + counts.great;
    default:
      return counts[filter];
  }
}

/**
 * The key two runs of "the same prompt" share.
 *
 * Exact text after collapsing whitespace and case, nothing looser: testing one
 * prompt across models is the case this serves, and fuzzy matching would quietly
 * merge two prompts that differ by the one word being tested.
 */
export function promptKey(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface PromptGroup<T> {
  key: string;
  /** The prompt as the newest run in the group wrote it. */
  prompt: string;
  items: T[];
}

/**
 * Groups results by prompt, keeping the order they arrived in: a group sits
 * where its newest member would have, and members keep their own order.
 * Untitled results (an empty prompt) are each their own group, since an empty
 * prompt is not a shared one.
 */
export function groupByPrompt<T>(items: readonly T[], promptOf: (item: T) => string): PromptGroup<T>[] {
  const groups = new Map<string, PromptGroup<T>>();
  items.forEach((item, index) => {
    const prompt = promptOf(item);
    const key = promptKey(prompt) || `untitled-${index}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, prompt, items: [item] });
  });
  return [...groups.values()];
}

/**
 * Where a finished result's rating is kept: the browser library record it was
 * filed as, or the cloud asset it was saved as. A result on screen is a view
 * of one of these, so rating it there and in the library is the same write.
 */
export type RatingTarget = { kind: 'browser'; recordId: string } | { kind: 'cloud'; assetId: string };

/** The record id `recordFinishedJob` files a provider job under. */
export function browserJobTarget(provider: string, jobId: string): RatingTarget {
  return { kind: 'browser', recordId: `${provider}-${jobId}` };
}
