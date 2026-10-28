import { isMiss, isPinned, recordBytes, type GalleryRecord } from '@/lib/gallery/storage';

export interface GalleryBudget {
  /** Ceiling on stored bytes. Metadata-only records cost nothing against it. */
  maxBytes: number;
  /** Ceiling on record count, so an all-metadata gallery cannot grow forever. */
  maxCount: number;
}

/** Roughly a hundred 4K stills, or a few dozen kept clips. */
export const DEFAULT_GALLERY_BUDGET: GalleryBudget = {
  maxBytes: 500 * 1024 * 1024,
  maxCount: 500,
};

export interface EvictionPlan {
  /** Records to delete outright. */
  remove: GalleryRecord[];
  /**
   * Records judged a miss whose bytes go but whose record stays. The rating,
   * model and prompt are the part worth keeping; the file is the part a miss
   * gave up any claim to.
   */
  strip: GalleryRecord[];
}

/**
 * What to drop to get back inside the budget.
 *
 * Bytes come off misses first, newest included, and the miss stays listed as a
 * metadata record. Then the oldest unpinned records go. Pinned records are
 * evicted last and only to satisfy the count ceiling — never to free bytes,
 * since pinning was a deliberate act and the provider URL has probably expired
 * by now. Auto-captured images are not pinned, so the gallery can still reclaim
 * space from them.
 *
 * Misses are spared by the count ceiling alongside pinned records: a metadata
 * record costs nothing against the byte budget, and dropping it would erase the
 * one thing a thumbs-down was for.
 */
export function planEvictions(
  records: GalleryRecord[],
  budget: GalleryBudget = DEFAULT_GALLERY_BUDGET
): EvictionPlan {
  const oldestFirst = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const evicted = new Set<GalleryRecord>();
  const stripped = new Set<GalleryRecord>();

  let bytes = oldestFirst.reduce((total, record) => total + recordBytes(record), 0);
  if (bytes > budget.maxBytes) {
    for (const record of oldestFirst) {
      if (bytes <= budget.maxBytes) break;
      if (!isMiss(record) || isPinned(record) || recordBytes(record) === 0) continue;
      stripped.add(record);
      bytes -= recordBytes(record);
    }
    for (const record of oldestFirst) {
      if (bytes <= budget.maxBytes) break;
      if (isPinned(record) || stripped.has(record)) continue;
      evicted.add(record);
      bytes -= recordBytes(record);
    }
    // Still over only because pinned records fill it; those are the user's to remove.
  }

  let count = oldestFirst.length - evicted.size;
  if (count > budget.maxCount) {
    const protectedRecord = (record: GalleryRecord) => isPinned(record) || isMiss(record);
    for (const pass of [false, true]) {
      for (const record of oldestFirst) {
        if (count <= budget.maxCount) break;
        if (evicted.has(record) || protectedRecord(record) !== pass) continue;
        evicted.add(record);
        count -= 1;
      }
    }
  }

  return {
    remove: oldestFirst.filter((record) => evicted.has(record)),
    strip: oldestFirst.filter((record) => stripped.has(record) && !evicted.has(record)),
  };
}
