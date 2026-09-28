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
}

export default function SegmentedToggleGroup({
  label,
  ariaDescribedBy,
  options,
  value,
  onChange,
}: SegmentedToggleGroupProps) {
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
      className="flex w-full items-center gap-2"
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
            className={`min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? 'border-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]'
                : 'border-[var(--border)] bg-[var(--background-elevated)]/60 text-[var(--foreground-muted)] hover:border-[var(--border-hover)] hover:text-[var(--foreground)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
