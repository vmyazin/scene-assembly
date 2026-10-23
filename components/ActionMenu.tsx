'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Loader2, type LucideIcon } from 'lucide-react';

export interface ActionMenuItem {
  id: string;
  label: string;
  /** One line under the label saying what the action does. */
  description?: string;
  icon: LucideIcon;
  /** Called inside the click, so a clipboard write still counts as the gesture. */
  onSelect: () => void;
  danger?: boolean;
}

const GAP = 6;
const EDGE = 8;

/**
 * A ⋯ button that opens a menu of the actions a card does not need on its face.
 *
 * Library cards used to show every action as a button: a finished clip carried
 * eight, three of them full width, so the grid read as a wall of controls and
 * the one thing most people came for (put it on the timeline, use it as a
 * reference) was no louder than Delete. The card now keeps that one action and
 * this menu holds the rest, grouped into sections with a line of explanation.
 *
 * The panel is fixed-position, placed from the button's box on screen, for the
 * reason `ChipPopover` gives: the library sheet scrolls inside itself, and an
 * absolutely positioned panel was clipped at its edge. It opens below the button
 * and flips above when the space below cannot hold it.
 *
 * Inside a modal it is portaled into the modal's own panel, not `document.body`:
 * `useAccessibleDialog` pulls focus back from anything outside the panel, so a
 * menu on the body could never hold keyboard focus there. Escape and Tab are
 * caught on the window before the dialog's document listener, which would
 * otherwise close the whole library for a key meant for the menu.
 *
 * Arrow keys, Home and End move between items; Escape and Tab close it and give
 * focus back to the button, since a portal sits outside the tab order.
 */
export default function ActionMenu({
  label,
  sections,
  disabled = false,
  busy = false,
}: {
  /** Accessible name of the button and the menu. */
  label: string;
  /** Item groups, drawn with a rule between them. Empty groups are skipped. */
  sections: ActionMenuItem[][];
  disabled?: boolean;
  /** Shows a spinner in the button while an action from the menu runs. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const groups = sections.filter((group) => group.length > 0);

  // Renders hidden first, so the panel's real height decides which side it opens on.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!box || !panel) return;
      const width = panel.offsetWidth;
      const height = panel.scrollHeight;
      const below = window.innerHeight - box.bottom - GAP - EDGE;
      const above = box.top - GAP - EDGE;
      const flip = height > below && above > below;
      const left = Math.min(Math.max(EDGE, box.right - width), window.innerWidth - width - EDGE);
      setPlace(
        flip
          ? { top: Math.max(EDGE, box.top - GAP - height), left, maxHeight: above }
          : { top: box.bottom + GAP, left, maxHeight: below }
      );
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  const placed = place !== null;
  useEffect(() => {
    if (open && placed) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      setOpen(false);
      setPlace(null);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) dismiss();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function openMenu() {
    setHost(buttonRef.current?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setPlace(null);
  }

  function closeToButton() {
    close();
    buttonRef.current?.focus();
  }

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
  };

  const select = (item: ActionMenuItem) => {
    closeToButton();
    item.onSelect();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || open) return;
          event.preventDefault();
          openMenu();
        }}
        className={`btn-secondary shrink-0 px-2.5${open ? ' border-[var(--border-hover)] bg-[var(--surface-hover)]' : ''}`}
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Ellipsis size={15} aria-hidden="true" />
        )}
      </button>
      {open && host &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKey}
            style={place ? { top: place.top, left: place.left, maxHeight: place.maxHeight } : { top: 0, left: 0, visibility: 'hidden' }}
            className="fixed z-[80] w-[min(18rem,calc(100vw-1rem))] overflow-y-auto rounded-(--radius) border border-[var(--border-hover)] bg-[var(--background-elevated)] p-1.5 shadow-[var(--shadow-md)]"
          >
            {groups.map((group, index) => (
              <div key={group[0].id} role="group">
                {index > 0 && <div role="separator" className="mx-1 my-1.5 h-px bg-[var(--border-hover)]" />}
                {group.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      // The label alone is the name, so voice control matches what
                      // is on screen; the explanation is read as its description.
                      aria-label={item.label}
                      aria-describedby={item.description ? `${menuId}-${item.id}` : undefined}
                      onClick={() => select(item)}
                      className={`flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none motion-reduce:transition-none ${
                        item.danger ? 'text-red-300' : 'text-[var(--foreground)]'
                      }`}
                    >
                      <Icon
                        size={15}
                        aria-hidden="true"
                        className={`mt-0.5 shrink-0 ${item.danger ? '' : 'text-[var(--foreground-muted)]'}`}
                      />
                      <span className="min-w-0">
                        <span className="block">{item.label}</span>
                        {item.description && (
                          <span id={`${menuId}-${item.id}`} className="mt-0.5 block text-xs leading-snug text-[var(--foreground-subtle)]">
                            {item.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          host
        )}
    </>
  );
}
