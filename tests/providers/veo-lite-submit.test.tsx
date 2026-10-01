import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import type { CloudJobView } from '@/lib/account/contracts';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';
import { useRunLocationStore } from '@/store/useRunLocationStore';
import { submitProviderVideo } from '@/lib/providers/browser';

const { refresh, upload, submit } = vi.hoisted(() => ({
  refresh: vi.fn(),
  upload: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/providers/browser', () => ({
  submitProviderVideo: vi.fn().mockResolvedValue('task'),
  getProviderVideoStatus: vi.fn(),
  pollDelayMs: () => 100000,
}));
vi.mock('@/lib/micro-ai/browser', () => ({
  requestPromptSlug: vi.fn().mockResolvedValue(null),
  requestExamplePrompt: vi.fn(),
}));
vi.mock('@/lib/account/session', () => ({ refreshAccount: refresh }));
vi.mock('@/lib/account/client', () => ({
  uploadAccountReferences: upload,
  submitAccountJob: submit,
  accountRequest: vi.fn(),
  accountAssetUrl: vi.fn(),
}));

const session: AccountSession = {
  account: { id: 'owner', name: 'Owner', email: 'owner@example.test' },
  googleEnabled: true,
  localSignIn: false,
  providers: ['runware'],
  connections: [{ id: 'runware-connection', provider: 'runware', revision: 1, hint: 'test' }],
};

const job: CloudJobView = {
  id: 'account-job',
  provider: 'runware',
  state: 'queued',
  errorCode: null,
  request: {
    provider: 'runware',
    modelId: 'google:veo@3.1-lite',
    mediaType: 'video',
    inputMode: 'text',
    prompt: 'A paper lantern over a canal',
    values: {},
    referenceIds: [],
  },
  createdAt: 1,
  updatedAt: 1,
};

function renderLite() {
  render(
    <ProviderVideoWorkspace
      provider="runware"
      label="Runware"
      inputMode="text"
      onBack={() => undefined}
      onOpenConnections={() => undefined}
    />
  );
}

describe('Veo 3.1 Lite submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunLocationStore.getState().reset();
    useProviderJobsStore.getState().clearJobs();
    useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
    useAccountStore.setState({ status: 'ready', session: null, epoch: 0, jobs: [], assets: [] });
    useAppStore.setState({ runwareApiKey: 'runware-key', runwareVideoModel: 'google:veo@3.1-lite' });
    refresh.mockResolvedValue(session);
    upload.mockResolvedValue([]);
    submit.mockResolvedValue({ job });
  });

  it('hides the aspect control when the size already names the ratio, and prices a silent 4s 720p clip at $0.12', () => {
    renderLite();

    expect(screen.queryByRole('combobox', { name: 'Aspect ratio' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Generate audio' })).toHaveAccessibleDescription(
      'Audio changes the price per second.'
    );
    expect(screen.getByRole('button', { name: /^Generate video/ })).toHaveAccessibleName(/~\$0\.12/);
    expect(screen.getByText(/Silent is \$0\.03\/s at 720p/)).toBeInTheDocument();
  });

  it('submits a guest run with the ratio from the selected size, never the string "undefined"', async () => {
    renderLite();
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'A paper lantern over a canal' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Output size/ }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(submitProviderVideo).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(submitProviderVideo).mock.calls[0][0];
    expect(payload).toMatchObject({
      provider: 'runware',
      model: 'google:veo@3.1-lite',
      durationSeconds: 4,
      size: '720p · 9:16',
      audio: false,
      aspectRatio: '9:16',
    });
    expect(payload.aspectRatio).not.toBe('undefined');
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits an account run with the ratio from the selected size, never the string "undefined"', async () => {
    useAccountStore.getState().applySession(session);
    useAppStore.setState({ runwareApiKey: '' });
    renderLite();
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'A paper lantern over a canal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const request = submit.mock.calls[0][1];
    expect(request).toMatchObject({
      provider: 'runware',
      modelId: 'google:veo@3.1-lite',
      mediaType: 'video',
      inputMode: 'text',
      values: {
        durationSeconds: 4,
        size: '720p · 16:9',
        audio: false,
        aspectRatio: '16:9',
      },
    });
    expect(request.values.aspectRatio).not.toBe('undefined');
    expect(submitProviderVideo).not.toHaveBeenCalled();
  });

  it('still sends the aspect a model with its own control has selected', async () => {
    useAppStore.setState({ piapiApiKey: 'piapi-key', piapiVideoModel: 'veo-3.1-fast' });
    render(
      <ProviderVideoWorkspace
        provider="piapi"
        label="PiAPI"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'A paper lantern over a canal' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(submitProviderVideo).toHaveBeenCalledTimes(1));
    expect(vi.mocked(submitProviderVideo).mock.calls[0][0]).toMatchObject({
      provider: 'piapi',
      model: 'veo-3.1-fast',
      aspectRatio: '9:16',
    });
  });
});
