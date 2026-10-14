// components/ReferenceClipTray.tsx
'use client';

import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { Film, Loader2, Music } from 'lucide-react';
import { SourceVideoPreview } from '@/components/VideoSourceInput';
import { probeDimensions, probeWithDemuxer } from '@/lib/timeline/probe';
import {
  clipToken,
  referenceClipCountError,
  referenceClipFileError,
  referenceClipProbeError,
  type ProbedClip,
} from '@/lib/providers/reference-clips';
import type { ReferenceClipLimit, ReferenceClipsCapability, VideoPromptSyntax } from '@/lib/providers/types';

export interface AttachedReferenceClip extends ProbedClip {
  id: string;
  file: File;
  kind: 'video' | 'audio';
}

function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const finish = (done: () => void) => () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      done();
    };
    audio.addEventListener('loadedmetadata', finish(() => resolve(Number.isFinite(audio.duration) ? audio.duration : 0)), { once: true });
    audio.addEventListener('error', finish(() => reject(new Error('Could not read that audio.'))), { once: true });
    const timer = setTimeout(finish(() => reject(new Error('Could not read that audio.'))), 15_000);
    audio.src = url;
  });
}

async function probeVideo(file: File, spec: ReferenceClipLimit): Promise<ProbedClip> {
  const dimensions = await probeDimensions(file);
  let fps: number | undefined;
  if (spec.minFps !== undefined) {
    try {
      fps = (await probeWithDemuxer(file, { framerate: true })).fps;
    } catch {
      fps = undefined;
    }
  }
  return { ...dimensions, ...(fps !== undefined ? { fps } : {}) };
}

function AudioPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    // This state synchronizes an external browser resource. Creating inside the
    // effect also recreates it after StrictMode cleanup; a memo stays revoked.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <audio controls src={url} className="w-full" /> : null;
}

function limitCopy(spec: ReferenceClipLimit): string {
  const noun = spec.token === 'Video' ? 'video' : 'audio clip';
  return `Up to ${spec.max} ${noun}${spec.max === 1 ? '' : 's'}, each ${spec.minSeconds}–${spec.maxSeconds}s, ${spec.maxTotalSeconds}s together. ${spec.formatsLabel}.`;
}

