// components/VideoSourceInput.tsx
'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Film, Library, Loader2, Scissors } from 'lucide-react';
import LibraryOverlay from './LibraryOverlay';
import YouTubeClipDialog, { type YouTubeClipTarget } from './YouTubeClipDialog';
import VideoPlayer from './video/VideoPlayer';
import { probeDimensions, type ProbedDimensions } from '@/lib/timeline/probe';
import type { ProviderModel } from '@/lib/providers/types';
import { editSourceToken } from '@/lib/providers/edit-references';
import { editVideoMaxBytes, editVideoMimes, validateEditVideo, validateEditSource } from '@/lib/providers/video-edit';
import { formatClock, watchUrl, type ImportedClipSource } from '@/lib/youtube/clip';
import { discardStagedSource } from '@/lib/account/staged-sources';
import { useAccountStore } from '@/store/useAccountStore';
import { trimVideoToLimit, videoTrimNotice } from '@/lib/media/trim-video';
import { useObjectUrl } from '@/lib/media/use-object-url';

export interface SourceVideo extends ProbedDimensions { file: File; epoch: number; origin?: ImportedClipSource; trimNotice?: string }

function sourceHint(capability: NonNullable<ProviderModel['videoEdit']>): string {
  if (capability.promptSyntax === 'triple-angle') return `Reference this clip as ${editSourceToken(capability.promptSyntax)}.`;
  if (capability.namesSource) return 'Reference this clip as @Video1.';
  return 'Describe how to change the source video.';
}
export function SourceVideoPreview({file, label = 'Original video'}: {file: File; label?: string}) {
  const url = useObjectUrl(file);
  return url ? <VideoPlayer src={url} label={label} className="aspect-video w-full" /> : null;
}

