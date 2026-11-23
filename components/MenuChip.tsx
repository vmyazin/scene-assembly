'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import ChipPopover from '@/components/ChipPopover';

export interface MenuChipOption {
  value: string | number;
  /** The choice itself: "1:1 (Square)". */
  label: string;
  /** What it resolves to, set apart on the right: "1024 × 1024". */
  detail?: string;
  /** A `W:H` ratio to draw as a small frame beside the label. */
  ratio?: string;
}

/** A frame in the option's proportions, so a shape can be read before its numbers. */
function RatioGlyph({ ratio }: { ratio?: string }) {
  const parsed = ratio ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio) : null;
  const box = 18;
  if (!parsed) return <span aria-hidden="true" className="inline-block shrink-0" style={{ width: box }} />;
  const value = Number(parsed[1]) / Number(parsed[2]);
  const width = value >= 1 ? box : Math.max(6, box * value);
  const height = value >= 1 ? Math.max(6, box / value) : box;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center" style={{ width: box, height: box }}>
      <span className="block rounded-[2px] border border-current opacity-70" style={{ width, height }} />
    </span>
  );
}

/**
 * A settings chip whose panel *is* the list of choices.
 *
 * For a choice with too many options to lay out in the row (Shape), where a
 * {@link ChoiceChip} would not fit. The chip used to open a panel holding a
 * native select, which is two menus to reach one choice; here each option is a
 * row in the panel, and picking one closes it.
 */
export default function MenuChip({
  label,
  panelLabel,
  value,
  chipValue,
  options,
  onChange,
  footer,
}: {
  /** What the setting is: "Shape". */
  label: string;
  /** Accessible name of the list: "Aspect ratio". */
  panelLabel: string;
  value: string | number | undefined;
  /** What the chip states, when it says more than the option's label. */
  chipValue?: ReactNode;
  options: readonly MenuChipOption[];
  onChange: (value: string | number) => void;
  /** Notes under the list: a legend, a limit, a mismatch with the reference. */
  footer?: ReactNode;
}) {
  const current = options.find((option) => Object.is(option.value, value));

  return (
    <ChipPopover label={label} panelLabel={panelLabel} value={chipValue ?? current?.label ?? value} wide>
      {(close) => (
        <>
          <div className="-mx-1.5 -my-1 max-h-[min(22rem,60dvh)] space-y-0.5 overflow-y-auto">
            {options.map((option) => {
              const selected = Object.is(option.value, value);
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  aria-pressed={selected}
                  aria-label={option.detail ? `${option.label} · ${option.detail}` : option.label}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] ${
                    selected
                      ? 'bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <RatioGlyph ratio={option.ratio} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.detail && (
                    <span className={`shrink-0 font-mono text-[0.7rem] ${selected ? '' : 'text-[var(--foreground-subtle)]'}`}>
                      {option.detail}
                    </span>
                  )}
                  <Check size={14} aria-hidden="true" className={`shrink-0 ${selected ? '' : 'invisible'}`} />
                </button>
              );
            })}
          </div>
          {footer}
        </>
      )}
    </ChipPopover>
  );
}
