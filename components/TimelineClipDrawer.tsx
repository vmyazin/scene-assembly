'use client';

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { Library, Loader2, Plus, Trash2, Video } from 'lucide-react';

import ConfirmDialog from '@/components/ConfirmDialog';
import LibraryOverlay from '@/components/LibraryOverlay';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import type { GalleryRecord } from '@/lib/gallery/storage';
import { startRecordDrag } from '@/lib/timeline/drag';
import {
  filmstripSnapshot,
  requestFilmstrip,
  subscribeFilmstrip,
  type Filmstrip,
} from '@/lib/timeline/filmstrip';
import { formatDuration } from '@/lib/timeline/format';
import { importLocalVideos } from '@/lib/timeline/import-local';
import { posterImage } from '@/lib/timeline/poster';
import { probeDimensions } from '@/lib/timeline/probe';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useObjectUrls } from '@/lib/media/use-object-url';

interface TimelineClipDrawerProps {
  records: GalleryRecord[];
  onAdd: (recordId: string) => void;
  onDelete: (recordId: string) => void;
  /**
   * Fill the height handed to it instead of growing to fit, and scroll inside.
   * The editor shell divides a fixed viewport between three bands, so the rail
   * is given a column and has to live in it; the narrow document layout keeps
   * the capped list, where there is no budget to divide.
   */
  fill?: boolean;
}

/**
 * Probes rail rows that have bytes but no measured duration, and writes the
 * answer back to the record.
 *
 * `durationSeconds` is optional on a `GalleryRecord`: imports set it, but a
 * generated clip only carries one when the provider request happened to state a
 * duration, and anything kept before the timeline existed has none. Until now
 * the only thing that measured a file was `acquireClipMedia`, i.e. adding it to
 * the timeline — so the rail could not tell you how long a clip was until after
 * you had committed to using it, which is exactly backwards.
 *
 * It writes through the same `setDimensions` the acquisition path uses, so the
 * answer is cached on the record and every later surface (the output format
 * vote, the track's scale) gets it for free. One at a time and once per session
 * per record: this is a background nicety, not something worth opening a dozen
 * video elements at once for.
 */
const probedThisSession = new Set<string>();

/**
 * How long to wait before measuring anything. A mount has real work to do
 * first — acquiring the clips on the timeline, loading the preview's first
 * frame — and a duration in the rail is worth none of it.
 */
const PROBE_SETTLE_MS = 600;

function useRailDimensions(records: GalleryRecord[]) {
  // Records already on the timeline are excluded: `acquireClipMedia` probes
  // those and writes the same field through the same `setDimensions`. Probing
  // them here as well opened a second `<video>` over the same blob at the same
  // moment, and the preview — which is loading those very blobs — lost the
  // race and sat at `readyState: 0` on a black frame.
  const placedRecordIds = useTimelineStore((state) => state.timeline.clips);

  useEffect(() => {
    const onTimeline = new Set(placedRecordIds.map((clip) => clip.recordId));
    const pending = records.filter(
      (record) =>
        record.kind === 'video' &&
        record.blob !== undefined &&
        record.durationSeconds === undefined &&
        !onTimeline.has(record.id) &&
        !probedThisSession.has(record.id)
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const record of pending) {
          if (cancelled) return;
          // Marked before the await, not after: the effect re-runs when the
          // store updates and would otherwise queue the same record twice.
          probedThisSession.add(record.id);
          try {
            const probed = await probeDimensions(record.blob!);
            if (cancelled) return;
            await useGalleryStore.getState().setDimensions(record.id, probed);
          } catch {
            // An unreadable file is not an error to report here — the row keeps
            // the dash, and adding the clip will say so properly.
          }
        }
      })();
    }, PROBE_SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [records, placedRecordIds]);
}

/**
 * A still for a rail row when the record has no extracted poster.
 *
 * Most records do not: `posterBlob` is only derived for a kept video at
 * download time, so generated clips and anything imported showed a grey icon.
 * The frames already exist though — `lib/timeline/filmstrip.ts` decodes a strip
 * for any clip that reaches the track and caches it by *record* id — so this
 * asks for the same strip and takes its first frame. A clip already on the
 * timeline costs nothing (cache hit), and a browser that cannot decode
 * (or a test environment with no canvas) simply never produces a frame and the
 * row keeps its placeholder.
 */
