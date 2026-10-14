'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { AlertTriangle, Crop, GripVertical, Scan, X } from 'lucide-react';

import type { GalleryRecord } from '@/lib/gallery/storage';
import { UNDECODABLE_WARNING } from '@/lib/timeline/acquire';
import { formatDuration } from '@/lib/timeline/format';
import { carriesRecord, droppedRecordId } from '@/lib/timeline/drag';
import { reorderHint, reorderIntent } from '@/lib/timeline/reorder';
import { trimmedDuration } from '@/lib/timeline/trim';
import { posterImage } from '@/lib/timeline/poster';
import { useTimelineStore, type TimelineClip } from '@/store/useTimelineStore';
import type { ClipState } from '@/components/TimelineWorkspace';
import RecoverMediaDropZone from '@/components/RecoverMediaDropZone';
import TimelineDropZone from '@/components/TimelineDropZone';
import TimelineTrimControl from '@/components/TimelineTrimControl';

interface TimelineListProps {
  clips: TimelineClip[];
  records: GalleryRecord[];
  clipStates: Record<string, ClipState>;
  onRemove: (clipId: string) => void;
  /** Fires with the repaired record id so every placement of it re-resolves. */
  onRepaired: (recordId: string) => void;
  /**
   * Adds a clip dragged out of the rail at `atIndex`. Routed through the
   * workspace, which owns acquisition — see the same prop on TimelineTrack.
   */
  onAdd: (recordId: string, atIndex?: number) => void;
}

function titleOf(record: GalleryRecord | undefined) {
  if (!record) return 'Untitled clip';
  return record.slug?.replace(/-/g, ' ') || record.prompt || 'Untitled clip';
}

/**
 * Object URL for a single blob, revoked when it changes or the row unmounts.
 * Rows come and go individually (add/remove), so this is scoped per-row
 * rather than batched the way the drawer batches its whole list. Derives the
 * URL via `useMemo` rather than `useState`+effect, matching GalleryGrid's own
 * preview hook — an effect exists here only to revoke it, never to set it.
 */
function usePreviewUrl(blob: Blob | undefined) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

