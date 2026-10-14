'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Crosshair, Loader2, Play, Square, X } from 'lucide-react';
import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';
import { discardStagedSource } from '@/lib/account/staged-sources';
import { importYouTubeClip } from '@/lib/account/youtube-clips';
import { QUICK_LENGTHS, readClipDialogSettings, writeClipDialogSettings } from '@/lib/youtube/dialog-settings';
import { createClipPlayer, type ClipPlayer } from '@/lib/youtube/iframe-api';
import { formatClock, importBounds, parseClock, parseYouTubeUrl, rangeProblem, roundTenth, type ImportedClipSource } from '@/lib/youtube/clip';
import { useAccountStore } from '@/store/useAccountStore';

export interface YouTubeClipTarget { provider: string; modelId: string; modelLabel: string }

const BUTTON = 'flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:text-[var(--foreground)] disabled:opacity-50';
const ACCOUNT_CHANGED = 'Your account changed. Import the section again.';

export default function YouTubeClipDialog({ open, target, onClose, onImported }: {
  open: boolean; target: YouTubeClipTarget; onClose: () => void; onImported: (file: File, source: ImportedClipSource) => Promise<void>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<ClipPlayer | null>(null);
  const controller = useRef<AbortController | null>(null);
  const titleId = useId();
  // Remembered per browser: the last link, its range, the quick length and the save choice.
  const [remembered] = useState(readClipDialogSettings);
  const [linkText, setLinkText] = useState(remembered.link);
  const [fromText, setFromText] = useState(remembered.from);
  const [toText, setToText] = useState(remembered.to);
  const [preferredLength, setPreferredLength] = useState(remembered.length);
  const [duration, setDuration] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'preparing' | 'attaching'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(remembered.saveToLibrary);
  useEffect(() => {
    writeClipDialogSettings({ link: linkText, from: fromText, to: toText, length: preferredLength, saveToLibrary });
  }, [linkText, fromText, toText, preferredLength, saveToLibrary]);

  const link = parseYouTubeUrl(linkText);
  const videoId = link?.videoId;
  const bounds = importBounds(target);
  const from = parseClock(fromText), to = parseClock(toText);
  const problem = !bounds ? 'This model cannot edit a source video.'
    : from === undefined || to === undefined ? 'Set From and To as times in the video, to a tenth of a second.'
    : rangeProblem(from, to, bounds);
  const length = from !== undefined && to !== undefined && to > from ? roundTenth(to - from) : null;
  const busy = phase !== 'idle';
  // Closing never cancels a running import; "Cancel import" is the only way.
  const close = () => { if (!busy) onClose(); };
  useAccessibleDialog({ open, onClose: close, dialogRef: panelRef });
  useEffect(() => () => controller.current?.abort(), []);

  // Each opening starts without the last attempt's error, progress or preview loop.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setError(null); setPhase('idle'); setLooping(false); setDuration(null); }
  }

  useEffect(() => {
    const host = playerHost.current;
    if (!open || !videoId || !host) return;
    let cancelled = false;
    const mount = document.createElement('div');
    host.replaceChildren(mount);
    const readDuration = (p: ClipPlayer) => { const seconds = p.getDuration(); if (!cancelled && seconds > 0) setDuration(seconds); };
    void createClipPlayer(mount, videoId, {
      onStateChange: readDuration,
      onError: message => { if (!cancelled) setError(message); },
    }).then(created => {
      if (cancelled) { created.destroy(); return; }
      player.current = created;
      readDuration(created);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? `${cause.message} You can still type the times.` : 'The YouTube player could not load. You can still type the times.'); });
    return () => { cancelled = true; player.current?.destroy(); player.current = null; };
  }, [open, videoId]);

  // A loop only runs over a valid range; an invalid one would seek on every tick.
  const loopRange = looping && !problem && from !== undefined && to !== undefined ? { from, to } : null;
  const loopFrom = loopRange?.from, loopTo = loopRange?.to;
  useEffect(() => {
    if (loopFrom === undefined || loopTo === undefined) return;
    const timer = window.setInterval(() => { const p = player.current; if (p && p.getCurrentTime() >= loopTo) p.seekTo(loopFrom, true); }, 100);
    return () => window.clearInterval(timer);
  }, [loopFrom, loopTo]);

  function changeLink(text: string) {
    setLinkText(text); setError(null); setLooping(false);
    const next = parseYouTubeUrl(text);
    if (next && next.videoId !== videoId) {
      const start = next.startSeconds ?? 0;
      setFromText(formatClock(start));
      // A new video gets the last quick length, when that length suits the model.
      const end = preferredLength === null ? undefined : roundTenth(start + preferredLength);
      setToText(end !== undefined && bounds && !rangeProblem(start, end, bounds) ? formatClock(end) : '');
      setDuration(null);
    }
  }
  /** Why a quick length cannot be used right now, or null when it can. */
  function lengthProblem(seconds: number): string | null {
    if (from === undefined) return 'Set From first.';
    if (!bounds) return 'This model cannot edit a source video.';
    if (seconds < bounds.minSeconds || seconds > bounds.maxSeconds) return `${target.modelLabel} takes a ${bounds.minSeconds}–${bounds.maxSeconds} s source.`;
    if (duration && from + seconds > duration + 1) return 'That runs past the end of the video.';
    return null;
  }
  function pickLength(seconds: number) {
    if (from === undefined) return;
    setPreferredLength(seconds);
    setTime('to', formatClock(roundTenth(from + seconds)));
  }
  /** Edits one end of the range; a running preview stops if the range stops being valid. */
  function setTime(which: 'from' | 'to', text: string) {
    (which === 'from' ? setFromText : setToText)(text);
    if (!looping) return;
    const nextFrom = parseClock(which === 'from' ? text : fromText), nextTo = parseClock(which === 'to' ? text : toText);
    if (!bounds || nextFrom === undefined || nextTo === undefined || rangeProblem(nextFrom, nextTo, bounds)) { setLooping(false); player.current?.pauseVideo(); }
  }
  const mark = (which: 'from' | 'to') => { const p = player.current; if (p) setTime(which, formatClock(p.getCurrentTime())); };
  function preview() {
    const p = player.current;
    if (looping) { setLooping(false); p?.pauseVideo(); return; }
    if (!p || from === undefined) return;
    p.seekTo(from, true); p.playVideo(); setLooping(true);
  }

  async function submit() {
    if (!link || problem || from === undefined || to === undefined) return;
    const { session, epoch } = useAccountStore.getState();
    const owner = session?.account?.id;
    if (!owner) { setError('Sign in to import a clip.'); return; }
    const abort = new AbortController();
    controller.current = abort;
    setError(null); setPhase('fetching'); setLooping(false); player.current?.pauseVideo();
    // Switching accounts stops the download instead of letting it run on unseen.
    let switched = false, attaching = false;
    const unsubscribe = useAccountStore.subscribe(state => {
      if (state.epoch !== epoch && !attaching) { switched = true; abort.abort(); }
    });
    try {
      const { file, source } = await importYouTubeClip({ url: linkText, startSeconds: from, endSeconds: to, provider: target.provider, modelId: target.modelId, saveToLibrary }, abort.signal, owner, () => setPhase('preparing'));
      // A clip imported for one account never attaches after a switch to another.
      if (switched || useAccountStore.getState().epoch !== epoch) { discardStagedSource(file); setError(ACCOUNT_CHANGED); return; }
      attaching = true; setPhase('attaching');
      await onImported(file, source);
      onClose();
    } catch (cause) {
      setError(switched ? ACCOUNT_CHANGED : abort.signal.aborted && !attaching ? 'Import cancelled.' : cause instanceof Error ? cause.message : 'The clip could not be imported.');
    } finally {
      unsubscribe();
      if (controller.current === abort) controller.current = null;
      setPhase('idle');
    }
  }

  const percent = (seconds: number | undefined) => duration && seconds !== undefined ? `${Math.min(100, (seconds / duration) * 100)}%` : '0%';
  const timeField = (which: 'from' | 'to') => {
    const label = which === 'from' ? 'From' : 'To', setLabel = which === 'from' ? 'Set start' : 'Set end';
    return <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs sm:flex-none">
      <span aria-hidden="true">{label}</span>
      <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--neon-cyan)]/60">
        <input aria-label={label} value={which === 'from' ? fromText : toText} onChange={event => setTime(which, event.target.value)} disabled={busy} inputMode="decimal" placeholder={which === 'to' ? 'm:ss.s' : undefined}
          className="w-full min-w-0 shadow-none! outline-none sm:w-24" />
        <button type="button" aria-label={setLabel} title="Use the player\u2019s current time" disabled={busy} onClick={() => mark(which)}
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 px-2 text-[var(--foreground-muted)] enabled:hover:text-[var(--foreground)] disabled:opacity-50">
          <Crosshair size={16} aria-hidden="true" /><span className="hidden text-sm sm:inline">{setLabel}</span>
        </button>
      </div>
    </div>;
  };
  return <DialogPortal>{open && (
    // A bottom sheet on phones, sized to its content; a centred card from `sm` up.
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-4" onClick={close}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}
        className="glass-card flex max-h-[100dvh] w-full max-w-2xl flex-col gap-3 overflow-y-auto p-3 sm:max-h-[90vh] sm:gap-4 sm:p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="display text-base font-semibold sm:text-lg">Import a section from YouTube</h2>
          <button type="button" aria-label="Close" onClick={close} disabled={busy} className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[var(--foreground-muted)] enabled:hover:text-[var(--foreground)] disabled:opacity-50"><X size={18} /></button>
        </div>
        <input aria-label="YouTube link" value={linkText} onChange={event => changeLink(event.target.value)} disabled={busy} inputMode="url" placeholder="Paste a YouTube link" className="w-full" />
        {linkText.trim() && !link && <p role="alert" className="text-sm text-red-300">Paste a YouTube video or Shorts link.</p>}
        {link && <>
          <div ref={playerHost} data-testid="youtube-player" className="aspect-video w-full overflow-hidden rounded-xl bg-black [&_iframe]:h-full [&_iframe]:w-full" />
          <div className="flex items-center gap-2">
            <div className="relative h-1.5 flex-1 rounded-full bg-[var(--border)]" aria-hidden="true">
              {duration && from !== undefined && to !== undefined && to > from && <div className="absolute inset-y-0 rounded-full bg-[var(--neon-cyan)]" style={{ left: percent(from), width: `calc(${percent(to)} - ${percent(from)})` }} />}
            </div>
            <button type="button" aria-label={looping ? 'Stop preview' : 'Preview range'} className={`${BUTTON} min-w-[44px] px-3`} disabled={busy || (!looping && Boolean(problem))} onClick={preview}>
              {looping ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}<span className="hidden sm:inline">{looping ? 'Stop preview' : 'Preview range'}</span>
            </button>
          </div>
        </>}
        <p aria-live="polite" className={`-mt-1 text-xs empty:hidden sm:text-sm ${problem && toText ? 'text-red-300' : 'text-[var(--foreground-muted)]'}`}>
          {link ? `${length !== null ? `${length.toFixed(1)} s · ` : ''}${bounds ? `${target.modelLabel} takes a ${bounds.minSeconds}–${bounds.maxSeconds} s source` : problem}` : ''}
        </p>
        {link && <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          {timeField('from')}{timeField('to')}
          <div role="group" aria-label="Section length" className="flex basis-full gap-1.5 sm:basis-auto">
            {QUICK_LENGTHS.map(seconds => {
              const why = lengthProblem(seconds), chosen = length === seconds;
              return <button key={seconds} type="button" aria-label={`Make the section ${seconds} seconds`} aria-pressed={chosen} title={why ?? undefined}
                disabled={busy || Boolean(why)} onClick={() => pickLength(seconds)}
                className={`flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-40 sm:flex-none ${chosen ? 'border-[var(--neon-cyan)]/70 bg-[var(--neon-cyan)]/15 text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--foreground-muted)] enabled:hover:border-[var(--neon-cyan)]/50 enabled:hover:text-[var(--foreground)]'}`}>
                {seconds} s
              </button>;
            })}
          </div>
        </div>}
        {link && <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" checked={saveToLibrary} disabled={busy} onChange={event => setSaveToLibrary(event.target.checked)} className="h-4 w-4 accent-[var(--neon-cyan)]" />
          <span>Save to library <span className="hidden sm:inline">to reuse this clip for more edits</span></span>
        </label>}
        <p role="status" className="sr-only">{phase === 'fetching' ? 'Fetching section…' : busy ? 'Preparing clip…' : ''}</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <p className="text-xs text-[var(--foreground-muted)]">{saveToLibrary
          ? 'Only this section is downloaded, and saved to your library.'
          : 'Only this section is downloaded, kept 24 hours for this edit.'}</p>
        <div className="flex gap-2 sm:justify-end">
          {phase === 'attaching' ? null : busy
            ? <button type="button" className={BUTTON} onClick={() => controller.current?.abort()}>Cancel import</button>
            : <button type="button" className={BUTTON} onClick={close}>Close</button>}
          <button type="button" className={`${BUTTON} flex-1 text-[var(--foreground)] sm:flex-none`} disabled={!link || Boolean(problem) || busy} onClick={() => void submit()}>
            {busy ? <><Loader2 size={16} className="animate-spin" /> {phase === 'fetching' ? 'Fetching section…' : 'Preparing clip…'}</> : 'Import clip'}
          </button>
        </div>
      </div>
    </div>
  )}</DialogPortal>;
}
