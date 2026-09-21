import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImageLightbox from '../components/ImageLightbox';
import { useAccessibleDialog } from '../hooks/useAccessibleDialog';

function Dialog({
  label,
  open,
  onClose,
  children,
}: {
  label: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useAccessibleDialog({ open, onClose, dialogRef });

  if (!open) return null;
  return (
    <section ref={dialogRef} role="dialog" aria-label={label} aria-modal="true" tabIndex={-1}>
      {children}
    </section>
  );
}

function DialogFixture() {
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={openerRef} onClick={() => setPrimaryOpen(true)}>Open primary</button>
      <Dialog label="Primary" open={primaryOpen} onClose={() => setPrimaryOpen(false)}>
        <button onClick={() => setNestedOpen(true)}>Open nested</button>
        <button>Primary last</button>
        <button onClick={() => setPrimaryOpen(false)}>Close primary</button>
        <Dialog label="Nested" open={nestedOpen} onClose={() => setNestedOpen(false)}>
          <button>Nested first</button>
          <button onClick={() => setNestedOpen(false)}>Close nested</button>
        </Dialog>
      </Dialog>
    </>
  );
}

afterEach(() => {
  document.documentElement.style.overflow = '';
  document.documentElement.style.overscrollBehavior = '';
  document.body.style.overflow = '';
  document.body.style.overscrollBehavior = '';
});

describe('accessible dialogs', () => {
  it('focuses the dialog, locks both scroll containers, and restores styles and opener on close', async () => {
    document.documentElement.style.overflow = 'scroll';
    document.documentElement.style.overscrollBehavior = 'contain';
    document.body.style.overflow = 'auto';
    document.body.style.overscrollBehavior = 'none';

    render(<DialogFixture />);
    const opener = screen.getByRole('button', { name: 'Open primary' });
    opener.focus();
    fireEvent.click(opener);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Primary' })).toHaveFocus();
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.body.style.overflow).toBe('hidden');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close primary' }));
    await waitFor(() => {
      expect(document.documentElement.style.overflow).toBe('scroll');
      expect(document.documentElement.style.overscrollBehavior).toBe('contain');
      expect(document.body.style.overflow).toBe('auto');
      expect(document.body.style.overscrollBehavior).toBe('none');
      expect(opener).toHaveFocus();
    });
  });

  it('wraps Tab from the last control to the first and Shift+Tab from the first to the last', async () => {
    render(<DialogFixture />);
    const opener = screen.getByRole('button', { name: 'Open primary' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Primary' });
    const controls = screen.getAllByRole('button').filter((button) => dialog.contains(button));
    const first = controls[0];
    const last = controls[controls.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('closes only the topmost nested dialog per Escape and keeps the body locked until the parent closes', async () => {
    render(<DialogFixture />);
    const opener = screen.getByRole('button', { name: 'Open primary' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole('button', { name: 'Open nested' }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Nested' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nested' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Primary' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Primary' })).toBeNull();
      expect(document.body.style.overflow).toBe('');
      expect(document.documentElement.style.overflow).toBe('');
    });
  });

  it('exposes ImageLightbox as a named modal with a close affordance and Escape handler', async () => {
    const onClose = vi.fn();
    const { container } = render(<ImageLightbox src="/preview.png" open onClose={onClose} />);

    const dialog = await screen.findByRole('dialog', { name: 'Image preview' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    // Framer Motion keeps the entering portal at opacity 0 in jsdom; the
    // accessible, rendered close control is the observable affordance here.
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
