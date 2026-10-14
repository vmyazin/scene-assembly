'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';

import { resolveTrim } from '@/lib/timeline/trim';
import { formatDuration } from '@/lib/timeline/format';
import Transport from '@/components/video/Transport';
import { buildSequence, locate, type PlaybackSequence } from '@/lib/timeline/playback';
import { usePlayheadStore } from '@/store/usePlayheadStore';
import type { TimelineClip, TimelineOutput } from '@/store/useTimelineStore';
import type { ClipState } from '@/components/TimelineWorkspace';
import { useObjectUrls } from '@/lib/media/use-object-url';

interface TimelinePreviewProps {
  clips: TimelineClip[];
  clipStates: Record<string, ClipState>;
  /** The frame being exported — the shape this preview has to be, or fit is a lie. */
  output: TimelineOutput;
  /**
   * Size the frame from the height it is given rather than from a viewport
   * constant. The editor shell hands the preview an elastic band — that band is
   * what absorbs an awkward viewport ratio, and a frame capped at `60vh` inside
   * it would either overflow the band or leave it half empty.
   */
  fill?: boolean;
}

type ReadyEntry = { clip: TimelineClip; state: Extract<ClipState, { status: 'ready' }> };

/** Keeps a 9:16 sequence from pushing the controls off the screen. */
const PREVIEW_MAX_HEIGHT = '60vh';

/**
 * The sequence played as one piece rather than a stack of separate files.
 *
 * Two media elements, not one: the idle element holds the *next* clip already
 * loaded and seeked to its first frame, so a cut is a swap between two ready
 * elements instead of a load. A single element would have to fetch and decode
 * at every boundary, which is the stutter this exists to remove — and it must
 * never be given a React `key` that changes, or React tears the element down
 * and the preload dies with it.
 *
 * The frame is the output frame, and each clip sits in it under its own `fit`
 * — the two things the render actually does with a clip, so Contain and Cover
 * can be judged here rather than discovered in a downloaded file. Sound is the
 * third: the preview is audible exactly when the export will be (see
 * `exportHasSound`), because both engines carry audio now and a preview that
 * was silent by construction let a cut be approved without hearing it.
 *
 * Still not a proof of the export: cuts land on whole clips rather than at
 * exact frame boundaries. Proving that means running the render pipeline in
 * real time, which is a later slice.
 */
