'use client';

import { useMemo, useState } from 'react';
import RecentCreationGrid from '@/components/RecentCreationGrid';
import { Download, Film, ImageDown, Loader2, Pin, PinOff, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { fetchResultBlob } from '@/lib/gallery/capture';
import { hasBytes, type GalleryRecord } from '@/lib/gallery/storage';
import { downloadRemoteMedia, extensionForMedia, fallbackFilenameBase } from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { extractLastFrameFromBlob } from '@/lib/video-frame';
import { LOCAL_PROVIDER } from '@/lib/timeline/import-local';
import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu';
import RatingControl from '@/components/RatingControl';
import RatingFilterBar, { type ModelChoice, type ModelOption } from '@/components/RatingFilterBar';
import { countRatings, groupByPrompt, matchesRating, type RatingFilter } from '@/lib/results/rating';
import { resultModelLabel, reuseRun } from '@/lib/results/reuse-run';
import RecoverMediaDropZone from '@/components/RecoverMediaDropZone';
import VideoPlayer from '@/components/video/VideoPlayer';
import FinalizeDraftButton from '@/components/FinalizeDraftButton';
import { runGuestFinalize } from '@/lib/providers/guest-finalize';
import { seedanceDraftSeconds } from '@/lib/providers/seedance-draft';
import { prepareReferences } from '@/lib/draft/ingest';
import { convertedForDownload } from '@/lib/image/download-format';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useGalleryStore } from '@/store/useGalleryStore';
import { placeClipOnTimeline } from '@/lib/timeline/place-clip';
import { saveBlobAs } from '@/lib/save-file';
import { useObjectUrls } from '@/lib/media/use-object-url';

/** Generous ceiling; the workspace trims to its own model's limit on mount. */
const REFERENCE_LIMIT = 8;

interface GalleryGridProps {
  /** Read-only home previews; full actions remain in the library overlay. */
  recent?: boolean;
  mode?: 'browse' | 'pick-image' | 'pick-clip';
  onUsedReference?: () => void;
  /** Fired after a stored clip lands on the timeline, so the host can close. */
  onAddedToTimeline?: () => void;
  referenceLimit?: number;
  onPickVideo?: (file: File) => Promise<void>;
  /**
   * Opens the studio at the workspace "Reuse settings" selected the model in.
   * Absent, reuse only loads the draft, as it did before it chose the model.
   */
  onOpenStudio?: (href: string) => void;
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

function usePreviewUrls(records: GalleryRecord[]): ReadonlyMap<string, Preview> {
  const blobs = useMemo(() => {
    const entries = new Map<string, Blob>();
    for (const record of records) {
      const blob = record.posterBlob ?? record.blob;
      if (blob) entries.set(record.id, blob);
    }
    return entries;
  }, [records]);
  const urls = useObjectUrls(blobs);
  return useMemo(() => {
    const previews = new Map<string, Preview>();
    for (const record of records) {
      const url = urls.get(record.id);
      if (url) previews.set(record.id, { url, isVideo: !record.posterBlob && record.kind === 'video' });
    }
    return previews;
  }, [records, urls]);
}

/** Every model with a record, most used first, for the model filter. */
function modelOptions(records: GalleryRecord[]): ModelOption[] {
  const options = new Map<string, ModelOption>();
  for (const record of records) {
    if (!record.modelId) continue;
    const key = `${record.provider}\u0000${record.modelId}`;
    const option = options.get(key);
    if (option) option.count += 1;
    else options.set(key, { provider: record.provider, modelId: record.modelId, mediaType: record.kind, count: 1 });
  }
  return [...options.values()].sort((a, b) => b.count - a.count);
}

export default function GalleryGrid({
  mode = 'browse',
  recent = false,
  onUsedReference,
  onAddedToTimeline,
  onPickVideo,
  onOpenStudio,
  referenceLimit = REFERENCE_LIMIT,
}: GalleryGridProps) {
  const records = useGalleryStore((state) => state.records);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [modelFilter, setModelFilter] = useState<ModelChoice | null>(null);
  const [grouped, setGrouped] = useState(false);

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
        : recent ? records.slice(0, 4) : records,
    [mode, records, recent]
  );
  // Rating and model narrow the browse library only; a picker is choosing an
  // input, and hiding unrated inputs there would hide most of them.
  const browsing = mode === 'browse';
  const shownRecords = useMemo(
    () => browsing
      ? visibleRecords.filter((record) =>
          matchesRating(record.rating, ratingFilter)
          && (!modelFilter || (record.provider === modelFilter.provider && record.modelId === modelFilter.modelId)))
      : visibleRecords,
    [browsing, visibleRecords, ratingFilter, modelFilter]
  );
  const ratingCounts = useMemo(() => countRatings(visibleRecords.map((record) => record.rating)), [visibleRecords]);
  const models = useMemo(() => modelOptions(visibleRecords), [visibleRecords]);
  const previews = usePreviewUrls(shownRecords);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Video records whose Keep failed because the provider URL is dead. Repair is
   * offered here rather than on every unkept video: most video records have no
   * bytes yet simply because nobody asked to keep them, and a permanent
   * "replace file" affordance on all of them would be noise. A failed download
   * is the moment the user actually learns the file is gone.
   */
  const [expiredIds, setExpiredIds] = useState<Set<string>>(new Set());

