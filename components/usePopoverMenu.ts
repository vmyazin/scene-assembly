'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

const GAP = 6;
const EDGE = 8;
/** `menuitem` and `menuitemcheckbox` alike: a switch row takes its turn with the arrows. */
const ITEMS = '[role^="menuitem"]';

/**
 * The behaviour of a menu that opens from a button: where the panel goes, what
 * closes it, and how the keyboard moves through it.
 *
 * It was written inside `ActionMenu`, behind that component's ⋯ button. The
 * header's account menu needed the same panel behind an avatar, and a second
 * copy of the placement and focus rules would have drifted from the first the
 * next time either was fixed. The trigger is the caller's now; everything a
 * menu must do the same way everywhere is here.
 *
 * The panel is fixed-position, placed from the trigger's box on screen, for the
 * reason `ChipPopover` gives: the library sheet scrolls inside itself, and an
 * absolutely positioned panel was clipped at its edge. It opens below the
 * trigger, right edges aligned, and flips above when the space below cannot
 * hold it.
 *
 * Inside a modal it is portaled into the modal's own panel, not `document.body`:
 * `useAccessibleDialog` pulls focus back from anything outside the panel, so a
 * menu on the body could never hold keyboard focus there. Escape and Tab are
 * caught on the window before the dialog's document listener, which would
 * otherwise close the whole library for a key meant for the menu.
 *
 * Focus moves to the first item once the panel is placed. Arrow keys, Home and
 * End move between items; Escape and Tab close it and give focus back to the
 * trigger, since a portal sits outside the tab order.
 */
export function usePopoverMenu<Trigger extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const menuId = useId();
  const triggerRef = useRef<Trigger>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Renders hidden first, so the panel's real height decides which side it opens on.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = triggerRef.current?.getBoundingClientRect();
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
    if (open && placed) panelRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [open, placed]);

  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
  }, []);

  const closeToTrigger = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      closeToTrigger();
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, close, closeToTrigger]);

  const openMenu = useCallback(() => {
    setHost(triggerRef.current?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body);
    setOpen(true);
  }, []);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    const current = document.activeElement as HTMLElement;
    const at = items.indexOf(current);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === ' ' && at >= 0 && current.tagName === 'A') {
      // A button already answers Space; a link only answers Enter, and a menu
      // item that ignores one of the two reads as broken.
      event.preventDefault();
      current.click();
    }
  };

  const panelStyle: CSSProperties = place
    ? { top: place.top, left: place.left, maxHeight: place.maxHeight }
    : { top: 0, left: 0, visibility: 'hidden' };

  return {
    open,
    /** Null until the first open: the portal target is read from the trigger. */
    host,
    menuId,
    triggerRef,
    panelRef,
    panelStyle,
    openMenu,
    close,
    closeToTrigger,
    onPanelKeyDown,
    /** Spread onto the trigger: the ARIA state, click to toggle, ArrowDown to open. */
    triggerProps: {
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      'aria-controls': open ? menuId : undefined,
      onClick: () => (open ? close() : openMenu()),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'ArrowDown' || open) return;
        event.preventDefault();
        openMenu();
      },
    },
  };
}