export default function VideoSourceInput({source, onChange, disabled, capability, youtube}: {
  capability: NonNullable<ProviderModel['videoEdit']>;
  source: SourceVideo | null; onChange: (source: SourceVideo | null) => void; disabled: boolean;
  youtube?: YouTubeClipTarget;
}) {
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [trimming, setTrimming] = useState(false);
  const [open, setOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    sequence.current++;
    pending.current?.abort();
    // A new model must not stay locked by an old selection finishing later.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReading(false);
    setTrimming(false);
    const selection = sequence;
    const request = pending;
    return () => { selection.current++; request.current?.abort(); };
  }, [capability]);
  /** A YouTube import that stops being (or never becomes) the source is released on the
   *  Worker; device and library files are not staged, so this is a no-op for them. */
  function change(next: SourceVideo | null) {
    if (source && source.file !== next?.file) discardStagedSource(source.file);
    onChange(next);
  }
  async function select(file: File, origin?: ImportedClipSource) {
    const turn = ++sequence.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const epoch = useAccountStore.getState().epoch;
    setReading(true); setTrimming(false); setError(null);
    try {
      validateEditVideo(file, capability);
      const dimensions = await probeDimensions(file);
      // Check non-duration constraints before doing expensive conversion.
      validateEditSource({...dimensions, durationSeconds: Math.min(dimensions.durationSeconds, capability.maxSeconds)}, capability);
      if (turn !== sequence.current) { discardStagedSource(file); return; }
      const prepared = await trimVideoToLimit(file, dimensions, capability.maxSeconds, {
        signal: controller.signal, onTrimming: () => setTrimming(true),
      });
      validateEditVideo(prepared.file, capability);
      validateEditSource(prepared, capability);
      if (turn !== sequence.current) { discardStagedSource(file); return; }
      if (useAccountStore.getState().epoch !== epoch) throw new Error('Your account changed. Choose the source again.');
      if (prepared.file !== file) discardStagedSource(file);
      const selectedOrigin = origin && prepared.file !== file
        ? {...origin, endSeconds: origin.startSeconds + prepared.durationSeconds, savedToLibrary: false}
        : origin;
      change({...prepared, epoch, trimNotice: videoTrimNotice(prepared), ...(selectedOrigin ? {origin: selectedOrigin} : {})}); setOpen(false);
    } catch (cause) {
      discardStagedSource(file);
      if (turn === sequence.current) setError(cause instanceof Error ? cause.message : 'Could not read that video.');
      throw cause;
    } finally { if (turn === sequence.current) { setReading(false); setTrimming(false); } }
  }
  return <section className="glass-card space-y-3 p-3.5 md:p-4">
    <div><h3 className="display text-base font-semibold">Source video</h3><p className="mt-1 text-xs text-[var(--foreground-muted)]">{editVideoMimes(capability).map(mime => mime === 'video/mp4' ? 'MP4' : mime === 'video/quicktime' ? 'MOV' : mime === 'video/webm' ? 'WebM' : mime).join(', ')} · {capability.minSeconds ? `${capability.minSeconds}–${capability.maxSeconds}` : `Up to ${capability.maxSeconds}`} seconds · up to {Math.round(editVideoMaxBytes(capability) / 1_000_000)} MB{capability.sourceBounds ? ` · ${capability.sourceBounds.minEdge}–${capability.sourceBounds.maxEdge}px` : ''}. {sourceHint(capability)} Longer clips are trimmed automatically.</p></div>
    {source && <><SourceVideoPreview file={source.file} /><p className="break-all text-xs text-[var(--foreground-muted)]">{source.origin
      ? <a href={watchUrl(source.origin)} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">From YouTube · {formatClock(source.origin.startSeconds)}–{formatClock(source.origin.endSeconds)}</a>
      : source.file.name} · {source.durationSeconds.toFixed(1)}s · {source.width} × {source.height}{source.origin?.savedToLibrary ? ' · Saved to library' : ''}</p>
      {source.trimNotice && <p role="status" className="text-xs text-[var(--neon-cyan)]">{source.trimNotice}</p>}
      {source.origin?.libraryNotice && <p role="status" className="text-xs text-[var(--foreground-muted)]">{source.origin.libraryNotice}</p>}</>}
    <input ref={input} type="file" aria-label="Upload source video" accept={editVideoMimes(capability).join(',')} className="sr-only" disabled={disabled || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void select(file).catch(() => {}); }} />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={disabled || reading} onClick={() => input.current?.click()} onDragOver={event => { if (!disabled && !reading && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDrop={event => { if (disabled || reading || !Array.from(event.dataTransfer.types).includes('Files')) return; event.preventDefault(); const files = Array.from(event.dataTransfer.files); if (files.length !== 1) setError('Choose one source video.'); else void select(files[0]).catch(() => {}); }} className="btn-secondary flex-1">
        {reading ? <Loader2 size={18} className="animate-spin"/> : <Film size={18}/>} {reading ? (trimming ? 'Trimming video…' : 'Reading video…') : source ? 'Replace video' : 'Drop or upload video'}
      </button>
      <button type="button" disabled={disabled || reading} onClick={() => setOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:bg-[var(--neon-cyan)]/10 enabled:hover:text-[var(--neon-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-50"><Library size={18} aria-hidden="true"/>From library</button>
      {youtube && <button type="button" disabled={disabled || reading} onClick={() => setYoutubeOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:bg-[var(--neon-cyan)]/10 enabled:hover:text-[var(--foreground)]"><Scissors size={18}/> From YouTube</button>}
    </div>
    {source && <button type="button" disabled={disabled || reading} className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]" onClick={() => change(null)}>Remove source video</button>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <LibraryOverlay open={open} onOpenChange={setOpen} purpose="pick-clip" onPickVideo={select} editCapability={capability}/>
    {youtube && <YouTubeClipDialog open={youtubeOpen} target={youtube} onClose={() => setYoutubeOpen(false)} onImported={(file, origin) => select(file, origin)} />}
  </section>;
}
