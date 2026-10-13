// components/ProviderSelector.tsx
'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import ProviderLogo from '@/components/ProviderLogo';

export type VideoProvider = 'gemini' | 'kie' | 'fal' | 'runware' | 'atlas' | 'comet' | 'piapi';

interface ProviderSelectorProps {
  value: VideoProvider;
  onChange: (provider: VideoProvider) => void;
}

const providers = [
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

export default function ProviderSelector({ value, onChange }: ProviderSelectorProps) {
  const headingId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % providers.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + providers.length) % providers.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = providers.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    onChange(providers[nextIndex].id);
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
        {providers.map((provider, index) => {
          const selected = provider.id === value;
          return (
            <button
              key={provider.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              ref={(element) => { buttonRefs.current[index] = element; }}
              onClick={() => onChange(provider.id)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
              className={`inline-flex min-h-12 items-center rounded-lg border px-3.5 py-3 text-sm leading-[1.45] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)] ${selected ? 'border-[var(--neon-purple)] bg-[var(--neon-purple)]/10' : 'border-[var(--border)] bg-[var(--background-elevated)]/60 hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]'}`}
            >
              <span className="flex items-center gap-2 whitespace-nowrap text-[var(--foreground)]">
                <ProviderLogo provider={provider.id} size={18} />
                {provider.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
