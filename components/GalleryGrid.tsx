'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Film, ImageDown, Loader2, Pin, PinOff, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { fetchResultBlob } from '@/lib/gallery/capture';
import { hasBytes, type GalleryRecord } from '@/lib/gallery/storage';
import { downloadRemoteMedia, extensionForMedia, fallbackFilenameBase } from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { extractLastFrameFromBlob } from '@/lib/video-frame';
import { LOCAL_PROVIDER } from '@/lib/timeline/import-local';
import RecoverMediaDropZone from '@/components/RecoverMediaDropZone';
import VideoPlayer from '@/components/video/VideoPlayer';
import { prepareReferences } from '@/lib/draft/ingest';
import { convertedForDownload } from '@/lib/image/download-format';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useTimelineStore } from '@/store/useTimelineStore';

/** Generous ceiling; the workspace trims to its own model's limit on mount. */
const REFERENCE_LIMIT = 8;

interface GalleryGridProps {
  mode?: 'browse' | 'pick-image' | 'pick-clip';
  onUsedReference?: () => void;
  /** Fired after a stored clip lands on the timeline, so the host can close. */
  onAddedToTimeline?: () => void;
  referenceLimit?: number;
  onPickVideo?: (file: File) => Promise<void>;
}

function titleOf(record: GalleryRecord) {
  return record.slug?.replace(/-/g, ' ') || record.prompt || 'Untitled result';
}

/**
 * Object URLs for whatever bytes each record holds, revoked when the set
 * changes. The gallery store owns the Blobs; this owns only the URLs made to
 * display them.
 *
 * Each entry says whether it is a still or a clip, because the two cannot share
 * an element: a kept video with no poster used to fall through to `record.blob`
 * and be handed to an `<img>`, which can never paint video bytes — the card
 * showed a broken image. Those records now report themselves as clips and get a
 * `<video>` instead.
 */
interface Preview {
  url: string;
  isVideo: boolean;
}

function usePreviewUrls(records: GalleryRecord[]) {
  const previews = useMemo(() => {
    const entries = new Map<string, Preview>();
    for (const record of records) {
      if (record.posterBlob) {
        entries.set(record.id, { url: URL.createObjectURL(record.posterBlob), isVideo: false });
      } else if (record.blob) {
        entries.set(record.id, {
          url: URL.createObjectURL(record.blob),
          isVideo: record.kind === 'video',
        });
      }
    }
    return entries;
  }, [records]);

  useEffect(() => {
    return () => {
      for (const preview of previews.values()) URL.revokeObjectURL(preview.url);
    };
  }, [previews]);

  return previews;
}

