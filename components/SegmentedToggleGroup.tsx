'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedToggleOption {
  label: string;
  value: string | number;
  /** A choice the current request cannot use, such as Relaxed with a reference attached. */
  disabled?: boolean;
}

export interface SegmentedToggleGroupProps {
  label: string;
  ariaDescribedBy?: string;
  options: readonly SegmentedToggleOption[];
  value: string | number;
  onChange: (value: string | number) => void;
  /** `compact` is a small inline pill row for a toggle that sits inside a card header. */
  size?: 'default' | 'compact';
}

const SIZES = {
  default: {
    group: 'flex w-full items-center gap-2',
    option: 'min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold',
    selected: 'border-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]',
    idle: 'border-[var(--border)] bg-[var(--background-elevated)]/60 text-[var(--foreground-muted)] hover:border-[var(--border-hover)] hover:text-[var(--foreground)]',
  },
  compact: {
    group: 'inline-flex items-center gap-0.5 rounded-[9px] border border-[var(--border)] bg-black/20 p-[3px]',
    option: 'whitespace-nowrap rounded-md border px-2 py-[3px] text-[0.71875rem] font-medium',
    selected: 'border-[var(--border-hover)] bg-[var(--surface-hover)] text-[var(--foreground)]',
    idle: 'border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]',
  },
};

export default function SegmentedToggleGroup({
  label,
  ariaDescribedBy,
  options,
  value,
  onChange,
  size = 'default',
}: SegmentedToggleGroupProps) {
  const styles = SIZES[size];
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, optionIndex: number) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
    if (direction === 0 || options.length === 0) return;

    event.preventDefault();
    const nextIndex = (optionIndex + direction + options.length) % options.length;
    onChange(options[nextIndex].value);
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      className={styles.group}
    >
      {options.map((option, optionIndex) => {
        const selected = Object.is(option.value, value);

        return (
          <button
            key={`${String(option.value)}-${optionIndex}`}
            ref={(element) => {
              optionRefs.current[optionIndex] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => {
              if (!option.disabled) onChange(option.value);
            }}
            onKeyDown={(event) => handleKeyDown(event, optionIndex)}
            className={`${styles.option} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? styles.selected : styles.idle
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
