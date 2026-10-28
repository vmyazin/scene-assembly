import { describe, expect, it } from 'vitest';

import { planEvictions, type GalleryBudget } from '../../lib/gallery/eviction';
import type { GalleryRecord } from '../../lib/gallery/storage';

const MB = 1024 * 1024;

function record(
  id: string,
  createdAt: number,
  options: { megabytes?: number; pinned?: boolean; rating?: GalleryRecord['rating'] } = {}
): GalleryRecord {
  const megabytes = options.megabytes ?? 0;
  // Bytes and pinning are independent: an auto-captured image has bytes but is
  // not pinned, and a video awaiting Keep has neither.
  const blob = megabytes > 0 ? ({ size: megabytes * MB } as Blob) : undefined;
  return {
    id,
    kind: 'image',
    createdAt,
    prompt: `prompt ${id}`,
    provider: 'gemini',
    controlValues: {},
    mimeType: 'image/png',
    blob,
    pinned: options.pinned,
    rating: options.rating,
    bytes: megabytes * MB,
  };
}

const budget: GalleryBudget = { maxBytes: 10 * MB, maxCount: 4 };

/** The records a plan deletes outright, which is all the older tests ask about. */
function selectEvictions(records: GalleryRecord[], limits: GalleryBudget) {
  return planEvictions(records, limits).remove;
}

describe('planEvictions', () => {
  it('keeps everything that fits', () => {
    const records = [record('a', 1, { megabytes: 2, pinned: true }), record('b', 2)];
    expect(selectEvictions(records, budget)).toEqual([]);
  });

  it('drops the oldest unpinned records first when over the byte ceiling', () => {
    const records = [
      record('oldest', 1, { megabytes: 6 }),
      record('middle', 2, { megabytes: 6 }),
      record('newest', 3, { megabytes: 6 }),
    ];

    // 18 MB against a 10 MB ceiling: shedding the two oldest gets under it.
    expect(selectEvictions(records, budget).map((r) => r.id)).toEqual(['oldest', 'middle']);
  });

  it('never frees bytes by evicting something the user pinned', () => {
    // Pinning was a deliberate act and the provider URL has likely expired,
    // so a pinned record is not the store's to reclaim.
    const records = [
      record('pinned', 1, { megabytes: 9, pinned: true }),
      record('auto', 2, { megabytes: 6 }),
    ];

    expect(selectEvictions(records, budget).map((r) => r.id)).toEqual(['auto']);
  });

  it('reclaims space from auto-captured images, which are not pinned', () => {
    const records = [
      record('auto-oldest', 1, { megabytes: 6 }),
      record('auto-newest', 2, { megabytes: 6 }),
    ];

    expect(selectEvictions(records, budget).map((r) => r.id)).toEqual(['auto-oldest']);
  });

  it('leaves the gallery over budget rather than discarding pinned work', () => {
    const records = [
      record('pinned-a', 1, { megabytes: 9, pinned: true }),
      record('pinned-b', 2, { megabytes: 9, pinned: true }),
    ];

    expect(selectEvictions(records, budget)).toEqual([]);
  });

  it('enforces the count ceiling even when nothing has bytes', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => record(`r${n}`, n));

    expect(selectEvictions(records, budget).map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('sheds unpinned records before pinned ones when trimming by count', () => {
    const records = [
      record('pinned-oldest', 1, { megabytes: 1, pinned: true }),
      record('auto-1', 2),
      record('auto-2', 3),
      record('pinned-newest', 4, { megabytes: 1, pinned: true }),
      record('auto-3', 5),
    ];

    expect(selectEvictions(records, { maxBytes: 10 * MB, maxCount: 3 }).map((r) => r.id)).toEqual([
      'auto-1',
      'auto-2',
    ]);
  });

  it('falls back to evicting pinned records only when nothing else is left', () => {
    const records = [1, 2, 3].map((n) => record(`pinned-${n}`, n, { megabytes: 1, pinned: true }));

    expect(selectEvictions(records, { maxBytes: 10 * MB, maxCount: 1 }).map((r) => r.id)).toEqual([
      'pinned-1',
      'pinned-2',
    ]);
  });

  it('does not reorder or mutate the list it was given', () => {
    const records = [record('b', 2), record('a', 1)];
    const snapshot = [...records];

    selectEvictions(records, budget);

    expect(records).toEqual(snapshot);
  });

  it('frees bytes from misses first, newest included, and keeps their records', () => {
    const records = [
      record('old-auto', 1, { megabytes: 4 }),
      record('miss', 2, { megabytes: 6, rating: 'down' }),
      record('new-auto', 3, { megabytes: 4 }),
    ];

    // 14 MB against 10: stripping the 6 MB miss is enough, so nothing is deleted.
    const plan = planEvictions(records, budget);
    expect(plan.strip.map((r) => r.id)).toEqual(['miss']);
    expect(plan.remove).toEqual([]);
  });

  it('removes the oldest unpinned records only once misses have given up their bytes', () => {
    const records = [
      record('old-auto', 1, { megabytes: 6 }),
      record('miss', 2, { megabytes: 2, rating: 'down' }),
      record('new-auto', 3, { megabytes: 6 }),
    ];

    const plan = planEvictions(records, budget);
    expect(plan.strip.map((r) => r.id)).toEqual(['miss']);
    expect(plan.remove.map((r) => r.id)).toEqual(['old-auto']);
  });

  it('spares misses from the count ceiling until unrated records are gone', () => {
    const records = [
      record('miss', 1, { rating: 'down' }),
      record('auto-1', 2),
      record('auto-2', 3),
    ];

    expect(planEvictions(records, { maxBytes: 10 * MB, maxCount: 2 }).remove.map((r) => r.id)).toEqual(['auto-1']);
  });
});
