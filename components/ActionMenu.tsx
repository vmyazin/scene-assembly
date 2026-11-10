'use client';

import { createPortal } from 'react-dom';
import { Ellipsis, Loader2, type LucideIcon } from 'lucide-react';

import { usePopoverMenu } from '@/components/usePopoverMenu';

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

/**
 * A ⋯ button that opens a menu of the actions a card does not need on its face.
 *
 * Library cards used to show every action as a button: a finished clip carried
 * eight, three of them full width, so the grid read as a wall of controls and
 * the one thing most people came for (put it on the timeline, use it as a
 * reference) was no louder than Delete. The card now keeps that one action and
 * this menu holds the rest, grouped into sections with a line of explanation.
 *
 * Placement, dismissal and keyboard handling come from `usePopoverMenu`, which
 * the header's account menu shares: the panel is fixed-position and portaled
 * (into the modal's own panel when inside one), arrow keys, Home and End move
 * between items, and Escape and Tab close it and give focus back to the button.
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
  const { open, host, menuId, triggerRef, panelRef, panelStyle, closeToTrigger, onPanelKeyDown, triggerProps } =
    usePopoverMenu<HTMLButtonElement>();
  const groups = sections.filter((group) => group.length > 0);

  const select = (item: ActionMenuItem) => {
    closeToTrigger();
    item.onSelect();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        {...triggerProps}
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
            onKeyDown={onPanelKeyDown}
            style={panelStyle}
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