export default function TimelinePreview({ clips, clipStates, output, fill = false }: TimelinePreviewProps) {
  const ready = useMemo<ReadyEntry[]>(
    () =>
      clips
        .map((clip) => ({ clip, state: clipStates[clip.id] }))
        .filter((entry): entry is ReadyEntry => entry.state?.status === 'ready'),
    [clips, clipStates]
  );

  /** In/out points per clip, clamped to the source that actually arrived. */
  const trims = useMemo(() => {
    const map = new Map<string, { start: number; end: number }>();
    for (const entry of ready) {
      map.set(entry.clip.id, resolveTrim(entry.clip, entry.state.dimensions.durationSeconds));
    }
    return map;
  }, [ready]);

  const sequence: PlaybackSequence = useMemo(
    () =>
      buildSequence(
        ready.map((entry) => {
          const trim = trims.get(entry.clip.id);
          return {
            id: entry.clip.id,
            // The trimmed length, and the same one the export panel totals —
            // the two readouts cannot disagree about how long this is.
            durationSeconds: trim ? trim.end - trim.start : entry.state.dimensions.durationSeconds,
          };
        })
      ),
    [ready, trims]
  );

  // The clock outlives the clips now that it is a store: clearing the
  // timeline (or removing its tail) leaves the old position behind, and the
  // next clip to load would seek straight to that stale instant. Clamping at
  // the source — not just in the readout — keeps every consumer honest.
  useEffect(() => {
    const store = usePlayheadStore.getState();
    if (store.time > sequence.total) store.setTime(sequence.total);
  }, [sequence.total]);

  // One object URL per placement, kept until it leaves or comes back holding
  // different bytes (a repaired clip keeps its id and arrives as a new blob).
  // `loadInto` returns early until a placement's URL arrives and depends on
  // `urls`, so the slot loads on the commit after one appears.
  const placementBlobs = useMemo(
    () => new Map(ready.map((entry) => [entry.clip.id, entry.state.blob])),
    [ready]
  );
  const urls = useObjectUrls(placementBlobs);

  // Two plain refs rather than an array of them: an array built during render
  // is itself a render value, so everything reached through it reads as
  // render-scope state and mutating an element's `src` or `currentTime`
  // through it is rejected by react-hooks/immutability. A `useRef` is the
  // sanctioned escape hatch; an array of them is not.
  const slotARef = useRef<HTMLVideoElement>(null);
  const slotBRef = useRef<HTMLVideoElement>(null);
  /** Which clip each element currently holds, so a slot is never reloaded with what it already has. */
  const loadedRef = useRef<[string | null, string | null]>([null, null]);
  const [activeSlot, setActiveSlot] = useState(0);
  /**
   * Whether the viewer has asked to hear the preview. Starts off: play is one
   * click away at all times (Space, even), and a preview that makes noise the
   * first time it is touched is the wrong default on a page nobody expects
   * sound from. It is a session gesture, not part of the timeline — nothing
   * about the exported file changes with it.
   */
  const [soundOn, setSoundOn] = useState(false);
  // The playhead lives in a shared store rather than component state: the
  // track renders the same clock and scrubs it, and neither component should
  // need to know the other exists. This component stays the playback engine —
  // the only writer of `setTime`/`setPlaying`; everyone else only `seek`s.
  const globalTime = usePlayheadStore((state) => state.time);
  const playing = usePlayheadStore((state) => state.playing);

  // A fresh workspace starts at zero — the playhead is a session gesture, and
  // whatever a previous mount left in the store is not this timeline's state.
  useEffect(() => {
    usePlayheadStore.getState().reset();
    return () => usePlayheadStore.getState().reset();
  }, []);

  const position = locate(sequence, globalTime);
  /**
   * `object-fit` per slot: contain letterboxes inside the output frame, cover
   * fills and crops — the same two things the render does with a clip, so the
   * choice can be judged here instead of in a downloaded file.
   *
   * Derived from what each slot is loaded with rather than from the playhead,
   * because the idle slot is already holding the *next* clip. Reading it off
   * the playhead would frame that preloaded clip wrongly until the swap, which
   * is one visible frame of the wrong crop at every cut.
   */
  const fitClassOf = (clipId: string | null | undefined) =>
    clips.find((clip) => clip.id === clipId)?.fit === 'cover' ? 'object-cover' : 'object-contain';
  const activeClipId = position?.id ?? null;
  const nextClipId = position ? (sequence.segments[position.index + 1]?.id ?? null) : null;
  const fitForSlot = (slot: 0 | 1) =>
    fitClassOf(slot === activeSlot ? activeClipId : nextClipId);
  /**
   * Clamped for display rather than written back through state: the sequence
   * can shrink underneath the playhead (a clip is removed mid-playback) and
   * deriving keeps the readout honest without a setState-in-effect cascade.
   * `locate` already clamps internally, so the frame shown was always right —
   * it was only the clock that could read past the end.
   */
  const shownTime = Math.min(Math.max(globalTime, 0), sequence.total);

  const loadInto = useCallback(
    (slot: 0 | 1, clipId: string | null, atLocalTime = 0) => {
      const element = (slot === 0 ? slotARef : slotBRef).current;
      if (!element) return;
      if (!clipId) {
        // A slot that is already blank is left alone: `urls` now settles in an
        // effect, so emptying the timeline runs this path once for the sequence
        // change and again when the URLs go, and a second `load()` on an
        // already-empty element is work that buys nothing.
        if (loadedRef.current[slot] === null) return;
        loadedRef.current[slot] = null;
        element.pause?.();
        element.removeAttribute('src');
        // Removing the attribute alone leaves the last decoded frame painted;
        // only load() resets the element to an empty (black) frame.
        element.load?.();
        return;
      }
      const url = urls.get(clipId);
      if (!url) return;
      // Local time is time *on the timeline*; the element has to be told where
      // that is inside the source, which trimming moves.
      const inPoint = trims.get(clipId)?.start ?? 0;
      const sourceTime = inPoint + atLocalTime;
      if (loadedRef.current[slot] !== clipId) {
        loadedRef.current[slot] = clipId;
        element.src = url;
      }
      // Seeking before metadata arrives is ignored by the element, so it is
      // repeated once the element knows how long it is.
      const seek = () => {
        if (Math.abs(element.currentTime - sourceTime) > 0.05) element.currentTime = sourceTime;
      };
      seek();
      element.addEventListener('loadedmetadata', seek, { once: true });
    },
    [urls, trims]
  );

  // Keep the active element on the clip the playhead is inside, and the idle
  // element parked on whatever comes next.
  useEffect(() => {
    if (!position) {
      loadInto(0, null);
      loadInto(1, null);
      return;
    }
    const idleSlot = activeSlot === 0 ? 1 : 0;
    if (loadedRef.current[activeSlot] !== position.id) {
      loadInto(activeSlot as 0 | 1, position.id, position.localTime);
    }
    const next = sequence.segments[position.index + 1];
    loadInto(idleSlot as 0 | 1, next?.id ?? null, 0);
  }, [position, activeSlot, sequence, loadInto]);

  // Drive the scrubber from whichever element is actually playing.
  useEffect(() => {
    const element = (activeSlot === 0 ? slotARef : slotBRef).current;
    if (!element) return;
    const onTime = () => {
      const loadedId = loadedRef.current[activeSlot];
      const segment = sequence.segments.find((candidate) => candidate.id === loadedId);
      if (!segment) return;
      const trim = loadedId ? trims.get(loadedId) : undefined;
      const inPoint = trim?.start ?? 0;
      usePlayheadStore.getState().setTime(segment.start + Math.max(0, element.currentTime - inPoint));

      // A trimmed clip has to be stopped at its out-point: the element would
      // otherwise play the source's own tail, which is not on this timeline.
      //
      // Safe to reach more than once at a single cut, which the frame-rate
      // check below makes likely: `onEnded` resolves the next clip from what
      // the *element* is loaded with, not from the playhead, and that does not
      // change until the swap has re-rendered — so a repeat lands on the same
      // clip rather than advancing past it.
      if (trim && element.currentTime >= trim.end - 0.02) element.dispatchEvent(new Event('ended'));
    };
    element.addEventListener('timeupdate', onTime);

    // `timeupdate` fires about four times a second, which is fine for a
    // read-out but not for a cut: it left a trimmed clip playing up to ~250ms
    // of footage the timeline says is not there, and the overshoot was visible
    // precisely on the short trims people make. `requestVideoFrameCallback`
    // fires once per presented frame, so the out-point lands within a frame of
    // where it was set. It only runs while frames are being presented — i.e.
    // while playing — which is the only time the out-point can be crossed;
    // `timeupdate` stays for seeking and for browsers without it.
    const withFrames = element as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    let handle: number | undefined;
    if (typeof withFrames.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        onTime();
        handle = withFrames.requestVideoFrameCallback?.(onFrame);
      };
      handle = withFrames.requestVideoFrameCallback(onFrame);
    }

    return () => {
      element.removeEventListener('timeupdate', onTime);
      if (handle !== undefined) withFrames.cancelVideoFrameCallback?.(handle);
    };
  }, [activeSlot, sequence, trims]);

  // A clip ending is a swap, not a load: the idle element is already holding
  // the next clip at its first frame.
  useEffect(() => {
    const element = (activeSlot === 0 ? slotARef : slotBRef).current;
    if (!element) return;
    const onEnded = () => {
      const current = sequence.segments.find((s) => s.id === loadedRef.current[activeSlot]);
      const next = current ? sequence.segments[current.index + 1] : undefined;
      if (!next) {
        usePlayheadStore.getState().setPlaying(false);
        usePlayheadStore.getState().setTime(sequence.total);
        return;
      }
      const idleSlot = activeSlot === 0 ? 1 : 0;
      setActiveSlot(idleSlot);
      usePlayheadStore.getState().setTime(next.start);
      // `?.` on the RESULT too: jsdom's play() returns undefined, and calling
      // .catch on that throws — the method guard alone is not enough.
      const upcoming = (idleSlot === 0 ? slotARef : slotBRef).current;
      void upcoming?.play?.()?.catch?.(() => {});
    };
    element.addEventListener('ended', onEnded);
    return () => element.removeEventListener('ended', onEnded);
  }, [activeSlot, sequence]);

  const toggle = () => {
    const element = (activeSlot === 0 ? slotARef : slotBRef).current;
    if (!element || !position) return;
    if (playing) {
      element.pause?.();
      usePlayheadStore.getState().setPlaying(false);
      return;
    }
    // Restart from the top once the sequence has run out, rather than
    // refusing to play because the playhead is parked at the end.
    if (globalTime >= sequence.total) usePlayheadStore.getState().seek(0);
    void element.play?.()?.catch?.(() => {});
    usePlayheadStore.getState().setPlaying(true);
  };

  // Space is the editor's transport key, so it works anywhere in the
  // workspace — not only with the play button focused. Kept behind refs
  // because the listener is attached once while `toggle` closes over fresh
  // state every render.
  const toggleRef = useRef<() => void>(() => {});
  const hasSequenceRef = useRef(false);
  useEffect(() => {
    toggleRef.current = toggle;
    hasSequenceRef.current = sequence.segments.length > 0;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // Typing a space, or activating a focused control, must stay what it
      // is — the transport only claims the key when nothing else owns it.
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="slider"]'
        )
      ) {
        return;
      }
      // With nothing to play, space stays the browser's (page scroll).
      if (!hasSequenceRef.current) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Scrubs arrive through the store — from this component's own slider and
  // from the track alike — so both surfaces move playback identically. The
  // effect watches `seekSeq`, never `time`: the engine's own timeupdate
  // writes move `time` too, and re-seeking the element on those would fight
  // playback frame by frame.
  const seekSeq = usePlayheadStore((state) => state.seekSeq);
  const handledSeekRef = useRef(usePlayheadStore.getState().seekSeq);
  useEffect(() => {
    if (seekSeq === handledSeekRef.current) return;
    handledSeekRef.current = seekSeq;
    const target = locate(sequence, usePlayheadStore.getState().time);
    const element = (activeSlot === 0 ? slotARef : slotBRef).current;
    if (!target || !element) return;
    if (loadedRef.current[activeSlot] === target.id) {
      // The store's clock is timeline time; the element seeks in source
      // time, which the clip's in-point offsets.
      const inPoint = trims.get(target.id)?.start ?? 0;
      element.currentTime = inPoint + target.localTime;
    }
  }, [seekSeq, sequence, activeSlot, trims]);

  const pending = clips.length - ready.length;

  /**
   * Whether the exported file will carry sound — the same judgement
   * `TimelineExportPanel` makes, and deliberately the same way round: a clip
   * the probe could not answer for is assumed to have audio, because promising
   * silence and then delivering sound is the worse way to be wrong.
   *
   * This gates the whole sound control, so the preview can only ever be as
   * audible as the export is. Offering "unmute" on a timeline exported with
   * `keepAudio` off would let someone approve an edit by an audio track the
   * file they download will not contain — the exact class of lie the frame
   * ratio and per-clip fit are already here to avoid.
   */
  const exportHasSound =
    output.keepAudio && !ready.every((entry) => entry.state.hasAudio === false);
  const audible = soundOn && exportHasSound;

  return (
    <div
      className={
        fill ? 'glass-card flex h-full min-h-0 flex-col gap-2.5 p-3.5' : 'glass-card space-y-2.5 p-3.5'
      }
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="eyebrow">Preview</p>
        {sequence.segments.length > 0 && (
          <p className="text-xs text-[var(--foreground-subtle)]">
            {sequence.segments.length} {sequence.segments.length === 1 ? 'clip' : 'clips'} ·{' '}
            {formatDuration(sequence.total)}
          </p>
        )}
      </div>

      {/* The export frame, not a fixed 16:9 box: a vertical timeline previewed
          in a landscape box shows framing that no export will produce.

          Two ways to be that shape. In the document layout the frame is capped
          against the viewport, because nothing else is holding it. In the shell
          it is capped against *the band it was given*, which is what a size
          container plus `cqw`/`cqh` buy: the frame is the largest box of this
          ratio that fits the space left over, so a 9:16 timeline in a short
          landscape window comes out small and correct rather than pushing the
          track off screen. Both keep width and height derived from one ratio —
          a max-height alone would cap the height while `w-full` held the width,
          quietly turning a tall format back into a wide box. */}
      <div
        className={
          fill
            ? 'flex min-h-0 flex-1 items-center justify-center'
            : 'contents'
        }
        style={fill ? { containerType: 'size' } : undefined}
      >
      <div
        // `group` is the hover target for the transport's reveal: the bar is
        // revealed by resting on the frame, not on the bar itself.
        className={`group relative overflow-hidden rounded-lg bg-black ${fill ? '' : 'mx-auto w-full'}`}
        style={{
          aspectRatio: `${output.width} / ${output.height}`,
          ...(fill
            ? { width: `min(100cqw, calc(100cqh * ${output.width / output.height}))` }
            : {
                maxHeight: PREVIEW_MAX_HEIGHT,
                maxWidth: `calc(${PREVIEW_MAX_HEIGHT} * ${output.width} / ${output.height})`,
              }),
        }}
        data-testid="preview-frame"
      >
        {/* Only the slot on screen is ever unmuted. The idle one is holding the
            *next* clip parked at its first frame, and a preloading element that
            can make noise would play the following clip's opening over the top
            of the one being watched. */}
        <video
          ref={slotARef}
          muted={!(audible && activeSlot === 0)}
          playsInline
          preload="auto"
          data-testid="preview-slot-0"
          data-active={activeSlot === 0 ? 'true' : 'false'}
          data-fit={fitForSlot(0)}
          className={`absolute inset-0 h-full w-full ${fitForSlot(0)} ${activeSlot === 0 ? '' : 'invisible'}`}
        />
        <video
          ref={slotBRef}
          muted={!(audible && activeSlot === 1)}
          playsInline
          preload="auto"
          data-testid="preview-slot-1"
          data-active={activeSlot === 1 ? 'true' : 'false'}
          data-fit={fitForSlot(1)}
          className={`absolute inset-0 h-full w-full ${fitForSlot(1)} ${activeSlot === 1 ? '' : 'invisible'}`}
        />
        {sequence.segments.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="px-4 text-center text-[0.8125rem] text-[var(--foreground-subtle)]">
              Add a ready clip to preview your sequence.
            </p>
          </div>
        )}

        {/* The shared bar, over the frame rather than under it. This component
            stays the playback engine — it owns two elements driven by one
            clock, which is why it renders `Transport` directly instead of going
            through `VideoPlayer`, which owns a single element and its own time.

            `density="full"` rather than measured: the preview frame is always
            the large surface, and a narrow window should not silently drop the
            readout and the sound control a person is mid-decision about. */}
        {sequence.segments.length > 0 && (
          <Transport
            density="full"
            label="Preview"
            playing={playing}
            time={shownTime}
            duration={sequence.total}
            onToggle={toggle}
            toggleTitle={playing ? 'Pause (Space)' : 'Play (Space)'}
            onSeek={(seconds) => usePlayheadStore.getState().seek(seconds)}
            /* Absent, not disabled, when the export is silent: a control that
               cannot change anything is noise, and its absence is itself the
               answer — there is no sound in this timeline to hear. */
            hasAudio={exportHasSound}
            /* One level and a toggle, not a slider: `soundOn` is a session
               gesture and nothing about the exported file changes with it. */
            volume={{ level: 1, muted: !soundOn }}
            onVolume={(next) => setSoundOn(!next.muted)}
            /* The preview is not a fullscreen surface — it is a frame for
               judging cuts, and the track beside it is half the point. */
            trackOverlay={sequence.segments.slice(1).map((segment) => (
              /* Where the cuts fall, so the sequence reads as several clips
                 even though it plays as one. Light rather than cyan: cyan
                 disappears against the played portion of the track, which is
                 itself cyan, so a cut already passed would become invisible. */
              <span
                key={segment.id}
                className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-[rgba(236,245,245,0.75)]"
                style={{ left: `${(segment.start / sequence.total) * 100}%` }}
              />
            ))}
          />
        )}
      </div>
      </div>

      <p className="flex shrink-0 items-start gap-1.5 text-xs text-[var(--foreground-subtle)]">
        <Info size={12} className="mt-0.5 shrink-0" />
        {/* The caption names only what is still untrue about this preview. It
            used to say "silent" unconditionally, which stopped being right the
            moment both engines learned to carry audio: the export can have
            sound, so a preview that never does is a divergence worth naming
            rather than a property to state as fact. */}
        {pending > 0
          ? `Playing ${ready.length} of ${clips.length} clips — the rest are not ready, so this is not the full sequence.`
          : exportHasSound
            ? soundOn
              ? 'Playback only — cuts land on whole clips rather than exact frames.'
              : 'Muted — this export will keep audio, so unmute to hear what you are cutting. Cuts land on whole clips rather than exact frames.'
            : 'Silent, like this export — cuts land on whole clips rather than exact frames.'}
      </p>
    </div>
  );
}
