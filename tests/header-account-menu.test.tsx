import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => 'div' }),
}));
vi.mock('@/components/ApiKeyConfig', () => ({ default: () => null }));
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/LibraryOverlay', () => ({ default: () => null }));
vi.mock('@/components/FeatureSelector', () => ({ default: () => null }));
vi.mock('@/components/VideoWorkspace', () => ({ default: () => null }));

import Home from '@/app/page';
import StudioHeader from '@/components/StudioHeader';
import { brand } from '@/lib/brand';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useConnectionsDialog } from '@/store/useConnectionsDialog';

const ada = { id: 'owner-1', name: 'Ada Lovelace', email: 'ada@example.test' };
const session = (account: AccountSession['account']): AccountSession => ({
  account,
  googleEnabled: true,
  localSignIn: false,
  providers: [],
  connections: account ? [{ id: 'c1', provider: 'fal', revision: 1, hint: '…abcd' }, { id: 'c2', provider: 'kie', revision: 1, hint: '…efgh' }] : [],
});

/** Answers the two account reads the menu makes, and records every request. */
function stubFetch({ signOutOk = true }: { signOutOk?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;
    if (url.includes('/api/account/sign-out')) return signOutOk ? reply({ ok: true }) : reply({ error: 'Sign-out failed upstream.' }, false);
    if (url.includes('/api/account/session')) return reply(session(null));
    if (url.includes('/api/account/spend/totals')) return reply({ accountId: ada.id, totals: { costUsd: 12.4 } });
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function signIn() {
  act(() => useAccountStore.getState().applySession(session(ada)));
}

function renderHeader(props: Partial<React.ComponentProps<typeof StudioHeader>> = {}) {
  return render(<StudioHeader active="home" onSelectWorkspace={vi.fn()} {...props} />);
}

function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Account menu' });
  fireEvent.click(trigger);
  return { trigger, menu: screen.getByRole('menu', { name: 'Account menu' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ apiKey: '', kieApiKey: '', falApiKey: '', uiSoundsEnabled: false });
  useConnectionsDialog.setState({ open: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the header identity slot for a guest', () => {
  it('is a quiet link to sign-in, never a primary button', () => {
    renderHeader();

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/sign-in');
    expect(link).toHaveTextContent('Sign in');
    // No fill, no border, neither shared button style: account promotion is
    // what AGENTS.md rules out, and a filled button is promotion.
    expect(link.className).not.toMatch(/btn-primary|btn-secondary|\bbg-|\bborder\b/);
    // The text hides below `lg` (the one-row header has no room for it at
    // 768), where the label is all that names the icon.
    expect(within(link).getByText('Sign in').className).toContain('hidden lg:inline');
  });

  it('leaves Connections as the primary action and offers no account menu', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'Connections' }).className).toContain('btn-primary');
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('sits last in the header row', () => {
    const { container } = renderHeader();

    const cluster = screen.getByRole('button', { name: 'Connections' }).parentElement!;
    expect(cluster.lastElementChild).toBe(container.querySelector('[data-account-slot="guest"]'));
  });
});

describe('the header identity slot while the session resolves', () => {
  it('reserves its place and offers nothing to click', () => {
    act(() => useAccountStore.setState({ session: null, status: 'loading' }));
    const { container } = renderHeader();

    const slot = container.querySelector('[data-account-slot="loading"]')!;
    expect(slot.className).toContain('h-11 w-11');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(slot.querySelector('a, button')).toBeNull();
    // The flash this exists to prevent: "Sign in" shown to someone signed in.
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });

  it('goes straight from the placeholder to the avatar', () => {
    act(() => useAccountStore.setState({ session: null, status: 'loading' }));
    renderHeader();

    signIn();

    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('drops the slot when the account service cannot be reached', () => {
    act(() => useAccountStore.setState({ status: 'unavailable' }));
    const { container } = renderHeader();

    expect(container.querySelector('[data-account-slot]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});

describe('the header account menu', () => {
  beforeEach(() => {
    stubFetch();
  });

  it('is an avatar button that announces a closed menu', () => {
    renderHeader();
    signIn();

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.className).toContain('h-11');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists who is signed in and every account destination', async () => {
    renderHeader();
    signIn();
    const { trigger, menu } = openMenu();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(within(menu).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(menu).getByText('ada@example.test')).toBeInTheDocument();

    expect(within(menu).getByRole('menuitem', { name: /Your account/ })).toHaveAttribute('href', '/account');
    expect(within(menu).getByRole('menuitem', { name: /Spend/ })).toHaveAttribute('href', '/spend');
    expect(within(menu).getByRole('menuitem', { name: /Connections/ })).toHaveTextContent('2 saved');
    expect(within(menu).getByRole('menuitem', { name: 'Connected agents' })).toHaveAttribute('href', '/account');
    expect(within(menu).getByRole('menuitem', { name: 'MCP docs' })).toHaveAttribute('href', '/docs/mcp');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Interface sounds' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();

    // The all-time total, from the same Worker read the footer makes.
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: /Spend/ })).toHaveTextContent('$12.40'));
  });

  it('opens the connections dialog from its row', () => {
    renderHeader();
    signIn();
    const { menu } = openMenu();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Connections/ }));

    expect(useConnectionsDialog.getState().open).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('flips interface sounds and stays open to show it', () => {
    renderHeader();
    signIn();
    const { menu } = openMenu();
    const sounds = within(menu).getByRole('menuitemcheckbox', { name: 'Interface sounds' });
    expect(sounds).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sounds);

    expect(useAppStore.getState().uiSoundsEnabled).toBe(true);
    expect(sounds).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('leaves the sounds row out where the page makes no sound', () => {
    renderHeader({ active: 'timeline', showChime: false });
    signIn();
    const { menu } = openMenu();

    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('moves focus into the menu, walks it with the arrow keys, and wraps', () => {
    renderHeader();
    signIn();
    const { menu } = openMenu();
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));

    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    expect(items.at(-1)).toHaveAccessibleName('Sign out');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });

  it('opens from the keyboard and activates a link with Space', () => {
    renderHeader();
    signIn();
    const trigger = screen.getByRole('button', { name: 'Account menu' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const account = within(screen.getByRole('menu')).getByRole('menuitem', { name: /Your account/ });
    expect(account).toHaveFocus();

    const clicked = vi.fn((event: Event) => event.preventDefault());
    account.addEventListener('click', clicked);
    fireEvent.keyDown(account, { key: ' ' });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it.each(['Escape', 'Tab'])('closes on %s and hands focus back to the avatar', (key) => {
    renderHeader();
    signIn();
    const { trigger } = openMenu();

    fireEvent.keyDown(document.activeElement!, { key });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a press outside it, and not on one inside', () => {
    renderHeader();
    signIn();
    const { menu } = openMenu();

    fireEvent.pointerDown(within(menu).getByText('Ada Lovelace'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the avatar is pressed again', () => {
    renderHeader();
    signIn();
    const { trigger } = openMenu();

    fireEvent.click(trigger);

    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('signing out from the studio header', () => {
  it('ends the session and leaves the person on the page as a guest', async () => {
    const fetchMock = stubFetch();
    renderHeader();
    signIn();
    const { menu } = openMenu();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/account/sign-out'))!;
    expect(call[1]).toMatchObject({ method: 'POST', headers: { 'X-Account-Id': ada.id } });
    expect(useAccountStore.getState().session?.account).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
    // /account sends a signed-out person to /sign-in; the studio must not.
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('still lands on the guest state when the first session read is discarded', async () => {
    // What the live page does: `AccountSessionProvider` hears the sign-out on
    // the BroadcastChannel and clears the store again while the session read is
    // in flight, so that read's answer is dropped for a stale epoch. Without a
    // second read the slot sat on its loading ring for a minute.
    const fetchMock = stubFetch();
    let sessionReads = 0;
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes('/api/account/session') && ++sessionReads === 1) useAccountStore.getState().clear();
      return answer(input, init);
    });
    renderHeader();
    signIn();
    const { menu } = openMenu();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument());
    expect(sessionReads).toBe(2);
    expect(useAccountStore.getState().status).toBe('ready');
  });

  it('keeps the session when the service refuses', async () => {
    const fetchMock = stubFetch({ signOutOk: false });
    renderHeader();
    signIn();
    const { menu } = openMenu();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Account menu' })).toBeEnabled());
    expect(useAccountStore.getState().session?.account?.id).toBe(ada.id);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('the trimmed header', () => {
  it('has no tagline and no sound button, and keeps the rest', () => {
    const { container } = renderHeader();
    const header = container.querySelector('header')!;

    expect(header).not.toHaveTextContent(brand.tagline);
    expect(within(header).queryByRole('button', { name: /interface sounds/i })).toBeNull();
    expect(within(header).getByRole('button', { name: 'Library' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Connections' })).toBeInTheDocument();
    expect(within(header).getByTitle('Open command menu (⌘K)')).toBeInTheDocument();
    expect(within(within(header).getByRole('navigation', { name: 'Workspace' })).getAllByText(/^(Image|Video|Timeline)$/)).toHaveLength(3);
  });

  it('puts the workspace tabs beside the wordmark, not in the middle of the row', () => {
    // Three items under `justify-between` left the tabs floating near the
    // centre once the row widened to 110rem and lost its tagline. From `sm` up
    // the row packs left and only the last cluster is pushed to the right.
    renderHeader();
    const home = screen.getByRole('link', { name: 'Go to Scene Assembly home' });
    const tabs = screen.getByRole('navigation', { name: 'Workspace' });
    const row = home.parentElement!;
    const cluster = screen.getByRole('button', { name: 'Connections' }).parentElement!;

    expect(Array.from(row.children)).toEqual([home, tabs, cluster]);
    expect(row.className).toContain('sm:justify-start');
    expect(row.className).not.toMatch(/sm:justify-between/);
    expect(cluster.className).toContain('sm:ml-auto');
    expect(tabs.className).not.toMatch(/m[lx]-auto/);
    // Phones keep two rows: wordmark and buttons apart on the first, the tabs
    // full width on the second.
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('justify-between');
    expect(tabs.className).toContain('order-last');
    expect(tabs.className).toContain('w-full');
    expect(tabs.className).toContain('sm:order-none');
    expect(tabs.className).toContain('sm:w-auto');
  });

  it('leaves the footer its sound control, for guests who have no menu', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const { container } = render(<Home />);

    expect(within(container.querySelector('header')!).queryByRole('button', { name: /interface sounds/i })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /interface sounds/i })).toBeInTheDocument();
  });
});