export default function GalleryGrid({
  mode = 'browse',
  onUsedReference,
  onAddedToTimeline,
  onPickVideo,
  referenceLimit = REFERENCE_LIMIT,
}: GalleryGridProps) {
  const records = useGalleryStore((state) => state.records);

  // Keep the filtered array stable: preview URLs are keyed to this dependency,
  // so recreating it on every picker render would revoke and rebuild every URL.
  const visibleRecords = useMemo(
    () => mode === 'pick-image'
      ? records.filter((record) => record.kind === 'image' && Boolean(record.blob))
      // A clip with no bytes cannot be placed: the timeline resolves through
      // the record's own Blob, and these records' provider links have usually
      // outlived their files by the time anyone goes looking for them.
      : mode === 'pick-clip'
        ? records.filter((record) => record.kind === 'video' && Boolean(record.blob))
        : records,
    [mode, records]
  );
  const previews = usePreviewUrls(visibleRecords);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Video records whose Keep failed because the provider URL is dead. Repair is
   * offered here rather than on every unkept video: most video records have no
   * bytes yet simply because nobody asked to keep them, and a permanent
   * "replace file" affordance on all of them would be noise. A failed download
   * is the moment the user actually learns the file is gone.
   */
  const [expiredIds, setExpiredIds] = useState<Set<string>>(new Set());

  if (visibleRecords.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">
        {mode === 'pick-image'
          ? 'No stored images yet.'
          : mode === 'pick-clip'
            ? 'No clips kept in this browser yet.'
            : 'Generated results are kept here automatically. Nothing yet.'}
      </p>
    );
  }

  const keep = async (record: GalleryRecord) => {
    if (!record.sourceUrl) return;
    setBusyId(record.id);
    try {
      // One download yields both artefacts: the clip and a still from its end.
      const blob = await fetchResultBlob(record.sourceUrl, record.kind);
      const poster =
        record.kind === 'video'
          ? await extractLastFrameFromBlob(blob).catch(() => undefined)
          : undefined;
      await useGalleryStore.getState().keep(record.id, blob, poster);
      setExpiredIds((prev) => {
        if (!prev.has(record.id)) return prev;
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
      toast.success('Pinned');
    } catch {
      if (record.kind === 'video') {
        setExpiredIds((prev) => new Set(prev).add(record.id));
        toast.error('That clip’s source is gone. You can restore it from your own copy.');
      } else {
        toast.error('This result is no longer available to keep.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const sendAsReference = async (record: GalleryRecord) => {
    // A clip's poster stands in for it, since a video is not a reference image.
    const blob = record.posterBlob ?? (record.kind === 'image' ? record.blob : undefined);
    if (!blob) {
      toast.error('Keep this clip first so its frame can be used.');
      return;
    }
    const base = record.slug || fallbackFilenameBase(record.prompt, 'image');
    const extension = mode === 'pick-image'
      ? extensionForMedia('image', blob.type || record.mimeType)
      : 'png';
    // Idempotent when the library already stores WebP; this only bites when
    // library conversion is off and the stored bytes are still PNG.
    const prepared = await prepareReferences(
      [{ file: new File([blob], `${base}.${extension}`, { type: blob.type || 'image/png' }), sourceLabel: `From ${titleOf(record)}` }],
      useAppStore.getState().imageFormat
    );
    useDraftStore.getState().addReferences(prepared, referenceLimit);
    toast.success('Added as a reference');
    onUsedReference?.();
  };

  /**
   * These bytes are already local, so there is nothing to fetch — placing is
   * the whole action. Adding through the store rather than a callback is what
   * lets the same gesture work from the main library, where the timeline
   * workspace is not mounted to receive one.
   */
  const addToTimeline = (record: GalleryRecord) => {
    if (!record.blob) {
      toast.error('Keep this clip first so it can be placed.');
      return;
    }
    useTimelineStore.getState().addClip(record.id);
    toast.success('Added to the timeline');
    onAddedToTimeline?.();
  };

  const restore = (record: GalleryRecord) => {
    const draft = useDraftStore.getState();
    draft.setPrompt(record.prompt);
    // Replayed through the same guard as a provider switch, so a control the
    // current model cannot express falls back to its default.
    draft.rememberControlValues(record.controlValues);
    toast.success('Prompt and settings restored');
    onUsedReference?.();
  };

  const download = async (record: GalleryRecord) => {
    const base = downloadFilenameBase({
      prompt: record.prompt,
      mediaType: record.kind,
      slug: record.slug,
      provider: record.provider,
      modelId: record.modelId,
    });
    const imageFormat = useAppStore.getState().imageFormat;
    if (record.blob) {
      const saved =
        record.kind === 'image'
          ? await convertedForDownload(record.blob, imageFormat)
          : record.blob;
      const url = URL.createObjectURL(saved);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${base}.${extensionForMedia(record.kind, saved.type || record.mimeType)}`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      return;
    }
    if (record.sourceUrl) {
      await downloadRemoteMedia({
        url: record.sourceUrl,
        mediaType: record.kind,
        filenameBase: base,
        mimeType: record.mimeType,
        imageFormat,
      });
    }
  };

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {visibleRecords.map((record) => {
        const preview = previews.get(record.id);
        const stored = hasBytes(record);
        const busy = busyId === record.id;

        return (
          <li
            key={record.id}
            className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/60 p-3"
          >
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black/40">
              {preview && !preview.isVideo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={preview.url} alt={titleOf(record)} className="h-full w-full object-contain" />
              ) : preview ? (
                /* A kept clip with no poster: its own bytes. */
                <VideoPlayer src={preview.url} label={titleOf(record)} reveal="always" className="h-full w-full" />
              ) : record.kind === 'video' && record.sourceUrl ? (
                <VideoPlayer src={record.sourceUrl} label={titleOf(record)} reveal="always" className="h-full w-full" />
              ) : (
                <p className="px-4 text-center text-xs text-[var(--foreground-subtle)]">
                  This result was not kept and its provider link has expired.
                </p>
              )}
            </div>

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]" title={record.prompt}>
                  {titleOf(record)}
                </p>
                <p className="text-[0.65rem] uppercase tracking-wide text-[var(--foreground-subtle)]">
                  {record.provider} · {record.kind}
                  {record.controlValues?.moderation === 'relaxed' ? ' · Relaxed' : ''}
                  {stored ? '' : ' · link only'}
                </p>
              </div>
              {mode === 'browse' && (
                <button
                  type="button"
                  onClick={() => void useGalleryStore.getState().setPinned(record.id, !record.pinned)}
                  aria-label={record.pinned ? 'Unpin result' : 'Pin result'}
                  title={record.pinned ? 'Unpin' : 'Pin to keep when storage fills'}
                  className="shrink-0 rounded-md border border-[var(--border)] p-1.5 text-[var(--foreground-muted)] hover:text-[var(--neon-cyan)]"
                >
                  {record.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                </button>
              )}
            </div>

            {mode === 'browse' && expiredIds.has(record.id) && (
              <RecoverMediaDropZone
                recordId={record.id}
                onRepaired={() =>
                  setExpiredIds((prev) => {
                    const next = new Set(prev);
                    next.delete(record.id);
                    return next;
                  })
                }
              />
            )}

            <div className="flex flex-wrap gap-1.5">
              {mode === 'pick-image' ? (
                <button
                  type="button"
                  onClick={() => void sendAsReference(record)}
                  className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs"
                >
                  <ImageDown size={13} /> Use image
                </button>
              ) : mode === 'pick-clip' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onPickVideo && record.blob) void onPickVideo(new File([record.blob], `${fallbackFilenameBase(record.prompt, 'video')}.${extensionForMedia('video', record.blob.type || record.mimeType)}`, {type: record.blob.type || record.mimeType})).catch(error => toast.error(error instanceof Error ? error.message : 'Could not select video.'));
                    else addToTimeline(record);
                  }}
                  className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs"
                >
                  <Film size={13} /> {onPickVideo ? 'Use video' : 'Add to timeline'}
                </button>
              ) : (
                <>
                  {!stored && record.sourceUrl && (
                    <button
                      type="button"
                      onClick={() => void keep(record)}
                      disabled={busy}
                      className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="animate-spin" size={13} /> : <ImageDown size={13} />}
                      {busy ? 'Keeping…' : 'Keep'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void sendAsReference(record)}
                    className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs"
                  >
                    <ImageDown size={13} /> Use as reference
                  </button>
                  {/* Only once the bytes are here: a link-only clip has nothing
                      for the timeline to resolve, and Keep sits right alongside. */}
                  {record.kind === 'video' && stored && (
                    <button
                      type="button"
                      onClick={() => {
                    if (onPickVideo && record.blob) void onPickVideo(new File([record.blob], `${fallbackFilenameBase(record.prompt, 'video')}.${extensionForMedia('video', record.blob.type || record.mimeType)}`, {type: record.blob.type || record.mimeType})).catch(error => toast.error(error instanceof Error ? error.message : 'Could not select video.'));
                    else addToTimeline(record);
                  }}
                      className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs"
                    >
                      <Film size={13} /> {onPickVideo ? 'Use video' : 'Add to timeline'}
                    </button>
                  )}
                  {/* An imported clip was never generated, so it carries no prompt
                      or settings to replay — offering the action would be a button
                      that silently does nothing. */}
                  {record.provider !== LOCAL_PROVIDER && (
                    <button
                      type="button"
                      onClick={() => restore(record)}
                      className="btn-secondary flex items-center gap-1.5 px-2 py-1 text-xs"
                    >
                      <Wand2 size={13} /> Restore settings
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void download(record)}
                    aria-label={`Download ${titleOf(record)}`}
                    className="btn-secondary px-2 py-1 text-xs"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void useGalleryStore.getState().remove(record.id)}
                    aria-label={`Remove ${titleOf(record)}`}
                    className="btn-secondary px-2 py-1 text-xs"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
