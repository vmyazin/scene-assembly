// lib/gallery/storage.ts
import type { DraftValue } from '@/lib/draft/carry-over';

export type GalleryKind = 'image' | 'video';

export interface GalleryRecord {
  id: string;
  kind: GalleryKind;
  createdAt: number;
  prompt: string;
  /** LLM-derived slug the download already uses; doubles as the card title. */
  slug?: string;
  /** Engine or provider that produced it, for the card's label. */
  provider: string;
  modelId?: string;
  inputMode?: string;
  /** Replayed onto the current model by "Restore settings". */
  controlValues: Record<string, DraftValue>;
  mimeType: string;
  /**
   * Provider URL, when there was one. fal expires outputs after seven days and
   * Kie calls its URLs temporary, so this is a preview convenience, never the
   * thing that makes a record durable.
   */
  sourceUrl?: string;
  /** The bytes. Absent for a video whose full file has not been fetched yet. */
  blob?: Blob;
  /**
   * Set when the user deliberately asked to keep this, which protects it from
   * eviction. Distinct from merely holding bytes: images are captured
   * automatically, so having a blob is not by itself a decision.
   */
  pinned?: boolean;
  /** Still frame for a kept video, derived from the same download. */
  posterBlob?: Blob;
  /** Size of whatever is actually stored, for the quota readout and eviction. */
  bytes: number;
  /** Probed once by the timeline; optional, so no IndexedDB migration is needed. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** Best-effort — only a demuxer can report it. */
  fps?: number;
  /** Seedance preview id. Optional, so an existing library needs no migration. */
  draftId?: string;
}

/**
 * Everything the gallery needs from durable storage.
 *
 * A port rather than direct IndexedDB calls because jsdom has no IndexedDB —
 * the store's logic is tested against an in-memory adapter, and the real one is
 * checked in a browser.
 */
export interface GalleryStorage {
  list(): Promise<GalleryRecord[]>;
  get(id: string): Promise<GalleryRecord | undefined>;
  put(record: GalleryRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Bytes a record occupies, counting a kept video's poster alongside it. */
export function recordBytes(record: Pick<GalleryRecord, 'blob' | 'posterBlob'>): number {
  return (record.blob?.size ?? 0) + (record.posterBlob?.size ?? 0);
}

/** Whether the bytes are held locally, rather than only linked by URL. */
export function hasBytes(record: GalleryRecord): boolean {
  return record.blob !== undefined;
}

/** Whether the user asked for this to survive; eviction must respect it. */
export function isPinned(record: GalleryRecord): boolean {
  return record.pinned === true;
}
