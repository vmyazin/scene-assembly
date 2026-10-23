import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CloudAssetGrid from '@/components/account/CloudAssetGrid';
import { ModalShell } from '@/components/ModalShell';
import type { CloudAsset, CloudJobRequest } from '@/lib/account/contracts';
import { useAccountStore } from '@/store/useAccountStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';

const { extractLastFrameMock } = vi.hoisted(() => ({ extractLastFrameMock: vi.fn() }));

vi.mock('@/lib/account/use-library', () => ({ formatAccountBytes: (n: number) => `${n} B` }));
vi.mock('@/lib/video-frame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/video-frame')>()),
  extractLastFrame: extractLastFrameMock,
}));

const request: CloudJobRequest = {
  provider: 'atlas', modelId: 'video-model', mediaType: 'video', inputMode: 'text',
  prompt: 'Static webcam shot behind a pane of glass', values: { duration: '5' }, referenceIds: [],
};
const clip: CloudAsset = { id: 'clip-1', kind: 'video', mimeType: 'video/mp4', bytes: 1600, createdAt: 1, jobId: 'job-1', metadata: request };
const still: CloudAsset = {
  id: 'image-1', kind: 'image', mimeType: 'image/png', bytes: 1400, createdAt: 2, jobId: 'job-2',
  metadata: { ...request, mediaType: 'image', prompt: 'A founder explainer still' },
};

function cardOf(prompt: string) {
  return screen.getByText(prompt).closest('li')!;
}

function openMenu(prompt: string) {
  fireEvent.click(within(cardOf(prompt)).getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu', { name: 'More actions' });
}

describe('the cloud library card menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.getState().applySession({ account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' }, googleEnabled: true, localSignIn: true, providers: [], connections: [] });
    useDraftStore.getState().reset();
    useSeedFrameStore.getState().clearSeedFrame();
    extractLastFrameMock.mockResolvedValue(new Blob(['frame'], { type: 'image/png' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps one action on the face of a clip and the rest in the menu', () => {
    render(<CloudAssetGrid assets={[clip]} ownerId="owner-1" onUsedReference={vi.fn()} onChanged={vi.fn()} />);
    const card = cardOf(clip.metadata.prompt);

    expect(within(card).getByRole('button', { name: /Add to timeline/ })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Save last frame/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: /Download/ })).toBeNull();

    const menu = openMenu(clip.metadata.prompt);
    expect(within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Continue from last frame', 'Save last frame', 'Reuse settings', 'Download video', 'Delete…',
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Save last frame' })).toHaveAccessibleDescription('Download the closing frame as a PNG');
  });

  it('offers no last-frame actions on an image', () => {
    render(<CloudAssetGrid assets={[still]} ownerId="owner-1" onChanged={vi.fn()} />);
    const menu = openMenu(still.metadata.prompt);

    expect(within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Reuse settings', 'Download image', 'Delete…',
    ]);
  });

  it('reuses the prompt and settings of the run, and closes', () => {
    const onUsedReference = vi.fn();
    render(<CloudAssetGrid assets={[clip]} ownerId="owner-1" onUsedReference={onUsedReference} onChanged={vi.fn()} />);

    fireEvent.click(within(openMenu(clip.metadata.prompt)).getByRole('menuitem', { name: 'Reuse settings' }));

    expect(useDraftStore.getState().prompt).toBe(clip.metadata.prompt);
    expect(onUsedReference).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('continues from the last frame by seeding the next draft', async () => {
    const onUsedReference = vi.fn();
    render(<CloudAssetGrid assets={[clip]} ownerId="owner-1" onUsedReference={onUsedReference} onChanged={vi.fn()} />);

    fireEvent.click(within(openMenu(clip.metadata.prompt)).getByRole('menuitem', { name: 'Continue from last frame' }));

    await waitFor(() => expect(onUsedReference).toHaveBeenCalledOnce());
    expect(extractLastFrameMock).toHaveBeenCalledWith('/api/account/assets/clip-1/content');
    expect(useSeedFrameStore.getState().seed?.file.type).toBe('image/png');
  });

  it('asks before deleting', () => {
    render(<CloudAssetGrid assets={[clip]} ownerId="owner-1" onChanged={vi.fn()} />);

    fireEvent.click(within(openMenu(clip.metadata.prompt)).getByRole('menuitem', { name: 'Delete…' }));

    expect(screen.getByRole('alertdialog', { name: 'Delete this saved asset?' })).toBeInTheDocument();
  });

  it('moves with the arrow keys and gives focus back on Escape', async () => {
    render(<CloudAssetGrid assets={[clip]} ownerId="owner-1" onChanged={vi.fn()} />);
    const trigger = within(cardOf(clip.metadata.prompt)).getByRole('button', { name: 'More actions' });

    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Save last frame' })).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Reuse settings' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(within(menu).getByRole('menuitem', { name: 'Delete…' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('works inside the library sheet: keeps focus there, and Escape closes only the menu', async () => {
    const onClose = vi.fn();
    render(
      <ModalShell open onClose={onClose} label="Library" className="">
        <CloudAssetGrid assets={[clip]} ownerId="owner-1" onChanged={vi.fn()} />
      </ModalShell>
    );
    const dialog = screen.getByRole('dialog', { name: 'Library' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'More actions' }));
    const menu = within(dialog).getByRole('menu');
    const first = within(menu).getByRole('menuitem', { name: 'Save last frame' });
    await waitFor(() => expect(first).toHaveFocus());

    fireEvent.keyDown(first, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'More actions' })).toHaveFocus();
  });
});
