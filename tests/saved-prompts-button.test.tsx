import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SavedPromptsButton from '@/components/SavedPromptsButton';
import StudioHeader from '@/components/StudioHeader';
import { useDraftStore } from '@/store/useDraftStore';
import { useLibraryDialog } from '@/store/useLibraryDialog';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';

// The header also renders the ⌘K palette, which keeps its state in the URL.
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

describe('the prompt panel saved prompts button', () => {
  beforeEach(() => {
    useLibraryDialog.setState({ open: false, tab: 'results' });
    usePromptLibraryStore.setState({ history: [], favourites: [] });
    useDraftStore.getState().setPrompt('');
  });

  it('opens the header-owned library on saved prompts and loads the one picked', () => {
    usePromptLibraryStore.getState().remember('A lighthouse at dusk, long exposure');
    render(<><StudioHeader active="image" /><SavedPromptsButton /></>);

    fireEvent.click(screen.getByRole('button', { name: 'Saved prompts' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'A lighthouse at dusk, long exposure' }));
    expect(useDraftStore.getState().prompt).toBe('A lighthouse at dusk, long exposure');
    expect(useLibraryDialog.getState().open).toBe(false);
  });

  it('leaves the header Library button opening results', () => {
    useLibraryDialog.getState().openLibrary('prompts');
    useLibraryDialog.getState().setOpen(false);
    useLibraryDialog.getState().openLibrary();

    expect(useLibraryDialog.getState()).toMatchObject({ open: true, tab: 'results' });
  });
});
