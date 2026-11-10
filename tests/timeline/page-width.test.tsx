import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Home from '../../app/page';

// The workspace the page is on comes from the query string, which is the only
// input these assertions need; everything heavy the page mounts is stubbed.
const workspaceValue = { current: null as string | null };
const replace = vi.fn();

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('nuqs', () => ({
  useQueryState: (key: string) => [key === 'workspace' ? workspaceValue.current : null, vi.fn()],
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => 'div' }),
}));
vi.mock('@/components/ApiKeyConfig', () => ({ default: () => null }));
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/FeatureSelector', () => ({ default: () => null }));
vi.mock('@/components/VideoWorkspace', () => ({ default: () => null }));

function renderAt(workspace: string | null) {
  workspaceValue.current = workspace;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const view = render(<Home />);
  const main = view.container.querySelector('main')!;
  const header = view.container.querySelector('header > div')!;
  return { main, header, view };
}

afterEach(() => {
  vi.restoreAllMocks();
  replace.mockClear();
  workspaceValue.current = null;
});

/**
 * The timeline used to widen this page to the account console's 110rem column.
 * It runs on /timeline with a shell of its own now — a fixed three-band editor
 * rather than a document — so the studio is back to one width. The header row
 * above it is capped separately, at that same 110rem.
 */
describe('studio page column', () => {
  it.each([null, 'video'])('keeps the %s workspace on the studio column', (workspace) => {
    const { main } = renderAt(workspace);

    expect(main.className).toContain('max-w-7xl');
    expect(main.className).not.toContain('max-w-[110rem]');
  });

  it.each([null, 'video'])('runs the %s header row wider than the column beneath it', (workspace) => {
    // The header's cap is its own, not the studio's: the row reaches the
    // account console's 110rem so the identity control sits near the screen's
    // edge, and the workspaces stay where they were.
    const { main, header } = renderAt(workspace);

    expect(header.className).toContain('max-w-[110rem]');
    expect(header.className).not.toContain('max-w-7xl');
    expect(main.className).not.toContain('max-w-[110rem]');
  });
});

describe('reaching the timeline editor', () => {
  it('sends the switcher to the editor route', () => {
    renderAt(null);

    expect(screen.getByTitle('Timeline')).toHaveAttribute('href', '/timeline');
  });

  it('forwards the query param the editor used to live behind', () => {
    // ?workspace=timeline is in bookmarks and in links already shared, so it
    // has to land somewhere real. `replace`, not `push`: Back should leave the
    // editor, not bounce between it and the redirect.
    renderAt('timeline');

    expect(replace).toHaveBeenCalledWith('/timeline');
  });

  it('leaves the studio column alone while it forwards', () => {
    const { main } = renderAt('timeline');

    expect(main.className).toContain('max-w-7xl');
  });
});
