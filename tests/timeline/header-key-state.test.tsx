import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TimelinePage from '../../app/timeline/page';
import { useAccountStore } from '../../store/useAccountStore';
import { useAppStore } from '../../store/useAppStore';

/** The workspace itself is irrelevant here — this is about the header above it. */
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/timeline',
}));
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/ApiKeyConfig', () => ({ default: () => null }));
vi.mock('@/components/LibraryOverlay', () => ({ default: () => null }));

/** The persist key `useAppStore` writes under. */
const STORAGE_KEY = 'scene-assembly-store';

/**
 * A browser that has a key saved from a previous visit, before anything has
 * rehydrated — which is the state every fresh page load starts in, because the
 * store sets `skipHydration` to avoid an SSR mismatch.
 *
 * The payload is produced by the store itself rather than hand-written, so this
 * cannot drift from `partialize`.
 */
function browserWithSavedKey() {
  useAppStore.setState({ falApiKey: 'fal-key', hasHydrated: true });
  const persisted = localStorage.getItem(STORAGE_KEY);
  // Clearing the state writes the empty value back out, so the fixture is put
  // back afterwards — this has to look like a reload, not like a sign-out.
  useAppStore.setState({ apiKey: '', kieApiKey: '', falApiKey: '', hasHydrated: false });
  if (persisted) localStorage.setItem(STORAGE_KEY, persisted);
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ apiKey: '', kieApiKey: '', falApiKey: '', runwareApiKey: '', hasHydrated: false });
  useAccountStore.setState({ session: null });
});

afterEach(() => vi.restoreAllMocks());

/**
 * The header used to be inline in `app/page.tsx`, and so was the mount effect
 * that rehydrates the persisted store. Moving the header onto a second route
 * left that effect behind: on /timeline `hasHydrated` never became true, so a
 * user whose keys were set was shown the bright "Add API Keys" call to action —
 * the loudest element in the header, asking them to do something they had
 * already done.
 */
describe('the timeline header reads the same key state as the studio', () => {
  it('confirms a key saved in this browser instead of asking for one', async () => {
    browserWithSavedKey();

    render(<TimelinePage />);

    expect(await screen.findByTitle('Manage provider connections')).toBeInTheDocument();
    expect(screen.queryByTitle('Connect a provider')).not.toBeInTheDocument();
  });

  it('still asks a browser that genuinely has no key', async () => {
    render(<TimelinePage />);

    expect(await screen.findByTitle('Connect a provider')).toBeInTheDocument();
  });

  it('hydrates the store rather than waiting for another route to do it', async () => {
    browserWithSavedKey();
    expect(useAppStore.getState().hasHydrated).toBe(false);

    render(<TimelinePage />);

    await waitFor(() => expect(useAppStore.getState().hasHydrated).toBe(true));
    expect(useAppStore.getState().falApiKey).toBe('fal-key');
  });
});

/**
 * UX audit M1: the button counted only the Gemini, Kie and fal browser keys, so
 * a signed-in person with eight connections saved to their account was still
 * told to "Add API Keys".
 */
describe('the header counts every place a key can live', () => {
  it('confirms keys saved to the account, with none in this browser', async () => {
    useAccountStore.setState({
      session: { connections: [{ id: 'c1', provider: 'gemini', revision: 1, hint: 'jUtA' }] },
    } as unknown as Partial<ReturnType<typeof useAccountStore.getState>>);

    render(<TimelinePage />);

    expect(await screen.findByTitle('Manage provider connections')).toBeInTheDocument();
  });

  it('confirms a browser key for an engine outside the original three', async () => {
    useAppStore.setState({ runwareApiKey: 'rw-key', hasHydrated: true });
    const persisted = localStorage.getItem(STORAGE_KEY);
    useAppStore.setState({ runwareApiKey: '', hasHydrated: false });
    if (persisted) localStorage.setItem(STORAGE_KEY, persisted);

    render(<TimelinePage />);

    expect(await screen.findByTitle('Manage provider connections')).toBeInTheDocument();
  });
});
