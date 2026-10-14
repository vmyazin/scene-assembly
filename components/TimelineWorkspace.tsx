'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, HardDrive, RotateCcw } from 'lucide-react';

import { DEFAULT_GALLERY_BUDGET } from '@/lib/gallery/eviction';
import { deriveOutputFormat } from '@/lib/timeline/derive-output';
import { acquireClipMedia, type ClipMedia, type Unavailable } from '@/lib/timeline/acquire';
import type { RenderEngine } from '@/lib/timeline/render/port';
import { useTrackHeight } from '@/lib/timeline/use-track-height';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useTimelineStore } from '@/store/useTimelineStore';
import ConfirmDialog from '@/components/ConfirmDialog';
import TimelineClipDrawer from '@/components/TimelineClipDrawer';
import TimelineExportPanel from '@/components/TimelineExportPanel';
import TimelineList from '@/components/TimelineList';
import TimelineOutputFormat from '@/components/TimelineOutputFormat';
import TimelinePreview from '@/components/TimelinePreview';
import TimelineTrack from '@/components/TimelineTrack';
import { formatBytes } from '@/lib/format-bytes';

/**
 * The state of one placement on the timeline while its bytes are acquired.
 * Keyed by placement id (`TimelineClip.id`), not record id — the same
 * gallery record can legitimately sit on the timeline twice, and each
 * placement acquires and reports independently.
 *
 * Exported because both the horizontal track (wide screens) and the export
 * panel are views over this same map, not owners of their own copy.
 */
export type ClipState = ClipMedia | Unavailable | { status: 'loading' };

interface TimelineWorkspaceProps {
  /**
   * Test seam: fires with the current `clipStates` map whenever it changes.
   * `app/page.tsx` never passes this — `clipStates` is otherwise private to
   * this component, and a placement's acquisition can resolve after the clip
   * that started it was removed (see the abort handling in `addClip`), which
   * is only observable by inspecting the map itself, not by what ends up
   * rendered from it — a removed placement never renders regardless of
   * whether its stale write was guarded away or not.
   */
  onClipStatesChange?: (states: Record<string, ClipState>) => void;
}

