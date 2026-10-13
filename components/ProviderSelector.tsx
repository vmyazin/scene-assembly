// components/ProviderSelector.tsx
'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import ProviderLogo from '@/components/ProviderLogo';

export type VideoProvider = 'gemini' | 'kie' | 'fal' | 'runware' | 'atlas' | 'comet' | 'piapi';

interface ProviderSelectorProps {
  value: VideoProvider;
  onChange: (provider: VideoProvider) => void;
  disabledProviders?: readonly VideoProvider[];
}

export const VIDEO_PROVIDERS = [
  // No blurbs: the model counts they carried drifted from the catalogs, and a
  // provider's name is the whole of what this control chooses. Runware leads as
  // the cheapest per second, then Kie and fal; Gemini is the BYOK option in
  // the fourth slot, then the remaining aggregators in their established order.
  { id: 'runware' as const, label: 'Runware' },
  { id: 'kie' as const, label: 'Kie.ai' },
  { id: 'fal' as const, label: 'fal.ai' },
  { id: 'gemini' as const, label: 'Gemini' },
  { id: 'atlas' as const, label: 'Atlas Cloud' },
  { id: 'comet' as const, label: 'CometAPI' },
  { id: 'piapi' as const, label: 'PiAPI' },
];

function EngineAvailabilityTooltip({ disabled, label, children }: { disabled: boolean; label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const visible = disabled && open;
  return (
    <span
      className={`relative inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)] ${disabled ? 'cursor-not-allowed' : ''}`}
      tabIndex={disabled ? 0 : undefined}
      aria-label={disabled ? label : undefined}
      aria-describedby={disabled ? id : undefined}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
    >
      {children}
      {disabled && (
        <span
          id={id}
          role="tooltip"
          style={{ visibility: visible ? 'visible' : 'hidden' }}
          className="absolute bottom-full left-1/2 z-50 w-44 -translate-x-1/2 pb-2"
        >
          <span className="block rounded-lg border border-[var(--border-hover)] bg-[var(--background-elevated)] px-3 py-2 text-center text-xs leading-snug text-[var(--foreground)] shadow-lg">
            No support for this mode/direction
          </span>
        </span>
      )}
    </span>
  );
}

export default function ProviderSelector({ value, onChange, disabledProviders = [] }: ProviderSelectorProps) {
  const headingId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabledIndices = VIDEO_PROVIDERS.flatMap((provider, i) => disabledProviders.includes(provider.id) ? [] : [i]);
    const current = enabledIndices.indexOf(index);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = enabledIndices[(current + 1) % enabledIndices.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = enabledIndices[(current - 1 + enabledIndices.length) % enabledIndices.length];
    } else if (event.key === 'Home') {
      nextIndex = enabledIndices[0];
    } else if (event.key === 'End') {
      nextIndex = enabledIndices.at(-1);
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    onChange(VIDEO_PROVIDERS[nextIndex].id);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div>
      <p id={headingId} className="mb-2.5 text-[0.625rem] uppercase tracking-[0.12em] text-[var(--foreground-muted)]">Generation engine</p>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="flex flex-wrap gap-2"
      >
        {VIDEO_PROVIDERS.map((provider, index) => {
          const disabled = disabledProviders.includes(provider.id);
          const selected = provider.id === value;
          return (
            <EngineAvailabilityTooltip key={provider.id} disabled={disabled} label={provider.label}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                tabIndex={selected && !disabled ? 0 : -1}
                ref={(element) => { buttonRefs.current[index] = element; }}
                onClick={() => { if (!disabled) onChange(provider.id); }}
                onKeyDown={(event) => selectFromKeyboard(event, index)}
                className={`inline-flex min-h-12 items-center rounded-lg border px-3.5 py-3 text-sm leading-[1.45] transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)] ${selected ? 'border-[var(--neon-purple)] bg-[var(--neon-purple)]/10' : 'border-[var(--border)] bg-[var(--background-elevated)]/60 hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]'}`}
              >
                <span className="flex items-center gap-2 whitespace-nowrap text-[var(--foreground)]">
                  <ProviderLogo provider={provider.id} size={18} />
                  {provider.label}
                </span>
              </button>
            </EngineAvailabilityTooltip>
          );
        })}
      </div>
    </div>
  );
}
