import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecentCreations from '../components/RecentCreations';
import RecentCreationGrid from '../components/RecentCreationGrid';
import { useAccountStore } from '../store/useAccountStore';
import { useGalleryStore } from '../store/useGalleryStore';
import { useLibraryDialog } from '../store/useLibraryDialog';

const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/account/use-library', () => ({ useAccountLibrary: read }));
vi.mock('../components/account/CloudAssetGrid', () => ({ default: ({ ownerId }: { ownerId: string }) => <div>Cloud {ownerId}</div> }));
vi.mock('../components/GalleryGrid', () => ({ default: () => <div>Browser results</div> }));
vi.mock('../components/video/VideoPlayer', () => ({ default: () => <div>Video preview</div> }));
beforeEach(() => {
  useAccountStore.setState({ status: 'ready', session: null, epoch: 0 });
  useGalleryStore.setState({ hydrated: true, records: [], storageError: null });
  vi.spyOn(useGalleryStore.getState(), 'hydrate').mockResolvedValue();
  read.mockReturnValue({ assets: [{ id: 'a' }], loading: false, error: null, refresh: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); read.mockClear(); });

describe('recent creation sources', () => {
  it('renders nothing for a guest with no creations', () => {
    const view = render(<RecentCreations />);
    expect(view.container).toBeEmptyDOMElement();
    expect(read).not.toHaveBeenCalled();
  });
  it('shows browser results with a link to the real library dialog', () => {
    useGalleryStore.setState({ records: [{ id: 'r' }] as never });
    render(<RecentCreations />);
    expect(screen.getByText('Browser results')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View library →' }));
    expect(useLibraryDialog.getState().open).toBe(true);
  });
  it('waits for session resolution instead of flashing browser results', () => {
    useAccountStore.setState({ status: 'loading' });
    const view = render(<RecentCreations />);
    expect(view.container).toBeEmptyDOMElement();
    expect(read).not.toHaveBeenCalled();
  });
  it('renders nothing for an account with an empty library', () => {
    read.mockReturnValue({ assets: [], loading: false, error: null, refresh: vi.fn() });
    useAccountStore.setState({ status: 'ready', session: { account: { id: 'owner-a', name: 'Test', email: 'test@example.test' }, providers: [], connections: [], googleEnabled: false, localSignIn: true } });
    const view = render(<RecentCreations />);
    expect(view.container).toBeEmptyDOMElement();
  });
  it('keys cloud reads to the current owner and does not render the browser library', () => {
    const session = { account: { id: 'owner-a', name: 'Test', email: 'test@example.test' }, providers: [], connections: [], googleEnabled: false, localSignIn: true };
    useAccountStore.setState({ status: 'ready', session });
    const view = render(<RecentCreations />);
    expect(screen.getByText('Cloud owner-a')).toBeVisible();
    useAccountStore.setState({ session: { ...session, account: { ...session.account, id: 'owner-b' } }, epoch: 1 });
    view.rerender(<RecentCreations />);
    expect(screen.queryByText('Cloud owner-a')).not.toBeInTheDocument();
    expect(screen.getByText('Cloud owner-b')).toBeVisible();
    expect(screen.queryByText('Browser results')).not.toBeInTheDocument();
  });
  it('keeps a sparse result visible and actionable', () => {
    render(<RecentCreationGrid items={[{ id: 'sparse', kind: 'image', title: 'Untitled result', provider: 'gemini' }]} />);
    expect(screen.getByText('Preview unavailable · Open library')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open library: Untitled result' }));
    expect(useLibraryDialog.getState().open).toBe(true);
  });
});
