import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CloudJobPanel from '@/components/account/CloudJobPanel';
import type { CloudJobView } from '@/lib/account/contracts';
import { useAccountStore } from '@/store/useAccountStore';

vi.mock('@/lib/account/client', () => ({ accountRequest: vi.fn() }));

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const request = { provider: 'gemini' as const, modelId: 'gemini-3-pro-image-preview', mediaType: 'image' as const, inputMode: 'text' as const, values: {}, referenceIds: [] };
function job(id: string, state: CloudJobView['state'], prompt: string): CloudJobView {
  return { id, provider: 'gemini', request: { ...request, prompt }, state, errorCode: null, createdAt: 1, updatedAt: 1 };
}

describe('the workspace result panel', () => {
  beforeEach(() => {
    useAccountStore.getState().applySession({
      account: { id: 'owner-1', name: 'Owner', email: 'owner@example.test' },
      googleEnabled: true,
      localSignIn: false,
      providers: [],
      connections: [],
    });
  });

  it('lists jobs still in flight or stopped, but not ones already saved', () => {
    const { epoch } = useAccountStore.getState();
    useAccountStore.getState().applyJobs('owner-1', epoch, [
      job('done', 'saved', 'Already saved prompt'),
      job('running', 'running', 'Still running prompt'),
      job('stopped', 'failed', 'Stopped prompt'),
    ], []);

    render(<CloudJobPanel provider="gemini" modelId="gemini-3-pro-image-preview" mediaType="image" inputMode="text" />);

    expect(screen.queryByText('Already saved prompt')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Still running prompt')).toBeInTheDocument();
    expect(screen.getByText('Stopped prompt')).toBeInTheDocument();
  });

  it('shows image jobs from every provider and model, not just the selected one', () => {
    const { epoch } = useAccountStore.getState();
    const other: CloudJobView = {
      id: 'kie-running',
      provider: 'kie',
      request: { ...request, provider: 'kie', modelId: 'flux-kontext-pro', inputMode: 'image', prompt: 'Kie prompt' },
      state: 'running',
      errorCode: null,
      createdAt: 1,
      updatedAt: 1,
    };
    useAccountStore.getState().applyJobs('owner-1', epoch, [job('gem', 'running', 'Gemini prompt'), other], []);

    render(<CloudJobPanel provider="gemini" modelId="gemini-3-pro-image-preview" mediaType="image" inputMode="text" />);

    expect(screen.getByText('Gemini prompt')).toBeInTheDocument();
    expect(screen.getByText('Kie prompt')).toBeInTheDocument();
  });
});