export default function TimelineWorkspace({ onClipStatesChange }: TimelineWorkspaceProps = {}) {
  const records = useGalleryStore((state) => state.records);
  // Gates the restore-on-mount effect below. Resolving before the gallery has
  // hydrated would look up records in an empty store and report every clip as
  // `missing` — a confident wrong answer, worse than the unresolved state it
  // is trying to replace.
  const galleryHydrated = useGalleryStore((state) => state.hydrated);
  const clips = useTimelineStore((state) => state.timeline.clips);
  const output = useTimelineStore((state) => state.timeline.output);
  const undoLabel = useTimelineStore((state) => state.undoLabel);

  const [clipStates, setClipStates] = useState<Record<string, ClipState>>({});
  // Read synchronously on mount via the lazy initializer (never on the
  // server: this component only ever loads with `ssr: false`), then kept
  // live by the change listener below. Only matters once Task 7's horizontal
  // track exists to switch into — the vertical list is the layout that works
  // at every width regardless of this value.
  const [isWide, setIsWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

  // One AbortController per in-flight placement id. A ref, not state: it
  // must survive re-renders without itself causing one, and nothing ever
  // reads it during render — only inside event handlers and effect cleanup.
  const controllersRef = useRef(new Map<string, AbortController>());

  // The render engines available to the export panel. Starts empty — the
  // browser engine lives behind a dynamic `import()` (it pulls in mediabunny,
  // which must never sit in a top-level import per lib/timeline/render/
  // webcodecs.ts's own contract) so it is loaded once, here, the moment the
  // timeline workspace itself mounts, rather than at module scope.
  const [engines, setEngines] = useState<RenderEngine[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Browser-first order, both loaded lazily: webcodecs pulls in mediabunny
    // (never a top-level import, per that module's own contract) and the
    // server engine only ever speaks HTTP, so neither needs to sit in this
    // component's own bundle before the workspace actually mounts.
    void Promise.all([
      import('@/lib/timeline/render/webcodecs'),
      import('@/lib/timeline/render/server'),
    ]).then(([{ createWebCodecsEngine }, { createServerEngine }]) => {
      if (!cancelled) setEngines([createWebCodecsEngine(), createServerEngine()]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void useGalleryStore.getState().hydrate();
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => setIsWide(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Fires the test seam after every clipStates change.
  useEffect(() => {
    onClipStatesChange?.(clipStates);
  }, [clipStates, onClipStatesChange]);

  // Acquisition runs at add time, not export time, so a clip whose source has
  // expired reports that immediately rather than at the end of a render.
  // Each placement gets its own AbortController so removing the clip — or
  // closing the workspace — can cancel the fetch/decode in flight instead of
  // letting it land under a placement id that no longer exists.
  // Shared by adding a clip and by re-resolving one whose file was just
  // restored, so both go through exactly the same acquisition, abort handling
  // and stale-write guard rather than growing a second, subtly different copy.
  const resolveClip = useCallback(async (placementId: string, recordId: string) => {
    setClipStates((prev) => ({ ...prev, [placementId]: { status: 'loading' } }));

    // A repair can land while a previous acquisition for this placement is
    // still in flight; the older one must not overwrite the newer result.
    controllersRef.current.get(placementId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(placementId, controller);

    try {
      const result = await acquireClipMedia(recordId, { signal: controller.signal });
      // A resolution that was already in flight when the abort fired can
      // still land here even though the controller was aborted, so the
      // timeline itself — not this component's own bookkeeping — is what
      // decides whether the write is still wanted.
      const stillOnTimeline = useTimelineStore
        .getState()
        .timeline.clips.some((clip) => clip.id === placementId);
      if (!stillOnTimeline) return;
      setClipStates((prev) => (placementId in prev ? { ...prev, [placementId]: result } : prev));
    } catch (error) {
      // acquireClipMedia rethrows only AbortError (every other failure is
      // already converted to an Unavailable result) — an aborted acquisition
      // is not a failure to display, so it is dropped silently rather than
      // leaving the row stuck loading or turning it into an error row.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    } finally {
      // Only clear the slot if it is still ours — a newer resolve for this
      // placement may have replaced it while this one was awaiting.
      if (controllersRef.current.get(placementId) === controller) {
        controllersRef.current.delete(placementId);
      }
    }
  }, []);

  // `atIndex` is where a drag from the rail was dropped; the rail's own `+`
  // button omits it and appends. Acquisition is identical either way — where a
  // placement sits on the timeline has nothing to do with fetching its bytes.
  const addClip = useCallback(
    async (recordId: string, atIndex?: number) => {
      const placementId = useTimelineStore.getState().addClip(recordId, atIndex);
      await resolveClip(placementId, recordId);
    },
    [resolveClip]
  );

  /**
   * A repair fixes the gallery *record*, and the same record can sit on the
   * timeline more than once — so every placement of it is re-resolved, not
   * just the row the user happened to drop the file on. Fixing one twin and
   * leaving the other broken would be the more confusing outcome.
   */
  /**
   * Resolve clips that are on the timeline but have no acquisition state.
   *
   * The timeline persists to localStorage; `clipStates` does not, and until
   * now resolution only ever happened inside `addClip`. So every clip on a
   * reloaded timeline stayed unresolved forever — no duration, no fit
   * controls, and Export permanently disabled, with removing and re-adding
   * each clip as the only way out. This is what makes a saved timeline
   * survive a reload as something you can actually export.
   *
   * Gated on gallery hydration: `acquireClipMedia` looks records up in the
   * store, so running against an un-hydrated (empty) store would report every
   * clip as `missing`.
   */
  useEffect(() => {
    if (!galleryHydrated) return;
    for (const clip of clips) {
      // `resolveClip` writes a `loading` state synchronously, so a clip is
      // only picked up once even though this effect re-runs on every
      // clipStates change.
      if (clipStates[clip.id] || controllersRef.current.has(clip.id)) continue;
      void resolveClip(clip.id, clip.recordId);
    }
  }, [galleryHydrated, clips, clipStates, resolveClip]);

  const repairedRecord = useCallback(
    (recordId: string) => {
      useTimelineStore
        .getState()
        .timeline.clips.filter((clip) => clip.recordId === recordId)
        .forEach((clip) => void resolveClip(clip.id, recordId));
    },
    [resolveClip]
  );

  const removeClip = useCallback((clipId: string) => {
    controllersRef.current.get(clipId)?.abort();
    controllersRef.current.delete(clipId);
    useTimelineStore.getState().removeClip(clipId);
    setClipStates((prev) => {
      if (!(clipId in prev)) return prev;
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
  }, []);

  // "New" asks first: a timeline is the most expensive thing to lose here,
  // and the button sits right where a hurried click lands.
  const [confirmingNew, setConfirmingNew] = useState(false);

  // Starts a blank project. Every placement's acquisition is aborted and its
  // state dropped, not just the store's clips: a stale `loading` entry left
  // behind would make the restore effect skip that clip if the user undoes
  // this, leaving it stuck. With the map empty, undo re-resolves everything.
  const startNewProject = useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
    setClipStates({});
    useTimelineStore.getState().clear();
    setConfirmingNew(false);
  }, []);

  // Aborts whatever is still in flight when the workspace itself closes —
  // the other half of "in-flight fetches abort when the clip is removed or
  // the workspace closes" (design spec §3).
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  // Tracks the derived format to whatever is ready, as long as the user has
  // not frozen it by editing directly — applyDerivedOutput is a no-op in that
  // case, so this effect does not need to know which state it is in.
  //
  // `output.auto` is a dependency because "match clips" changes *only* that
  // flag: `matchClips` cannot recompute on its own (the store has no access to
  // clipStates), so without this the button would thaw the format and leave
  // the user's edited numbers frozen in place, which is not what it says.
  // It cannot loop: the flag stays `true` across a recompute, and React
  // compares deps by value, so a re-render caused by applyDerivedOutput does
  // not re-run this effect.
  useEffect(() => {
    const dimensions = clips
      .map((clip) => clipStates[clip.id])
      .filter((state): state is ClipMedia => state?.status === 'ready')
      .map((state) => state.dimensions);
    if (dimensions.length === 0) return;
    useTimelineStore.getState().applyDerivedOutput(deriveOutputFormat(dimensions));
  }, [clips, clipStates, output.auto]);

  const storedBytes = records.reduce((total, record) => total + record.bytes, 0);
  const budgetBytes = DEFAULT_GALLERY_BUDGET.maxBytes;
  const storagePct = Math.min(100, (storedBytes / budgetBytes) * 100);

  /**
   * Filling the budget is not a cosmetic milestone here: `lib/gallery/eviction`
   * reclaims unpinned records to stay under it, and a reclaimed record is
   * exactly how a clip on this timeline turns into `missing`. The meter read
   * the same cyan at 5% as at 99%, so the one moment it had something to say
   * was the one moment it looked identical to every other.
   */
  const storagePressure = storagePct >= 90 ? 'critical' : storagePct >= 75 ? 'high' : 'fine';
  const storageLabel = `${formatBytes(storedBytes)} of ${formatBytes(budgetBytes)} stored`;

  // The band the splitter moves. Only meaningful in the fixed shell below —
  // the narrow layout is a scrolling document, where every card is as tall as
  // it needs to be and there is no fixed budget to divide.
  const track = useTrackHeight();

  /**
   * How full the library is. It rides in the track band's head rather than the
   * app header above, which is shared with the studio — and it belongs near the
   * clips, because filling this budget is what evicts an unpinned file and turns
   * a clip on this timeline into a missing one.
   */
  const storageMeter = (
      <p
        className="hidden items-center gap-1.5 text-xs text-[var(--foreground-muted)] xl:flex"
        title={
          storagePressure === 'fine'
            ? undefined
            : 'Your library evicts unpinned files to stay under this budget, which is how a clip on the timeline goes missing. Delete what you no longer need.'
        }
      >
        <HardDrive size={13} className="text-[var(--foreground-subtle)]" aria-hidden />
        {storageLabel}
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[hsl(var(--tint)/0.14)]">
          <span
            data-storage-pressure={storagePressure}
            className={`block h-full rounded-full ${
              storagePressure === 'critical'
                ? 'bg-red-400'
                : storagePressure === 'high'
                  ? 'bg-amber-300'
                  : 'bg-[var(--neon-cyan)]'
            }`}
            style={{ width: `${storagePct}%` }}
          />
        </span>
        {/* Spelled out, not just coloured — the bar alone cannot be read by
            anyone who cannot see the colour change, and this is the point at
            which clips start disappearing. */}
        {storagePressure !== 'fine' && (
          <span className={storagePressure === 'critical' ? 'text-red-300' : 'text-amber-300'}>
            — nearly full, so unpinned files may be evicted
          </span>
        )}
      </p>
  );

  /**
   * The two controls that change the project as a whole, at the top of the
   * right column — above the format and the export, which are the other things
   * in this editor that are about the piece rather than about one clip.
   *
   * Rendered as nothing at all when neither applies: undo appears only once
   * there is something to put back, and New only once there is something to
   * clear, so an untouched timeline shows no row rather than an empty one.
   */
  const projectActions =
    undoLabel || clips.length > 0 ? (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {undoLabel && (
          <button
            type="button"
            onClick={() => useTimelineStore.getState().undo()}
            className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
          >
            <RotateCcw size={13} /> Undo {undoLabel}
          </button>
        )}
        {clips.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmingNew(true)}
            className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
          >
            <FilePlus2 size={13} /> New
          </button>
        )}
      </div>
    ) : null;

  /**
   * The editor shell.
   *
   * Three bands, and only the middle one is elastic: the bar is 52px, the track
   * is whatever the splitter says, and the viewer row takes the rest. That is
   * the whole fix for the bug this layout was drawn for — the preview used to
   * be sized by its own `max-height` inside a scrolling page, so a short
   * landscape window spent its entire height on a 16:9 frame and pushed the
   * track (the thing being edited) below the fold. Here the frame is the part
   * that gives, and the track's floor is `MIN_TRACK_HEIGHT`.
   *
   * Only at `lg`. Below that the same components go back to being a document
   * that scrolls, because three fixed bands plus a rail do not fit a phone —
   * and `TimelineList`, not `TimelineTrack`, is the layout that works there.
   */
  return (
    <div
      data-timeline-width={isWide ? 'wide' : 'narrow'}
      // `flex-1` of the route's 100dvh column, not `100dvh` itself: the shared
      // header is a band above this one, and claiming the whole viewport here
      // would push the track down by exactly the header's height.
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >

      <ConfirmDialog
        open={confirmingNew}
        title="Start a new project?"
        description={
          <>
            This removes {clips.length === 1 ? 'the clip' : `all ${clips.length} clips`} from the
            timeline and resets the output settings. Your library files stay where they are, and
            you can undo this from the bar above.
          </>
        }
        confirmLabel="Start new project"
        cancelLabel="Keep editing"
        onConfirm={startNewProject}
        onCancel={() => setConfirmingNew(false)}
      />

      {isWide ? (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)_16.5rem] gap-2.5 p-2.5">
            <TimelineClipDrawer
              fill
              records={records}
              onAdd={(recordId) => void addClip(recordId)}
              onDelete={(recordId) => void useGalleryStore.getState().remove(recordId)}
            />

            <TimelinePreview fill clips={clips} clipStates={clipStates} output={output} />

            {/* Two cards rather than one panel with a rule inside it: the
                export panel owns its own surface and swaps between seven
                states (rendering, unavailable, server fallback…), so folding
                it into a shared card would mean it could no longer be the
                thing that decides what that card looks like. */}
            <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto">
              {projectActions}
              <div className="glass-card shrink-0 p-3.5">
                <TimelineOutputFormat
                  output={output}
                  onEdit={(patch) => useTimelineStore.getState().setOutput(patch)}
                  onKeepAudioChange={(keepAudio) => useTimelineStore.getState().setKeepAudio(keepAudio)}
                  onMatchClips={() => useTimelineStore.getState().matchClips()}
                />
              </div>
              <TimelineExportPanel engines={engines} clips={clips} clipStates={clipStates} output={output} />
            </aside>
          </div>

          {/* A real separator, not a decorative grip: it is focusable and takes
              arrow keys, because a band you can only resize by dragging an
              11px strip is a band a keyboard user cannot resize at all. */}
          <div
            role="separator"
            aria-label="Resize the timeline track"
            aria-orientation="horizontal"
            aria-valuemin={track.min}
            aria-valuemax={track.max}
            aria-valuenow={track.height}
            tabIndex={0}
            data-testid="track-splitter"
            data-dragging={track.dragging ? 'true' : 'false'}
            onPointerDown={track.onPointerDown}
            onKeyDown={track.onKeyDown}
            className="group flex h-2.5 shrink-0 cursor-row-resize touch-none items-center justify-center focus-visible:outline-none"
          >
            <span
              aria-hidden
              className={`block h-[3px] w-13 rounded-full transition-colors ${
                track.dragging
                  ? 'bg-[var(--neon-cyan)]'
                  : 'bg-[hsl(var(--tint)/0.22)] group-hover:bg-[hsl(var(--tint)/0.4)] group-focus-visible:bg-[var(--neon-cyan)]'
              }`}
              style={{ width: '3.25rem' }}
            />
          </div>

          <div className="min-h-0 shrink-0 px-2.5 pb-2.5" style={{ height: track.height }}>
            <TimelineTrack
              fill
              actions={storageMeter}
              clips={clips}
              records={records}
              clipStates={clipStates}
              onRemove={removeClip}
              onRepaired={repairedRecord}
              onAdd={(recordId, atIndex) => void addClip(recordId, atIndex)}
            />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
          <TimelineClipDrawer
            records={records}
            onAdd={(recordId) => void addClip(recordId)}
            onDelete={(recordId) => void useGalleryStore.getState().remove(recordId)}
          />

          <TimelinePreview clips={clips} clipStates={clipStates} output={output} />

          <div className="glass-card p-3.5">
            <TimelineOutputFormat
              output={output}
              onEdit={(patch) => useTimelineStore.getState().setOutput(patch)}
              onKeepAudioChange={(keepAudio) => useTimelineStore.getState().setKeepAudio(keepAudio)}
              onMatchClips={() => useTimelineStore.getState().matchClips()}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {storageMeter}
            {projectActions}
          </div>

          <TimelineList
            clips={clips}
            records={records}
            clipStates={clipStates}
            onRemove={removeClip}
            onRepaired={repairedRecord}
            onAdd={(recordId, atIndex) => void addClip(recordId, atIndex)}
          />

          <TimelineExportPanel engines={engines} clips={clips} clipStates={clipStates} output={output} />
        </div>
      )}
    </div>
  );
}
