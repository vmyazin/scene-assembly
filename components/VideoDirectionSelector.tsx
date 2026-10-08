'use client';

import Image, { type StaticImageData } from 'next/image';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProviderMode } from '@/lib/providers/types';

export interface VideoDirection {
  id: ProviderMode;
  label: string;
  blurb: string;
  requires: string;
  icon: LucideIcon;
  thumbnail: StaticImageData | string;
  needsProviderSupport?: boolean;
}

const PREVIEW_DELAY_MS = 1000;
// Allow the pointer to cross the small gap without dismissing the card en route.
const LEAVE_GRACE_MS = 120;

export default function VideoDirectionSelector({
  modes,
  value,
  onChange,
}: {
  modes: readonly VideoDirection[];
  value: ProviderMode;
  onChange: (mode: ProviderMode) => void;
}) {
  const [previewId, setPreviewId] = useState<ProviderMode | null>(null);
  const preview = modes.find(mode => mode.id === previewId);
  const tooltipId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchPress = useRef(false);

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setPreviewId(null);
  }, [clearTimers]);

  function show(mode: ProviderMode, anchor: HTMLButtonElement) {
    clearTimers();
    anchorRef.current = anchor;
    setPreviewId(mode);
  }

  function schedule(mode: ProviderMode, anchor: HTMLButtonElement) {
    dismiss();
    anchorRef.current = anchor;
    openTimer.current = setTimeout(() => setPreviewId(mode), PREVIEW_DELAY_MS);
  }

  function leave() {
    clearTimeout(openTimer.current);
    if (!anchorRef.current?.matches(':focus-visible')) {
      closeTimer.current = setTimeout(dismiss, LEAVE_GRACE_MS);
    }
  }

  useEffect(() => {
    const outsidePress = (event: PointerEvent) => {
      if (!groupRef.current?.contains(event.target as Node) && !cardRef.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', outsidePress);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      clearTimers();
      document.removeEventListener('pointerdown', outsidePress);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [clearTimers, dismiss]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const anchor = anchorRef.current;
    if (!preview || !card || !anchor) return;
    const triggerBounds = anchor.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    const left = Math.max(12, Math.min(triggerBounds.left, window.innerWidth - bounds.width - 12));
    const below = triggerBounds.bottom + 8;
    const top = below + bounds.height <= window.innerHeight - 12
      ? below
      : Math.max(12, triggerBounds.top - bounds.height - 8);
    // Position before paint, so the preview neither shifts the layout nor flashes
    // at the viewport origin. A portal avoids clipping by workspace containers.
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = 'visible';
  }, [preview]);

  return (
    <div>
      <p className="mb-2.5 text-[0.625rem] uppercase tracking-[0.12em] text-[var(--foreground-muted)]">Direction</p>
      <div ref={groupRef} role="group" aria-label="Video direction" className="flex flex-wrap gap-[3px]">
        {modes.map(mode => {
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={value === mode.id}
              aria-describedby={previewId === mode.id ? tooltipId : undefined}
              onPointerEnter={event => {
                if (event.pointerType !== 'touch') schedule(mode.id, event.currentTarget);
              }}
              onPointerLeave={leave}
              onPointerDown={event => { touchPress.current = event.pointerType === 'touch'; }}
              onFocus={event => {
                if (event.currentTarget.matches(':focus-visible')) schedule(mode.id, event.currentTarget);
              }}
              onBlur={dismiss}
              onClick={event => {
                onChange(mode.id);
                if (touchPress.current) show(mode.id, event.currentTarget);
                touchPress.current = false;
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-[9px] py-2.5 text-xs leading-[1.45] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)] ${value === mode.id ? 'border-[var(--neon-purple)] bg-[var(--neon-purple)]/10 text-[var(--foreground)]' : 'border-transparent text-[var(--foreground)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]'}`}
            >
              <Icon aria-hidden="true" size={16} className={value === mode.id ? 'text-[#d483ff]' : 'text-[var(--foreground-muted)]'} />
              {mode.label}
            </button>
          );
        })}
      </div>

      {preview && createPortal(
        <div
          ref={cardRef}
          id={tooltipId}
          role="tooltip"
          onPointerEnter={() => clearTimeout(closeTimer.current)}
          onPointerLeave={leave}
          className="fixed z-[100] w-[304px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[11px] border border-[var(--border-hover)] bg-[var(--background-elevated)] text-[var(--foreground)] shadow-[0_16px_48px_#0008]"
          style={{ visibility: 'hidden', left: 12, top: 12 }}
        >
          <div className="relative aspect-video border-b border-[var(--border-hover)]">
            <Image src={preview.thumbnail} alt="" fill sizes="304px" className="object-cover" />
          </div>
          <div className="p-3.5">
            <p className="text-sm font-semibold leading-[1.45]">{preview.label}</p>
            <p className="mb-[13px] mt-1.5 text-xs leading-[1.45] text-[var(--foreground-muted)]">{preview.blurb}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--neon-purple)]/40 bg-[var(--neon-purple)]/10 px-2 py-1 text-[11px] leading-[1.45] text-[#deb5f1]">{preview.requires}</span>
              {preview.needsProviderSupport && <span className="text-[10px] text-[var(--foreground-muted)]">Not on every provider</span>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
