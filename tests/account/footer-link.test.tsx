import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Same mocks as tests/spend/entry-points.test.tsx, which also renders Home.
vi.mock('next/dynamic', () => ({ default: () => () => null }));
// The studio forwards ?workspace=timeline to the editor's own route, so it
// asks for a router these suites never mount one for.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => 'div' }),
}));
vi.mock('@/components/ApiKeyConfig', () => ({ default: () => null }));
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/FeatureSelector', () => ({ default: () => null }));
vi.mock('@/components/VideoWorkspace', () => ({ default: () => null }));

import Home from '@/app/page';
import { useAccountStore } from '@/store/useAccountStore';

function renderHome() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  render(<Home />);
}

// tests/setup.ts starts every component test from a resolved guest identity,
// so each case below states the session it wants.
afterEach(() => vi.restoreAllMocks());

describe('the footer account link', () => {
  it('sends someone signed in to their account', () => {
    useAccountStore.getState().applySession({
      account: { id: 'owner-1', name: 'Vasily', email: 'v@example.test' },
      googleEnabled: true,
      localSignIn: false,
      providers: [],
      connections: [],
    });

    renderHome();

    expect(screen.getByRole('link', { name: /Account.*v@example\.test/ })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('offers to sign a guest in once the session says there is nobody', () => {
    useAccountStore.getState().applySession({
      account: null,
      googleEnabled: true,
      localSignIn: false,
      providers: [],
      connections: [],
    });

    renderHome();

    // Scoped to the footer: the studio header carries a Sign in link of its own.
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(footer.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('waits for a definite answer before offering to sign anyone in', () => {
    // The session resolves after paint. Guessing "Sign in" here would flip the
    // row out from under someone who is already signed in; /account redirects a
    // guest to sign-in anyway, so the link is never broken while we wait.
    useAccountStore.setState({ session: null, status: 'loading' });

    renderHome();

    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
  });

  it('still offers the account when the service cannot be reached', () => {
    // /sign-in explains an outage; a row that vanishes explains nothing.
    useAccountStore.getState().unavailable();

    renderHome();

    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
  });
});
