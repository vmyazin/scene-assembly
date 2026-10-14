import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConfirmDialog from '../components/ConfirmDialog';
import { ModalBody, ModalHeader, ModalShell } from '../components/ModalShell';

function SheetFixture({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <ModalShell open={open} onClose={close} labelledBy="sheet-title" describedBy="sheet-desc" className="max-w-4xl">
        <ModalHeader icon={null} title="Sheet" titleId="sheet-title" description="What it is for" descriptionId="sheet-desc" onClose={close} />
        <ModalBody>
          <button>Inside</button>
        </ModalBody>
      </ModalShell>
    </>
  );
}

afterEach(() => {
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

describe('ModalShell', () => {
  it('names the dialog from its header and returns focus to the opener after Escape', async () => {
    render(<SheetFixture />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Sheet' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('What it is for');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('closes from the backdrop and the close button, but not from a click inside the panel', async () => {
    const onClose = vi.fn();
    render(<SheetFixture onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inside' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders ConfirmDialog as a named alert dialog that cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete this?" description="It cannot come back." confirmLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this?' });
    expect(dialog).toHaveAccessibleDescription('It cannot come back.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
