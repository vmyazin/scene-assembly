import { describe, expect, it } from 'vitest';

import { countRatings, groupByPrompt, matchesRating, ratingFilterCount } from '../../lib/results/rating';

describe('matchesRating', () => {
  it('treats Good & up as both positive marks and Unrated as the absence of one', () => {
    expect(matchesRating('good', 'good-up')).toBe(true);
    expect(matchesRating('great', 'good-up')).toBe(true);
    expect(matchesRating('down', 'good-up')).toBe(false);
    expect(matchesRating(undefined, 'unrated')).toBe(true);
    expect(matchesRating('down', 'unrated')).toBe(false);
    expect(matchesRating(null, 'all')).toBe(true);
  });
});

describe('rating counts', () => {
  it('counts each pill from one tally', () => {
    const counts = countRatings(['good', 'great', 'great', 'down', undefined, null]);
    expect(counts).toEqual({ unrated: 2, down: 1, good: 1, great: 2 });
    expect(ratingFilterCount(counts, 'all')).toBe(6);
    expect(ratingFilterCount(counts, 'good-up')).toBe(3);
  });
});

describe('groupByPrompt', () => {
  it('groups one prompt run on several models, ignoring spacing and case', () => {
    const runs = [
      { id: 'a', prompt: 'A fox at dawn' },
      { id: 'b', prompt: 'Something else' },
      { id: 'c', prompt: '  a fox   AT dawn ' },
    ];

    const groups = groupByPrompt(runs, (run) => run.prompt);
    expect(groups.map((group) => group.items.map((run) => run.id))).toEqual([['a', 'c'], ['b']]);
    expect(groups[0].prompt).toBe('A fox at dawn');
  });

  it('keeps prompts that differ by a word apart, and never merges untitled results', () => {
    const groups = groupByPrompt(
      [{ prompt: 'A fox at dawn' }, { prompt: 'A fox at dusk' }, { prompt: '' }, { prompt: ' ' }],
      (run) => run.prompt
    );
    expect(groups).toHaveLength(4);
  });
});
