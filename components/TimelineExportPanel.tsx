'use client';

// components/TimelineExportPanel.tsx
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Library, Loader2, UploadCloud, X } from 'lucide-react';

import {
  selectRenderEngine,
  type EngineSelection,
  type RenderEngine,
  type RenderProgress,
  type RenderRequest,
} from '@/lib/timeline/render/port';
import { acquireAll, type ClipMedia } from '@/lib/timeline/acquire';
import { formatCompactDuration } from '@/lib/timeline/format';
import { resolveTrim, trimmedDuration } from '@/lib/timeline/trim';
import { useGalleryStore } from '@/store/useGalleryStore';
import type { TimelineClip, TimelineOutput } from '@/store/useTimelineStore';
import type { ClipState } from '@/components/TimelineWorkspace';
import { formatBytes } from '@/lib/format-bytes';
import { saveBlobAs } from '@/lib/save-file';

export interface TimelineExportPanelProps {
  /**
   * Render engines in preference order — browser first, so
   * `selectRenderEngine` only reaches for the server when the browser
   * cannot do the job. The server engine does not exist yet; appending it
   * here later is the entire integration.
   */
  engines: RenderEngine[];
  clips: TimelineClip[];
  clipStates: Record<string, ClipState>;
  output: TimelineOutput;
}

function titleOf(record: { slug?: string; prompt?: string } | undefined) {
  if (!record) return 'Untitled clip';
  return record.slug?.replace(/-/g, ' ') || record.prompt || 'Untitled clip';
}

const PHASE_LABEL: Record<RenderProgress['phase'], string> = {
  preparing: 'Preparing',
  encoding: 'Encoding',
  muxing: 'Finalizing',
  uploading: 'Uploading',
};

/**
 * Timestamped so two exports in one session never collide, and kept at module
 * scope: the purity lint reads the component body as render scope and rejects a
 * `Date.now()` there, even inside an async handler.
 */
function exportFilename(): string {
  return `timeline-export-${Date.now()}.mp4`;
}

interface RenderState {
  progress: RenderProgress;
  controller: AbortController;
}

/**
 * What a finished render leaves behind.
 *
 * The panel used to have no such state: it downloaded the file and reset to the
 * Export button, so the browser's download shelf was the only evidence the
 * export had happened — no name, no size, and nothing to click if the download
 * was missed. Holding the blob is what makes Download work a second time
 * without re-encoding, and what makes saving to the library possible at all.
 */
interface CompletedExport {
  blob: Blob;
  filename: string;
  bytes: number;
  /**
   * Snapshotted, not read live: the card describes the file that was produced,
   * and the timeline underneath it can be edited the moment the export ends.
   */
  durationSeconds: number;
  sound: string;
  /** Set once the export has been kept, so the button can say so. */
  savedRecordId: string | null;
  /** Why a save could not be made — the library being full, most likely. */
  saveError: string | null;
  saving: boolean;
}

/**
 * Five states, exactly the ones design spec §7 names: the browser can
 * render, the browser can't but the server can, neither can, a render is in
 * flight, or a clip on the timeline can't be exported at all. Exactly one
 * shows at a time, in that priority order.
 */
