'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

/**
 * A settings chip that states its value and opens its control in place.
 *
 * The image workspace folds the settings that rarely change between runs
 * (shape, size, the rest) into a row of these under the prompt, so the results
 * get the width a settings column used to take. The chip always shows the
 * current value, so folding hides the control, never the choice.
 *
 * Closes on Escape (focus returns to the chip), on a click outside, and when
 * another chip opens, since only one panel at a time fits under the prompt.
 */
export default function ChipPopover({
  label,
  value,
  children,
  panelLabel,
  wide = false,
  variant = 'chip',
  aside,
}: {
  /** What the setting is: "Shape", "Size", "More settings". */
  label: string;
  /** What it is set to, shown in the chip. Omitted for a chip that only opens. */
  value?: ReactNode;
  /** The panel. A function receives `close`, for a panel whose choice ends it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Accessible name of the panel, when the label alone is too terse. */
  panelLabel?: string;
  /** A wider panel, for a group of controls rather than one. */
  wide?: boolean;
  /**
   * `chip` sits in a row of settings under the prompt. `field` fills its
   * container like a select (the rail's engine menu), with `aside` on the right
   * and the panel as wide as the field.
   *
   * A field's panel floats in a portal on `document.body`, placed from the
   * field's box on screen. The rail scrolls inside itself, and a scroll box
   * clips anything absolutely positioned past its edge, so a menu anchored in
   * the rail was cut off wherever the rail was shorter than the list
   * (Pollinations, Cloudflare). A portal leaves the tab order, so opening moves
   * focus into the panel and tabbing out of it closes it.
   */
  variant?: 'chip' | 'field';
  aside?: ReactNode;
}) {
  const field = variant === 'field';
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);

  // Follows the field through page and rail scrolls (capture catches both)
  // and resizes, so the menu stays attached to it.
  useLayoutEffect(() => {
    if (!open || !field) return;
    const measure = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (box) setPlace({ top: box.bottom + 6, left: box.left, width: box.width });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, field]);

  // Waits for the panel to be placed: it renders hidden while it is measured,
  // and a hidden element cannot take focus.
  const placed = place !== null;
  useEffect(() => {
    if (!open || !field || !placed) return;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>('button');
    target?.focus();
  }, [open, field, placed]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== panelId) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('chip-popover:open', onOther);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('chip-popover:open', onOther);
    };
  }, [open, panelId]);

  const close = () => setOpen(false);
  const onPanelBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panelRef.current?.contains(next) && !rootRef.current?.contains(next)) setOpen(false);
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) window.dispatchEvent(new CustomEvent('chip-popover:open', { detail: panelId }));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={
          field
            ? `flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors ${
                open
                  ? 'border-[var(--neon-cyan)]/70 bg-[var(--neon-cyan)]/5'
                  : 'border-[var(--neon-cyan)]/35 bg-[var(--neon-cyan)]/[0.03] hover:border-[var(--neon-cyan)]/60'
              }`
            : `inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
                open
                  ? 'border-[var(--neon-cyan)]/55 text-[var(--neon-cyan)]'
                  : 'border-[var(--border-hover)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
              }`
        }
      >
        {field ? (
          <>
            <span className="sr-only">{label}: </span>
            <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{value ?? label}</span>{' '}
            {aside && <span className="shrink-0 font-mono text-[0.68rem] text-[var(--foreground-subtle)]">{aside}</span>}
          </>
        ) : (
          <>
            <span>{label}</span>{' '}
            {value !== undefined && <span className="font-medium text-[var(--foreground)]">{value}</span>}
          </>
        )}
        <ChevronDown size={13} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !field && (
        <div
          id={panelId}
          role="group"
          aria-label={panelLabel ?? label}
          className={`absolute left-0 top-full z-30 mt-1.5 space-y-3 rounded-(--radius) border border-[var(--border-hover)] bg-[var(--background-elevated)] p-3.5 shadow-[var(--shadow-md)] ${
            wide ? 'w-[min(26rem,calc(100vw-2rem))]' : 'w-[min(20rem,calc(100vw-2rem))]'
          }`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
      {open && field && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={panelLabel ?? label}
          onBlur={onPanelBlur}
          style={place ? { top: place.top, left: place.left, width: place.width, maxHeight: `calc(100dvh - ${place.top}px - 12px)` } : { visibility: 'hidden' }}
          className="fixed z-50 overflow-y-auto rounded-(--radius) border border-[var(--border-hover)] bg-[var(--background-elevated)] p-1.5 shadow-[var(--shadow-md)]"
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body
      )}
    </div>
  );
}