function useDerivedThumbnail(record: GalleryRecord, enabled: boolean): string | undefined {
  const key = record.id;
  const strip = useSyncExternalStore<Filmstrip>(
    useCallback((listener) => subscribeFilmstrip(key, listener), [key]),
    useCallback(() => filmstripSnapshot(key), [key]),
    useCallback(() => filmstripSnapshot(key), [key])
  );

  const blob = record.blob;
  const duration = record.durationSeconds;
  useEffect(() => {
    if (!enabled || !blob || !duration) return;
    // Deferred for the same reason the probe is: the strip is decoration, and
    // decoding it the instant the editor opens competes with the preview
    // loading the very same file. A clip already on the timeline has its strip
    // requested by its track block, and this is a cache read when it lands.
    const timer = setTimeout(() => requestFilmstrip(key, blob, duration), PROBE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, key, blob, duration]);

  return enabled ? strip.frames.find(Boolean) : undefined;
}

function titleOf(record: GalleryRecord) {
  return record.slug?.replace(/-/g, ' ') || record.prompt || 'Untitled result';
}

/** A poster URL per video record that has a poster image to show. */
function usePosterUrls(records: GalleryRecord[]) {
  const posters = useMemo(() => {
    const entries = new Map<string, Blob>();
    for (const record of records) {
      const blob = posterImage(record.posterBlob);
      if (blob) entries.set(record.id, blob);
    }
    return entries;
  }, [records]);
  return useObjectUrls(posters);
}

/**
 * Bringing videos the app never generated into the library.
 *
 * Both a button and a drop target: a drag is the natural gesture for files
 * already sitting in a folder, but it is not discoverable on its own and
 * leaves no path for anyone who would rather browse.
 */
function ImportTile() {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const runImport = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setErrors([]);
    try {
      const results = await importLocalVideos(files);
      // One bad file in a multi-select must not read as a total failure, so
      // each rejection is named rather than collapsed into a single message.
      setErrors(
        results
          .filter((result) => result.status === 'rejected')
          .map((result) => `${result.fileName}: ${result.message}`)
      );
    } finally {
      setBusy(false);
    }
  };

  const { isDragging, dropProps } = useFileDrop({
    onFiles: runImport,
    onError: (message) => setErrors([message]),
    disabled: busy,
  });

  return (
    <div
      {...dropProps}
      data-testid="import-clips"
      className={`rounded-lg border border-dashed transition-colors ${
        isDragging
          ? 'border-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10'
          : 'border-[var(--border-hover)] bg-[var(--background-elevated)]/40'
      }`}
    >
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-center justify-center gap-1.5 p-2.5 text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
      >
        {busy ? (
          <Loader2 size={13} className="shrink-0 animate-spin" />
        ) : (
          <Plus size={13} className="shrink-0" />
        )}
        {busy ? 'Importing…' : 'Add files from your device'}
      </label>

      <input
        id={inputId}
        type="file"
        accept="video/*"
        multiple
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          // Reset first, or picking the same file twice in a row fires no
          // change event and the retry looks like it silently did nothing.
          event.target.value = '';
          void runImport(picked);
        }}
      />

      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 px-2.5 pb-2.5">
          {errors.map((message) => (
            <li key={message} className="text-[0.7rem] text-red-300">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The library rail: every video result, newest first, each with compact trash
 * and plus controls that remove the source from Your clips or add a timeline
 * placement. Copies GalleryGrid's card treatment rather than importing it
 * (that markup is inline there, not extracted) or reaching for MediaCard,
 * which despite its name is the picker card used elsewhere.
 */
/**
 * One row of the rail: a still, a title, its length, and the two controls that
 * take it off the shelf or put it on the timeline.
 *
 * Its own component because the still is derived per record through a
 * subscription (see `useDerivedThumbnail`), and a hook cannot live inside the
 * map that draws the list.
 */
function ClipRow({
  record,
  posterUrl,
  compact,
  onAdd,
  onRequestDelete,
}: {
  record: GalleryRecord;
  /** Object URL for the record's extracted poster, when it has one. */
  posterUrl: string | undefined;
  /**
   * Tighter controls for the shell's fixed-width rail. The 40px buttons are a
   * touch target and stay that size in the document layout, where the rail is
   * as wide as the page; in a 17rem column they leave a clip's name about
   * fifty pixels, which truncates every title to "a q…".
   */
  compact: boolean;
  onAdd: (recordId: string) => void;
  /** Asks for deletion rather than doing it: the drawer confirms first. */
  onRequestDelete: (record: GalleryRecord) => void;
}) {
  const title = titleOf(record);
  // Only asked for when there is no poster — decoding a strip to reproduce a
  // still the record already carries would be work for nothing.
  const derived = useDerivedThumbnail(record, posterUrl === undefined);
  const preview = posterUrl ?? derived;

  return (
    <li
      // Draggable straight onto the timeline, where the drop decides
      // the position. The `+` button beside it stays the keyboard
      // (and touch) route and still appends — dragging adds placement
      // to an action that was always available, rather than becoming
      // the only way to do it.
      draggable
      onDragStart={(event) => startRecordDrag(event.dataTransfer, record.id, title)}
      className="flex cursor-grab items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--background-elevated)]/60 p-2 active:cursor-grabbing"
    >
      <div
        className={`flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/40 ${
          compact ? 'w-12' : 'w-16'
        }`}
      >
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={preview} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <Video size={14} className="text-[var(--foreground-subtle)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`line-clamp-2 leading-snug text-[var(--foreground)] ${
            compact ? 'text-xs' : 'text-[0.8125rem]'
          }`}
          title={record.prompt}
        >
          {title}
        </p>
        {/* Always drawn, even before anything has measured the file:
            `formatDuration` renders an em dash for an unknown length, and a
            row that grows a line when the probe lands is a rail that reflows
            under the reader. The measurement itself is `useRailDimensions`. */}
        <p
          className={`tabular-nums text-[var(--foreground-subtle)] ${
            compact ? 'text-[0.65rem]' : 'mt-0.5 text-[0.7rem]'
          }`}
        >
          {formatDuration(record.durationSeconds)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onRequestDelete(record)}
          aria-label={`Delete ${title} from Your clips`}
          title={`Delete ${title} from Your clips`}
          style={{ padding: 0 }}
          className={`btn-secondary shrink-0 ${compact ? 'size-8' : 'size-10'}`}
        >
          <Trash2 size={compact ? 15 : 16} />
        </button>
        <button
          type="button"
          onClick={() => onAdd(record.id)}
          aria-label={`Add ${title} to the timeline`}
          title={`Add ${title} to the timeline`}
          style={{ padding: 0 }}
          className={`btn-secondary shrink-0 ${compact ? 'size-8' : 'size-10'}`}
        >
          <Plus size={compact ? 15 : 16} />
        </button>
      </div>
    </li>
  );
}

export default function TimelineClipDrawer({
  records,
  onAdd,
  onDelete,
  fill = false,
}: TimelineClipDrawerProps) {
  const clips = useMemo(
    () => records.filter((record) => record.kind === 'video').sort((a, b) => b.createdAt - a.createdAt),
    [records]
  );
  const previews = usePosterUrls(clips);
  useRailDimensions(clips);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * The clip whose deletion is being confirmed.
   *
   * This trash can and the one on a timeline block used to be the same glyph
   * doing very different things: that one takes a clip out of the sequence and
   * is undoable, this one deletes the file from this browser and is not. The
   * block's control is a cross now, and this one asks first — and says what it
   * would cost, because a record that is gone is exactly how a clip on the
   * timeline becomes `missing`, the one unavailable state with nothing to
   * re-fill it from.
   */
  const [confirmingDelete, setConfirmingDelete] = useState<GalleryRecord | null>(null);
  const placements = useTimelineStore((state) => state.timeline.clips);
  const placementCount = confirmingDelete
    ? placements.filter((clip) => clip.recordId === confirmingDelete.id).length
    : 0;

  return (
    <div
      className={
        fill
          ? 'glass-card flex h-full min-h-0 flex-col gap-3 p-3.5'
          : 'glass-card space-y-3 p-3.5'
      }
    >
      <div className="flex items-center gap-2">
        <Video size={15} className="text-[var(--neon-purple)]" />
        <h3 className="display text-sm font-semibold">Your clips</h3>
        {/* The rail scrolls inside itself now, so its length is no longer the
            cue for how much is in here. */}
        {clips.length > 0 && (
          <span className="ml-auto tabular-nums text-xs text-[var(--foreground-subtle)]">
            {clips.length}
          </span>
        )}
      </div>

      <div className="shrink-0 space-y-3">
      <ImportTile />

      {/* The rail below lists only what this browser holds. A clip generated in
          the cloud never lands there on its own, so without this the editor
          could not see the app's own default-mode output at all. */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="btn-secondary w-full"
      >
        <Library size={13} aria-hidden="true" /> Add from library
      </button>

      <LibraryOverlay
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        purpose="pick-clip"
        onAddedToTimeline={() => setPickerOpen(false)}
      />
      </div>

      <ConfirmDialog
        open={confirmingDelete !== null}
        title="Delete this clip from your library?"
        description={
          <>
            <strong>{confirmingDelete ? titleOf(confirmingDelete) : ''}</strong> is removed from
            this browser for good — there is no undo for it, and nothing to download it back
            from.
            {placementCount > 0 && (
              <>
                {' '}
                It is on this timeline {placementCount === 1 ? 'once' : `${placementCount} times`},
                and {placementCount === 1 ? 'that clip' : 'those clips'} will be left with no file
                to play or export.
              </>
            )}
          </>
        }
        confirmLabel="Delete from library"
        cancelLabel="Keep it"
        onConfirm={() => {
          onDelete(confirmingDelete!.id);
          setConfirmingDelete(null);
        }}
        onCancel={() => setConfirmingDelete(null)}
      />

      {clips.length === 0 ? (
        <p className="text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
          Generated videos are kept here automatically. Nothing yet — make one, add a file
          from your device, or pull one in from your library.
        </p>
      ) : (
        /* Capped and scrolled internally. Uncapped, a real library made this
           column thousands of pixels tall — and because it is the *first* cell
           of the workspace grid, that pushed the track and Export off screen
           entirely on narrow layouts, and left the wide column with one very
           long rail beside a short editor. `overscroll-behavior: contain`
           (from `dialog-scroll-region`) stops a flick through the rail from
           carrying on into the page underneath it. */
        <ul
          className={`dialog-scroll-region -mr-1 space-y-2 overflow-y-auto pr-1 ${
            fill ? 'min-h-0 flex-1' : 'max-h-[22rem] lg:max-h-[32rem]'
          }`}
        >
          {clips.map((record) => (
            <ClipRow
              key={record.id}
              record={record}
              posterUrl={previews.get(record.id)}
              compact={fill}
              onAdd={onAdd}
              onRequestDelete={setConfirmingDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
