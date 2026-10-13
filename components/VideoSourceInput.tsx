'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Library, Loader2, Scissors } from 'lucide-react';
import LibraryOverlay from './LibraryOverlay';
import YouTubeClipDialog, { type YouTubeClipTarget } from './YouTubeClipDialog';
import VideoPlayer from './video/VideoPlayer';
import { probeDimensions, type ProbedDimensions } from '@/lib/timeline/probe';
import type { ProviderModel } from '@/lib/providers/types';
import { validateEditVideo, validateEditSource } from '@/lib/providers/video-edit';
import { formatClock, watchUrl, type ClipSource } from '@/lib/youtube/clip';
import { discardStagedSource } from '@/lib/account/staged-sources';
import { useAccountStore } from '@/store/useAccountStore';

export interface SourceVideo extends ProbedDimensions { file: File; epoch: number; origin?: ClipSource }
export function SourceVideoPreview({file, label = 'Original video'}: {file: File; label?: string}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    // This state synchronizes an external browser resource. Creating inside the
    // effect also recreates it after StrictMode cleanup; a memo stays revoked.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <VideoPlayer src={url} label={label} className="aspect-video w-full" /> : null;
}

export default function VideoSourceInput({source, onChange, disabled, capability, youtube}: {
  capability: NonNullable<ProviderModel['videoEdit']>;
  source: SourceVideo | null; onChange: (source: SourceVideo | null) => void; disabled: boolean;
  youtube?: YouTubeClipTarget;
}) {
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const [open, setOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { sequence.current++; }, []);
  /** A YouTube import that stops being (or never becomes) the source is released on the
   *  Worker; device and library files are not staged, so this is a no-op for them. */
  function change(next: SourceVideo | null) {
    if (source && source.file !== next?.file) discardStagedSource(source.file);
    onChange(next);
  }
  async function select(file: File, origin?: ClipSource) {
    const turn = ++sequence.current;
    const epoch = useAccountStore.getState().epoch;
    setReading(true); setError(null);
    try {
      validateEditVideo(file);
      const dimensions = await probeDimensions(file);
      validateEditSource(dimensions, capability);
      if (turn !== sequence.current) { discardStagedSource(file); return; }
      if (useAccountStore.getState().epoch !== epoch) throw new Error('Your account changed. Choose the source again.');
      change({file, ...dimensions, epoch, ...(origin ? {origin} : {})}); setOpen(false);
    } catch (cause) {
      discardStagedSource(file);
      if (turn === sequence.current) setError(cause instanceof Error ? cause.message : 'Could not read that video.');
      throw cause;
    } finally { if (turn === sequence.current) setReading(false); }
  }
  return <section className="glass-card space-y-3 p-3.5 md:p-4">
    <div><h3 className="display text-base font-semibold">Source video</h3><p className="mt-1 text-xs text-[var(--foreground-muted)]">MP4, MOV or WebM · {capability.minSeconds ? `${capability.minSeconds}–${capability.maxSeconds}` : `Up to ${capability.maxSeconds}`} seconds · up to 100 MB. {capability.promptSyntax === 'image-index' ? 'Describe how to change the source video.' : 'Reference this clip as @Video1.'}</p></div>
    {source && <><SourceVideoPreview file={source.file} /><p className="break-all text-xs text-[var(--foreground-muted)]">{source.origin
      ? <a href={watchUrl(source.origin)} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">From YouTube · {formatClock(source.origin.startSeconds)}–{formatClock(source.origin.endSeconds)}</a>
      : source.file.name} · {source.durationSeconds.toFixed(1)}s · {source.width} × {source.height}</p></>}
    <input ref={input} type="file" aria-label="Upload source video" accept="video/mp4,video/quicktime,video/webm" className="sr-only" disabled={disabled || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void select(file).catch(() => {}); }} />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || reading} onClick={() => input.current?.click()} onDragOver={event => { if (!disabled && !reading && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDrop={event => { if (disabled || reading || !Array.from(event.dataTransfer.types).includes('Files')) return; event.preventDefault(); const files = Array.from(event.dataTransfer.files); if (files.length !== 1) setError('Choose one source video.'); else void select(files[0]).catch(() => {}); }} className="btn-secondary flex flex-1 items-center justify-center gap-2 border-dashed py-3">
        {reading ? <Loader2 size={18} className="animate-spin"/> : <Film size={18}/>} {reading ? 'Reading video…' : source ? 'Replace video' : 'Drop or upload video'}
      </button>
      <button type="button" disabled={disabled || reading} onClick={() => setOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:bg-[var(--neon-cyan)]/10 enabled:hover:text-[var(--neon-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-50"><Library size={18} aria-hidden="true"/>From library</button>
      {youtube && <button type="button" disabled={disabled || reading} onClick={() => setYoutubeOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:bg-[var(--neon-cyan)]/10 enabled:hover:text-[var(--foreground)]"><Scissors size={18}/> From YouTube</button>}
    </div>
    {source && <button type="button" disabled={disabled || reading} className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]" onClick={() => change(null)}>Remove source video</button>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <LibraryOverlay open={open} onOpenChange={setOpen} purpose="pick-clip" onPickVideo={select}/>
    {youtube && <YouTubeClipDialog open={youtubeOpen} target={youtube} onClose={() => setYoutubeOpen(false)} onImported={(file, origin) => select(file, origin)} />}
  </section>;
}