export default function TimelineExportPanel({ engines, clips, clipStates, output }: TimelineExportPanelProps) {
  const records = useGalleryStore((state) => state.records);
  const recordsById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);

  const [render, setRender] = useState<RenderState | null>(null);
  const [completed, setCompleted] = useState<CompletedExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set after a failed browser render when the server can actually take over. */
  const [fallbackEngine, setFallbackEngine] = useState<RenderEngine | null>(null);
  const [selection, setSelection] = useState<EngineSelection | null>(null);

  const unavailableClips = clips.filter((clip) => clipStates[clip.id]?.status === 'unavailable');
  const pendingClips = clips.filter((clip) => {
    const state = clipStates[clip.id];
    return !state || state.status === 'loading';
  });
  const canProbe = clips.length > 0 && unavailableClips.length === 0 && pendingClips.length === 0;

  /**
   * Clips this browser said, at add time, that it cannot decode. That is a
   * question about the *clips*, which `VideoEncoder.isConfigSupported` — the
   * only thing the browser engine's own `unavailableReason` can ask — has no
   * way to answer. Withdrawing the engine here rather than letting the export
   * dead-end minutes in is the "offers the server engine as a next step"
   * the design spec's error handling asks for.
   */
  const undecodableNames = clips
    .filter((clip) => {
      const state = clipStates[clip.id];
      return state?.status === 'ready' && state.decodable === false;
    })
    .map((clip) => titleOf(recordsById.get(clip.recordId)));

  const decodeBlock =
    undecodableNames.length > 0
      ? `This browser cannot decode ${undecodableNames.join(', ')}.`
      : null;

  /**
   * What the button promises about sound. "Silent" is only claimed when it is
   * certain — the box is off, or every clip was probed and none of them had an
   * audio track. A clip the probe could not answer for is assumed to have
   * sound: both engines will carry it through if it does, and promising
   * silence and then delivering audio is the wrong way round to be wrong.
   */
  const soundLabel =
    output.keepAudio &&
    !clips.every((clip) => {
      const state = clipStates[clip.id];
      return state?.status === 'ready' && state.hasAudio === false;
    })
      ? 'with audio'
      : 'silent';

  const availableEngines = useMemo(
    () => (decodeBlock ? engines.filter((engine) => engine.id !== 'webcodecs') : engines),
    [engines, decodeBlock]
  );

  // A cheap signature so the probe effect only re-runs when something that
  // could change engine availability actually changed, not on every render.
  const clipsSignature = clips.map((clip) => `${clip.id}:${clip.fit}:${clipStates[clip.id]?.status}`).join('|');

  // Which engine can run this request is itself async (VideoEncoder.isConfigSupported
  // is a promise), so it is tracked in state rather than computed inline. When the
  // timeline is not currently probeable, the effect simply does not run — `selection`
  // is left as whatever it last was, and `effectiveSelection` below is what decides
  // whether that stale value is actually shown.
  useEffect(() => {
    if (!canProbe) return;
    let cancelled = false;
    const request: RenderRequest = {
      output,
      clips: clips.map((clip) => {
        const state = clipStates[clip.id];
        const trim =
          state?.status === 'ready' ? resolveTrim(clip, state.dimensions.durationSeconds) : null;
        return {
          media: state?.status === 'ready' ? state.blob : new Blob(),
          fit: clip.fit,
          ...(trim ? { trimStart: trim.start, trimEnd: trim.end } : {}),
        };
      }),
    };
    void selectRenderEngine(availableEngines, request).then((result) => {
      if (!cancelled) setSelection(result);
    });
    return () => {
      cancelled = true;
    };
    // clipsSignature stands in for `clips`/`clipStates`; `availableEngines` and
    // `output`'s fields are the rest of what the probe actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    availableEngines,
    output.width,
    output.height,
    output.fps,
    // Load-bearing: with sound on, the browser engine also has to be able to
    // encode AAC, so ticking the box can change which engine is chosen.
    output.keepAudio,
    clipsSignature,
    canProbe,
  ]);

  // Derived, not stored: when the timeline is not currently probeable the
  // last computed `selection` may be stale (it answered a question about a
  // different set of clips), so it must not be shown. The `clips.length ===
  // 0` and `unavailableClips.length > 0` branches below already return
  // before this is read, so this only actually matters for the "still
  // resolving" case just past them.
  const effectiveSelection = canProbe ? selection : null;

  const totalDuration = clips.reduce((sum, clip) => {
    const state = clipStates[clip.id];
    // Trimmed, so "Export 14s" is the length of the file this produces rather
    // than the length of the footage it was cut from.
    return state?.status === 'ready'
      ? sum + trimmedDuration(clip, state.dimensions.durationSeconds)
      : sum;
  }, 0);
  const totalUploadBytes = clips.reduce((sum, clip) => {
    const state = clipStates[clip.id];
    return state?.status === 'ready' ? sum + state.blob.size : sum;
  }, 0);

  /**
   * Export re-resolves every clip through `acquireClipMedia` before building
   * the `RenderRequest` — `clipStates` is never trusted at this point. A
   * gallery record can be removed, cleared, or evicted between adding a clip
   * and pressing Export, and provider URLs expire; a clip already holding
   * bytes resolves instantly, so this costs the happy path nothing, and
   * catches anything that vanished in between before a byte is encoded.
   */
  const runExport = async (engine: RenderEngine) => {
    setError(null);
    setFallbackEngine(null);
    // One end state at a time: this run replaces the last one rather than
    // stacking a second card describing an older file.
    setCompleted(null);
    const controller = new AbortController();
    setRender({ progress: { phase: 'preparing', completed: null }, controller });

    let request: RenderRequest | null = null;
    try {
      // `acquireAll` rather than a bare `Promise.all`: design spec §3 caps
      // acquisition at a concurrency of 3 so a large timeline neither spikes
      // memory nor hammers the CDN, and this is where the fan-out actually
      // happens. Results come back index-aligned with the ids passed in.
      const results = await acquireAll(
        clips.map((clip) => clip.recordId),
        { signal: controller.signal }
      );
      const resolved = clips.map((clip, index) => ({ clip, result: results[index] }));

      const failed = resolved.filter((entry) => entry.result.status !== 'ready');
      if (failed.length > 0) {
        const names = failed.map((entry) => titleOf(recordsById.get(entry.clip.recordId))).join(', ');
        throw new Error(
          `${failed.length} clip${failed.length === 1 ? '' : 's'} could not be exported (${names}). Remove or replace them and try again.`
        );
      }

      request = {
        output,
        clips: resolved.map((entry) => {
          const media = entry.result as ClipMedia;
          const trim = resolveTrim(entry.clip, media.dimensions.durationSeconds);
          return {
          media: media.blob,
          fit: entry.clip.fit,
          trimStart: trim.start,
          trimEnd: trim.end,
          // Both only matter to the server engine, which cannot probe the
          // files it is sent — see the field docs on `RenderRequest`.
          ...(media.hasAudio !== undefined ? { hasAudio: media.hasAudio } : {}),
          durationSeconds: trim.end - trim.start,
          // So an engine that fails on one clip can name it, rather than
          // pointing at a position the user has to count out.
          label: titleOf(recordsById.get(entry.clip.recordId)),
          };
        }),
      };

      const blob = await engine.render(request, {
        signal: controller.signal,
        onProgress: (progress) => setRender((prev) => (prev ? { ...prev, progress } : prev)),
      });

      // The download still fires on its own — that is what someone pressing
      // Export asked for. What is new is that the panel says what it produced
      // rather than snapping back as though nothing happened.
      //
      // Never written back into the gallery *automatically* — doing that would
      // double the storage cost of every export against a budget the pinning rules
      // already strain. The end state below offers a "Save to library" button
      // instead, so the cost is paid only for the exports somebody deliberately
      // keeps, and the bytes are not thrown away by the one path that has them.
      const filename = exportFilename();
      saveBlobAs(blob, filename);
      setRender(null);
      setCompleted({
        blob,
        filename,
        bytes: blob.size,
        durationSeconds: totalDuration,
        sound: soundLabel,
        savedRecordId: null,
        saveError: null,
        saving: false,
      });
    } catch (err) {
      setRender(null);
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'The export failed.');

      // A browser render that died — most often on a clip it turned out not
      // to be able to decode — must not dead-end. Ask the server engine
      // whether it could actually take over before offering it, so the
      // fallback is a real next step rather than a second failure.
      const server = engines.find((candidate) => candidate.id === 'server');
      if (engine.id === 'webcodecs' && server) {
        const probe: RenderRequest = request ?? { output, clips: [] };
        const reason = await server.unavailableReason(probe).catch(() => 'unavailable');
        if (reason === null) setFallbackEngine(server);
      }
    }
  };

  const cancel = () => render?.controller.abort();

  /**
   * Keeps the finished export in the browser library, as a pinned video.
   *
   * Pinned because eviction reclaims unpinned records to stay under the budget,
   * and an export somebody asked to keep is the last thing that should quietly
   * disappear. It goes through `useGalleryStore.record` — the one chokepoint for
   * library writes — so it lands with the same eviction, quota and storage-error
   * handling every other kept result gets.
   */
  const saveToLibrary = async () => {
    const finished = completed;
    if (!finished || finished.savedRecordId || finished.saving) return;
    setCompleted((prev) => (prev ? { ...prev, saving: true, saveError: null } : prev));

    const saved = await useGalleryStore.getState().record({
      kind: 'video',
      prompt: `Timeline export · ${formatCompactDuration(finished.durationSeconds)}`,
      slug: finished.filename.replace(/\.mp4$/, ''),
      provider: 'timeline',
      controlValues: {},
      mimeType: finished.blob.type || 'video/mp4',
      blob: finished.blob,
      // The render already knows the frame it produced, so the record does not
      // have to be probed for it later.
      width: output.width,
      height: output.height,
      fps: output.fps,
      durationSeconds: finished.durationSeconds,
      pinned: true,
    });

    setCompleted((prev) =>
      prev
        ? {
            ...prev,
            saving: false,
            savedRecordId: saved?.id ?? null,
            // `record` returns null after setting the store's own storage
            // error, which is where the quota message lives.
            saveError: saved
              ? null
              : useGalleryStore.getState().storageError ?? 'Could not save this export.',
          }
        : prev
    );
  };

  // ---- State: rendering ---------------------------------------------------
  if (render) {
    return (
      <div className="glass-card flex flex-col gap-2 p-3.5" data-testid="export-panel">
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--foreground)]">
          <Loader2 size={14} className="animate-spin text-[var(--neon-cyan)]" aria-hidden />
          {PHASE_LABEL[render.progress.phase]}
          {render.progress.completed !== null && ` · ${Math.round(render.progress.completed * 100)}%`}
        </p>
        <p className="text-xs text-[var(--foreground-subtle)]">
          {soundLabel === 'with audio'
            ? "Keeping the clips' own sound."
            : 'Exporting silently — the file has no sound.'}
        </p>
        <button type="button" onClick={cancel} className="btn-secondary self-start px-3 py-1.5 text-xs">
          <X size={13} /> Cancel
        </button>
      </div>
    );
  }

  // ---- State: finished -----------------------------------------------------
  // Above every idle branch below: the export that just finished is the most
  // important thing this panel has to say, and it outranks "add a clip" even if
  // the timeline was emptied in the meantime.
  if (completed) {
    return (
      <div className="glass-card flex flex-col gap-2.5 p-3.5" data-testid="export-panel">
        <div className="flex items-start gap-2">
          <Check size={15} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
          <div className="min-w-0 flex-1">
            {/* Announced, not just drawn: the render can take minutes and
                nobody watches the panel for the whole of it. */}
            <p role="status" className="text-[0.8125rem] font-medium text-[var(--foreground)]">
              Exported <span className="break-all">{completed.filename}</span>
            </p>
            <p className="text-xs text-[var(--foreground-subtle)]">
              {formatBytes(completed.bytes)} · {formatCompactDuration(completed.durationSeconds)} ·{' '}
              {completed.sound}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCompleted(null)}
            aria-label="Dismiss the finished export"
            title="Dismiss"
            className="shrink-0 rounded-md p-1 text-[var(--foreground-subtle)] hover:text-[var(--foreground)]"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* The browser already downloaded it once. This is for the download
              that was missed, dismissed, or sent to the wrong place — and it
              costs nothing, because the bytes are still here. */}
          <button
            type="button"
            onClick={() => saveBlobAs(completed.blob, completed.filename)}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            <Download size={13} aria-hidden /> Download
          </button>

          {completed.savedRecordId ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-300">
              <Check size={13} aria-hidden /> Saved to library
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void saveToLibrary()}
              disabled={completed.saving}
              className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {completed.saving ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Library size={13} aria-hidden />
              )}
              {completed.saving ? 'Saving…' : 'Save to library'}
            </button>
          )}
        </div>

        {completed.saveError && <p className="text-xs text-red-300">{completed.saveError}</p>}
      </div>
    );
  }

  // ---- State: clips unavailable -------------------------------------------
  if (unavailableClips.length > 0) {
    const names = unavailableClips.map((clip) => titleOf(recordsById.get(clip.recordId))).join(', ');
    return (
      <div className="glass-card flex flex-col gap-1.5 p-3.5" data-testid="export-panel">
        <button
          type="button"
          disabled
          className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={14} aria-hidden />
          Export
        </button>
        <p className="flex items-center gap-1.5 text-xs text-red-300">
          <AlertTriangle size={12} className="shrink-0" aria-hidden />
          {unavailableClips.length} clip{unavailableClips.length === 1 ? '' : 's'} can&apos;t be exported: {names}
        </p>
      </div>
    );
  }

  // ---- Nothing to export yet, or still resolving --------------------------
  if (clips.length === 0) {
    return (
      <div className="glass-card p-3.5" data-testid="export-panel">
        <button
          type="button"
          disabled
          className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={14} aria-hidden />
          Export
        </button>
        <p className="mt-1.5 text-xs text-[var(--foreground-subtle)]">Add a clip to the timeline to export.</p>
      </div>
    );
  }

  if (pendingClips.length > 0 || effectiveSelection === null) {
    return (
      <div className="glass-card p-3.5" data-testid="export-panel">
        <button
          type="button"
          disabled
          className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Loader2 size={14} className="animate-spin" aria-hidden /> Export
        </button>
      </div>
    );
  }

  const browserEngine = engines.find((engine) => engine.id === 'webcodecs') ?? null;
  const serverEngine = engines.find((engine) => engine.id === 'server') ?? null;
  const browserRejection = effectiveSelection.rejected.find((rejection) => rejection.id === 'webcodecs') ?? null;
  const serverRejection = effectiveSelection.rejected.find((rejection) => rejection.id === 'server') ?? null;

  // ---- State: browser can render -------------------------------------------
  if (effectiveSelection.chosen?.id === 'webcodecs') {
    const engine = effectiveSelection.chosen;
    return (
      <div className="glass-card flex flex-col gap-1.5 p-3.5" data-testid="export-panel">
        <button
          type="button"
          onClick={() => void runExport(engine)}
          className="btn-primary w-full justify-center"
        >
          <Download size={14} aria-hidden />
          Export {formatCompactDuration(totalDuration)} · {soundLabel}
        </button>
        {error && <p className="text-xs text-red-300">{error}</p>}
        {/* Design spec error handling: a browser decode failure names which
            clip failed and offers the server engine as a next step rather
            than dead-ending. Only shown once the server has confirmed it can
            actually run this request. */}
        {error && fallbackEngine && (
          <button
            type="button"
            onClick={() => void runExport(fallbackEngine)}
            className="btn-secondary w-full justify-center text-xs"
          >
            <UploadCloud size={13} aria-hidden />
            Export on the server instead · upload {formatBytes(totalUploadBytes)}
          </button>
        )}
      </div>
    );
  }

  // ---- State: browser cannot, server configured ----------------------------
  if (effectiveSelection.chosen?.id === 'server') {
    const engine = effectiveSelection.chosen;
    const browserReasonText =
      decodeBlock ??
      browserRejection?.reason ??
      (browserEngine ? 'The browser engine is unavailable.' : 'This browser cannot run the export directly.');
    return (
      <div className="glass-card flex flex-col gap-2 p-3.5" data-testid="export-panel">
        <p className="flex items-center gap-1.5 text-xs text-amber-300">
          <AlertTriangle size={13} className="shrink-0" aria-hidden /> {browserReasonText}
        </p>
        <button
          type="button"
          onClick={() => void runExport(engine)}
          className="btn-primary w-full justify-center"
        >
          <UploadCloud size={14} aria-hidden />
          Export {formatCompactDuration(totalDuration)} · {soundLabel} · on the server · upload {formatBytes(totalUploadBytes)}
        </button>
        <p className="text-xs text-[var(--foreground-subtle)]">
          Uploaded to render, then deleted from the server once you download it.
        </p>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  // ---- State: neither available ---------------------------------------------
  const browserReasonText =
    decodeBlock ??
    (browserEngine
      ? browserRejection?.reason ?? 'The browser engine is unavailable.'
      : 'No browser render engine is loaded.');
  const serverReasonText = serverEngine
    ? serverRejection?.reason ?? 'The server engine is unavailable.'
    : 'No server render is configured.';

  return (
    <div className="glass-card flex flex-col gap-1.5 p-3.5" data-testid="export-panel">
      <button
        type="button"
        disabled
        className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        <AlertTriangle size={14} aria-hidden />
        Export unavailable
      </button>
      <p className="text-xs text-red-300">Browser: {browserReasonText}</p>
      <p className="text-xs text-red-300">Server: {serverReasonText}</p>
    </div>
  );
}
