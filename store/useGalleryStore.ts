import { create } from 'zustand';

import { DEFAULT_GALLERY_BUDGET, planEvictions, type GalleryBudget } from '@/lib/gallery/eviction';
import { createIndexedDbGalleryStorage, isIndexedDbAvailable } from '@/lib/gallery/idb-storage';
import { createMemoryGalleryStorage } from '@/lib/gallery/memory-storage';
import { recordBytes, type GalleryRecord, type GalleryStorage } from '@/lib/gallery/storage';
import { convertImageBlob } from '@/lib/image/convert';
import type { Rating } from '@/lib/results/rating';
import { DEFAULT_QUALITY, targetFormat } from '@/lib/image/policy';
import { useAppStore } from '@/store/useAppStore';

export interface GalleryDraftRecord extends Omit<GalleryRecord, 'id' | 'createdAt' | 'bytes'> {
  id?: string;
  createdAt?: number;
  bytes?: number;
}

interface GalleryState {
  /**
   * In-memory index of what is on disk. Durability comes from IndexedDB, not
   * from zustand persist — the bytes are Blobs, which localStorage cannot hold.
   */
  records: GalleryRecord[];
  hydrated: boolean;
  /** Set when the browser refuses more data, so capture stops nagging. */
  storageError: string | null;
  hydrate: () => Promise<void>;
  /** Adds a result, evicting whatever no longer fits the budget. */
  record: (draft: GalleryDraftRecord) => Promise<GalleryRecord | null>;
  /**
   * Attaches bytes to an existing record and pins it — asking to keep something
   * is the deliberate act that protects it from eviction.
   */
  keep: (id: string, blob: Blob, posterBlob?: Blob) => Promise<void>;
  /** Protects (or releases) a record that already has bytes, such as an image. */
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  /**
   * Judges a result, or clears the judgement with `null`. Good and Great pin
   * it, because losing a result you rated to cleanup defeats the rating. A miss
   * releases the pin: you have said you do not want the file, only the memory.
   * Clearing leaves the pin as it was, since it may predate the rating.
   */
  setRating: (id: string, rating: Rating | null) => Promise<void>;
  /** Caches probed dimensions so the timeline does not re-decode on every visit. */
  setDimensions: (
    id: string,
    dims: { width?: number; height?: number; durationSeconds?: number; fps?: number }
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

let nextRecordId = 0;

/** Chosen once so tests can swap in the memory adapter before anything hydrates. */
let storage: GalleryStorage | null = null;
let budget: GalleryBudget = DEFAULT_GALLERY_BUDGET;

export function galleryStorage(): GalleryStorage {
  return (storage ??= isIndexedDbAvailable()
    ? createIndexedDbGalleryStorage()
    : createMemoryGalleryStorage());
}

/** Test seam: point the store at an adapter and budget of the caller's choosing. */
export function configureGalleryStorage(next: GalleryStorage, nextBudget?: GalleryBudget) {
  storage = next;
  budget = nextBudget ?? DEFAULT_GALLERY_BUDGET;
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

const QUOTA_MESSAGE =
  'This browser is out of storage for kept results. Remove some to keep saving.';

/**
 * The bytes the library should actually hold.
 *
 * `record` and `keep` are the only two points where bytes enter the library, so
 * converting here covers every caller — automatic image capture and each
 * provider workspace's Keep — without any of them knowing about it. Video
 * posters go through the same policy, since a poster becomes a reference image
 * via `GalleryGrid.sendAsReference`.
 *
 * This is the one irreversible conversion in the app, which is why it is
 * opt-out: once a record holds WebP the original PNG is gone for good.
 */
async function storedBlob(blob: Blob): Promise<Blob>;
async function storedBlob(blob: Blob | undefined): Promise<Blob | undefined>;
async function storedBlob(blob: Blob | undefined): Promise<Blob | undefined> {
  if (!blob) return blob;
  const { convertLibraryImages, imageFormat } = useAppStore.getState();
  if (!convertLibraryImages) return blob;

  const format = targetFormat({
    sourceMime: blob.type,
    destination: 'library',
    preference: imageFormat,
  });
  return format ? convertImageBlob(blob, format, DEFAULT_QUALITY) : blob;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  records: [],
  hydrated: false,
  storageError: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      set({ records: await galleryStorage().list(), hydrated: true });
    } catch {
      // A blocked or unavailable database must not take the studio down with it.
      set({ records: [], hydrated: true, storageError: 'Saved results are unavailable.' });
    }
  },

  record: async (draft) => {
    const stored = draft.kind === 'image' ? await storedBlob(draft.blob) : draft.blob;
    const storedPoster = await storedBlob(draft.posterBlob);
    if (stored !== draft.blob || storedPoster !== draft.posterBlob) {
      draft = {
        ...draft,
        blob: stored,
        posterBlob: storedPoster,
        mimeType: stored?.type || draft.mimeType,
        bytes: undefined,
      };
    }

    nextRecordId += 1;
    const record: GalleryRecord = {
      ...draft,
      id: draft.id ?? `result-${Date.now()}-${nextRecordId}`,
      createdAt: draft.createdAt ?? Date.now(),
      bytes: draft.bytes ?? recordBytes(draft),
    };

    try {
      await galleryStorage().put(record);
    } catch (error) {
      set({ storageError: isQuotaError(error) ? QUOTA_MESSAGE : 'Could not save this result.' });
      return null;
    }

    const plan = planEvictions([...get().records, record], budget);
    const stripped = new Map(
      plan.strip.map((miss): [string, GalleryRecord] => [
        miss.id,
        { ...miss, blob: undefined, posterBlob: undefined, bytes: 0 },
      ])
    );
    await Promise.all([
      ...plan.remove.map((stale) => galleryStorage().remove(stale.id).catch(() => {})),
      ...[...stripped.values()].map((miss) => galleryStorage().put(miss).catch(() => {})),
    ]);

    const dropped = new Set(plan.remove.map((stale) => stale.id));
    set((state) => ({
      records: [record, ...state.records]
        .filter((existing) => !dropped.has(existing.id))
        .map((existing) => stripped.get(existing.id) ?? existing),
      storageError: null,
    }));
    return stripped.get(record.id) ?? record;
  },

  keep: async (id, blob, posterBlob) => {
    const existing = get().records.find((record) => record.id === id);
    if (!existing) return;

    const stored = existing.kind === 'image' ? await storedBlob(blob) : blob;
    const storedPoster = await storedBlob(posterBlob);

    const kept: GalleryRecord = {
      ...existing,
      blob: stored,
      posterBlob: storedPoster,
      mimeType: existing.kind === 'image' ? stored?.type || existing.mimeType : existing.mimeType,
      pinned: true,
      bytes: recordBytes({ blob: stored, posterBlob: storedPoster }),
    };
    try {
      await galleryStorage().put(kept);
    } catch (error) {
      set({ storageError: isQuotaError(error) ? QUOTA_MESSAGE : 'Could not keep this result.' });
      return;
    }
    set((state) => ({
      records: state.records.map((record) => (record.id === id ? kept : record)),
      storageError: null,
    }));
  },

  setPinned: async (id, pinned) => {
    const existing = get().records.find((record) => record.id === id);
    if (!existing) return;

    const updated: GalleryRecord = { ...existing, pinned };
    try {
      await galleryStorage().put(updated);
    } catch {
      set({ storageError: 'Could not update this result.' });
      return;
    }
    set((state) => ({
      records: state.records.map((record) => (record.id === id ? updated : record)),
    }));
  },

  setRating: async (id, rating) => {
    const existing = get().records.find((record) => record.id === id);
    if (!existing) return;

    const pinned = rating === 'good' || rating === 'great' ? true : rating === 'down' ? false : existing.pinned;
    const updated: GalleryRecord = { ...existing, rating: rating ?? undefined, pinned };
    try {
      await galleryStorage().put(updated);
    } catch {
      set({ storageError: 'Could not save this rating.' });
      return;
    }
    set((state) => ({
      records: state.records.map((record) => (record.id === id ? updated : record)),
    }));
  },

  setDimensions: async (id, dims) => {
    const existing = get().records.find((record) => record.id === id);
    if (!existing) return;

    const updated: GalleryRecord = { ...existing, ...dims };
    try {
      await galleryStorage().put(updated);
    } catch {
      // Dimensions are a cache. Failing to persist them must not fail the add.
      return;
    }
    set((state) => ({
      records: state.records.map((record) => (record.id === id ? updated : record)),
    }));
  },

  remove: async (id) => {
    await galleryStorage().remove(id).catch(() => {});
    set((state) => ({ records: state.records.filter((record) => record.id !== id) }));
  },

  clear: async () => {
    await galleryStorage().clear().catch(() => {});
    set({ records: [], storageError: null });
  },
}));