export default function ReferenceClipTray({
  capability,
  syntax,
  videos,
  audios,
  onVideos,
  onAudios,
  disabled,
  hostedOnly,
  epoch,
}: {
  capability: ReferenceClipsCapability;
  syntax: VideoPromptSyntax | undefined;
  videos: AttachedReferenceClip[];
  audios: AttachedReferenceClip[];
  onVideos: (clips: AttachedReferenceClip[]) => void;
  onAudios: (clips: AttachedReferenceClip[]) => void;
  disabled: boolean;
  /** Atlas has no browser file host. The controls stay visible and do not accept files. */
  hostedOnly: boolean;
  /**
   * Owned by the workspace. A layout effect bumps it when the model or account
   * changes. The commit callback is the parent's, so unmounting this tray does
   * not stop it: the probe checks this ref before writing clips back.
   */
  epoch: RefObject<number>;
}) {
  const videoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = disabled || reading || hostedOnly;

  useEffect(() => () => { sequence.current += 1; }, []);

  async function add(kind: 'video' | 'audio', incoming: File[]) {
    const spec = kind === 'video' ? capability.video : capability.audio;
    if (!spec || incoming.length === 0) return;
    const turn = ++sequence.current;
    const scope = epoch.current;
    const current = () => turn === sequence.current && epoch.current === scope;
    setReading(true);
    setError(null);
    const next = kind === 'video' ? [...videos] : [...audios];
    try {
      for (const file of incoming) {
        if (!current()) return;
        if (next.length >= spec.max) {
          setError(referenceClipCountError(spec, next.length + 1));
          break;
        }
        const fileError = referenceClipFileError(spec, file);
        if (fileError) {
          setError(fileError);
          continue;
        }
        try {
          const probed = kind === 'video' ? await probeVideo(file, spec) : { durationSeconds: await probeAudioDuration(file) };
          if (!current()) return;
          const existing = next.reduce((sum, clip) => sum + clip.durationSeconds, 0);
          const probeError = referenceClipProbeError(spec, probed, existing);
          if (probeError) {
            setError(probeError);
            continue;
          }
          next.push({ id: crypto.randomUUID(), file, kind, ...probed });
        } catch (cause) {
          if (!current()) return;
          setError(cause instanceof Error ? cause.message : 'Could not read that file.');
        }
      }
      if (!current()) return;
      if (kind === 'video') onVideos(next);
      else onAudios(next);
    } finally {
      if (current()) setReading(false);
    }
  }

  function onDrop(kind: 'video' | 'audio', event: DragEvent) {
    if (locked || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    void add(kind, Array.from(event.dataTransfer.files));
  }

  return (
    <section className="glass-card space-y-3 p-3.5 md:p-4">
      <div>
        <h3 className="display text-base font-semibold">Reference video and audio</h3>
        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
          {capability.video ? `Address videos as ${clipToken(syntax, 'Video', 0)}.` : ''}
          {capability.video && capability.audio ? ' ' : ''}
          {capability.audio ? `Address audio as ${clipToken(syntax, 'Audio', 0)}.` : ''}
          {capability.audioRequiresVisual ? ' Audio needs an image or a reference video with it.' : ' Audio can be the only reference.'}
          {' '}A draft keeps these clips. Finalizing that draft does not send them again.
        </p>
      </div>
      {hostedOnly && (
        <p className="text-sm text-[var(--foreground-muted)]">
          Atlas needs a background job for reference video and audio, so the files have a hosted address. Switch this run to background, or pick Runware to upload from the browser.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {capability.video && (
          <ClipColumn
            kind="video"
            spec={capability.video}
            syntax={syntax}
            clips={videos}
            reading={reading}
            locked={locked}
            inputRef={videoInput}
            onPick={() => videoInput.current?.click()}
            onDrop={(event) => onDrop('video', event)}
            onFiles={(files) => void add('video', files)}
            onRemove={(id) => onVideos(videos.filter((clip) => clip.id !== id))}
          />
        )}
        {capability.audio && (
          <ClipColumn
            kind="audio"
            spec={capability.audio}
            syntax={syntax}
            clips={audios}
            reading={reading}
            locked={locked}
            inputRef={audioInput}
            onPick={() => audioInput.current?.click()}
            onDrop={(event) => onDrop('audio', event)}
            onFiles={(files) => void add('audio', files)}
            onRemove={(id) => onAudios(audios.filter((clip) => clip.id !== id))}
          />
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </section>
  );
}

function ClipColumn({
  kind, spec, syntax, clips, reading, locked, inputRef, onPick, onDrop, onFiles, onRemove,
}: {
  kind: 'video' | 'audio';
  spec: ReferenceClipLimit;
  syntax: VideoPromptSyntax | undefined;
  clips: AttachedReferenceClip[];
  reading: boolean;
  locked: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onDrop: (event: DragEvent) => void;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const label = kind === 'video' ? 'reference video' : 'reference audio';
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--foreground-muted)]">{limitCopy(spec)}</p>
      <input
        ref={inputRef}
        type="file"
        aria-label={kind === 'video' ? 'Upload reference video' : 'Upload reference audio'}
        accept={kind === 'video' ? 'video/mp4,video/quicktime,.mp4,.mov' : 'audio/mpeg,audio/wav,.mp3,.wav'}
        multiple={spec.max > 1}
        className="sr-only"
        disabled={locked}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        disabled={locked}
        onClick={onPick}
        onDragOver={(event) => { if (!locked && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }}
        onDrop={onDrop}
        className="btn-secondary w-full"
      >
        {reading ? <Loader2 size={18} className="animate-spin" /> : kind === 'video' ? <Film size={18} /> : <Music size={18} />}
        {reading ? 'Reading clip…' : `Drop or upload ${label}`}
      </button>
      {clips.map((clip, index) => (
        <div key={clip.id} className="space-y-1">
          {clip.kind === 'video' ? <SourceVideoPreview file={clip.file} label={clipToken(syntax, 'Video', index)} /> : <AudioPreview file={clip.file} />}
          <p className="break-all text-xs text-[var(--foreground-muted)]">
            {clipToken(syntax, spec.token, index)} · {clip.file.name} · {clip.durationSeconds.toFixed(1)}s
            {clip.width && clip.height ? ` · ${clip.width} × ${clip.height}` : ''}
          </p>
          <button type="button" disabled={locked} className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]" onClick={() => onRemove(clip.id)}>
            Remove {label}
          </button>
        </div>
      ))}
    </div>
  );
}
