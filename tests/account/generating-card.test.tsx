import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountPage from '@/app/account/page';
import type { CloudAsset, CloudJobRequest, CloudJobView } from '@/lib/account/contracts';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/account/session', () => ({ refreshAccount: vi.fn(), accountChanged: vi.fn() }));
vi.mock('@/components/account/AccountConnections', () => ({ default: () => <section>Connections</section> }));
vi.mock('@/components/account/AccountKeyImport', () => ({ default: () => <section>Key import</section> }));
vi.mock('@/components/account/AccountDeletion', () => ({ default: () => <section>Deletion</section> }));

const request: CloudJobRequest = {
  provider: 'fal', modelId: 'veo-3-1', mediaType: 'video', inputMode: 'text',
  prompt: 'Space Sheep on stage at a tech event', values: {}, referenceIds: [],
};
const startedAt = Date.now() - 79_000;
const running: CloudJobView = { id: 'job-1', provider: 'fal', state: 'running', errorCode: null, request, createdAt: startedAt, updatedAt: startedAt };
const queued: CloudJobView = { ...running, id: 'job-2', state: 'queued', request: { ...request, mediaType: 'image', prompt: 'A canal at dusk' } };
const saved: CloudAsset = { id: 'image-1', kind: 'image', mimeType: 'image/png', bytes: 1200, createdAt: 2, metadata: { ...request, prompt: 'A tram at dawn' }, jobId: 'job-0' };

const refresh = vi.fn();
vi.mock('@/lib/account/use-library', () => ({
  useAccountLibrary: () => ({
    jobs: [running, queued], assets: [saved], storage: null,
    counts: { all: 1, image: 1, video: 0, temporary: 0 }, error: null,
    loading: false, cursor: null, nextCursor: null, page: vi.fn(), refresh,
  }),
  formatAccountBytes: (n: number) => `${n} B`,
}));

const session: AccountSession = {
  account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' },
  googleEnabled: true, localSignIn: true, providers: ['fal'], connections: [],
};

async function openGenerating() {
  render(<AccountPage />);
  const pill = await screen.findByRole('button', { name: /^Generating/ });
  fireEvent.click(pill);
}

function card(prompt: string) {
  return screen.getByText(prompt).closest('li');
}

describe('a job still running in the cloud library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.getState().applySession(session);
    vi.stubGlobal('fetch', vi.fn());
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('is a card carrying everything already known about the run', async () => {
    await openGenerating();

    const running = card('Space Sheep on stage at a tech event');
    expect(running).toBeInTheDocument();
    // Model named rather than left as the vendor id, beside the media type and
    // the provider — the same three facts a saved card's meta line carries.
    expect(running).toHaveTextContent('fal · video · Veo 3.1 Standard');
    // The state and how long it has been in it, in the well that stands in for
    // the thumbnail.
    expect(running).toHaveTextContent('Generating');
    expect(running).toHaveTextContent('1:19');
    // Progress is stated without a fabricated percentage.
    const bar = screen.getAllByRole('progressbar')[0];
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringContaining('The provider is working on it.'));
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('keeps the cancel a queued job still allows', async () => {
    await openGenerating();

    expect(card('A canal at dusk')).toHaveTextContent('Waiting for a free slot.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('leaves the saved assets to the grid', async () => {
    await openGenerating();

    expect(screen.queryByText('A tram at dawn')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    await waitFor(() => expect(screen.getByText('A tram at dawn')).toBeInTheDocument());
  });
});
