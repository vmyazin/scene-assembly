import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import VideoWorkspace from '@/components/VideoWorkspace';
import { submitProviderVideo } from '@/lib/providers/browser';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/FalGenerationWorkspace', () => ({ default: () => <div>fal image flow</div> }));
vi.mock('@/components/KieGenerationWorkspace', () => ({
  default: ({ inputMode }: { inputMode: string }) => <div>Kie image flow: {inputMode}</div>,
}));

function renderVideo(inputMode: 'text' | 'image' | 'frames' | 'reference' = 'reference') {
  return render(
    <VideoWorkspace
      inputMode={inputMode}
      onInputModeChange={vi.fn()}
      onExit={() => undefined}
      onOpenConnections={() => undefined}
    />
  );
}

beforeEach(() => {
  useAppStore.setState({
    videoEngine: 'runware',
    runwareApiKey: 'rw-key',
    runwareVideoModel: 'alibaba:wan@3.0',
    atlasVideoModel: 'ltx-2.3-quality/text-to-video',
    cometVideoModel: 'seedance-2-5',
  });
  useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
  useProviderJobsStore.getState().clearJobs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
  useProviderJobsStore.getState().clearJobs();
});

describe('reference video and audio controls', () => {
  it('shows the clip tray on Seedance and hides it on Wan', () => {
    useAppStore.setState({ runwareVideoModel: 'alibaba:wan@3.0' });
    const view = renderVideo('reference');
    expect(screen.queryByRole('heading', { name: 'Reference video and audio' })).not.toBeInTheDocument();

    useAppStore.setState({ runwareVideoModel: 'bytedance:seedance@2.5' });
    view.rerender(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={vi.fn()}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    expect(screen.getByRole('heading', { name: 'Reference video and audio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Upload reference video')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload reference audio')).toBeInTheDocument();
    expect(screen.getAllByText(/@Video1/).length).toBeGreaterThan(1);
  });
});

describe('reference video mode routing', () => {
  it('keeps Character references visible and disables engines without the mode', () => {
    const onInputModeChange = vi.fn();
    const view = render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: /Character references/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Character references/i }));
    expect(onInputModeChange).toHaveBeenCalledWith('reference');

    view.rerender(
      <VideoWorkspace
        inputMode="reference"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    expect(screen.getByRole('button', { name: /Character references/i })).toBeInTheDocument();
    for (const name of ['Kie.ai', 'fal.ai', 'CometAPI']) {
      expect(screen.getByRole('radio', { name })).toBeDisabled();
    }
    // Atlas gained the mode with Seedance 2.0's reference-to-video endpoints.
    expect(screen.getByRole('radio', { name: 'Atlas Cloud' })).toBeEnabled();
  });

  it('moves an unsupported reference deep link to an engine that has the mode', () => {
    useAppStore.setState({ videoEngine: 'kie' });
    renderVideo();
    expect(screen.queryByText(/Kie image flow/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Character references/i })).toHaveAttribute('aria-pressed', 'true');
    expect(useAppStore.getState().videoEngine).toBe('runware');
  });

  it('shows character-view guidance and Image tokens in the Runware workspace', () => {
    useDraftStore.setState({
      prompt: 'A character walks through a market',
      references: [
        { id: 'one', file: new File(['1'], 'one.png', { type: 'image/png' }), previewUrl: 'blob:one' },
        { id: 'two', file: new File(['2'], 'two.png', { type: 'image/png' }), previewUrl: 'blob:two' },
      ],
    });
    render(
      <ProviderVideoWorkspace
        provider="runware"
        label="Runware"
        inputMode="reference"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    expect(screen.getByText('Add character views')).toBeInTheDocument();
    expect(screen.getByText(/front, three-quarter, or profile/i)).toBeInTheDocument();
    expect(screen.getByText('Image 1')).toBeInTheDocument();
    expect(screen.getByText('Image 2')).toBeInTheDocument();
    expect(screen.getByAltText(/Image 1 character reference/i)).toBeInTheDocument();
    expect(screen.getByAltText(/Image 2 character reference/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 5/i)).toBeInTheDocument();
  });

  it('sends the semantic reference mode from the browser client', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, taskId: 'task-reference' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await submitProviderVideo({
      provider: 'runware',
      apiKey: 'rw-key',
      model: 'alibaba:wan@3.0',
      prompt: 'A character walks',
      images: ['data:image/png;base64,AAA'],
      inputMode: 'reference',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      inputMode: 'reference',
      provider: 'runware',
      model: 'alibaba:wan@3.0',
    });
  });
});
