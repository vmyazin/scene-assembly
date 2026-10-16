// components/EditReferenceTray.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  editImageToken,
  emptyEditReferenceDraft,
  type EditReferenceDraft,
  type EditStill,
} from '@/lib/providers/edit-references';
import { referenceClipFileError, referenceClipProbeError } from '@/lib/providers/reference-clips';
import type { EditReferenceSpec, VideoPromptSyntax } from '@/lib/providers/types';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export interface EditReferenceTrayProps {
  spec: EditReferenceSpec;
  draft: EditReferenceDraft;
  onChange: (draft: EditReferenceDraft) => void;
  disabled?: boolean;
  /** A Luma edit uses the model's keyframe max. Other background jobs stop at 16. */
  fileCap: number;
  promptSyntax?: VideoPromptSyntax;
}

function stillFrom(file: File): EditStill {
  return { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) };
}

function revoke(still: EditStill | null | undefined) {
  if (still) URL.revokeObjectURL(still.previewUrl);
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

function fileCount(draft: EditReferenceDraft): number {
  const elements = draft.elements.reduce((sum, element) => sum + (element.frontal ? 1 : 0) + element.angles.length, 0);
  const frames = draft.guide === 'keyframes' ? draft.keyframes.length : draft.startImage ? 1 : 0;
  return draft.images.length + elements + frames + draft.persons.length + (draft.litSphere ? 1 : 0);
}

function Thumb({ still, label, onRemove, disabled }: { still: EditStill; label: string; onRemove: () => void; disabled?: boolean }) {
  return (
    <figure className="relative w-24 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={still.previewUrl} alt={label} className="h-16 w-24 rounded-md object-cover" />
      <figcaption className="mt-1 truncate text-[11px] text-[var(--foreground-muted)]">{label}</figcaption>
      <button type="button" aria-label={`Remove ${label}`} disabled={disabled} onClick={onRemove} className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white">
        <X size={12} />
      </button>
    </figure>
  );
}

export default function EditReferenceTray({ spec, draft, onChange, disabled, fileCap, promptSyntax }: EditReferenceTrayProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const audioRequest = useRef(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  // The workspace owns the draft, including across a mode change that unmounts
  // this tray, so it is the one that revokes previews.
  useEffect(() => () => { alive.current = false; }, []);
  const used = fileCount(draft);
  const room = Math.max(0, fileCap - used);
  const capped = fileCap < (spec.keyframes?.max ?? fileCap);

  const addImages = (files: File[]) => {
    const next = files.slice(0, Math.min(room, (spec.images?.max ?? 0) - draft.images.length)).map(stillFrom);
    if (next.length) onChange({ ...draft, images: [...draft.images, ...next] });
  };

  return (
    <section className="glass-card space-y-4 p-3.5 md:p-4" data-testid="edit-reference-tray">
      {spec.images && (
        <div className="space-y-2">
          <h3 className="display text-base font-semibold">Reference images</h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            Up to {spec.images.max}. Address them as {editImageToken(promptSyntax, 0)}
            {spec.images.max > 1 ? `, ${editImageToken(promptSyntax, 1)}` : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            {draft.images.map((still, index) => (
              <Thumb key={still.id} still={still} label={editImageToken(promptSyntax, index)} disabled={disabled} onRemove={() => {
                revoke(still);
                onChange({ ...draft, images: draft.images.filter((item) => item.id !== still.id) });
              }} />
            ))}
          </div>
          {draft.images.length < spec.images.max && (
            <label className="btn-secondary inline-flex cursor-pointer">
              Add image
              <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple={spec.images.max > 1} className="sr-only" disabled={disabled || room === 0} onChange={(event) => {
                addImages(Array.from(event.target.files ?? []));
                event.target.value = '';
              }} />
            </label>
          )}
        </div>
      )}

      {spec.elements && (
        <div className="space-y-2" data-testid="edit-elements">
          <h3 className="display text-base font-semibold">Elements</h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            Images and elements together can be at most {spec.elements.combinedMax}. Each element is a front view plus {spec.elements.minAngles} to {spec.elements.maxAngles} angle images. Address an element as @Element1.
          </p>
          <p className="text-xs text-[var(--foreground-muted)]">{draft.images.length + draft.elements.length} of {spec.elements.combinedMax} reference slots used.</p>
          {draft.elements.map((element, index) => (
            <div key={element.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">@Element{index + 1}</p>
                <button type="button" className="btn-secondary" disabled={disabled} onClick={() => {
                  revoke(element.frontal);
                  element.angles.forEach(revoke);
                  onChange({ ...draft, elements: draft.elements.filter((item) => item.id !== element.id) });
                }}>Remove element</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {element.frontal && <Thumb still={element.frontal} label="Front" disabled={disabled} onRemove={() => { revoke(element.frontal); onChange({ ...draft, elements: draft.elements.map((item) => item.id === element.id ? { ...item, frontal: null } : item) }); }} />}
                {element.angles.map((still, angleIndex) => (
                  <Thumb key={still.id} still={still} label={`Angle ${angleIndex + 1}`} disabled={disabled} onRemove={() => {
                    revoke(still);
                    onChange({ ...draft, elements: draft.elements.map((item) => item.id === element.id ? { ...item, angles: item.angles.filter((angle) => angle.id !== still.id) } : item) });
                  }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {!element.frontal && (
                  <label className="btn-secondary inline-flex cursor-pointer">
                    Front view
                    <input type="file" accept={IMAGE_ACCEPT} className="sr-only" disabled={disabled || room === 0} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onChange({ ...draft, elements: draft.elements.map((item) => item.id === element.id ? { ...item, frontal: stillFrom(file) } : item) });
                      event.target.value = '';
                    }} />
                  </label>
                )}
                {element.angles.length < spec.elements!.maxAngles && (
                  <label className="btn-secondary inline-flex cursor-pointer">
                    Add angle
                    <input type="file" accept={IMAGE_ACCEPT} className="sr-only" disabled={disabled || room === 0} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onChange({ ...draft, elements: draft.elements.map((item) => item.id === element.id ? { ...item, angles: [...item.angles, stillFrom(file)] } : item) });
                      event.target.value = '';
                    }} />
                  </label>
                )}
              </div>
            </div>
          ))}
          {draft.images.length + draft.elements.length < spec.elements.combinedMax && (
            <button type="button" className="btn-secondary" disabled={disabled} onClick={() => onChange({ ...draft, elements: [...draft.elements, { id: crypto.randomUUID(), frontal: null, angles: [] }] })}>Add element</button>
          )}
        </div>
      )}

      {spec.keyframes && (
        <div className="space-y-2" data-testid="edit-keyframes">
          <h3 className="display text-base font-semibold">Guidance frames</h3>
          {spec.keyframes.startImage && (
            <div className="flex gap-3 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" name="edit-guide" checked={draft.guide === 'start'} disabled={disabled} onChange={() => onChange({ ...draft, guide: 'start' })} />Start frame</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="edit-guide" checked={draft.guide === 'keyframes'} disabled={disabled} onChange={() => onChange({ ...draft, guide: 'keyframes' })} />Keyframes</label>
            </div>
          )}
          {capped && <p className="text-xs text-[var(--foreground-muted)]">A background job can attach {fileCap} keyframes. In the browser this model takes up to {spec.keyframes.max}.</p>}
          {draft.guide === 'start' && spec.keyframes.startImage && (
            <div className="space-y-2">
              {draft.startImage && <Thumb still={draft.startImage} label="Start frame" disabled={disabled} onRemove={() => { revoke(draft.startImage); onChange({ ...draft, startImage: null }); }} />}
              {!draft.startImage && (
                <label className="btn-secondary inline-flex cursor-pointer">
                  Add start frame
                  <input type="file" accept={IMAGE_ACCEPT} className="sr-only" disabled={disabled} onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onChange({ ...draft, startImage: stillFrom(file) });
                    event.target.value = '';
                  }} />
                </label>
              )}
            </div>
          )}
          {draft.guide === 'keyframes' && (
            <div className="space-y-2">
              {draft.keyframes.map((frame, index) => (
                <div key={frame.id} className="flex flex-wrap items-end gap-2">
                  <Thumb still={frame.image} label={`Keyframe ${index + 1}`} disabled={disabled} onRemove={() => { revoke(frame.image); onChange({ ...draft, keyframes: draft.keyframes.filter((item) => item.id !== frame.id) }); }} />
                  <label className="text-xs text-[var(--foreground-muted)]">
                    Frame index
                    <input aria-label={`Keyframe ${index + 1} index`} className="field mt-1 w-24" inputMode="numeric" value={frame.index} disabled={disabled} onChange={(event) => onChange({ ...draft, keyframes: draft.keyframes.map((item) => item.id === frame.id ? { ...item, index: event.target.value.replace(/[^\d]/g, '') } : item) })} />
                  </label>
                </div>
              ))}
              {draft.keyframes.length < Math.min(spec.keyframes.max, fileCap) && (
                <label className="btn-secondary inline-flex cursor-pointer">
                  Add keyframe
                  <input type="file" accept={IMAGE_ACCEPT} className="sr-only" disabled={disabled || room === 0} onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onChange({ ...draft, keyframes: [...draft.keyframes, { id: crypto.randomUUID(), image: stillFrom(file), index: String(draft.keyframes.length) }] });
                    event.target.value = '';
                  }} />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {spec.persons && (
        <div className="space-y-2" data-testid="edit-persons">
          <h3 className="display text-base font-semibold">People</h3>
          <p className="text-xs text-[var(--foreground-muted)]">One photo per person, {spec.persons.min} to {spec.persons.max}. No shot in the source may be longer than 15 seconds. That cut is not readable from the file.</p>
          <div className="flex flex-wrap gap-2">
            {draft.persons.map((still, index) => (
              <Thumb key={still.id} still={still} label={`Person ${index + 1}`} disabled={disabled} onRemove={() => { revoke(still); onChange({ ...draft, persons: draft.persons.filter((item) => item.id !== still.id) }); }} />
            ))}
          </div>
          {draft.persons.length < spec.persons.max && (
            <label className="btn-secondary inline-flex cursor-pointer">
              Add person
              <input type="file" accept={IMAGE_ACCEPT} className="sr-only" disabled={disabled || room === 0} onChange={(event) => {
                const next = Array.from(event.target.files ?? []).slice(0, Math.min(room, spec.persons!.max - draft.persons.length)).map(stillFrom);
                if (next.length) onChange({ ...draft, persons: [...draft.persons, ...next] });
                event.target.value = '';
              }} />
            </label>
          )}
        </div>
      )}

      {spec.litSphere && (
        <div className="space-y-2" data-testid="edit-lit-sphere">
          <h3 className="display text-base font-semibold">Lighting sphere</h3>
          <p className="text-xs text-[var(--foreground-muted)]">Exactly one sphere image. This model does not take a prompt.</p>
          {draft.litSphere && <Thumb still={draft.litSphere} label="Lighting sphere" disabled={disabled} onRemove={() => { revoke(draft.litSphere); onChange({ ...draft, litSphere: null }); }} />}
          {!draft.litSphere && (
            <label className="btn-secondary inline-flex cursor-pointer">
              Add lighting sphere
              <input type="file" accept={IMAGE_ACCEPT} className="sr-only" disabled={disabled} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onChange({ ...draft, litSphere: stillFrom(file) });
                event.target.value = '';
              }} />
            </label>
          )}
        </div>
      )}

      {spec.audio && (
        <div className="space-y-2" data-testid="edit-audio">
          <h3 className="display text-base font-semibold">Driving audio</h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            {spec.audioLimit
              ? `Optional. ${spec.audioLimit.formatsLabel}, ${spec.audioLimit.minSeconds}–${spec.audioLimit.maxSeconds} seconds, up to ${Math.round(spec.audioLimit.maxBytes / 1_000_000)} MB.`
              : 'Optional. One clip drives the edit.'}
          </p>
          {audioError && <p role="alert" className="text-sm text-red-300">{audioError}</p>}
          {draft.audio && (
            <p className="flex items-center gap-2 text-sm">
              {draft.audio.name}
              <button type="button" className="btn-secondary" disabled={disabled} onClick={() => onChange({ ...draft, audio: null })}>Remove audio</button>
            </p>
          )}
          {!draft.audio && (
            <label className="btn-secondary inline-flex cursor-pointer">
              Add audio
              <input type="file" accept={spec.audioLimit ? spec.audioLimit.accept.join(',') : 'audio/*'} className="sr-only" disabled={disabled} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const requestId = ++audioRequest.current;
                const limit = spec.audioLimit;
                void (async () => {
                  if (limit) {
                    const fileError = referenceClipFileError(limit, file);
                    if (fileError) { if (alive.current && audioRequest.current === requestId) setAudioError(fileError); return; }
                    try {
                      const durationSeconds = await probeAudioDuration(file);
                      const probeError = referenceClipProbeError(limit, { durationSeconds });
                      if (probeError) { if (alive.current && audioRequest.current === requestId) setAudioError(probeError); return; }
                    } catch (cause) {
                      if (alive.current && audioRequest.current === requestId) setAudioError(cause instanceof Error ? cause.message : 'Could not read that audio.');
                      return;
                    }
                  }
                  if (!alive.current || audioRequest.current !== requestId) return;
                  setAudioError(null);
                  onChange({ ...draft, audio: { id: crypto.randomUUID(), file, name: file.name } });
                })();
              }} />
            </label>
          )}
        </div>
      )}
    </section>
  );
}

export { emptyEditReferenceDraft };
