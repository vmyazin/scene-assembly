'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Play, Square, X } from 'lucide-react';
import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';
import { importYouTubeClip } from '@/lib/account/youtube-clips';
import { createClipPlayer, type ClipPlayer } from '@/lib/youtube/iframe-api';
import { formatClock, importBounds, parseClock, parseYouTubeUrl, rangeProblem, roundTenth, type ClipSource } from '@/lib/youtube/clip';
import { useAccountStore } from '@/store/useAccountStore';

export interface YouTubeClipTarget { provider: string; modelId: string; modelLabel: string }

const BUTTON = 'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:text-[var(--foreground)] disabled:opacity-50';
const FIELD = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const ACCOUNT_CHANGED = 'Your account changed. Import the section again.';
const TIME_FIELD = `${FIELD} min-h-11 w-28`;

export default function YouTubeClipDialog({ open, target, onClose, onImported }: {
  open: boolean; target: YouTubeClipTarget; onClose: () => void; onImported: (file: File, source: ClipSource) => Promise<void>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<ClipPlayer | null>(null);
  const controller = useRef<AbortController | null>(null);
  const titleId = useId();
  const [linkText, setLinkText] = useState('');
  const [fromText, setFromText] = useState('0:00.0');
  const [toText, setToText] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'preparing' | 'attaching'>('idle');
  const [error, setError] = useState<string | null>(null);

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
    if (next && next.videoId !== videoId) { setFromText(formatClock(next.startSeconds ?? 0)); setToText(''); setDuration(null); }
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
      const { file, source } = await importYouTubeClip({ url: linkText, startSeconds: from, endSeconds: to, provider: target.provider, modelId: target.modelId }, abort.signal, owner, () => setPhase('preparing'));
      // A clip imported for one account never attaches after a switch to another.
      if (switched || useAccountStore.getState().epoch !== epoch) { setError(ACCOUNT_CHANGED); return; }
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
  return <DialogPortal>{open && (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-4" onClick={close}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}
        className="glass-card flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl md:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="display text-lg font-semibold">Import a section from YouTube</h2>
          <button type="button" aria-label="Close" onClick={close} disabled={busy} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--foreground-muted)] enabled:hover:text-[var(--foreground)] disabled:opacity-50"><X size={18} /></button>
        </div>
        <label className="block space-y-1 text-sm">
          <span>YouTube link</span>
          <input value={linkText} onChange={event => changeLink(event.target.value)} disabled={busy} inputMode="url" placeholder="https://www.youtube.com/watch?v=…" className={`${FIELD} w-full`} />
        </label>
        {linkText.trim() && !link && <p role="alert" className="text-sm text-red-300">Paste a YouTube video or Shorts link.</p>}
        {link && <>
          <div ref={playerHost} data-testid="youtube-player" className="aspect-video w-full overflow-hidden rounded-xl bg-black [&_iframe]:h-full [&_iframe]:w-full" />
          <div className="relative h-1.5 w-full rounded-full bg-[var(--border)]" aria-hidden="true">
            {duration && from !== undefined && to !== undefined && to > from && <div className="absolute inset-y-0 rounded-full bg-[var(--neon-cyan)]" style={{ left: percent(from), width: `calc(${percent(to)} - ${percent(from)})` }} />}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className={BUTTON} disabled={busy} onClick={() => mark('from')}>Set start</button>
            <label className="space-y-1 text-xs"><span>From</span><input aria-label="From" value={fromText} onChange={event => setTime('from', event.target.value)} disabled={busy} inputMode="decimal" className={TIME_FIELD} /></label>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => mark('to')}>Set end</button>
            <label className="space-y-1 text-xs"><span>To</span><input aria-label="To" value={toText} onChange={event => setTime('to', event.target.value)} disabled={busy} inputMode="decimal" placeholder="m:ss.s" className={TIME_FIELD} /></label>
            <button type="button" className={BUTTON} disabled={busy || (!looping && Boolean(problem))} onClick={preview}>{looping ? <><Square size={16} /> Stop preview</> : <><Play size={16} /> Preview range</>}</button>
          </div>
        </>}
        <p aria-live="polite" className={`text-sm empty:hidden ${problem && toText ? 'text-red-300' : 'text-[var(--foreground-muted)]'}`}>
          {link ? `${length !== null ? `${length.toFixed(1)} s · ` : ''}${bounds ? `${target.modelLabel} takes a ${bounds.minSeconds}–${bounds.maxSeconds} s source` : problem}` : ''}
        </p>
        <p role="status" className="sr-only">{phase === 'fetching' ? 'Fetching section…' : busy ? 'Preparing clip…' : ''}</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="mt-auto flex flex-wrap justify-end gap-2">
          {phase === 'attaching' ? null : busy
            ? <button type="button" className={BUTTON} onClick={() => controller.current?.abort()}>Cancel import</button>
            : <button type="button" className={BUTTON} onClick={close}>Close</button>}
          <button type="button" className={`${BUTTON} text-[var(--foreground)]`} disabled={!link || Boolean(problem) || busy} onClick={() => void submit()}>
            {busy ? <><Loader2 size={16} className="animate-spin" /> {phase === 'fetching' ? 'Fetching section…' : 'Preparing clip…'}</> : 'Import clip'}
          </button>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">Only this section is downloaded. It is kept for 24 hours as this edit&apos;s source and never added to your library.</p>
      </div>
    </div>
  )}</DialogPortal>;
}
