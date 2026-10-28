import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryGalleryStorage } from '../../lib/gallery/memory-storage';
import type { GalleryRecord, GalleryStorage } from '../../lib/gallery/storage';
import { configureGalleryStorage, useGalleryStore } from '../../store/useGalleryStore';

const MB = 1024 * 1024;

function blobOf(megabytes: number) {
  return { size: megabytes * MB } as Blob;
}

function draft(overrides: Partial<GalleryRecord> = {}) {
  return {
    kind: 'image' as const,
    prompt: 'A quiet ocean at dusk',
    provider: 'gemini',
    controlValues: { aspect_ratio: '16:9' },
    mimeType: 'image/png',
    blob: blobOf(1),
    ...overrides,
  };
}

let storage: ReturnType<typeof createMemoryGalleryStorage>;

describe('useGalleryStore', () => {
  beforeEach(() => {
    storage = createMemoryGalleryStorage();
    configureGalleryStorage(storage, { maxBytes: 10 * MB, maxCount: 4 });
    useGalleryStore.setState({ records: [], hydrated: false, storageError: null });
  });

  it('loads what durable storage already holds, newest first', async () => {
    await storage.put({ ...draft(), id: 'older', createdAt: 1, bytes: MB } as GalleryRecord);
    await storage.put({ ...draft(), id: 'newer', createdAt: 2, bytes: MB } as GalleryRecord);

    await useGalleryStore.getState().hydrate();

    expect(useGalleryStore.getState().records.map((r) => r.id)).toEqual(['newer', 'older']);
    expect(useGalleryStore.getState().hydrated).toBe(true);
  });

  it('hydrates only once, so navigating around does not re-read the database', async () => {
    const list = vi.spyOn(storage, 'list');
    await useGalleryStore.getState().hydrate();
    await useGalleryStore.getState().hydrate();

    expect(list).toHaveBeenCalledOnce();
  });

  it('survives a database that will not open', async () => {
    configureGalleryStorage({
      ...storage,
      list: () => Promise.reject(new Error('blocked')),
    } as GalleryStorage);

    await useGalleryStore.getState().hydrate();

    const state = useGalleryStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.records).toEqual([]);
    expect(state.storageError).toBe('Saved results are unavailable.');
  });

  it('persists a new result and puts it at the front', async () => {
    await useGalleryStore.getState().record(draft({ prompt: 'first' }));
    await useGalleryStore.getState().record(draft({ prompt: 'second' }));

    expect(useGalleryStore.getState().records.map((r) => r.prompt)).toEqual(['second', 'first']);
    expect(await storage.list()).toHaveLength(2);
  });

  it('carries the controls forward so a run can be restored later', async () => {
    const saved = await useGalleryStore.getState().record(
      draft({ controlValues: { aspect_ratio: '9:16', resolution: '2K' } })
    );

    expect(saved?.controlValues).toEqual({ aspect_ratio: '9:16', resolution: '2K' });
  });

  it('evicts past the budget, from durable storage as well as the index', async () => {
    for (const index of [1, 2, 3, 4, 5] as const) {
      await useGalleryStore.getState().record(
        draft({ prompt: `run ${index}`, createdAt: index })
      );
    }

    // maxCount is 4, so the oldest unpinned record goes.
    expect(useGalleryStore.getState().records.map((r) => r.prompt)).toEqual([
      'run 5',
      'run 4',
      'run 3',
      'run 2',
    ]);
    expect(storage.size()).toBe(4);
  });

  it('keeps a linked video by attaching its bytes and pinning it', async () => {
    const linked = await useGalleryStore.getState().record(
      draft({ kind: 'video', blob: undefined, sourceUrl: 'https://v3.fal.media/x.mp4' })
    );
    expect(linked?.bytes).toBe(0);

    await useGalleryStore.getState().keep(linked!.id, blobOf(6), blobOf(1));

    const kept = useGalleryStore.getState().records[0];
    expect(kept.blob?.size).toBe(6 * MB);
    expect(kept.posterBlob?.size).toBe(MB);
    expect(kept.bytes).toBe(7 * MB);
    // Asking to keep is the deliberate act that protects it.
    expect(kept.pinned).toBe(true);
    expect((await storage.get(linked!.id))?.pinned).toBe(true);
  });

  it('protects a pinned result from eviction while the rest churn', async () => {
    const first = await useGalleryStore.getState().record(draft({ prompt: 'keeper', createdAt: 1 }));
    await useGalleryStore.getState().setPinned(first!.id, true);

    for (const index of [2, 3, 4, 5, 6] as const) {
      await useGalleryStore.getState().record(draft({ prompt: `run ${index}`, createdAt: index }));
    }

    expect(useGalleryStore.getState().records.map((r) => r.prompt)).toContain('keeper');
  });

  it('reports a quota refusal instead of throwing mid-generation', async () => {
    configureGalleryStorage({
      ...storage,
      put: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
    } as GalleryStorage);

    const saved = await useGalleryStore.getState().record(draft());

    expect(saved).toBeNull();
    expect(useGalleryStore.getState().records).toEqual([]);
    expect(useGalleryStore.getState().storageError).toMatch(/out of storage/i);
  });

  it('removes and clears from durable storage too', async () => {
    const one = await useGalleryStore.getState().record(draft({ prompt: 'one' }));
    await useGalleryStore.getState().record(draft({ prompt: 'two' }));

    await useGalleryStore.getState().remove(one!.id);
    expect(useGalleryStore.getState().records.map((r) => r.prompt)).toEqual(['two']);
    expect(storage.size()).toBe(1);

    await useGalleryStore.getState().clear();
    expect(useGalleryStore.getState().records).toEqual([]);
    expect(storage.size()).toBe(0);
  });

  it('is not a persisted store: the bytes belong in IndexedDB', () => {
    expect('persist' in useGalleryStore).toBe(false);
  });

  describe('ratings', () => {
    it('pins a result rated Good or Great, so cleanup cannot take it', async () => {
      const saved = await useGalleryStore.getState().record(draft());
      await useGalleryStore.getState().setRating(saved!.id, 'great');

      const [rated] = useGalleryStore.getState().records;
      expect(rated).toMatchObject({ rating: 'great', pinned: true });
      expect((await storage.get(saved!.id))?.rating).toBe('great');
    });

    it('releases the pin on a miss, and leaves it alone when a rating is cleared', async () => {
      const saved = await useGalleryStore.getState().record(draft());
      await useGalleryStore.getState().setRating(saved!.id, 'good');
      await useGalleryStore.getState().setRating(saved!.id, null);
      expect(useGalleryStore.getState().records[0]).toMatchObject({ rating: undefined, pinned: true });

      await useGalleryStore.getState().setRating(saved!.id, 'down');
      expect(useGalleryStore.getState().records[0]).toMatchObject({ rating: 'down', pinned: false });
    });

    it('drops a miss\'s bytes before anything else when space runs out, but keeps its record', async () => {
      const miss = await useGalleryStore.getState().record(draft({ prompt: 'missed', blob: blobOf(6) }));
      await useGalleryStore.getState().setRating(miss!.id, 'down');
      await useGalleryStore.getState().record(draft({ prompt: 'newer', blob: blobOf(6) }));

      const kept = useGalleryStore.getState().records.find((r) => r.id === miss!.id);
      expect(kept).toMatchObject({ rating: 'down', bytes: 0, blob: undefined, prompt: 'missed' });
      expect((await storage.get(miss!.id))?.blob).toBeUndefined();
      expect(useGalleryStore.getState().records).toHaveLength(2);
    });
  });
});