  if (recent) return <RecentCreationGrid items={visibleRecords.map(record => ({
    id: record.id, title: titleOf(record), provider: record.provider, kind: record.kind,
    url: previews.get(record.id)?.url ?? record.sourceUrl,
    isVideo: previews.get(record.id)?.isVideo ?? record.kind === 'video',
  }))} />;

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
  const addToTimeline = async (record: GalleryRecord) => {
    if (!record.blob) {
      toast.error('Keep this clip first so it can be placed.');
      return;
    }
    await placeClipOnTimeline(record.id);
    onAddedToTimeline?.();
  };

  const restore = (record: GalleryRecord) => {
    // Replayed through the same guard as a provider switch, so a control the
    // current model cannot express falls back to its default.
    const href = reuseRun({
      provider: record.provider,
      modelId: record.modelId,
      mediaType: record.kind,
      inputMode: record.inputMode,
      prompt: record.prompt,
      values: record.controlValues,
    });
    toast.success(href ? 'Model, prompt and settings loaded' : 'Prompt and settings loaded');
    if (href && onOpenStudio) onOpenStudio(href);
    else onUsedReference?.();
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
      saveBlobAs(saved, `${base}.${extensionForMedia(record.kind, saved.type || record.mimeType)}`);
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

  /** The ⋯ menu's two groups: other ways to use the result, then the file itself. */
  const menuSections = (record: GalleryRecord): ActionMenuItem[][] => {
    const use: ActionMenuItem[] = [];
    if (record.kind === 'video') {
      use.push({
        id: 'reference',
        label: 'Use as reference',
        description: 'Add the closing frame to the reference images',
        icon: ImageDown,
        onSelect: () => void sendAsReference(record),
      });
    }
    // An imported clip was never generated, so it carries no prompt or settings
    // to replay — offering the action would be a button that silently does nothing.
    if (record.provider !== LOCAL_PROVIDER) {
      use.push({
        id: 'reuse',
        label: 'Reuse settings',
        description: 'Select this model and load its prompt and settings',
        icon: Wand2,
        onSelect: () => restore(record),
      });
    }
    return [
      use,
      [
        {
          id: 'download',
          label: record.kind === 'video' ? 'Download video' : 'Download image',
          icon: Download,
          // A toast, because the menu that started it has already closed.
          onSelect: () => void download(record).catch(() => toast.error('This result could not be downloaded.')),
        },
        {
          id: 'remove',
          label: 'Remove',
          description: 'Delete it from this browser',
          icon: Trash2,
          onSelect: () => void useGalleryStore.getState().remove(record.id),
          danger: true,
        },
      ],
    ];
  };

  const renderCard = (record: GalleryRecord) => {
    const preview = previews.get(record.id);
    const modelLabel = resultModelLabel({ provider: record.provider, modelId: record.modelId, mediaType: record.kind });
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
              {modelLabel && <span className="text-[var(--foreground-muted)]">{modelLabel} · </span>}
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

        {mode === 'browse' && (
          <RatingControl
            value={record.rating}
            onChange={(rating) => void useGalleryStore.getState().setRating(record.id, rating)}
          />
        )}

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
              className="btn-secondary"
            >
              <ImageDown size={13} /> Use image
            </button>
          ) : mode === 'pick-clip' ? (
            <button
              type="button"
              onClick={() => {
                if (onPickVideo && record.blob) void onPickVideo(new File([record.blob], `${fallbackFilenameBase(record.prompt, 'video')}.${extensionForMedia('video', record.blob.type || record.mimeType)}`, {type: record.blob.type || record.mimeType})).catch(error => toast.error(error instanceof Error ? error.message : 'Could not select video.'));
                else void addToTimeline(record);
              }}
              className="btn-secondary"
            >
              <Film size={13} /> {onPickVideo ? 'Use video' : 'Add to timeline'}
            </button>
          ) : (
            <>
            {/* One action on the face, the rest in the ⋯ menu, the same split
                the cloud tab's cards make (`CloudAssetMenu`). Keep stays out
                beside it while the bytes are only a provider link: that link
                expires, so keeping is the one thing that cannot wait. */}
            <div className="flex w-full gap-2">
              {!stored && record.sourceUrl && (
                <button
                  type="button"
                  onClick={() => void keep(record)}
                  disabled={busy}
                  className="btn-secondary min-w-0 flex-1"
                >
                  {busy ? <Loader2 className="animate-spin" size={13} /> : <ImageDown size={13} />}
                  {busy ? 'Keeping…' : 'Keep'}
                </button>
              )}
              {/* Only once the bytes are here: a link-only clip has nothing
                  for the timeline to resolve, and Keep sits right alongside. */}
              {record.kind === 'video' ? stored && (
                <button
                  type="button"
                  onClick={() => {
                    if (onPickVideo && record.blob) void onPickVideo(new File([record.blob], `${fallbackFilenameBase(record.prompt, 'video')}.${extensionForMedia('video', record.blob.type || record.mimeType)}`, {type: record.blob.type || record.mimeType})).catch(error => toast.error(error instanceof Error ? error.message : 'Could not select video.'));
                    else void addToTimeline(record);
                  }}
                  className="btn-secondary min-w-0 flex-1"
                >
                  <Film size={13} /> {onPickVideo ? 'Use video' : 'Add to timeline'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void sendAsReference(record)}
                  className="btn-secondary min-w-0 flex-1"
                >
                  <ImageDown size={13} /> Use as reference
                </button>
              )}
              <ActionMenu label="More actions" sections={menuSections(record)} />
            </div>
            {record.draftId && record.provider === 'runware' && record.kind === 'video' && (
              <FinalizeDraftButton
                inputMode={record.inputMode ?? 'text'}
                durationSeconds={seedanceDraftSeconds(record.controlValues)}
                busy={finalizingId === record.id}
                onApprove={async () => {
                  const seconds = seedanceDraftSeconds(record.controlValues);
                  const apiKey = useAppStore.getState().runwareApiKey;
                  const inputMode = record.inputMode === 'image' || record.inputMode === 'frames' || record.inputMode === 'reference' || record.inputMode === 'edit' ? record.inputMode : 'text';
                  if (!apiKey.trim()) throw new Error('Connect your Runware key before finalizing.');
                  if (!record.draftId || seconds === undefined) throw new Error('This draft has no saved length, so it cannot be priced.');
                  setFinalizingId(record.id);
                  try {
                    await runGuestFinalize({
                      apiKey, modelId: record.modelId ?? 'bytedance:seedance@2.5', prompt: record.prompt,
                      inputMode, draftId: record.draftId, durationSeconds: seconds,
                    });
                    toast.success('1080p video ready.');
                  } finally {
                    setFinalizingId(null);
                  }
                }}
              />
            )}
            </>
          )}
        </div>
      </li>
    );
  };

  const grid = (items: GalleryRecord[]) => (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">{items.map(renderCard)}</ul>
  );

  return (
    <>
      {browsing && (
        <RatingFilterBar
          counts={ratingCounts}
          rating={ratingFilter}
          onRating={setRatingFilter}
          models={models}
          model={modelFilter}
          onModel={setModelFilter}
          grouped={grouped}
          onGrouped={setGrouped}
        />
      )}
      <div className={browsing ? 'mt-4' : undefined}>
        {shownRecords.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">Nothing matches these filters.</p>
        ) : browsing && grouped ? (
          <div className="space-y-6">
            {groupByPrompt(shownRecords, (record) => record.prompt).map((group) => (
              <section key={group.key} aria-label={`Prompt: ${group.prompt || 'Untitled'}`}>
                <h3 className="mb-2 line-clamp-2 text-sm font-medium text-[var(--foreground)]" title={group.prompt}>
                  {group.prompt || 'Untitled result'}
                  <span className="ml-2 text-xs font-normal text-[var(--foreground-subtle)]">
                    {group.items.length} {group.items.length === 1 ? 'run' : 'runs'}
                  </span>
                </h3>
                {grid(group.items)}
              </section>
            ))}
          </div>
        ) : (
          grid(shownRecords)
        )}
      </div>
    </>
  );
}
