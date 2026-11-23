'use client';

import { useSyncExternalStore } from 'react';
import ChipPopover from '@/components/ChipPopover';
import SegmentedToggleGroup, { type SegmentedToggleOption } from '@/components/SegmentedToggleGroup';

/** Wide enough for a row of short choices beside the other chips. */
const INLINE_QUERY = '(min-width: 640px)';

const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(INLINE_QUERY);
  mql.addEventListener?.('change', onChange);
  return () => mql.removeEventListener?.('change', onChange);
};
const isWide = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(INLINE_QUERY)?.matches);

/**
 * A chip for a short list of choices, such as Size.
 *
 * A popover hides a choice that could simply be shown, so the chip lays its
 * options out in place wherever the row has the width, and folds them into a
 * {@link ChipPopover} on a narrow screen. A setting with a single option is not
 * a choice at all: it is stated as plain text, so nothing invites a click that
 * cannot change anything.
 */
export default function ChoiceChip({
  label,
  panelLabel,
  options,
  value,
  onChange,
}: {
  /** What the setting is: "Size". */
  label: string;
  /** Accessible name of the choices: "Resolution". */
  panelLabel: string;
  options: readonly SegmentedToggleOption[];
  value: string | number | undefined;
  onChange: (value: string | number) => void;
}) {
  const wide = useSyncExternalStore(subscribe, isWide, () => false);
  const current = options.find((option) => Object.is(option.value, value)) ?? options[0];

  if (options.length <= 1) {
    return (
      <div className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-xs text-[var(--foreground-muted)]">
        <span>{label}</span>{' '}
        <span className="font-medium text-[var(--foreground)]">{current?.label ?? value}</span>
      </div>
    );
  }

  if (wide) {
    return (
      <div className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-hover)] py-0.5 pl-2.5 pr-0.5 text-xs text-[var(--foreground-muted)]">
        <span aria-hidden="true">{label}</span>
        <SegmentedToggleGroup size="compact" label={panelLabel} options={options} value={current?.value ?? ''} onChange={onChange} />
      </div>
    );
  }

  return (
    <ChipPopover label={label} panelLabel={panelLabel} value={current?.label}>
      <div className="space-y-2">
        <span className="block text-sm font-medium text-[var(--foreground)]">{panelLabel}</span>
        <SegmentedToggleGroup label={panelLabel} options={options} value={current?.value ?? ''} onChange={onChange} />
      </div>
    </ChipPopover>
  );
}