function ClipRow({
  clip,
  record,
  state,
  index,
  total,
  onRemove,
  onRepaired,
  onAdd,
}: {
  clip: TimelineClip;
  record: GalleryRecord | undefined;
  state: ClipState | undefined;
  index: number;
  total: number;
  onRemove: (clipId: string) => void;
  onRepaired: (recordId: string) => void;
  onAdd: (recordId: string, atIndex?: number) => void;
}) {
  const [draggedOver, setDraggedOver] = useState(false);
  const poster = posterImage(record?.posterBlob);
  const previewUrl = usePreviewUrl(poster);

  const handleDrop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    setDraggedOver(false);

    // A clip out of the rail inserts at this row, pushing this one down —
    // the same rule the track follows, so the gesture reads the same in both
    // layouts even though one runs sideways.
    const recordId = droppedRecordId(event.dataTransfer);
    if (recordId) {
      onAdd(recordId, index);
      return;
    }

    const draggedId = event.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== clip.id) {
      useTimelineStore.getState().moveClip(draggedId, index);
    }
  };

  const rowClass =
    'flex items-center gap-3 rounded-lg border p-2.5 transition-colors ' +
    (state?.status === 'unavailable'
      ? 'border-red-500/30 bg-red-500/5'
      : state?.status === 'ready' && !state.durable
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-[var(--border)] bg-[var(--background-elevated)]/60') +
    (draggedOver ? ' border-[var(--neon-cyan)]/60' : '') +
    ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)]';

  return (
    <li
      // The same Alt+arrow move as the track: one policy, two layouts.
      tabIndex={0}
      aria-label={reorderHint(index + 1, total, titleOf(record))}
      onKeyDown={(event) => {
        const intent = reorderIntent(event.key, event, index, total);
        if (!intent) return;
        event.preventDefault();
        useTimelineStore.getState().moveClip(clip.id, intent.toIndex);
        const element = event.currentTarget;
        requestAnimationFrame(() => element.focus());
      }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', clip.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (carriesRecord(event.dataTransfer)) event.dataTransfer.dropEffect = 'copy';
        setDraggedOver(true);
      }}
      onDragLeave={() => setDraggedOver(false)}
      onDrop={handleDrop}
      className={rowClass}
    >
      <GripVertical
        size={15}
        className="shrink-0 cursor-grab text-[var(--foreground-subtle)] active:cursor-grabbing"
        aria-hidden="true"
      />

      {/* The thumb keeps a 16:9 footprint so every row's text starts on the
          same line, but the poster inside is never cropped — a vertical clip
          shows as vertical, letterboxed. */}
      <div className="flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/40">
        {previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={previewUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-[0.65rem] text-[var(--foreground-subtle)]">No preview</span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-[0.8125rem] font-medium text-[var(--foreground)]" title={record?.prompt}>
          {titleOf(record)}
        </p>

        {state?.status === 'unavailable' && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs text-red-300">
              <AlertTriangle size={12} className="shrink-0" /> {state.message}
            </p>
            {/* `missing` means the record itself is gone from the library, so
                there is nothing left to re-fill — the only honest action is
                Remove. Every other reason is a dead or absent source, which is
                exactly what the user's own copy of the file can fix. */}
            {state.reason !== 'missing' && (
              <RecoverMediaDropZone recordId={clip.recordId} onRepaired={() => onRepaired(clip.recordId)} />
            )}
          </div>
        )}

        {state?.status === 'loading' && (
          <p className="text-xs text-[var(--foreground-subtle)]">Loading…</p>
        )}

        {state?.status === 'ready' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-[var(--foreground-muted)]">
              {formatDuration(trimmedDuration(clip, state.dimensions.durationSeconds))}
            </p>
            <div role="group" aria-label="Fit" className="flex overflow-hidden rounded-md border border-[var(--border)]">
              {(['contain', 'cover'] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  aria-pressed={clip.fit === fit}
                  onClick={() => useTimelineStore.getState().setFit(clip.id, fit)}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[0.7rem] capitalize transition-colors ${
                    clip.fit === fit
                      ? 'bg-[var(--neon-cyan)]/15 text-[var(--neon-cyan)]'
                      : 'text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {fit === 'contain' ? <Scan size={11} /> : <Crop size={11} />}
                  {fit}
                </button>
              ))}
            </div>
            <div className="w-full">
              <TimelineTrimControl clip={clip} sourceDuration={state.dimensions.durationSeconds} />
            </div>
            {!state.durable && (
              <p className="flex w-full items-center gap-1.5 text-xs text-amber-300">
                <AlertTriangle size={12} className="shrink-0" />
                {state.warning ?? 'This clip could not be saved and will not survive a reload.'}
              </p>
            )}
            {state.decodable === false && (
              <p className="flex w-full items-center gap-1.5 text-xs text-amber-300">
                <AlertTriangle size={12} className="shrink-0" />
                {UNDECODABLE_WARNING}
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onRemove(clip.id)}
        aria-label={`Remove ${titleOf(record)} from the timeline`}
        className="btn-secondary shrink-0"
      >
        {/* See TimelineTrack: a cross removes from the sequence, a trash can
            deletes the file. */}
        <X size={13} />
      </button>
    </li>
  );
}

/**
 * The vertical layout's sequence: one row per placement, reorderable by drag
 * handle. Works at every width — the horizontal track is an enhancement on
 * top of this, not a replacement for it below the lg breakpoint.
 */
export default function TimelineList({
  clips,
  records,
  clipStates,
  onRemove,
  onRepaired,
  onAdd,
}: TimelineListProps) {
  const byId = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);

  if (clips.length === 0) {
    return (
      <TimelineDropZone
        data-testid="timeline-list"
        onDropRecord={(recordId) => onAdd(recordId)}
        className="glass-card p-4 text-center"
      >
        <p className="text-[0.8125rem] text-[var(--foreground-muted)]">
          No clips yet. Drag one over from your clips, or press its + button.
        </p>
      </TimelineDropZone>
    );
  }

  return (
    <div className="space-y-2">
      <ul data-testid="timeline-list" className="space-y-2">
        {clips.map((clip, index) => (
          <ClipRow
            key={clip.id}
            clip={clip}
            record={byId.get(clip.recordId)}
            state={clipStates[clip.id]}
            index={index}
            total={clips.length}
            onRemove={onRemove}
            onRepaired={onRepaired}
            onAdd={onAdd}
          />
        ))}
      </ul>

      {/* Dropping on a row inserts above it, so appending needs a target of
          its own below the last one — the vertical counterpart to the track's
          tail zone. */}
      <TimelineDropZone
        data-testid="list-drop-end"
        onDropRecord={(recordId) => onAdd(recordId)}
        className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-center text-xs text-[var(--foreground-subtle)] transition-colors"
        activeClassName="border-[var(--neon-cyan)]/60 bg-[var(--neon-cyan)]/5 text-[var(--neon-cyan)]"
      >
        Drop a clip here to add it to the end
      </TimelineDropZone>
    </div>
  );
}
